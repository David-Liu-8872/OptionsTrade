from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo
import math

from app.models import (
    ExitPlaybook,
    OptionLeg,
    PayoffCurveRequest,
    PayoffGridPoint,
    RiskLevelType,
    SafetyBreakdown,
    StrategyCandidate,
    StrategyFilterType,
)
from app.quant.bs_pricing import (
    bs_price_and_greeks,
    estimate_moomoo_us_option_fee,
    format_moomoo_us_option_code,
    implied_prob_above,
)


RISK_DELTA_RANGES: dict[RiskLevelType, tuple[float, float]] = {
    "conservative": (0.12, 0.22),  # ~78% - 88% POP (Best for brand-new beginners)
    "balanced": (0.18, 0.29),      # ~71% - 82% POP
    "income": (0.25, 0.36),        # ~64% - 75% POP
}


def _clamp(val: float, lo: float = 0.0, hi: float = 100.0) -> int:
    return int(round(max(lo, min(hi, val))))


def score_beginner_safety(
    *,
    pop_pct: float,
    cushion_pct: float,
    spread_slippage_pct: float,
    min_oi: int,
    atm_iv_pct: float,
    iv_hv_ratio: float,
    trend_status: str,
    rsi_14: float,
    has_earnings_before_exp: bool,
    strategy: str,
) -> SafetyBreakdown:
    """Compute 5-dimensional Beginner Safety Score (0-100) with transparent explanations."""
    highlights: list[str] = []
    warnings: list[str] = []

    # 1. Win-rate score (POP %: 70%->66, 78%->82, 85%->95)
    win_rate_score = _clamp(40.0 + (pop_pct - 58.0) * 2.05)
    if pop_pct >= 80:
        highlights.append(f"理论到期胜率高达 {pop_pct:.1f}%，容错空间充裕")
    elif pop_pct < 68:
        warnings.append(f"理论胜率 {pop_pct:.1f}% 偏激进，新手建议优先选择 >75% 的合约")

    # 2. Downside cushion score (5%->65, 8%->86, 10%+->96)
    cushion_score = _clamp(30.0 + cushion_pct * 7.0)
    if cushion_pct >= 7.0:
        highlights.append(f"盈亏平衡点距现价有 {cushion_pct:.1f}% 安全垫")
    elif cushion_pct < 3.5 and strategy != "covered_call":
        warnings.append(f"下跌缓冲垫仅 {cushion_pct:.1f}%，轻微回调即触及行权区")

    # 3. Liquidity & Moomoo execution quality
    spread_score = max(0.0, 100.0 - spread_slippage_pct * 6.5)
    oi_score = min(100.0, math.log10(max(min_oi, 10)) * 30.0)
    liquidity_score = _clamp(0.65 * spread_score + 0.35 * oi_score)
    if spread_slippage_pct <= 4.0 and min_oi >= 500:
        highlights.append(f"期权盘口极佳（价差仅 {spread_slippage_pct:.1f}%，未平仓 {min_oi:,} 张），Moomoo 限价单易成交")
    elif spread_slippage_pct > 10.0:
        warnings.append(f"买卖价差偏宽 ({spread_slippage_pct:.1f}%)，切勿使用市价单，必须在 Moomoo 挂中间价限价单")

    # 4. Volatility sanity (avoid >85% meme IV traps while rewarding fair VRP)
    if atm_iv_pct > 75:
        vol_base = max(20.0, 85.0 - (atm_iv_pct - 75.0) * 1.5)
        warnings.append(f"隐含波动率高达 {atm_iv_pct:.1f}%，属于高波动标的，谨防单日大幅跳空")
    elif 14 <= atm_iv_pct <= 48:
        vol_base = 88.0
    else:
        vol_base = 72.0

    if 1.02 <= iv_hv_ratio <= 1.45:
        vol_base += 10.0
        highlights.append(f"IV/HV 比值 {iv_hv_ratio:.2f}，期权权利金存在正向溢价且未过热")
    elif iv_hv_ratio < 0.85:
        vol_base -= 10.0
    volatility_score = _clamp(vol_base)

    # 5. Trend & Earnings event safety
    trend_map = {
        "strong_uptrend": 92.0,
        "uptrend": 82.0,
        "neutral": 68.0,
        "downtrend": 42.0,
    }
    te_score = trend_map.get(trend_status, 65.0)
    if trend_status in ("strong_uptrend", "uptrend"):
        highlights.append("标的处于均线多头趋势，顺势做收租策略安全度更高")
    elif trend_status == "downtrend":
        warnings.append("股价低于 200 日均线处于弱势区间，注意接飞刀风险")

    if rsi_14 > 76 and strategy in ("bull_put_spread", "cash_secured_put"):
        te_score -= 10.0
        warnings.append(f"短线 RSI({rsi_14:.0f}) 超买，可等待小幅回踩后再入场")
    elif rsi_14 < 28:
        warnings.append(f"短线 RSI({rsi_14:.0f}) 超卖，波动加剧")

    if has_earnings_before_exp:
        te_score -= 45.0
        warnings.append("到期前跨越财报日！财报跳空可能直接击穿安全垫，新手强烈建议避开")
    else:
        highlights.append("到期窗口内无已知财报黑天鹅干扰")

    trend_event_score = _clamp(te_score)

    # Weighted composite
    total = _clamp(
        0.28 * win_rate_score
        + 0.22 * cushion_score
        + 0.20 * liquidity_score
        + 0.14 * volatility_score
        + 0.16 * trend_event_score
    )

    if total >= 85:
        grade = "A+"
    elif total >= 78:
        grade = "A"
    elif total >= 70:
        grade = "B+"
    elif total >= 60:
        grade = "B"
    else:
        grade = "C"

    return SafetyBreakdown(
        score_total=total,
        grade=grade,
        win_rate_score=win_rate_score,
        cushion_score=cushion_score,
        liquidity_score=liquidity_score,
        volatility_score=volatility_score,
        trend_event_score=trend_event_score,
        highlights=highlights[:4],
        warnings=warnings[:3],
    )


