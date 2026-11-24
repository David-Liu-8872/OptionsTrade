from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
import math
import time
from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf

from app.providers.moomoo_client import moomoo_client
from app.providers.presets import TICKER_META
from app.quant.bs_pricing import bs_price_and_greeks


_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_HISTORY_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
CACHE_TTL_SECONDS = 240.0


def _compute_rsi(series: pd.Series, period: int = 14) -> float:
    if len(series) < period + 2:
        return 50.0
    delta = series.diff()
    gain = delta.clip(lower=0.0).rolling(window=period).mean()
    loss = (-delta.clip(upper=0.0)).rolling(window=period).mean()
    last_gain = float(gain.iloc[-1] or 0.0)
    last_loss = float(loss.iloc[-1] or 0.0)
    if last_loss <= 1e-9:
        return 85.0
    rs = last_gain / last_loss
    return float(100.0 - (100.0 / (1.0 + rs)))


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        f = float(val)
        return default if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return default


def _safe_int(val: Any, default: int = 0) -> int:
    try:
        f = float(val)
        return default if (math.isnan(f) or math.isinf(f)) else int(f)
    except (TypeError, ValueError):
        return default


def _build_synthetic_fallback(symbol: str, min_dte: int, max_dte: int) -> dict[str, Any]:
    """Offline / rate-limit fallback so visualization always works smoothly."""
    seed_prices = {
        "SPY": 592.0, "QQQ": 512.0, "IWM": 232.0, "DIA": 438.0,
        "SCHD": 28.8, "TLT": 91.5, "GLD": 248.0, "AAPL": 232.0,
        "MSFT": 428.0, "GOOGL": 182.0, "AMZN": 212.0, "NVDA": 140.0,
        "META": 595.0, "JPM": 242.0, "KO": 64.5, "CSCO": 58.5,
    }
    spot = seed_prices.get(symbol, 150.0)
    iv_map = {"NVDA": 0.44, "META": 0.31, "SPY": 0.155, "QQQ": 0.195, "IWM": 0.22, "KO": 0.145, "SCHD": 0.135, "TLT": 0.165}
    base_iv = iv_map.get(symbol, 0.24)

    today = datetime.now().date()
    dtes = [d for d in (28, 35, 42) if min_dte <= d <= max_dte] or [max(min_dte, 30)]
    step = 5.0 if spot >= 180 else (2.5 if spot >= 65 else 1.0)

    chains = []
    for dte in dtes:
        exp_str = (today + timedelta(days=dte)).strftime("%Y-%m-%d")
        t = dte / 365.0
        center = round(spot / step) * step
        puts, calls = [], []
        for k in range(-12, 13):
            strike = round(center + k * step, 2)
            if strike <= 2:
                continue
            skew_iv = base_iv * (1.0 - 0.008 * k)  # Put skew
            gp = bs_price_and_greeks(spot, strike, t, skew_iv, "PUT")
            gc = bs_price_and_greeks(spot, strike, t, skew_iv, "CALL")
            for opt_t, g, bucket in (("PUT", gp, puts), ("CALL", gc, calls)):
                mid = max(0.05, round(g.price, 2))
                half_sp = max(0.01, round(mid * 0.025, 2))
                bucket.append({
                    "strike": strike,
                    "bid": max(0.01, round(mid - half_sp, 2)),
                    "ask": round(mid + half_sp, 2),
                    "lastPrice": mid,
                    "iv": round(skew_iv, 4),
                    "open_interest": 1800,
                    "volume": 420,
                })
        chains.append({"expiration": exp_str, "dte": dte, "puts": puts, "calls": calls})

    name, sector = TICKER_META.get(symbol, (symbol, "美股标的"))
    return {
        "symbol": symbol,
        "name": name,
        "sector": sector,
        "data_source": "demo_fallback",
        "spot_price": spot,
        "sma_50": round(spot * 0.975, 2),
        "sma_200": round(spot * 0.915, 2),
        "trend_status": "strong_uptrend",
        "rsi_14": 54.5,
        "hv_20": round(base_iv * 86.0, 1),
        "atm_iv": round(base_iv * 100.0, 1),
        "earnings_date": None,
        "days_to_earnings": None,
        "chains": chains,
    }


