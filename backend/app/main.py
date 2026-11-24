from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.models import (
     ConePoint,
    MoomooStatusResponse,
    PaperTradeCreate,
    PaperTradeRecord,
    PayoffCurveRequest,
    PayoffCurveResponse,
    PricePoint,
    ScreenerRequest,
    ScreenerResponse,
    SimPortfolioState,
    StrategyCandidate,
)
from app.providers.market_data import fetch_batch_snapshots, get_price_history
from app.providers.moomoo_client import moomoo_client
from app.providers.presets import PRESET_POOLS
from app.quant.bs_pricing import generate_probability_cone
from app.quant.strategies import build_candidates_for_ticker, compute_payoff_grid
from app.sim.auto_trader import load_or_init_sim_state, reset_sim_portfolio, run_auto_sim_cycle
from app.storage.journal import add_paper_trade, close_paper_trade, delete_paper_trade, list_paper_trades

app = FastAPI(
    title="Moomoo US Options Low-Risk Screener & Visualizer",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check() -> dict:
    return {"ok": True, "timestamp": datetime.now().isoformat()}


@app.get("/api/presets")
def get_presets() -> dict:
    return {"pools": list(PRESET_POOLS.values())}


@app.get("/api/moomoo/status", response_model=MoomooStatusResponse)
def get_moomoo_status() -> MoomooStatusResponse:
    st = moomoo_client.check_status()
    return MoomooStatusResponse(**st)


@app.post("/api/screener/scan", response_model=ScreenerResponse)
def run_screener(req: ScreenerRequest) -> ScreenerResponse:
    if req.pool_id == "custom" and req.custom_symbols:
        symbols = [s.strip().upper() for s in req.custom_symbols if s.strip()]
    else:
        pool = PRESET_POOLS.get(req.pool_id, PRESET_POOLS["beginner_etf"])
        symbols = list(pool["symbols"])
        if req.custom_symbols:
            for cs in req.custom_symbols:
                clean = cs.strip().upper()
                if clean and clean not in symbols:
                    symbols.append(clean)

    snapshots = fetch_batch_snapshots(
        symbols=symbols,
        min_dte=req.min_dte,
        max_dte=req.max_dte,
        prefer_moomoo=req.prefer_moomoo,
    )

    all_candidates: list[StrategyCandidate] = []
    sources_seen: set[str] = set()
    market_notes: list[str] = []

    for snap in snapshots:
        sources_seen.add(snap["data_source"])
        if snap.get("days_to_earnings") is not None and 0 <= snap["days_to_earnings"] <= req.max_dte:
            if req.exclude_earnings:
                market_notes.append(
                    f"已自动拦截 {snap['symbol']} 跨越财报 ({snap['earnings_date']}，{snap['days_to_earnings']}天后) 的高风险期权链"
                )
        cands = build_candidates_for_ticker(
            snap,
            strategy_filter=req.strategy,
            max_capital=req.max_capital_per_trade,
            min_dte=req.min_dte,
            max_dte=req.max_dte,
            risk_level=req.risk_level,
            spread_width=req.spread_width,
            exclude_earnings=req.exclude_earnings,
            only_uptrend=req.only_uptrend,
        )
        all_candidates.extend(cands)

    # Sort primarily by Beginner Safety Score + Expected Value / Risk-adjusted return
    all_candidates.sort(
        key=lambda c: (c.safety.score_total * 0.68 + min(c.annualized_roc_pct, 45.0) * 0.32),
        reverse=True,
    )

    if "moomoo_opend" in sources_seen:
        active_source = "Moomoo OpenD 实时期权链"
    elif "yfinance_live" in sources_seen:
        active_source = "美股实时行情 (Yahoo Finance)"
    else:
        active_source = "离线仿真行情"

    return ScreenerResponse(
        generated_at=datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d %H:%M:%S ET"),
        active_source=active_source,
        moomoo_connected=moomoo_client.is_port_open(),
        scanned_symbols=[s["symbol"] for s in snapshots],
        total_candidates=len(all_candidates),
        candidates=all_candidates[:45],
        market_notes=market_notes[:5],
    )


@app.post("/api/payoff/analyze", response_model=PayoffCurveResponse)
def analyze_payoff(req: PayoffCurveRequest) -> PayoffCurveResponse:
    if not req.legs:
        raise HTTPException(status_code=400, detail="At least one option leg is required")

    grid, breakeven, max_profit, max_loss, sd_low, sd_high = compute_payoff_grid(req)
    avg_iv = sum(l.iv for l in req.legs) / len(req.legs)
    cone_raw = generate_probability_cone(req.spot_price, avg_iv, req.dte)
    hist_raw = get_price_history(req.symbol) if req.symbol else []

    return PayoffCurveResponse(
        symbol=req.symbol,
        spot_price=req.spot_price,
        breakeven_price=breakeven,
        max_profit_dollars=max_profit,
        max_loss_dollars=max_loss,
        one_sd_low=sd_low,
        one_sd_high=sd_high,
        grid=grid,
        price_history=[PricePoint(**p) for p in hist_raw],
        probability_cone=[ConePoint(**c) for c in cone_raw],
    )


@app.get("/api/journal", response_model=list[PaperTradeRecord])
def get_journal() -> list[PaperTradeRecord]:
    return list_paper_trades()


@app.post("/api/journal", response_model=PaperTradeRecord)
def create_journal_entry(payload: PaperTradeCreate) -> PaperTradeRecord:
    return add_paper_trade(payload)


@app.post("/api/journal/{trade_id}/close")
def mark_journal_closed(trade_id: int) -> dict:
    ok = close_paper_trade(trade_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Paper trade not found")
    return {"ok": True}


@app.delete("/api/journal/{trade_id}")
def remove_journal_entry(trade_id: int) -> dict:
    ok = delete_paper_trade(trade_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Paper trade not found")
    return {"ok": True}


@app.get("/api/sim/portfolio", response_model=SimPortfolioState)
def get_sim_portfolio() -> SimPortfolioState:
    return load_or_init_sim_state()


@app.post("/api/sim/run-cycle", response_model=SimPortfolioState)
def trigger_sim_cycle(mark_only: bool = False, force: bool = True) -> SimPortfolioState:
    state, _, _ = run_auto_sim_cycle(allow_new_entries=not mark_only, force_when_closed=force)
    return state


@app.post("/api/sim/reset", response_model=SimPortfolioState)
def trigger_sim_reset() -> SimPortfolioState:
    return reset_sim_portfolio()