def _build_leg(
    symbol: str,
    expiration: str,
    dte: int,
    action: str,
    option_type: str,
    row: dict[str, Any],
    spot: float,
) -> OptionLeg:
    strike = float(row["strike"])
    bid = float(row.get("bid", 0.0) or 0.0)
    ask = float(row.get("ask", 0.0) or 0.0)
    mid = round(0.5 * (bid + ask), 2) if (bid > 0 and ask > 0) else round(float(row.get("lastPrice", 0.0) or 0.0), 2)
    iv = float(row.get("iv", 0.0) or 0.0)
    if iv <= 0.01:
        iv = 0.25

    t_years = max(dte / 365.0, 1.0 / 365.0)
    greeks = bs_price_and_greeks(spot, strike, t_years, iv, option_type)

    # Prefer broker-supplied Greeks when non-zero, fallback to BS Greeks
    delta = float(row.get("delta") if row.get("delta") is not None else greeks.delta)
    gamma = float(row.get("gamma") if row.get("gamma") is not None else greeks.gamma)
    theta = float(row.get("theta") if row.get("theta") is not None else greeks.theta)
    vega = float(row.get("vega") if row.get("vega") is not None else greeks.vega)

    spread_pct = ((ask - bid) / mid * 100.0) if (mid > 0 and ask >= bid > 0) else 25.0
    moomoo_code, occ_sym = format_moomoo_us_option_code(symbol, expiration, option_type, strike)
    if row.get("moomoo_code"):
        moomoo_code = str(row["moomoo_code"])

    return OptionLeg(
        action=action,  # type: ignore[arg-type]
        option_type=option_type,  # type: ignore[arg-type]
        strike=strike,
        expiration=expiration,
        dte=dte,
        bid=round(bid, 2),
        ask=round(ask, 2),
        mid=round(mid, 2),
        iv=round(iv, 4),
        delta=round(delta, 4),
        gamma=round(gamma, 4),
        theta=round(theta, 4),
        vega=round(vega, 4),
        open_interest=int(row.get("open_interest", 0) or 0),
        volume=int(row.get("volume", 0) or 0),
        spread_pct=round(spread_pct, 2),
        moomoo_code=moomoo_code,
        occ_symbol=occ_sym,
    )


