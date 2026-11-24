from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field

StrategyType = Literal["bull_put_spread", "cash_secured_put", "covered_call"]
StrategyFilterType = Literal["all", "bull_put_spread", "cash_secured_put", "covered_call"]
RiskLevelType = Literal["conservative", "balanced", "income"]


class OptionLeg(BaseModel):
    action: Literal["SELL", "BUY"]
    option_type: Literal["PUT", "CALL"]
    strike: float
    expiration: str
    dte: int
    bid: float
    ask: float
    mid: float
    iv: float = Field(description="Implied volatility in decimal, e.g. 0.24 = 24%")
    delta: float
    gamma: float
    theta: float
    vega: float
    open_interest: int
    volume: int
    spread_pct: float
    moomoo_code: str
    occ_symbol: str


class SafetyBreakdown(BaseModel):
    score_total: int
    grade: str
    win_rate_score: int       # 0-100
    cushion_score: int        # 0-100
    liquidity_score: int      # 0-100
    volatility_score: int     # 0-100
    trend_event_score: int    # 0-100
    highlights: list[str]
    warnings: list[str]


class ExitPlaybook(BaseModel):
    take_profit_50_credit: float = Field(description="Close when remaining option/spread value drops to this price")
    take_profit_dollars: float
    dte_exit_days: int = 21
    dte_exit_date: str
    stop_loss_rule: str
    beginner_summary: str


class StrategyCandidate(BaseModel):
    id: str
    symbol: str
    name: str
    sector: str
    data_source: Literal["moomoo_opend", "yfinance_live", "demo_fallback"]
    spot_price: float
    sma_50: float
    sma_200: float
    trend_status: Literal["strong_uptrend", "uptrend", "neutral", "downtrend"]
    rsi_14: float
    hv_20: float = Field(description="20-day annualized historical volatility in %")
    atm_iv: float = Field(description="ATM implied volatility in %")
    iv_hv_ratio: float
    earnings_date: Optional[str] = None
    days_to_earnings: Optional[int] = None
    has_earnings_before_exp: bool = False

    strategy: StrategyType
    strategy_label: str
    strategy_subtitle: str
    expiration: str
    dte: int

    legs: list[OptionLeg]
    short_strike: float
    long_strike: Optional[float] = None
    width: Optional[float] = None

    gross_credit_per_share: float
    gross_credit_dollars: float
    moomoo_fee_dollars: float
    net_credit_dollars: float

    max_profit_dollars: float
    max_loss_dollars: float
    collateral_required: float

    return_on_risk_pct: float
    annualized_roc_pct: float
    breakeven_price: float
    downside_cushion_pct: float
    pop_pct: float = Field(description="Black-Scholes Probability of Profit at expiration (%)")
    expected_value_dollars: float

    net_delta: float
    net_theta_per_day: float
    net_vega_per_1pct: float
    spread_slippage_pct: float

    safety: SafetyBreakdown
    exit_playbook: ExitPlaybook
    moomoo_execution_steps: list[str]


class ScreenerRequest(BaseModel):
    strategy: StrategyFilterType = "all"
    pool_id: str = "beginner_etf"
    custom_symbols: list[str] = Field(default_factory=list)
    max_capital_per_trade: float = 5000.0
    min_dte: int = 21
    max_dte: int = 46
    risk_level: RiskLevelType = "conservative"
    spread_width: float = 5.0
    exclude_earnings: bool = True
    only_uptrend: bool = False
    prefer_moomoo: bool = True


class ScreenerResponse(BaseModel):
    generated_at: str
    active_source: str
    moomoo_connected: bool
    scanned_symbols: list[str]
    total_candidates: int
    candidates: list[StrategyCandidate]
    market_notes: list[str]


class PayoffCurveRequest(BaseModel):
    spot_price: float
    dte: int
    strategy: StrategyType
    legs: list[OptionLeg]
    moomoo_fee_dollars: float = 1.30
    days_passed: int = 0
    iv_shift_pct: float = 0.0
    symbol: Optional[str] = None


class PricePoint(BaseModel):
    date: str
    close: float
    high: float
    low: float
    sma50: Optional[float] = None
    sma200: Optional[float] = None


class ConePoint(BaseModel):
    date: str
    days_ahead: int
    center: float
    upper_1sd: float
    lower_1sd: float
    upper_15sd: float
    lower_15sd: float


class PayoffGridPoint(BaseModel):
    price: float
    pct_move: float
    expiration_pnl: float
    today_pnl: float
    halfway_pnl: float
    simulated_pnl: float


class PayoffCurveResponse(BaseModel):
    symbol: Optional[str] = None
    spot_price: float
    breakeven_price: float
    max_profit_dollars: float
    max_loss_dollars: float
    one_sd_low: float
    one_sd_high: float
    grid: list[PayoffGridPoint]
    price_history: list[PricePoint]
    probability_cone: list[ConePoint]


