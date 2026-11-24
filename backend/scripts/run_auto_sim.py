#!/usr/bin/env python3
"""
Autonomous US Options Low-Risk Paper Trading Runner (US Eastern Time).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import run_screener  # noqa: E402
from app.models import ScreenerRequest  # noqa: E402
from app.providers.presets import PRESET_POOLS  # noqa: E402
from app.sim.auto_trader import load_or_init_sim_state, run_auto_sim_cycle  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Run 1 cycle of Moomoo US Options Auto-Simulation")
    parser.add_argument("--mark-only", action="store_true", help="Only mark open positions without opening new ones")
    parser.add_argument("--force", action="store_true", help="Force execution even outside US market hours")
    parser.add_argument("--skip-sim", action="store_true", help="Skip trading cycle and only export static UI data")
    parser.add_argument("--export-static", action="store_true", help="Export static JSON snapshots for GitHub Pages")
    args = parser.parse_args()

    if args.skip_sim:
        state = load_or_init_sim_state()
        print("Skipped trading cycle (--skip-sim); loaded existing portfolio state.")
    else:
        print("=== [1/2] Checking US Market Hours & Running Paper-Trading Cycle ===")
        state, executed, msg = run_auto_sim_cycle(
            allow_new_entries=not args.mark_only,
            force_when_closed=args.force,
        )
        if not executed:
            print(f"⏭️ Skipped trading cycle: {msg}")
        else:
            print(
                f"✅ Executed at {state.last_updated_at} ET | Equity: ${state.total_equity:,.2f} "
                f"({state.total_return_pct:+.2f}%) | Open: {len(state.open_positions)} | "
                f"Closed: {len(state.closed_positions)} (WinRate {state.win_rate_pct:.1f}%)"
            )

    if args.export_static:
        print("=== [2/2] Exporting Static JSON Snapshots for GitHub Pages ===")
        public_data_dir = REPO_ROOT / "frontend" / "public" / "data"
        public_data_dir.mkdir(parents=True, exist_ok=True)

        (public_data_dir / "sim_portfolio.json").write_text(
            json.dumps(state.model_dump(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (public_data_dir / "presets.json").write_text(
            json.dumps({"pools": list(PRESET_POOLS.values())}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        scan_res = run_screener(
            ScreenerRequest(
                strategy="all",
                pool_id="beginner_etf",
                max_capital_per_trade=8000,
                min_dte=21,
                max_dte=46,
                risk_level="conservative",
                spread_width=5.0,
                exclude_earnings=True,
            )
        )
        (public_data_dir / "latest_scan.json").write_text(
            json.dumps(scan_res.model_dump(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"Static snapshots written to {public_data_dir}")


if __name__ == "__main__":
    main()
