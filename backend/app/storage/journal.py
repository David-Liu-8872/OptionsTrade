from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
import sqlite3
from typing import Any

from app.models import PaperTradeCreate, PaperTradeRecord
from app.providers.market_data import fetch_ticker_snapshot
from app.providers.moomoo_client import moomoo_client


DB_PATH = Path(__file__).resolve().parents[2] / "data" / "paper_journal.db"


def _get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS paper_trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'OPEN',
            symbol TEXT NOT NULL,
            strategy TEXT NOT NULL,
            strategy_label TEXT NOT NULL,
            expiration TEXT NOT NULL,
            dte_at_entry INTEGER NOT NULL,
            short_strike REAL NOT NULL,
            long_strike REAL,
            contracts INTEGER NOT NULL DEFAULT 1,
            entry_net_credit_dollars REAL NOT NULL,
            max_loss_dollars REAL NOT NULL,
            collateral_required REAL NOT NULL,
            breakeven_price REAL NOT NULL,
            spot_at_entry REAL NOT NULL,
            moomoo_codes_json TEXT NOT NULL,
            moomoo_order_status TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT ''
        )
        """
    )
    conn.commit()
    return conn


def add_paper_trade(payload: PaperTradeCreate) -> PaperTradeRecord:
    order_status = "本地模拟持仓"
    if payload.submit_to_moomoo_sim and payload.moomoo_codes:
        actions = ["SELL", "BUY"] if len(payload.moomoo_codes) == 2 else ["SELL"]
        per_share = round(payload.entry_net_credit_dollars / 100.0, 2)
        prices = [per_share, 0.10] if len(payload.moomoo_codes) == 2 else [per_share]
        order_status = moomoo_client.submit_paper_legs(
            payload.moomoo_codes,
            actions,
            prices,
            qty=payload.contracts,
        )

    created_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    with _get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO paper_trades (
                created_at, status, symbol, strategy, strategy_label, expiration,
                dte_at_entry, short_strike, long_strike, contracts,
                entry_net_credit_dollars, max_loss_dollars, collateral_required,
                breakeven_price, spot_at_entry, moomoo_codes_json, moomoo_order_status, notes
            ) VALUES (?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                created_at,
                payload.symbol.upper(),
                payload.strategy,
                payload.strategy_label,
                payload.expiration,
                payload.dte_at_entry,
                payload.short_strike,
                payload.long_strike,
                payload.contracts,
                payload.entry_net_credit_dollars,
                payload.max_loss_dollars,
                payload.collateral_required,
                payload.breakeven_price,
                payload.spot_at_entry,
                json.dumps(payload.moomoo_codes),
                order_status,
                payload.notes,
            ),
        )
        row_id = int(cur.lastrowid)

    records = list_paper_trades()
    for rec in records:
        if rec.id == row_id:
            return rec
    raise RuntimeError("Failed to retrieve created paper trade")


def close_paper_trade(trade_id: int) -> bool:
    with _get_conn() as conn:
        cur = conn.execute("UPDATE paper_trades SET status = 'CLOSED' WHERE id = ?", (trade_id,))
        conn.commit()
        return cur.rowcount > 0


def delete_paper_trade(trade_id: int) -> bool:
    with _get_conn() as conn:
        cur = conn.execute("DELETE FROM paper_trades WHERE id = ?", (trade_id,))
        conn.commit()
        return cur.rowcount > 0


def _enrich_row(row: sqlite3.Row, spot_map: dict[str, float]) -> PaperTradeRecord:
    today = datetime.now().date()
    exp_date = datetime.strptime(row["expiration"], "%Y-%m-%d").date()
    current_dte = max(0, (exp_date - today).days)
    sym = row["symbol"]
    spot_entry = float(row["spot_at_entry"])
    current_spot = spot_map.get(sym, spot_entry)

    entry_credit = float(row["entry_net_credit_dollars"]) * int(row["contracts"])
    max_loss = float(row["max_loss_dollars"]) * int(row["contracts"])
    dte_entry = max(1, int(row["dte_at_entry"]))
    time_progress = max(0.0, min(1.0, (dte_entry - current_dte) / dte_entry))

    # Estimate mark-to-market P&L combining theta decay and underlying spot drift
    spot_move_pct = (current_spot - spot_entry) / max(spot_entry, 1.0)
    theta_gain = entry_credit * (time_progress ** 0.85)
    if row["strategy"] in ("bull_put_spread", "cash_secured_put"):
        directional_adj = spot_move_pct * entry_credit * 3.2
    else:
        directional_adj = spot_move_pct * entry_credit * 1.5

    est_pnl = max(-max_loss, min(entry_credit, round(theta_gain + directional_adj, 2)))
    pnl_pct = round((est_pnl / max(entry_credit, 1.0)) * 100.0, 1)

    alert_tag: str | None = None
    alert_message: str | None = None
    if row["status"] == "OPEN":
        if pnl_pct >= 50.0:
            alert_tag = "TAKE_PROFIT_50"
            alert_message = f"已达 {pnl_pct:.0f}% 利润目标！新手纪律：建议立即买回平仓落袋为安。"
        elif row["strategy"] != "covered_call" and current_spot <= float(row["short_strike"]):
            alert_tag = "STRIKE_TESTED"
            alert_message = f"现价 ${current_spot:.2f} 已触及卖出执行价 ${row['short_strike']:g}，请检查止损或移仓规则！"
        elif current_dte <= 21:
            alert_tag = "DTE_21_EXIT"
            alert_message = f"距离到期仅剩 {current_dte} 天（≤21天 Gamma 加速区），建议择机平仓或向后移仓。"

    return PaperTradeRecord(
        id=int(row["id"]),
        created_at=row["created_at"],
        status=row["status"],
        symbol=sym,
        strategy=row["strategy"],
        strategy_label=row["strategy_label"],
        expiration=row["expiration"],
        current_dte=current_dte,
        short_strike=float(row["short_strike"]),
        long_strike=float(row["long_strike"]) if row["long_strike"] is not None else None,
        contracts=int(row["contracts"]),
        entry_net_credit_dollars=round(entry_credit, 2),
        max_loss_dollars=round(max_loss, 2),
        collateral_required=round(float(row["collateral_required"]) * int(row["contracts"]), 2),
        breakeven_price=float(row["breakeven_price"]),
        spot_at_entry=spot_entry,
        current_spot=round(current_spot, 2),
        estimated_current_pnl=est_pnl,
        pnl_pct_of_max_profit=pnl_pct,
        moomoo_codes=json.loads(row["moomoo_codes_json"]),
        moomoo_order_status=row["moomoo_order_status"],
        alert_tag=alert_tag,
        alert_message=alert_message,
        notes=row["notes"],
    )


def list_paper_trades() -> list[PaperTradeRecord]:
    with _get_conn() as conn:
        rows = conn.execute("SELECT * FROM paper_trades ORDER BY id DESC").fetchall()
    if not rows:
        return []
    syms = list({r["symbol"] for r in rows})
    spot_map: dict[str, float] = {}
    for sym in syms:
        try:
            snap = fetch_ticker_snapshot(sym)
            spot_map[sym] = float(snap["spot_price"])
        except Exception:
            pass
    return [_enrich_row(r, spot_map) for r in rows]
