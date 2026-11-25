#!/usr/bin/env python3
"""
Lightweight Zero-CPU Cloud Cron Watchdog for OptionsTrade.
Checks if US options market is currently open (America/New_York).
If GitHub Actions' best-effort `on: schedule` missed or dropped a 30-min slot
(last_updated_at > 28 mins old and no run currently queued/in_progress),
triggers `gh workflow run auto_paper_trade.yml` on GitHub Cloud.
"""
from __future__ import annotations

from datetime import datetime
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from zoneinfo import ZoneInfo

REPO = "David-Liu-8872/OptionsTrade"
WORKFLOW = "auto_paper_trade.yml"
US_EASTERN = ZoneInfo("America/New_York")


def is_market_or_settlement_window(cur: datetime) -> bool:
    d = cur.date()
    if cur.weekday() >= 5:
        return False
    if (d.month, d.day) in {(1, 1), (6, 19), (7, 4), (12, 25)}:
        return False
    if d.month == 11 and d.weekday() == 3 and 22 <= d.day <= 28:
        return False
    mins = cur.hour * 60 + cur.minute
    is_early = (d.month == 11 and d.weekday() == 4 and 23 <= d.day <= 29) or (d.month, d.day) == (12, 24)
    close_min = (13 * 60 + 20) if is_early else (16 * 60 + 20)
    return (9 * 60 + 36) <= mins <= close_min


def main() -> int:
    now_et = datetime.now(US_EASTERN)
    if not is_market_or_settlement_window(now_et):
        return 0

    env = os.environ.copy()
    env["PATH"] = f"/opt/homebrew/bin:/usr/local/bin:{env.get('PATH', '/usr/bin:/bin')}"
    gh_bin = shutil.which("gh", path=env["PATH"])
    if not gh_bin:
        return 0

    try:
        # 1. Check if a run is already queued or in_progress
        runs_raw = subprocess.check_output(
            [gh_bin, "run", "list", "--repo", REPO, "--limit", "3", "--json", "status"],
            env=env,
            timeout=15,
        )
        runs = json.loads(runs_raw)
        if any(r.get("status") in ("queued", "in_progress", "waiting") for r in runs):
            return 0

        # 2. Check live last_updated_at on main branch
        req = urllib.request.Request(
            f"https://api.github.com/repos/{REPO}/contents/data/sim_portfolio.json?ref=main",
            headers={"Accept": "application/vnd.github.raw+json", "User-Agent": "OptionsTrade-Watchdog"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            portfolio = json.loads(resp.read().decode("utf-8"))

        last_str = portfolio.get("last_updated_at", "")
        last_dt = datetime.strptime(last_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=US_EASTERN)

        # Skip if today's closing settlement (16:00:00) was already recorded
        if last_dt.date() == now_et.date() and last_str.endswith("16:00:00") and (now_et.hour * 60 + now_et.minute) >= 16 * 60:
            return 0

        elapsed_mins = (now_et - last_dt).total_seconds() / 60.0
        if elapsed_mins >= 28.0:
            subprocess.run(
                [gh_bin, "workflow", "run", WORKFLOW, "--repo", REPO],
                env=env,
                timeout=20,
                check=False,
            )
            print(f"[{now_et.strftime('%Y-%m-%d %H:%M:%S')} ET] Triggered cloud workflow_dispatch (elapsed {elapsed_mins:.1f}m)")
    except Exception as exc:
        print(f"Watchdog check skipped: {exc}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