class MoomooStatusResponse(BaseModel):
    connected: bool
    host: str
    port: int
    quote_ok: bool
    sim_trade_ok: bool
    message: str
    sim_cash: Optional[float] = None
    sim_total_assets: Optional[float] = None


class PaperTradeCreate(BaseModel):
    candidate_id: str
    symbol: str
    strategy: StrategyType
    strategy_label: str
    expiration: str
    dte_at_entry: int
    short_strike: float
    long_strike: Optional[float] = None
    contracts: int = 1
    entry_net_credit_dollars: float
    max_loss_dollars: float
    collateral_required: float
    breakeven_price: float
    spot_at_entry: float
    moomoo_codes: list[str]
    notes: str = ""
    submit_to_moomoo_sim: bool = False


class PaperTradeRecord(BaseModel):
    id: int
    created_at: str
    status: Literal["OPEN", "CLOSED"]
    symbol: str
    strategy: StrategyType
    strategy_label: str
    expiration: str
    current_dte: int
    short_strike: float
    long_strike: Optional[float] = None
    contracts: int
    entry_net_credit_dollars: float
    max_loss_dollars: float
    collateral_required: float
    breakeven_price: float
    spot_at_entry: float
    current_spot: float
    estimated_current_pnl: float
    pnl_pct_of_max_profit: float
    moomoo_codes: list[str]
    moomoo_order_status: str
    alert_tag: Optional[str] = None
    alert_message: Optional[str] = None
    notes: str = ""


class SimConfig(BaseModel):
    initial_capital: float = 10000.0
    max_open_positions: int = 6
    max_collateral_per_trade: float = 2000.0
    max_total_utilization_pct: float = 60.0
    min_safety_score: int = 72
    take_profit_pct: float = 50.0
    dte_exit_threshold: int = 21
    stop_loss_mult: float = 2.0
    watchlist: list[str] = Field(
        default_factory=lambda: [
            "SPY", "QQQ", "IWM", "GLD", "TLT", "DIA",
            "AAPL", "MSFT", "GOOGL", "AMZN", "KO", "JPM",
        ]
    )


class SimPositionLeg(BaseModel):
    action: Literal["SELL", "BUY"]
    option_type: Literal["PUT", "CALL"]
    strike: float
    entry_mid: float
    current_mark: float
    iv_at_entry: float
    moomoo_code: str


class SimPosition(BaseModel):
    pos_id: str
    status: Literal["OPEN", "CLOSED"]
    opened_at: str
    closed_at: Optional[str] = None
    exit_reason: Optional[str] = None
    exit_reason_label: Optional[str] = None
    symbol: str
    name: str
    strategy: StrategyType
    strategy_label: str
    expiration: str
    dte_at_entry: int
    current_dte: int
    contracts: int = 1
    short_strike: float
    long_strike: Optional[float] = None
    legs: list[SimPositionLeg]
    spot_at_entry: float
    current_spot: float
    breakeven_price: float
    safety_score_at_entry: int
    safety_grade_at_entry: str
    pop_at_entry: float
    gross_credit_dollars: float
    entry_fee_dollars: float
    entry_net_credit_dollars: float
    collateral_required: float
    max_loss_dollars: float
    current_close_debit_dollars: float
    exit_fee_dollars: float
    net_pnl_dollars: float
    pnl_pct_of_credit: float


class SimEquityPoint(BaseModel):
    timestamp: str
    date: str
    total_equity: float
    cash_available: float
    collateral_locked: float
    realized_pnl_cum: float
    unrealized_pnl: float
    spy_benchmark_equity: float
    drawdown_pct: float
    open_positions_count: int


class SimActivityEvent(BaseModel):
    timestamp: str
    event_type: Literal["OPEN", "CLOSE", "MARK", "INIT"]
    symbol: str
    summary: str
    pnl_dollars: Optional[float] = None


class SimPortfolioState(BaseModel):
    started_at: str
    last_updated_at: str
    days_running: int
    total_runs: int
    spy_entry_spot: float
    spy_current_spot: float
    config: SimConfig
    total_equity: float
    total_return_dollars: float
    total_return_pct: float
    spy_return_pct: float
    cash_available: float
    collateral_locked: float
    utilization_pct: float
    realized_pnl_cum: float
    unrealized_pnl: float
    win_count: int
    loss_count: int
    win_rate_pct: float
    max_drawdown_pct: float
    open_positions: list[SimPosition]
    closed_positions: list[SimPosition]
    equity_curve: list[SimEquityPoint]
    activity_log: list[SimActivityEvent]