def build_candidates_for_ticker(
    snapshot: dict[str, Any],
    *,
    strategy_filter: StrategyFilterType,
    max_capital: float,
    min_dte: int,
    max_dte: int,
    risk_level: RiskLevelType,
    spread_width: float,
    exclude_earnings: bool,
    only_uptrend: bool,
) -> list[StrategyCandidate]:
    """Scan all option expirations of a ticker and construct top low-risk beginner strategies."""
    symbol: str = snapshot["symbol"]
    spot: float = snapshot["spot_price"]
    sma_50: float = snapshot["sma_50"]
    sma_200: float = snapshot["sma_200"]
    trend_status: str = snapshot["trend_status"]
    rsi_14: float = snapshot["rsi_14"]
    hv_20: float = snapshot["hv_20"]
    atm_iv: float = snapshot["atm_iv"]
    earnings_date: str | None = snapshot.get("earnings_date")
    days_to_earnings: int | None = snapshot.get("days_to_earnings")
    data_source: str = snapshot["data_source"]

    if only_uptrend and trend_status == "downtrend":
        return []

    iv_hv_ratio = round(atm_iv / max(hv_20, 5.0), 2)
    delta_lo, delta_hi = RISK_DELTA_RANGES[risk_level]
    today = datetime.now(ZoneInfo("America/New_York")).date()

    results: list[StrategyCandidate] = []

    for chain in snapshot.get("chains", []):
        exp_str: str = chain["expiration"]
        dte: int = int(chain["dte"])
        if not (min_dte <= dte <= max_dte):
            continue

        has_earnings_before_exp = bool(
            days_to_earnings is not None and 0 <= days_to_earnings <= dte
        )
        if exclude_earnings and has_earnings_before_exp:
            continue

        t_years = dte / 365.0
        dte_21_date = (today + timedelta(days=max(1, dte - 21))).strftime("%Y-%m-%d")

        puts_raw: list[dict[str, Any]] = chain.get("puts", [])
        calls_raw: list[dict[str, Any]] = chain.get("calls", [])

        # Build Put legs for OTM puts
        otm_puts: list[OptionLeg] = []
        for p in puts_raw:
            if float(p["strike"]) >= spot * 0.995:
                continue
            leg = _build_leg(symbol, exp_str, dte, "SELL", "PUT", p, spot)
            if leg.bid > 0.03 and leg.mid >= 0.08:
                otm_puts.append(leg)
        otm_puts.sort(key=lambda x: x.strike, reverse=True)

        # ----------------------------------------------------------------------
        # STRATEGY 1: Bull Put Credit Spread (牛市看跌信用价差 — 小资金锁死最大风险)
        # ----------------------------------------------------------------------
        if strategy_filter in ("all", "bull_put_spread") and len(otm_puts) >= 2:
            short_candidates = [
                leg for leg in otm_puts
                if delta_lo <= abs(leg.delta) <= delta_hi
                and leg.open_interest >= 50
                and leg.spread_pct <= 18.0
            ]
            # Pick up to 2 best short strikes per expiration to avoid clutter
            short_candidates.sort(key=lambda l: abs(abs(l.delta) - 0.5 * (delta_lo + delta_hi)))
            for short_leg in short_candidates[:2]:
                # Find protective long put ~ spread_width below short_strike
                desired_width = spread_width
                if spot >= 350 and spread_width < 5:
                    desired_width = 5.0
                elif spot < 60 and spread_width > 2.5:
                    desired_width = 2.5

                long_matches = [
                    p for p in otm_puts
                    if p.strike < short_leg.strike
                    and abs((short_leg.strike - p.strike) - desired_width) <= max(2.5, desired_width * 0.5)
                ]
                if not long_matches:
                    continue
                long_raw = min(
                    long_matches,
                    key=lambda p: abs((short_leg.strike - p.strike) - desired_width),
                )
                long_leg = long_raw.model_copy(update={"action": "BUY"})
                width = round(short_leg.strike - long_leg.strike, 2)
                if width <= 0:
                    continue

                gross_credit_share = round(short_leg.mid - long_leg.mid, 2)
                if gross_credit_share <= 0.15:
                    continue

                gross_credit_dollars = round(gross_credit_share * 100.0, 2)
                moomoo_fee = estimate_moomoo_us_option_fee(num_legs=2, contracts_per_leg=1)
                net_credit_dollars = round(gross_credit_dollars - moomoo_fee, 2)
                if net_credit_dollars <= 12.0:
                    continue

                collateral = round(width * 100.0, 2)
                max_loss_dollars = round(collateral - net_credit_dollars, 2)
                if collateral > max_capital or max_loss_dollars <= 0:
                    continue

                ror_pct = (net_credit_dollars / max_loss_dollars) * 100.0
                ann_roc_pct = ror_pct * (365.0 / dte)
                if ann_roc_pct < 8.0:
                    continue

                breakeven = round(short_leg.strike - (net_credit_dollars / 100.0), 2)
                cushion_pct = ((spot - breakeven) / spot) * 100.0
                pop_pct = implied_prob_above(spot, breakeven, t_years, short_leg.iv) * 100.0
                # Expected value approximation
                ev_dollars = (pop_pct / 100.0) * net_credit_dollars - (1.0 - pop_pct / 100.0) * (0.55 * max_loss_dollars)

                combined_spread_pct = 0.6 * short_leg.spread_pct + 0.4 * long_leg.spread_pct
                min_oi = min(short_leg.open_interest, max(long_leg.open_interest, 20))

                safety = score_beginner_safety(
                    pop_pct=pop_pct,
                    cushion_pct=cushion_pct,
                    spread_slippage_pct=combined_spread_pct,
                    min_oi=min_oi,
                    atm_iv_pct=atm_iv,
                    iv_hv_ratio=iv_hv_ratio,
                    trend_status=trend_status,
                    rsi_14=rsi_14,
                    has_earnings_before_exp=has_earnings_before_exp,
                    strategy="bull_put_spread",
                )

                tp_credit = round(gross_credit_share * 0.50, 2)
                results.append(
                    StrategyCandidate(
                        id=f"{symbol}-BPS-{exp_str}-{short_leg.strike}-{long_leg.strike}",
                        symbol=symbol,
                        name=snapshot["name"],
                        sector=snapshot["sector"],
                        data_source=data_source,  # type: ignore[arg-type]
                        spot_price=round(spot, 2),
                        sma_50=round(sma_50, 2),
                        sma_200=round(sma_200, 2),
                        trend_status=trend_status,  # type: ignore[arg-type]
                        rsi_14=round(rsi_14, 1),
                        hv_20=round(hv_20, 1),
                        atm_iv=round(atm_iv, 1),
                        iv_hv_ratio=iv_hv_ratio,
                        earnings_date=earnings_date,
                        days_to_earnings=days_to_earnings,
                        has_earnings_before_exp=has_earnings_before_exp,
                        strategy="bull_put_spread",
                        strategy_label="牛市看跌价差 (Bull Put Spread)",
                        strategy_subtitle=f"卖 ${short_leg.strike:g}P / 买 ${long_leg.strike:g}P · 锁死最大亏损 ${max_loss_dollars:.0f}",
                        expiration=exp_str,
                        dte=dte,
                        legs=[short_leg, long_leg],
                        short_strike=short_leg.strike,
                        long_strike=long_leg.strike,
                        width=width,
                        gross_credit_per_share=gross_credit_share,
                        gross_credit_dollars=gross_credit_dollars,
                        moomoo_fee_dollars=moomoo_fee,
                        net_credit_dollars=net_credit_dollars,
                        max_profit_dollars=net_credit_dollars,
                        max_loss_dollars=max_loss_dollars,
                        collateral_required=collateral,
                        return_on_risk_pct=round(ror_pct, 2),
                        annualized_roc_pct=round(ann_roc_pct, 2),
                        breakeven_price=breakeven,
                        downside_cushion_pct=round(cushion_pct, 2),
                        pop_pct=round(pop_pct, 1),
                        expected_value_dollars=round(ev_dollars, 2),
                        net_delta=round(( -short_leg.delta + long_leg.delta ) * 100.0, 2),
                        net_theta_per_day=round(( -short_leg.theta + long_leg.theta ) * 100.0, 2),
                        net_vega_per_1pct=round(( -short_leg.vega + long_leg.vega ) * 100.0, 2),
                        spread_slippage_pct=round(combined_spread_pct, 1),
                        safety=safety,
                        exit_playbook=ExitPlaybook(
                            take_profit_50_credit=tp_credit,
                            take_profit_dollars=round(net_credit_dollars * 0.5, 2),
                            dte_exit_days=21,
                            dte_exit_date=dte_21_date,
                            stop_loss_rule=f"若组合平仓成本涨至 ${gross_credit_share * 2.0:.2f}（亏损约 1 倍权利金）或正股跌破 ${short_leg.strike:g}，果断止损离场，绝不死扛到期。",
                            beginner_summary="双腿保护组合：即使遇到极端暴跌，最大亏损也被买入的保护腿严格锁定，适合小资金新手稳健收租。",
                        ),
                        moomoo_execution_steps=[
                            f"打开 moomoo 搜索 {symbol} -> 点击「期权 (Options)」切换至 {exp_str} ({dte}天)",
                            "在期权链底部策略栏选择「垂直价差 (Vertical)」-> 方向选「看跌信用价差 / 卖出看跌价差」",
                            f"卖出一腿选 ${short_leg.strike:g} Put ({short_leg.moomoo_code})，买入保护腿选 ${long_leg.strike:g} Put ({long_leg.moomoo_code})",
                            f"订单类型选「限价单 (Limit)」，净收入(Credit)填入中间价 ${gross_credit_share:.2f}，数量先下 1 张试水",
                            f"成交后立即设置条件单/价格提醒：组合价格回落至 ${tp_credit:.2f} 自动平仓止盈 50%",
                        ],
                    )
                )

        # ----------------------------------------------------------------------
        # STRATEGY 2: Cash-Secured Put (现金担保卖 Put — 打折接优质蓝筹股)
        # ----------------------------------------------------------------------
        if strategy_filter in ("all", "cash_secured_put"):
            csp_candidates = [
                leg for leg in otm_puts
                if delta_lo <= abs(leg.delta) <= delta_hi
                and leg.open_interest >= 80
                and leg.spread_pct <= 14.0
                and (leg.strike * 100.0) <= max_capital
            ]
            csp_candidates.sort(key=lambda l: abs(abs(l.delta) - 0.5 * (delta_lo + delta_hi)))
            for short_leg in csp_candidates[:2]:
                collateral = round(short_leg.strike * 100.0, 2)
                gross_credit_dollars = round(short_leg.mid * 100.0, 2)
                moomoo_fee = estimate_moomoo_us_option_fee(num_legs=1, contracts_per_leg=1)
                net_credit_dollars = round(gross_credit_dollars - moomoo_fee, 2)
                if net_credit_dollars <= 10.0:
                    continue

                ror_pct = (net_credit_dollars / collateral) * 100.0
                ann_roc_pct = ror_pct * (365.0 / dte)
                if ann_roc_pct < 6.0:
                    continue

                breakeven = round(short_leg.strike - (net_credit_dollars / 100.0), 2)
                cushion_pct = ((spot - breakeven) / spot) * 100.0
                pop_pct = implied_prob_above(spot, breakeven, t_years, short_leg.iv) * 100.0
                max_loss_dollars = round(breakeven * 100.0, 2)
                ev_dollars = (pop_pct / 100.0) * net_credit_dollars - (1.0 - pop_pct / 100.0) * (spot * 0.03 * 100.0 * 0.25)

                safety = score_beginner_safety(
                    pop_pct=pop_pct,
                    cushion_pct=cushion_pct,
                    spread_slippage_pct=short_leg.spread_pct,
                    min_oi=short_leg.open_interest,
                    atm_iv_pct=atm_iv,
                    iv_hv_ratio=iv_hv_ratio,
                    trend_status=trend_status,
                    rsi_14=rsi_14,
                    has_earnings_before_exp=has_earnings_before_exp,
                    strategy="cash_secured_put",
                )

                tp_credit = round(short_leg.mid * 0.50, 2)
                results.append(
                    StrategyCandidate(
                        id=f"{symbol}-CSP-{exp_str}-{short_leg.strike}",
                        symbol=symbol,
                        name=snapshot["name"],
                        sector=snapshot["sector"],
                        data_source=data_source,  # type: ignore[arg-type]
                        spot_price=round(spot, 2),
                        sma_50=round(sma_50, 2),
                        sma_200=round(sma_200, 2),
                        trend_status=trend_status,  # type: ignore[arg-type]
                        rsi_14=round(rsi_14, 1),
                        hv_20=round(hv_20, 1),
                        atm_iv=round(atm_iv, 1),
                        iv_hv_ratio=iv_hv_ratio,
                        earnings_date=earnings_date,
                        days_to_earnings=days_to_earnings,
                        has_earnings_before_exp=has_earnings_before_exp,
                        strategy="cash_secured_put",
                        strategy_label="现金担保卖 Put (Cash-Secured Put)",
                        strategy_subtitle=f"卖 ${short_leg.strike:g}P · 若跌破则以 ${breakeven:.2f} 折价接 100 股",
                        expiration=exp_str,
                        dte=dte,
                        legs=[short_leg],
                        short_strike=short_leg.strike,
                        long_strike=None,
                        width=None,
                        gross_credit_per_share=short_leg.mid,
                        gross_credit_dollars=gross_credit_dollars,
                        moomoo_fee_dollars=moomoo_fee,
                        net_credit_dollars=net_credit_dollars,
                        max_profit_dollars=net_credit_dollars,
                        max_loss_dollars=max_loss_dollars,
                        collateral_required=collateral,
                        return_on_risk_pct=round(ror_pct, 2),
                        annualized_roc_pct=round(ann_roc_pct, 2),
                        breakeven_price=breakeven,
                        downside_cushion_pct=round(cushion_pct, 2),
                        pop_pct=round(pop_pct, 1),
                        expected_value_dollars=round(ev_dollars, 2),
                        net_delta=round(-short_leg.delta * 100.0, 2),
                        net_theta_per_day=round(-short_leg.theta * 100.0, 2),
                        net_vega_per_1pct=round(-short_leg.vega * 100.0, 2),
                        spread_slippage_pct=round(short_leg.spread_pct, 1),
                        safety=safety,
                        exit_playbook=ExitPlaybook(
                            take_profit_50_credit=tp_credit,
                            take_profit_dollars=round(net_credit_dollars * 0.5, 2),
                            dte_exit_days=21,
                            dte_exit_date=dte_21_date,
                            stop_loss_rule=f"账户预留足额现金 ${collateral:,.0f}，不使用融资杠杆；若到期被指派接股，自动转入备兑看涨 (Wheel 轮动策略)。",
                            beginner_summary="巴菲特最常用的期权入门法：涨了白赚权利金利息，跌破则按心仪折扣价买入优质正股。",
                        ),
                        moomoo_execution_steps=[
                            f"确认 moomoo 账户现金购买力充足（需预留 ${collateral:,.0f} 现金担保，勿超额加杠杆）",
                            f"进入 {symbol} 期权链 -> 选择 {exp_str} ({dte}天) -> 选中行权价 ${short_leg.strike:g} Put ({short_leg.moomoo_code})",
                            f"点击「卖出 (Sell)」-> 限价单填入 ${short_leg.mid:.2f}（盘口买一 ${short_leg.bid:.2f} / 卖一 ${short_leg.ask:.2f}）",
                            f"权利金回落至 ${tp_credit:.2f} 时买回平仓（Buy to Close）锁定 50% 利润",
                        ],
                    )
                )

        # ----------------------------------------------------------------------
        # STRATEGY 3: Covered Call (备兑看涨期权 — 持股收租 / Wheel 下半场)
        # ----------------------------------------------------------------------
        if strategy_filter in ("all", "covered_call"):
            otm_calls: list[OptionLeg] = []
            for c in calls_raw:
                if float(c["strike"]) <= spot * 1.005:
                    continue
                leg = _build_leg(symbol, exp_str, dte, "SELL", "CALL", c, spot)
                if leg.bid > 0.03 and leg.mid >= 0.08:
                    otm_calls.append(leg)

            cc_candidates = [
                leg for leg in otm_calls
                if delta_lo <= abs(leg.delta) <= delta_hi
                and leg.open_interest >= 80
                and leg.spread_pct <= 14.0
                and (spot * 100.0) <= max_capital
            ]
            cc_candidates.sort(key=lambda l: abs(abs(l.delta) - 0.5 * (delta_lo + delta_hi)))
            for short_call in cc_candidates[:1]:
                collateral = round(spot * 100.0, 2)
                gross_credit_dollars = round(short_call.mid * 100.0, 2)
                moomoo_fee = estimate_moomoo_us_option_fee(num_legs=1, contracts_per_leg=1)
                net_credit_dollars = round(gross_credit_dollars - moomoo_fee, 2)
                if net_credit_dollars <= 10.0:
                    continue

                static_ror_pct = (net_credit_dollars / collateral) * 100.0
                ann_roc_pct = static_ror_pct * (365.0 / dte)
                if ann_roc_pct < 5.0:
                    continue

                breakeven = round(spot - (net_credit_dollars / 100.0), 2)
                cushion_pct = ((spot - breakeven) / spot) * 100.0
                upside_cap_pct = ((short_call.strike - spot) / spot) * 100.0
                # For Covered Call, not getting called away probability OR total positive return probability
                prob_keep_shares = (1.0 - implied_prob_above(spot, short_call.strike, t_years, short_call.iv)) * 100.0
                pop_pct = max(prob_keep_shares, implied_prob_above(spot, breakeven, t_years, short_call.iv) * 100.0)
                max_profit_If_called = round((short_call.strike - spot) * 100.0 + net_credit_dollars, 2)

                safety = score_beginner_safety(
                    pop_pct=pop_pct,
                    cushion_pct=max(cushion_pct * 2.2, upside_cap_pct),
                    spread_slippage_pct=short_call.spread_pct,
                    min_oi=short_call.open_interest,
                    atm_iv_pct=atm_iv,
                    iv_hv_ratio=iv_hv_ratio,
                    trend_status=trend_status,
                    rsi_14=rsi_14,
                    has_earnings_before_exp=has_earnings_before_exp,
                    strategy="covered_call",
                )

                tp_credit = round(short_call.mid * 0.50, 2)
                results.append(
                    StrategyCandidate(
                        id=f"{symbol}-CC-{exp_str}-{short_call.strike}",
                        symbol=symbol,
                        name=snapshot["name"],
                        sector=snapshot["sector"],
                        data_source=data_source,  # type: ignore[arg-type]
                        spot_price=round(spot, 2),
                        sma_50=round(sma_50, 2),
                        sma_200=round(sma_200, 2),
                        trend_status=trend_status,  # type: ignore[arg-type]
                        rsi_14=round(rsi_14, 1),
                        hv_20=round(hv_20, 1),
                        atm_iv=round(atm_iv, 1),
                        iv_hv_ratio=iv_hv_ratio,
                        earnings_date=earnings_date,
                        days_to_earnings=days_to_earnings,
                        has_earnings_before_exp=has_earnings_before_exp,
                        strategy="covered_call",
                        strategy_label="备兑看涨收租 (Covered Call)",
                        strategy_subtitle=f"持 100 股 + 卖 ${short_call.strike:g}C · 静态收租 ${net_credit_dollars:.0f} (被行权最高赚 ${max_profit_If_called:.0f})",
                        expiration=exp_str,
                        dte=dte,
                        legs=[short_call],
                        short_strike=short_call.strike,
                        long_strike=None,
                        width=None,
                        gross_credit_per_share=short_call.mid,
                        gross_credit_dollars=gross_credit_dollars,
                        moomoo_fee_dollars=moomoo_fee,
                        net_credit_dollars=net_credit_dollars,
                        max_profit_dollars=max_profit_If_called,
                        max_loss_dollars=round(breakeven * 100.0, 2),
                        collateral_required=collateral,
                        return_on_risk_pct=round(static_ror_pct, 2),
                        annualized_roc_pct=round(ann_roc_pct, 2),
                        breakeven_price=breakeven,
                        downside_cushion_pct=round(cushion_pct, 2),
                        pop_pct=round(pop_pct, 1),
                        expected_value_dollars=round(net_credit_dollars * 0.75, 2),
                        net_delta=round((1.0 - short_call.delta) * 100.0, 2),
                        net_theta_per_day=round(-short_call.theta * 100.0, 2),
                        net_vega_per_1pct=round(-short_call.vega * 100.0, 2),
                        spread_slippage_pct=round(short_call.spread_pct, 1),
                        safety=safety,
                        exit_playbook=ExitPlaybook(
                            take_profit_50_credit=tp_credit,
                            take_profit_dollars=round(net_credit_dollars * 0.5, 2),
                            dte_exit_days=21,
                            dte_exit_date=dte_21_date,
                            stop_loss_rule=f"必须持有 100 股 {symbol} 正股才可卖出 Call（切勿裸卖 Call！）；若股价涨超 ${short_call.strike:g} 则自动止盈交割股票。",
                            beginner_summary="持有 100 股正股的基础上每月收租增强收益，降低持仓成本，无追加保证金爆仓风险。",
                        ),
                        moomoo_execution_steps=[
                            f"若尚未持有 100 股 {symbol}，可在 moomoo 直接选用「备兑看涨 (Covered Stock)」组合单同时买股+卖 Call",
                            f"若已持有 ≥100 股，选中 {exp_str} 行权价 ${short_call.strike:g} Call ({short_call.moomoo_code}) 挂限价单卖出 1 张",
                            f"回落至 ${tp_credit:.2f} 可提前平仓，释放股票继续卖下一期",
                        ],
                    )
                )

    return results


