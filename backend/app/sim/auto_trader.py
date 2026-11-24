from __future__ import annotations

from datetime import datetime
import json
import math
import os
from pathlib import Path
from typing import Any

import requests
import yfinance as yf

from app.models import (
    SimActivityEvent,
    SimConfig,
    SimEquityPoint,
    SimPortfolioState,
    SimPosition,
    SimPositionLeg,
)
from app.providers.market_data import fetch_batch_snapshots, fetch_ticker_snapshot
from app.quant.bs_pricing import bs_price_and_greeks, estimate_moomoo_us_option_fee
from app.quant.strategies import build_candidates_for_ticker


REPO_ROOT = Path(__file__).resolve().parents[3]
SIM_STATE_PATH = REPO_ROOT / "data" / "sim_portfolio.json"


def _now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _today_str() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _get_spy_spot() -> float:
    try:
        snap = fetch_ticker_snapshot("SPY")
        return float(snap["spot_price"])
    except Exception:
        return 595.0


def load_or_init_sim_state(state_path: Path = SIM_STATE_PATH) -> SimPortfolioState:
    if state_path.exists():
        raw = json.loads(state_path.read_text(encoding="utf-8"))
        return SimPortfolioState(**raw)

    cfg = SimConfig()
    spy_spot = _get_spy_spot()
    now_s = _now_str()
    today_s = _today_str()
    init_pt = SimEquityPoint(
        timestamp=now_s,
        date=today_s,
        total_equity=cfg.initial_capital,
        cash_available=cfg.initial_capital,
        collateral_locked=0.0,
        realized_pnl_cum=0.0,
        unrealized_pnl=0.0,
        spy_benchmark_equity=cfg.initial_capital,
        drawdown_pct=0.0,
        open_positions_count=0,
    )
    state = SimPortfolioState(
        started_at=now_s,
        last_updated_at=now_s,
        days_running=1,
        total_runs=0,
        spy_entry_spot=spy_spot,
        spy_current_spot=spy_spot,
        config=cfg,
        total_equity=cfg.initial_capital,
        total_return_dollars=0.0,
        total_return_pct=0.0,
        spy_return_pct=0.0,
        cash_available=cfg.initial_capital,
        collateral_locked=0.0,
        utilization_pct=0.0,
        realized_pnl_cum=0.0,
        unrealized_pnl=0.0,
        win_count=0,
        loss_count=0,
        win_rate_pct=0.0,
        max_drawdown_pct=0.0,
        open_positions=[],
        closed_positions=[],
        equity_curve=[init_pt],
        activity_log=[
            SimActivityEvent(
                timestamp=now_s,
                event_type="INIT",
                symbol="PORTFOLIO",
                summary=f"初始化 30 天全自动模拟账户，起始本金 ${cfg.initial_capital:,.0f}，基准 SPY 入场价 ${spy_spot:.2f}",
            )
        ],
    )
    save_sim_state(state, state_path)
    return state


