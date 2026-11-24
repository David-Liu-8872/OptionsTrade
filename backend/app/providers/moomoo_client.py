from __future__ import annotations

import os
import socket
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


def _ensure_moomoo_log_dir() -> None:
    """Ensure moomoo SDK can initialize its logger even inside sandboxed directories."""
    default_dir = Path(os.environ.get("HOME", "")) / ".com.moomoo.OpenD" / "Log"
    try:
        default_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        fallback_home = Path(__file__).resolve().parents[2] / ".moomoo_home"
        (fallback_home / ".com.moomoo.OpenD" / "Log").mkdir(parents=True, exist_ok=True)
        os.environ["HOME"] = str(fallback_home)


class MoomooClient:
    """
    Lightweight, safe wrapper around moomoo-api (OpenD).
    - Uses fast TCP socket probe first so offline checks return in <5ms.
    - Supports reading US Stock + Option Chains from OpenQuoteContext.
    - Strictly locks order placement to TrdEnv.SIMULATE (Paper Trading) to protect beginners.
    """

    def __init__(self, host: str = "127.0.0.1", port: int = 11111) -> None:
        self.host = os.environ.get("MOOMOO_HOST", host)
        self.port = int(os.environ.get("MOOMOO_PORT", str(port)))

    def is_port_open(self, timeout: float = 0.35) -> bool:
        try:
            with socket.create_connection((self.host, self.port), timeout=timeout):
                return True
        except OSError:
            return False

    def check_status(self) -> dict[str, Any]:
        if not self.is_port_open():
            return {
                "connected": False,
                "host": self.host,
                "port": self.port,
                "quote_ok": False,
                "sim_trade_ok": False,
                "message": f"未检测到本地 moomoo OpenD ({self.host}:{self.port})，当前已自动启用美股实时期权链免费数据源 (Yahoo Finance)。开启 OpenD 后可一键无缝切换。",
                "sim_cash": None,
                "sim_total_assets": None,
            }

        _ensure_moomoo_log_dir()
        import moomoo as mm

        quote_ok = False
        sim_trade_ok = False
        sim_cash = None
        sim_assets = None
        msg_parts: list[str] = []

        quote_ctx = None
        trd_ctx = None
        try:
            quote_ctx = mm.OpenQuoteContext(host=self.host, port=self.port)
            ret, _ = quote_ctx.get_global_state()
            if ret == mm.RET_OK:
                quote_ok = True
                msg_parts.append("OpenD 行情通道已就绪")

            trd_ctx = mm.OpenSecTradeContext(
                filter_trdmarket=mm.TrdMarket.US,
                host=self.host,
                port=self.port,
                security_firm=mm.SecurityFirm.NONE,
            )
            ret_acc, df_acc = trd_ctx.accinfo_query(trd_env=mm.TrdEnv.SIMULATE)
            if ret_acc == mm.RET_OK and not df_acc.empty:
                sim_trade_ok = True
                sim_cash = float(df_acc["cash"].iloc[0]) if "cash" in df_acc.columns else None
                sim_assets = float(df_acc["total_assets"].iloc[0]) if "total_assets" in df_acc.columns else None
                msg_parts.append("美股模拟交易账户已连接")
        except Exception as exc:
            msg_parts.append(f"OpenD 握手异常: {exc}")
        finally:
            if quote_ctx is not None:
                quote_ctx.close()
            if trd_ctx is not None:
                trd_ctx.close()

        return {
            "connected": quote_ok,
            "host": self.host,
            "port": self.port,
            "quote_ok": quote_ok,
            "sim_trade_ok": sim_trade_ok,
            "message": " · ".join(msg_parts) if msg_parts else "已连接 OpenD",
            "sim_cash": sim_cash,
            "sim_total_assets": sim_assets,
        }

    def fetch_option_chains(
        self,
        symbol: str,
        spot_price: float,
        min_dte: int,
        max_dte: int,
    ) -> list[dict[str, Any]] | None:
        """Fetch live US option chain + OPRA Greeks/quotes from moomoo OpenD if connected."""
        if not self.is_port_open():
            return None

        _ensure_moomoo_log_dir()
        import moomoo as mm

        mm_code = f"US.{symbol.upper().replace('US.', '')}"
        quote_ctx = None
        try:
            quote_ctx = mm.OpenQuoteContext(host=self.host, port=self.port)
            ret_exp, df_exp = quote_ctx.get_option_expiration_date(code=mm_code)
            if ret_exp != mm.RET_OK or df_exp.empty:
                return None

            valid_exps: list[tuple[str, int]] = []
            for _, row in df_exp.iterrows():
                exp_str = str(row["strike_time"])[:10]
                dte = int(row["option_expiry_date_distance"])
                if min_dte <= dte <= max_dte:
                    valid_exps.append((exp_str, dte))

            if not valid_exps:
                return None

            # Limit to at most 3 representative expirations per symbol to preserve OpenD API quota
            valid_exps = valid_exps[:3]
            chains_out: list[dict[str, Any]] = []

            for exp_str, dte in valid_exps:
                ret_c, df_chain = quote_ctx.get_option_chain(
                    code=mm_code,
                    start=exp_str,
                    end=exp_str,
                )
                if ret_c != mm.RET_OK or df_chain.empty:
                    continue

                # Filter strikes within +-22% of spot to save snapshot quota
                df_near = df_chain[
                    (df_chain["strike_price"] >= spot_price * 0.78)
                    & (df_chain["strike_price"] <= spot_price * 1.22)
                ]
                codes = df_near["code"].tolist()
                if not codes:
                    continue

                snaps = []
                for idx in range(0, len(codes), 350):
                    batch = codes[idx : idx + 350]
                    ret_s, df_snap = quote_ctx.get_market_snapshot(batch)
                    if ret_s == mm.RET_OK and not df_snap.empty:
                        snaps.append(df_snap)
                if not snaps:
                    continue

                import pandas as pd
                df_all_snap = pd.concat(snaps, ignore_index=True)
                merged = df_near.merge(df_all_snap, on="code", suffixes=("", "_snap"))

                puts_list: list[dict[str, Any]] = []
                calls_list: list[dict[str, Any]] = []

                for _, r in merged.iterrows():
                    iv_pct = float(r.get("option_implied_volatility", 0.0) or 0.0)
                    item = {
                        "moomoo_code": str(r["code"]),
                        "strike": float(r["strike_price"]),
                        "bid": float(r.get("bid_price", 0.0) or 0.0),
                        "ask": float(r.get("ask_price", 0.0) or 0.0),
                        "lastPrice": float(r.get("last_price", 0.0) or 0.0),
                        "iv": iv_pct / 100.0 if iv_pct > 1.5 else iv_pct,
                        "delta": float(r["option_delta"]) if r.get("option_delta") is not None else None,
                        "gamma": float(r["option_gamma"]) if r.get("option_gamma") is not None else None,
                        "theta": float(r["option_theta"]) if r.get("option_theta") is not None else None,
                        "vega": float(r["option_vega"]) if r.get("option_vega") is not None else None,
                        "open_interest": int(r.get("option_open_interest", 0) or 0),
                        "volume": int(r.get("volume", 0) or 0),
                    }
                    opt_type = str(r.get("option_type", "")).upper()
                    if "PUT" in opt_type:
                        puts_list.append(item)
                    else:
                        calls_list.append(item)

                chains_out.append({
                    "expiration": exp_str,
                    "dte": dte,
                    "puts": puts_list,
                    "calls": calls_list,
                })

            return chains_out if chains_out else None
        except Exception:
            return None
        finally:
            if quote_ctx is not None:
                quote_ctx.close()

    def submit_paper_legs(self, moomoo_codes: list[str], actions: list[str], prices: list[float], qty: int = 1) -> str:
        """
        Submit paper trade leg(s) ONLY to Moomoo Simulate environment (TrdEnv.SIMULATE).
        Never touches real trading accounts.
        """
        if not self.is_port_open():
            return "本地记录成功（未开启 OpenD，仅保存在本地模拟账本）"

        _ensure_moomoo_log_dir()
        import moomoo as mm

        trd_ctx = None
        try:
            trd_ctx = mm.OpenSecTradeContext(
                filter_trdmarket=mm.TrdMarket.US,
                host=self.host,
                port=self.port,
                security_firm=mm.SecurityFirm.NONE,
            )
            order_ids: list[str] = []
            for code, act, px in zip(moomoo_codes, actions, prices):
                side = mm.TrdSide.SELL if act.upper() == "SELL" else mm.TrdSide.BUY
                ret, data = trd_ctx.place_order(
                    price=round(px, 2),
                    qty=qty,
                    code=code,
                    trd_side=side,
                    order_type=mm.OrderType.NORMAL,
                    trd_env=mm.TrdEnv.SIMULATE,
                )
                if ret == mm.RET_OK and not data.empty:
                    order_ids.append(str(data["order_id"].iloc[0]))
                else:
                    return f"本地已记录（Moomoo 模拟盘返回: {data}）"
            return f"已同步至 Moomoo 美股模拟盘 (单号: {', '.join(order_ids)})"
        except Exception as exc:
            return f"本地已记录（OpenD 模拟下单跳过: {exc}）"
        finally:
            if trd_ctx is not None:
                trd_ctx.close()


moomoo_client = MoomooClient()