def compute_payoff_grid(req: PayoffCurveRequest) -> tuple[list[PayoffGridPoint], float, float, float, float, float]:
    """
    Compute multi-curve P&L across underlying price grid:
      - Expiration P&L
      - Today P&L (T = dte)
      - Halfway P&L (T = 50% dte)
      - Interactive Simulated P&L (T = dte - days_passed, IV = iv + iv_shift_pct)
    """
    spot = req.spot_price
    dte = max(req.dte, 1)
    fee = req.moomoo_fee_dollars

    # Determine price range wide enough to cover strikes and +-18%
    strikes = [leg.strike for leg in req.legs] + [spot]
    min_ref = min(strikes)
    max_ref = max(strikes)
    low_price = max(1.0, min(spot * 0.82, min_ref * 0.90))
    high_price = max(spot * 1.18, max_ref * 1.10)

    avg_iv = sum(leg.iv for leg in req.legs) / max(len(req.legs), 1)
    t_full = dte / 365.0
    one_sd_move = avg_iv * math.sqrt(t_full)
    one_sd_low = round(spot * math.exp(-one_sd_move), 2)
    one_sd_high = round(spot * math.exp(one_sd_move), 2)

    t_half = max(0.5 * dte / 365.0, 1e-6)
    sim_rem_days = max(0, dte - req.days_passed)
    t_sim = max(sim_rem_days / 365.0, 1e-6)
    iv_shift_dec = req.iv_shift_pct / 100.0

    # Entry net credit per share
    entry_credit_per_share = 0.0
    for leg in req.legs:
        sign = 1.0 if leg.action == "SELL" else -1.0
        entry_credit_per_share += sign * leg.mid

    # Calibrate theoretical entry value at spot so Today curve passes cleanly near -$fee at spot
    theo_entry_per_share = 0.0
    for leg in req.legs:
        sign = 1.0 if leg.action == "SELL" else -1.0
        g0 = bs_price_and_greeks(spot, leg.strike, t_full, leg.iv, leg.option_type)
        theo_entry_per_share += sign * g0.price
    basis_adj = entry_credit_per_share - theo_entry_per_share

    num_pts = 101
    step = (high_price - low_price) / (num_pts - 1)
    grid: list[PayoffGridPoint] = []

    for i in range(num_pts):
        px = round(low_price + i * step, 2)
        pct_move = ((px - spot) / spot) * 100.0

        exp_val = 0.0
        today_val = 0.0
        half_val = 0.0
        sim_val = 0.0

        for leg in req.legs:
            # Position sign from holder perspective: SELL means we collected mid, owe current value
            pos_mult = -1.0 if leg.action == "SELL" else 1.0
            intrinsic = max(0.0, px - leg.strike) if leg.option_type == "CALL" else max(0.0, leg.strike - px)

            g_today = bs_price_and_greeks(px, leg.strike, t_full, leg.iv, leg.option_type)
            g_half = bs_price_and_greeks(px, leg.strike, t_half, leg.iv, leg.option_type)
            sim_iv = max(0.03, leg.iv + iv_shift_dec)
            g_sim = bs_price_and_greeks(px, leg.strike, t_sim, sim_iv, leg.option_type)

            exp_val += pos_mult * intrinsic
            today_val += pos_mult * g_today.price
            half_val += pos_mult * g_half.price
            sim_val += pos_mult * g_sim.price

        # If Covered Call, include 100 shares of underlying stock P&L!
        stock_pnl = 0.0
        if req.strategy == "covered_call":
            stock_pnl = (px - spot) * 100.0

        exp_pnl = (entry_credit_per_share + exp_val) * 100.0 + stock_pnl - fee
        today_pnl = (entry_credit_per_share - basis_adj + today_val) * 100.0 + stock_pnl - fee
        half_pnl = (entry_credit_per_share - basis_adj * 0.5 + half_val) * 100.0 + stock_pnl - fee
        sim_pnl = (entry_credit_per_share - basis_adj * (sim_rem_days / dte) + sim_val) * 100.0 + stock_pnl - fee

        grid.append(
            PayoffGridPoint(
                price=px,
                pct_move=round(pct_move, 2),
                expiration_pnl=round(exp_pnl, 2),
                today_pnl=round(today_pnl, 2),
                halfway_pnl=round(half_pnl, 2),
                simulated_pnl=round(sim_pnl, 2),
            )
        )

    exp_pnls = [g.expiration_pnl for g in grid]
    max_profit = round(max(exp_pnls), 2)
    max_loss = round(abs(min(exp_pnls)), 2)

    # Interpolate breakeven where expiration_pnl crosses 0
    breakeven = spot
    for idx in range(len(grid) - 1):
        y1, y2 = grid[idx].expiration_pnl, grid[idx + 1].expiration_pnl
        if (y1 <= 0 <= y2) or (y2 <= 0 <= y1):
            x1, x2 = grid[idx].price, grid[idx + 1].price
            if abs(y2 - y1) > 1e-6:
                breakeven = round(x1 + (0.0 - y1) * (x2 - x1) / (y2 - y1), 2)
            break

    return grid, breakeven, max_profit, max_loss, one_sd_low, one_sd_high