def save_sim_state(state: SimPortfolioState, state_path: Path = SIM_STATE_PATH) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(
        json.dumps(state.model_dump(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _fetch_live_chain_lookup(symbol: str, expiration: str) -> dict[tuple[str, float], tuple[float, float, float]]:
    """
    Return {(option_type, strike): (bid, ask, lastPrice)} from live yfinance option chain.
    """
    lookup: dict[tuple[str, float], tuple[float, float, float]] = {}
    try:
        tk = yf.Ticker(symbol)
        if expiration not in (tk.options or []):
            return lookup
        oc = tk.option_chain(expiration)
        for opt_type, df in (("PUT", oc.puts), ("CALL", oc.calls)):
            if df is None or df.empty:
                continue
            for _, r in df.iterrows():
                strike = round(float(r["strike"]), 2)
                bid = float(r.get("bid") or 0.0)
                ask = float(r.get("ask") or 0.0)
                last_p = float(r.get("lastPrice") or 0.0)
                if math.isnan(bid):
                    bid = 0.0
                if math.isnan(ask):
                    ask = 0.0
                if math.isnan(last_p):
                    last_p = 0.0
                lookup[(opt_type, strike)] = (bid, ask, last_p)
    except Exception:
        pass
    return lookup


def _mark_position_to_market(
    pos: SimPosition,
    spot_price: float,
    chain_lookup: dict[tuple[str, float], tuple[float, float, float]],
) -> SimPosition:
    today = datetime.now().date()
    exp_date = datetime.strptime(pos.expiration, "%Y-%m-%d").date()
    current_dte = max(0, (exp_date - today).days)
    t_years = max(current_dte / 365.0, 1e-6)

    updated_legs: list[SimPositionLeg] = []
    close_debit_per_share = 0.0

    for leg in pos.legs:
        key = (leg.option_type, round(leg.strike, 2))
        if current_dte == 0:
            # Exact intrinsic value at expiration
            mark = (
                max(0.0, spot_price - leg.strike)
                if leg.option_type == "CALL"
                else max(0.0, leg.strike - spot_price)
            )
        elif key in chain_lookup:
            bid, ask, last_p = chain_lookup[key]
            if bid > 0 and ask >= bid:
                mid = 0.5 * (bid + ask)
                # Conservative fill penalty: pay slightly above mid to buy back short, receive slightly below mid to sell long
                slip = min(0.05, 0.15 * (ask - bid))
                mark = (mid + slip) if leg.action == "SELL" else max(0.01, mid - slip)
            elif last_p > 0:
                mark = last_p
            else:
                g = bs_price_and_greeks(spot_price, leg.strike, t_years, leg.iv_at_entry, leg.option_type)
                mark = g.price
        else:
            g = bs_price_and_greeks(spot_price, leg.strike, t_years, leg.iv_at_entry, leg.option_type)
            mark = g.price

        mark = round(max(0.0, mark), 2)
        updated_legs.append(leg.model_copy(update={"current_mark": mark}))

        if leg.action == "SELL":
            close_debit_per_share += mark
        else:
            close_debit_per_share -= mark

    # Account for Covered Call underlying 100 shares movement
    stock_pnl_dollars = 0.0
    if pos.strategy == "covered_call":
        stock_pnl_dollars = (spot_price - pos.spot_at_entry) * 100.0 * pos.contracts

    close_debit_dollars = round(max(0.0, close_debit_per_share) * 100.0 * pos.contracts, 2)
    exit_fee = (
        0.0
        if current_dte == 0 and close_debit_dollars == 0.0
        else estimate_moomoo_us_option_fee(len(pos.legs), pos.contracts)
    )
    net_pnl = round(
        pos.entry_net_credit_dollars - close_debit_dollars - exit_fee + stock_pnl_dollars,
        2,
    )
    # Clamp within theoretical max loss / max profit bounds
    net_pnl = max(-pos.max_loss_dollars, net_pnl)
    pnl_pct = round((net_pnl / max(pos.entry_net_credit_dollars, 1.0)) * 100.0, 1)

    return pos.model_copy(
        update={
            "current_dte": current_dte,
            "current_spot": round(spot_price, 2),
            "legs": updated_legs,
            "current_close_debit_dollars": close_debit_dollars,
            "exit_fee_dollars": exit_fee,
            "net_pnl_dollars": net_pnl,
            "pnl_pct_of_credit": pnl_pct,
        }
    )


def _check_exit_signal(pos: SimPosition, cfg: SimConfig) -> tuple[str | None, str | None]:
    if pos.current_dte <= 0:
        return "EXPIRED", "到期自动交割结案"
    if pos.pnl_pct_of_credit >= cfg.take_profit_pct:
        return "TAKE_PROFIT_50", f"达到 {pos.pnl_pct_of_credit:.1f}% 止盈目标 (≥{cfg.take_profit_pct:.0f}%)"
    if pos.current_close_debit_dollars >= pos.gross_credit_dollars * cfg.stop_loss_mult:
        return "STOP_LOSS_2X", f"触发 {cfg.stop_loss_mult:.1f}x 权利金风控止损线"
    if pos.current_dte <= cfg.dte_exit_threshold:
        return "DTE_21_EXIT", f"剩余 {pos.current_dte} 天触及 {cfg.dte_exit_threshold}DTE 时间防线离场"
    return None, None


def _send_notifications_if_configured(state: SimPortfolioState, new_events: list[SimActivityEvent]) -> None:
    webhook_url = os.environ.get("SIM_WEBHOOK_URL", "").strip()
    tg_token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    tg_chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()

    if not webhook_url and not (tg_token and tg_chat):
        return

    event_lines = "\n".join(f"• [{e.event_type}] {e.symbol}: {e.summary}" for e in new_events[:8])
    text = (
        f"📊 Moomoo 美股稳健期权自动模拟日报 ({state.last_updated_at})\n"
        f"账户总净值: ${state.total_equity:,.2f} ({state.total_return_pct:+.2f}% | 同期 SPY {state.spy_return_pct:+.2f}%)\n"
        f"在途持仓: {len(state.open_positions)} 笔 | 胜率: {state.win_rate_pct:.1f}% ({state.win_count}胜/{state.loss_count}负)\n"
        f"本次变动:\n{event_lines or '• 常规盯市巡检，无新开/平仓动作'}"
    )

    if webhook_url:
        try:
            # Compatible with Feishu, DingTalk, Slack, Discord
            payload: dict[str, Any] = {"text": text, "content": text, "msg_type": "text"}
            if "feishu" in webhook_url or "larksuite" in webhook_url:
                payload = {"msg_type": "text", "content": {"text": text}}
            requests.post(webhook_url, json=payload, timeout=6)
        except Exception:
            pass

    if tg_token and tg_chat:
        try:
            requests.post(
                f"https://api.telegram.org/bot{tg_token}/sendMessage",
                json={"chat_id": tg_chat, "text": text},
                timeout=6,
            )
        except Exception:
            pass


def run_auto_sim_cycle(
    *,
    allow_new_entries: bool = True,
    state_path: Path = SIM_STATE_PATH,
) -> SimPortfolioState:
    """
    Execute one complete autonomous paper-trading cycle:
      1. Mark all open positions against live US option chain Bid/Ask quotes.
      2. Auto-close positions hitting 50% TP, 21 DTE, Stop-Loss, or Expiration.
      3. Scan curated watchlist & open new top-graded (A+/A/B+) non-overlapping trades within risk limits.
      4. Update equity curve, drawdown, SPY benchmark, and persist to JSON.
    """
    state = load_or_init_sim_state(state_path)
    cfg = state.config
    now_s = _now_str()
    today_s = _today_str()
    cycle_events: list[SimActivityEvent] = []

    # 1. Fetch live spot & chains for currently open positions
    still_open: list[SimPosition] = []
    chain_cache: dict[tuple[str, str], dict[tuple[str, float], tuple[float, float, float]]] = {}
    spot_cache: dict[str, float] = {}

    for pos in state.open_positions:
        if pos.symbol not in spot_cache:
            snap = fetch_ticker_snapshot(pos.symbol)
            spot_cache[pos.symbol] = float(snap["spot_price"])
        ck = (pos.symbol, pos.expiration)
        if ck not in chain_cache:
            chain_cache[ck] = _fetch_live_chain_lookup(pos.symbol, pos.expiration)

        marked = _mark_position_to_market(pos, spot_cache[pos.symbol], chain_cache[ck])
        reason_code, reason_label = _check_exit_signal(marked, cfg)

        if reason_code:
            closed_pos = marked.model_copy(
                update={
                    "status": "CLOSED",
                    "closed_at": now_s,
                    "exit_reason": reason_code,
                    "exit_reason_label": reason_label,
                }
            )
            state.closed_positions.insert(0, closed_pos)
            state.realized_pnl_cum = round(state.realized_pnl_cum + closed_pos.net_pnl_dollars, 2)
            if closed_pos.net_pnl_dollars >= 0:
                state.win_count += 1
            else:
                state.loss_count += 1

            ev = SimActivityEvent(
                timestamp=now_s,
                event_type="CLOSE",
                symbol=closed_pos.symbol,
                summary=f"自动平仓 {closed_pos.strategy_label} (${closed_pos.short_strike:g}{f'/${closed_pos.long_strike:g}' if closed_pos.long_strike else ''}) · {reason_label} · 净盈亏 ${closed_pos.net_pnl_dollars:+.2f}",
                pnl_dollars=closed_pos.net_pnl_dollars,
            )
            cycle_events.append(ev)
        else:
            still_open.append(marked)

    state.open_positions = still_open

    # 2. Scan & auto-open new positions if slots & buying power permit
    open_symbols = {p.symbol for p in state.open_positions}
    current_collateral = sum(p.collateral_required for p in state.open_positions)
    prelim_equity = cfg.initial_capital + state.realized_pnl_cum + sum(p.net_pnl_dollars for p in state.open_positions)
    max_allowed_collateral = prelim_equity * (cfg.max_total_utilization_pct / 100.0)

    if allow_new_entries and len(state.open_positions) < cfg.max_open_positions:
        scan_syms = [s for s in cfg.watchlist if s not in open_symbols]
        snapshots = fetch_batch_snapshots(scan_syms, min_dte=24, max_dte=45, prefer_moomoo=True)
        for snap in snapshots:
            spot_cache[snap["symbol"]] = float(snap["spot_price"])

        all_cands = []
        for snap in snapshots:
            cands = build_candidates_for_ticker(
                snap,
                strategy_filter="all",
                max_capital=cfg.max_collateral_per_trade,
                min_dte=24,
                max_dte=45,
                risk_level="conservative",
                spread_width=5.0,
                exclude_earnings=True,
                only_uptrend=False,
            )
            # Filter strictly for Bull Put Spread & Cash-Secured Put with high safety score
            for c in cands:
                if c.strategy in ("bull_put_spread", "cash_secured_put") and c.safety.score_total >= cfg.min_safety_score:
                    all_cands.append(c)

        all_cands.sort(
            key=lambda c: (c.safety.score_total * 0.72 + min(c.return_on_risk_pct, 25.0) * 0.28),
            reverse=True,
        )

        for cand in all_cands:
            if len(state.open_positions) >= cfg.max_open_positions:
                break
            if cand.symbol in open_symbols:
                continue
            if current_collateral + cand.collateral_required > max_allowed_collateral:
                continue

            # Apply conservative $0.02/share entry slippage penalty so simulation never cheats
            slip_dollars = 2.0
            realistic_gross = max(10.0, round(cand.gross_credit_dollars - slip_dollars, 2))
            realistic_net_credit = round(realistic_gross - cand.moomoo_fee_dollars, 2)
            if realistic_net_credit <= 10.0:
                continue

            sim_legs = [
                SimPositionLeg(
                    action=l.action,
                    option_type=l.option_type,
                    strike=l.strike,
                    entry_mid=l.mid,
                    current_mark=l.mid,
                    iv_at_entry=l.iv,
                    moomoo_code=l.moomoo_code,
                )
                for l in cand.legs
            ]
            exit_fee_est = estimate_moomoo_us_option_fee(len(sim_legs), 1)
            new_pos = SimPosition(
                pos_id=f"SIM-{datetime.now().strftime('%m%d%H%M')}-{cand.symbol}-{int(cand.short_strike)}",
                status="OPEN",
                opened_at=now_s,
                symbol=cand.symbol,
                name=cand.name,
                strategy=cand.strategy,
                strategy_label=cand.strategy_label,
                expiration=cand.expiration,
                dte_at_entry=cand.dte,
                current_dte=cand.dte,
                contracts=1,
                short_strike=cand.short_strike,
                long_strike=cand.long_strike,
                legs=sim_legs,
                spot_at_entry=cand.spot_price,
                current_spot=cand.spot_price,
                breakeven_price=cand.breakeven_price,
                safety_score_at_entry=cand.safety.score_total,
                safety_grade_at_entry=cand.safety.grade,
                pop_at_entry=cand.pop_pct,
                gross_credit_dollars=realistic_gross,
                entry_fee_dollars=cand.moomoo_fee_dollars,
                entry_net_credit_dollars=realistic_net_credit,
                collateral_required=cand.collateral_required,
                max_loss_dollars=cand.max_loss_dollars,
                current_close_debit_dollars=realistic_gross,
                exit_fee_dollars=exit_fee_est,
                net_pnl_dollars=round(-cand.moomoo_fee_dollars - slip_dollars, 2),
                pnl_pct_of_credit=round(((-cand.moomoo_fee_dollars - slip_dollars) / realistic_net_credit) * 100.0, 1),
            )

            state.open_positions.append(new_pos)
            open_symbols.add(cand.symbol)
            current_collateral += cand.collateral_required

            cycle_events.append(
                SimActivityEvent(
                    timestamp=now_s,
                    event_type="OPEN",
                    symbol=cand.symbol,
                    summary=(
                        f"自动建仓 {cand.strategy_label} ({cand.expiration}, {cand.dte}DTE) · "
                        f"行权 ${cand.short_strike:g}{f'/${cand.long_strike:g}' if cand.long_strike else ''}P · "
                        f"安全评级 {cand.safety.grade}({cand.safety.score_total}分, POP {cand.pop_pct}%) · "
                        f"净收权利金 +${realistic_net_credit:.2f} (担保 ${cand.collateral_required:,.0f})"
                    ),
                )
            )

    # 3. Recompute Portfolio Metrics & Equity Curve
    spy_now = spot_cache.get("SPY") or _get_spy_spot()
    state.spy_current_spot = round(spy_now, 2)
    spy_bench_eq = round(cfg.initial_capital * (spy_now / max(state.spy_entry_spot, 1.0)), 2)

    collateral_locked = round(sum(p.collateral_required for p in state.open_positions), 2)
    unrealized_pnl = round(sum(p.net_pnl_dollars for p in state.open_positions), 2)
    total_equity = round(cfg.initial_capital + state.realized_pnl_cum + unrealized_pnl, 2)
    cash_available = round(max(0.0, total_equity - collateral_locked), 2)

    total_closed = state.win_count + state.loss_count
    win_rate = round((state.win_count / total_closed) * 100.0, 1) if total_closed > 0 else 0.0

    # Peak equity & drawdown calculation
    prev_peaks = [pt.total_equity for pt in state.equity_curve] + [cfg.initial_capital, total_equity]
    peak_eq = max(prev_peaks)
    current_dd_pct = round(((peak_eq - total_equity) / max(peak_eq, 1.0)) * 100.0, 2)
    max_dd = round(max([state.max_drawdown_pct, current_dd_pct]), 2)

    eq_point = SimEquityPoint(
        timestamp=now_s,
        date=today_s,
        total_equity=total_equity,
        cash_available=cash_available,
        collateral_locked=collateral_locked,
        realized_pnl_cum=state.realized_pnl_cum,
        unrealized_pnl=unrealized_pnl,
        spy_benchmark_equity=spy_bench_eq,
        drawdown_pct=current_dd_pct,
        open_positions_count=len(state.open_positions),
    )

    # Keep 1 latest snapshot per date (or append if first run vs new date, keeping initial baseline point)
    if len(state.equity_curve) >= 2 and state.equity_curve[-1].date == today_s:
        state.equity_curve[-1] = eq_point
    else:
        state.equity_curve.append(eq_point)

    if not cycle_events:
        cycle_events.append(
            SimActivityEvent(
                timestamp=now_s,
                event_type="MARK",
                symbol="PORTFOLIO",
                summary=f"盘中自动盯市完成：在途 {len(state.open_positions)} 笔，浮动盈亏 ${unrealized_pnl:+.2f}，总净值 ${total_equity:,.2f}",
            )
        )

    state.activity_log = (cycle_events + state.activity_log)[:80]
    started_dt = datetime.strptime(state.started_at[:10], "%Y-%m-%d").date()
    state.days_running = max(1, (datetime.now().date() - started_dt).days + 1)
    state.last_updated_at = now_s
    state.total_runs += 1
    state.total_equity = total_equity
    state.total_return_dollars = round(total_equity - cfg.initial_capital, 2)
    state.total_return_pct = round(((total_equity - cfg.initial_capital) / cfg.initial_capital) * 100.0, 2)
    state.spy_return_pct = round(((spy_now - state.spy_entry_spot) / max(state.spy_entry_spot, 1.0)) * 100.0, 2)
    state.cash_available = cash_available
    state.collateral_locked = collateral_locked
    state.utilization_pct = round((collateral_locked / max(total_equity, 1.0)) * 100.0, 1)
    state.unrealized_pnl = unrealized_pnl
    state.win_rate_pct = win_rate
    state.max_drawdown_pct = max_dd

    save_sim_state(state, state_path)
    _send_notifications_if_configured(state, cycle_events)
    return state


def reset_sim_portfolio(state_path: Path = SIM_STATE_PATH) -> SimPortfolioState:
    if state_path.exists():
        state_path.unlink()
    return load_or_init_sim_state(state_path)