def fetch_ticker_snapshot(
    symbol: str,
    min_dte: int = 20,
    max_dte: int = 48,
    prefer_moomoo: bool = True,
) -> dict[str, Any]:
    """Fetch underlying technicals, HV, earnings date, and live option chains."""
    clean_sym = symbol.upper().replace("US.", "").strip()
    cache_key = f"{clean_sym}:{min_dte}:{max_dte}:{prefer_moomoo and moomoo_client.is_port_open()}"
    now = time.time()
    if cache_key in _CACHE:
        ts, cached_val = _CACHE[cache_key]
        if now - ts < CACHE_TTL_SECONDS:
            return cached_val

    try:
        tk = yf.Ticker(clean_sym)
        hist = tk.history(period="1y", auto_adjust=True)
        if hist is None or len(hist) < 30:
            fallback = _build_synthetic_fallback(clean_sym, min_dte, max_dte)
            _CACHE[cache_key] = (now, fallback)
            return fallback

        closes = hist["Close"].dropna()
        spot = float(closes.iloc[-1])
        sma_50 = float(closes.rolling(min(50, len(closes))).mean().iloc[-1])
        sma_200 = float(closes.rolling(min(200, len(closes))).mean().iloc[-1])
        rsi_14 = _compute_rsi(closes, 14)

        log_ret = np.log(closes / closes.shift(1)).dropna()
        hv_20 = float(log_ret.tail(20).std() * math.sqrt(252) * 100.0) if len(log_ret) >= 15 else 20.0

        if spot > sma_50 > sma_200:
            trend_status = "strong_uptrend"
        elif spot > sma_200:
            trend_status = "uptrend"
        elif spot > sma_50:
            trend_status = "neutral"
        else:
            trend_status = "downtrend"

        # Cache price history for probability cone visualization
        hist_tail = hist.tail(140).copy()
        hist_tail["sma50"] = closes.rolling(min(50, len(closes))).mean().tail(140)
        hist_tail["sma200"] = closes.rolling(min(200, len(closes))).mean().tail(140)
        pts = []
        for idx, r in hist_tail.iterrows():
            dt_s = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
            pts.append({
                "date": dt_s,
                "close": round(float(r["Close"]), 2),
                "high": round(float(r["High"]), 2),
                "low": round(float(r["Low"]), 2),
                "sma50": round(float(r["sma50"]), 2) if not pd.isna(r["sma50"]) else None,
                "sma200": round(float(r["sma200"]), 2) if not pd.isna(r["sma200"]) else None,
            })
        _HISTORY_CACHE[clean_sym] = (now, pts)

        # Check upcoming earnings date for individual stocks (ETFs have none)
        earnings_date_str: str | None = None
        days_to_earnings: int | None = None
        today = datetime.now().date()
        name, sector = TICKER_META.get(clean_sym, (clean_sym, "美股期权标的"))
        if "ETF" not in sector:
            try:
                cal = tk.calendar
                if isinstance(cal, dict) and "Earnings Date" in cal:
                    ed_list = cal["Earnings Date"]
                    if ed_list:
                        ed0 = ed_list[0]
                        ed_date = ed0 if hasattr(ed0, "year") and not hasattr(ed0, "date") else ed0.date()
                        diff_days = (ed_date - today).days
                        if -2 <= diff_days <= 120:
                            earnings_date_str = ed_date.strftime("%Y-%m-%d")
                            days_to_earnings = diff_days
            except Exception:
                pass

        # 1. Try Moomoo OpenD first if requested & running
        data_source = "yfinance_live"
        chains = None
        if prefer_moomoo and moomoo_client.is_port_open():
            chains = moomoo_client.fetch_option_chains(clean_sym, spot, min_dte, max_dte)
            if chains:
                data_source = "moomoo_opend"

        # 2. Fallback to live Yahoo Finance option chains
        if not chains:
            exp_dates = list(tk.options or [])
            matched_exps: list[tuple[str, int]] = []
            for exp_s in exp_dates:
                try:
                    d_obj = datetime.strptime(exp_s, "%Y-%m-%d").date()
                    dte = (d_obj - today).days
                    if min_dte <= dte <= max_dte:
                        matched_exps.append((exp_s, dte))
                except ValueError:
                    continue

            # Keep up to 3 evenly spaced expirations in range (e.g. ~24d, ~32d, ~42d) for speed
            if len(matched_exps) > 3:
                idxs = [0, len(matched_exps) // 2, len(matched_exps) - 1]
                matched_exps = [matched_exps[i] for i in idxs]

            chains = []
            for exp_s, dte in matched_exps:
                opt_chain = tk.option_chain(exp_s)
                puts_df = opt_chain.puts
                calls_df = opt_chain.calls

                puts_list: list[dict[str, Any]] = []
                if puts_df is not None and not puts_df.empty:
                    near_p = puts_df[
                        (puts_df["strike"] >= spot * 0.78) & (puts_df["strike"] <= spot * 1.05)
                    ]
                    for _, pr in near_p.iterrows():
                        strike_val = _safe_float(pr["strike"])
                        if abs(strike_val * 2.0 - round(strike_val * 2.0)) > 0.01:
                            continue
                        bid = _safe_float(pr.get("bid"), 0.0)
                        ask = _safe_float(pr.get("ask"), 0.0)
                        last_px = _safe_float(pr.get("lastPrice"), 0.0)
                        # Outside US market hours, some tickers report bid=0/ask=0; synthesize conservative spread around lastPrice
                        if (bid <= 0 or ask <= 0) and last_px > 0.05:
                            bid = round(max(0.01, last_px * 0.96), 2)
                            ask = round(last_px * 1.04, 2)
                        puts_list.append({
                            "strike": _safe_float(pr["strike"]),
                            "bid": bid,
                            "ask": ask,
                            "lastPrice": last_px,
                            "iv": _safe_float(pr.get("impliedVolatility"), 0.25),
                            "open_interest": max(_safe_int(pr.get("openInterest"), 0), _safe_int(pr.get("volume"), 0) * 2, 100 if last_px > 0.1 else 0),
                            "volume": _safe_int(pr.get("volume"), 0),
                        })

                calls_list: list[dict[str, Any]] = []
                if calls_df is not None and not calls_df.empty:
                    near_c = calls_df[
                        (calls_df["strike"] >= spot * 0.95) & (calls_df["strike"] <= spot * 1.22)
                    ]
                    for _, cr in near_c.iterrows():
                        strike_val = _safe_float(cr["strike"])
                        if abs(strike_val * 2.0 - round(strike_val * 2.0)) > 0.01:
                            continue
                        bid = _safe_float(cr.get("bid"), 0.0)
                        ask = _safe_float(cr.get("ask"), 0.0)
                        last_px = _safe_float(cr.get("lastPrice"), 0.0)
                        if (bid <= 0 or ask <= 0) and last_px > 0.05:
                            bid = round(max(0.01, last_px * 0.96), 2)
                            ask = round(last_px * 1.04, 2)
                        calls_list.append({
                            "strike": _safe_float(cr["strike"]),
                            "bid": bid,
                            "ask": ask,
                            "lastPrice": last_px,
                            "iv": _safe_float(cr.get("impliedVolatility"), 0.25),
                            "open_interest": max(_safe_int(cr.get("openInterest"), 0), _safe_int(cr.get("volume"), 0) * 2, 100 if last_px > 0.1 else 0),
                            "volume": _safe_int(cr.get("volume"), 0),
                        })

                chains.append({
                    "expiration": exp_s,
                    "dte": dte,
                    "puts": puts_list,
                    "calls": calls_list,
                })

        if not chains:
            fallback = _build_synthetic_fallback(clean_sym, min_dte, max_dte)
            _CACHE[cache_key] = (now, fallback)
            return fallback

        # Estimate ATM IV from nearest strike in first chain
        atm_iv_pct = hv_20 * 1.12
        first_puts = chains[0].get("puts", [])
        if first_puts:
            nearest = min(first_puts, key=lambda x: abs(x["strike"] - spot))
            if nearest["iv"] > 0.03:
                atm_iv_pct = nearest["iv"] * 100.0

        result = {
            "symbol": clean_sym,
            "name": name,
            "sector": sector,
            "data_source": data_source,
            "spot_price": round(spot, 2),
            "sma_50": round(sma_50, 2),
            "sma_200": round(sma_200, 2),
            "trend_status": trend_status,
            "rsi_14": round(rsi_14, 1),
            "hv_20": round(hv_20, 1),
            "atm_iv": round(atm_iv_pct, 1),
            "earnings_date": earnings_date_str,
            "days_to_earnings": days_to_earnings,
            "chains": chains,
        }
        _CACHE[cache_key] = (now, result)
        return result
    except Exception:
        fallback = _build_synthetic_fallback(clean_sym, min_dte, max_dte)
        _CACHE[cache_key] = (now, fallback)
        return fallback


def fetch_batch_snapshots(
    symbols: list[str],
    min_dte: int,
    max_dte: int,
    prefer_moomoo: bool = True,
) -> list[dict[str, Any]]:
    unique_syms = list(dict.fromkeys(s.upper().strip() for s in symbols if s.strip()))[:12]
    snapshots: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=min(6, max(1, len(unique_syms)))) as pool:
        future_map = {
            pool.submit(fetch_ticker_snapshot, sym, min_dte, max_dte, prefer_moomoo): sym
            for sym in unique_syms
        }
        for fut in as_completed(future_map):
            try:
                snapshots.append(fut.result())
            except Exception:
                pass
    return snapshots


def get_price_history(symbol: str) -> list[dict[str, Any]]:
    clean_sym = symbol.upper().replace("US.", "").strip()
    now = time.time()
    if clean_sym in _HISTORY_CACHE and (now - _HISTORY_CACHE[clean_sym][0]) < 900:
        return _HISTORY_CACHE[clean_sym][1]
    fetch_ticker_snapshot(clean_sym)
    return _HISTORY_CACHE.get(clean_sym, (0.0, []))[1]
