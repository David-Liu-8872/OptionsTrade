from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from scipy.stats import norm


RISK_FREE_RATE_DEFAULT = 0.043  # US Treasury short-term benchmark (~4.3%)


@dataclass
class BSGreeks:
    price: float
    delta: float
    gamma: float
    theta: float  # Per calendar day, per 1 share ($)
    vega: float   # Per +1% (+0.01) IV change, per 1 share ($)


def bs_price_and_greeks(
    spot: float,
    strike: float,
    t_years: float,
    iv: float,
    option_type: str,
    r: float = RISK_FREE_RATE_DEFAULT,
) -> BSGreeks:
    """Calculate Black-Scholes theoretical price and Greeks for Call / Put."""
    opt = option_type.upper()
    if spot <= 0 or strike <= 0:
        return BSGreeks(0.0, 0.0, 0.0, 0.0, 0.0)

    if t_years <= 1e-6 or iv <= 1e-4:
        intrinsic = max(0.0, spot - strike) if opt == "CALL" else max(0.0, strike - spot)
        if opt == "CALL":
            delta = 1.0 if spot > strike else 0.0
        else:
            delta = -1.0 if spot < strike else 0.0
        return BSGreeks(intrinsic, delta, 0.0, 0.0, 0.0)

    sqrt_t = math.sqrt(t_years)
    d1 = (math.log(spot / strike) + (r + 0.5 * iv * iv) * t_years) / (iv * sqrt_t)
    d2 = d1 - iv * sqrt_t

    pdf_d1 = norm.pdf(d1)
    disc = math.exp(-r * t_years)

    if opt == "CALL":
        cdf_d1 = norm.cdf(d1)
        cdf_d2 = norm.cdf(d2)
        price = spot * cdf_d1 - strike * disc * cdf_d2
        delta = cdf_d1
        theta_annual = -(spot * pdf_d1 * iv) / (2.0 * sqrt_t) - r * strike * disc * cdf_d2
    else:
        cdf_neg_d1 = norm.cdf(-d1)
        cdf_neg_d2 = norm.cdf(-d2)
        price = strike * disc * cdf_neg_d2 - spot * cdf_neg_d1
        delta = cdf_neg_d1 - 1.0  # [-1, 0] for Put: N(d1) - 1 = -N(-d1)
        delta = norm.cdf(d1) - 1.0
        theta_annual = -(spot * pdf_d1 * iv) / (2.0 * sqrt_t) + r * strike * disc * cdf_neg_d2

    gamma = pdf_d1 / (spot * iv * sqrt_t)
    theta_daily = theta_annual / 365.0
    vega_1pct = spot * pdf_d1 * sqrt_t / 100.0

    return BSGreeks(
        price=max(0.0, float(price)),
        delta=float(delta),
        gamma=float(gamma),
        theta=float(theta_daily),
        vega=float(vega_1pct),
    )


def implied_prob_above(
    spot: float,
    level: float,
    t_years: float,
    iv: float,
    r: float = RISK_FREE_RATE_DEFAULT,
) -> float:
    """Risk-neutral probability that S_T > level at expiration (N(d2))."""
    if spot <= 0 or level <= 0:
        return 0.0
    if t_years <= 1e-6 or iv <= 1e-4:
        return 1.0 if spot > level else 0.0
    sqrt_t = math.sqrt(t_years)
    d2 = (math.log(spot / level) + (r - 0.5 * iv * iv) * t_years) / (iv * sqrt_t)
    return float(norm.cdf(d2))


def format_moomoo_us_option_code(
    symbol: str,
    expiration_yyyy_mm_dd: str,
    option_type: str,
    strike: float,
) -> tuple[str, str]:
    """
    Build Moomoo US Option symbol and standard OCC symbol.
    Example:
      SPY, '2026-12-18', 'PUT', 580.0 -> ('US.SPY261218P00580000', 'SPY261218P00580000')
    """
    clean_sym = symbol.upper().replace("US.", "").strip()
    dt = datetime.strptime(expiration_yyyy_mm_dd, "%Y-%m-%d")
    yymmdd = dt.strftime("%y%m%d")
    cp = "C" if option_type.upper().startswith("C") else "P"
    strike_int = int(round(strike * 1000))
    occ = f"{clean_sym}{yymmdd}{cp}{strike_int:08d}"
    return f"US.{occ}", occ


def estimate_moomoo_us_option_fee(num_legs: int, contracts_per_leg: int = 1) -> float:
    """
    Estimate Moomoo US option round-trip or entry regulatory + platform fees.
    Moomoo US charges $0 commission + ~$0.55-$0.65 contract/platform + ~$0.05-0.12 regulatory (ORF/OCC/CAT) per contract.
    We budget $0.68 per leg entry so net return calculations are realistic for small accounts.
    """
    total_contracts = max(1, num_legs * contracts_per_leg)
    return round(total_contracts * 0.68, 2)


def generate_probability_cone(
    spot: float,
    atm_iv_decimal: float,
    dte: int,
    start_date: date | None = None,
) -> list[dict]:
    """Generate forward expected move bands (1.0 SD = 68.2%, 1.5 SD = 86.6%) from today to expiration."""
    base = start_date or datetime.now().date()
    iv = max(0.08, min(atm_iv_decimal, 2.0))
    steps = min(max(dte, 5), 25)
    cone = []
    for i in range(steps + 1):
        days_ahead = round(i * dte / steps) if steps > 0 else 0
        dt_str = (base + timedelta(days=days_ahead)).strftime("%Y-%m-%d")
        t = max(days_ahead / 365.0, 0.0)
        sigma_move = iv * math.sqrt(t)
        cone.append({
            "date": dt_str,
            "days_ahead": days_ahead,
            "center": round(spot, 2),
            "upper_1sd": round(spot * math.exp(sigma_move), 2),
            "lower_1sd": round(spot * math.exp(-sigma_move), 2),
            "upper_15sd": round(spot * math.exp(1.5 * sigma_move), 2),
            "lower_15sd": round(spot * math.exp(-1.5 * sigma_move), 2),
        })
    return cone
