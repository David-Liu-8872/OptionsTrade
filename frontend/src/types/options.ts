export type StrategyType = 'bull_put_spread' | 'cash_secured_put' | 'covered_call';
export type StrategyFilterType = 'all' | StrategyType;
export type RiskLevelType = 'conservative' | 'balanced' | 'income';

export interface OptionLeg {
  action: 'SELL' | 'BUY';
  option_type: 'PUT' | 'CALL';
  strike: number;
  expiration: string;
  dte: number;
  bid: number;
  ask: number;
  mid: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  open_interest: number;
  volume: number;
  spread_pct: number;
  moomoo_code: string;
  occ_symbol: string;
}

export interface SafetyBreakdown {
  score_total: number;
  grade: string;
  win_rate_score: number;
  cushion_score: number;
  liquidity_score: number;
  volatility_score: number;
  trend_event_score: number;
  highlights: string[];
  warnings: string[];
}

export interface ExitPlaybook {
  take_profit_50_credit: number;
  take_profit_dollars: number;
  dte_exit_days: number;
  dte_exit_date: string;
  stop_loss_rule: string;
  beginner_summary: string;
}

export interface StrategyCandidate {
  id: string;
  symbol: string;
  name: string;
  sector: string;
  data_source: 'moomoo_opend' | 'yfinance_live' | 'demo_fallback';
  spot_price: number;
  sma_50: number;
  sma_200: number;
  trend_status: 'strong_uptrend' | 'uptrend' | 'neutral' | 'downtrend';
  rsi_14: number;
  hv_20: number;
  atm_iv: number;
  iv_hv_ratio: number;
  earnings_date: string | null;
  days_to_earnings: number | null;
  has_earnings_before_exp: boolean;

  strategy: StrategyType;
  strategy_label: string;
  strategy_subtitle: string;
  expiration: string;
  dte: number;

  legs: OptionLeg[];
  short_strike: number;
  long_strike: number | null;
  width: number | null;

  gross_credit_per_share: number;
  gross_credit_dollars: number;
  moomoo_fee_dollars: number;
  net_credit_dollars: number;

  max_profit_dollars: number;
  max_loss_dollars: number;
  collateral_required: number;

  return_on_risk_pct: number;
  annualized_roc_pct: number;
  breakeven_price: number;
  downside_cushion_pct: number;
  pop_pct: number;
  expected_value_dollars: number;

  net_delta: number;
  net_theta_per_day: number;
  net_vega_per_1pct: number;
  spread_slippage_pct: number;

  safety: SafetyBreakdown;
  exit_playbook: ExitPlaybook;
  moomoo_execution_steps: string[];
}

export interface ScreenerRequest {
  strategy: StrategyFilterType;
  pool_id: string;
  custom_symbols: string[];
  max_capital_per_trade: number;
  min_dte: number;
  max_dte: number;
  risk_level: RiskLevelType;
  spread_width: number;
  exclude_earnings: boolean;
  only_uptrend: boolean;
  prefer_moomoo: boolean;
}

export interface ScreenerResponse {
  generated_at: string;
  active_source: string;
  moomoo_connected: boolean;
  scanned_symbols: string[];
  total_candidates: number;
  candidates: StrategyCandidate[];
  market_notes: string[];
}

export interface PayoffGridPoint {
  price: number;
  pct_move: number;
  expiration_pnl: number;
  today_pnl: number;
  halfway_pnl: number;
  simulated_pnl: number;
}

export interface PricePoint {
  date: string;
  close: number;
  high: number;
  low: number;
  sma50: number | null;
  sma200: number | null;
}

export interface ConePoint {
  date: string;
  days_ahead: number;
  center: number;
  upper_1sd: number;
  lower_1sd: number;
  upper_15sd: number;
  lower_15sd: number;
}

export interface PayoffCurveResponse {
  symbol: string | null;
  spot_price: number;
  breakeven_price: number;
  max_profit_dollars: number;
  max_loss_dollars: number;
  one_sd_low: number;
  one_sd_high: number;
  grid: PayoffGridPoint[];
  price_history: PricePoint[];
  probability_cone: ConePoint[];
}

export interface MoomooStatusResponse {
  connected: boolean;
  host: string;
  port: number;
  quote_ok: boolean;
  sim_trade_ok: boolean;
  message: string;
  sim_cash: number | null;
  sim_total_assets: number | null;
}

export interface PresetPool {
  id: string;
  name: string;
  description: string;
  symbols: string[];
}

export interface PaperTradeRecord {
  id: number;
  created_at: string;
  status: 'OPEN' | 'CLOSED';
  symbol: string;
  strategy: StrategyType;
  strategy_label: string;
  expiration: string;
  current_dte: number;
  short_strike: number;
  long_strike: number | null;
  contracts: number;
  entry_net_credit_dollars: number;
  max_loss_dollars: number;
  collateral_required: number;
  breakeven_price: number;
  spot_at_entry: number;
  current_spot: number;
  estimated_current_pnl: number;
  pnl_pct_of_max_profit: number;
  moomoo_codes: string[];
  moomoo_order_status: string;
  alert_tag: string | null;
  alert_message: string | null;
  notes: string;
}

export interface SimConfig {
  initial_capital: number;
  max_open_positions: number;
  max_collateral_per_trade: number;
  max_total_utilization_pct: number;
  min_safety_score: number;
  take_profit_pct: number;
  dte_exit_threshold: number;
  stop_loss_mult: number;
  watchlist: string[];
}

export interface SimPositionLeg {
  action: 'SELL' | 'BUY';
  option_type: 'PUT' | 'CALL';
  strike: number;
  entry_mid: number;
  current_mark: number;
  iv_at_entry: number;
  moomoo_code: string;
}

export interface SimPosition {
  pos_id: string;
  status: 'OPEN' | 'CLOSED';
  opened_at: string;
  closed_at: string | null;
  exit_reason: string | null;
  exit_reason_label: string | null;
  symbol: string;
  name: string;
  strategy: StrategyType;
  strategy_label: string;
  expiration: string;
  dte_at_entry: number;
  current_dte: number;
  contracts: number;
  short_strike: number;
  long_strike: number | null;
  legs: SimPositionLeg[];
  spot_at_entry: number;
  current_spot: number;
  breakeven_price: number;
  safety_score_at_entry: number;
  safety_grade_at_entry: string;
  pop_at_entry: number;
  gross_credit_dollars: number;
  entry_fee_dollars: number;
  entry_net_credit_dollars: number;
  collateral_required: number;
  max_loss_dollars: number;
  current_close_debit_dollars: number;
  exit_fee_dollars: number;
  net_pnl_dollars: number;
  pnl_pct_of_credit: number;
}

export interface SimEquityPoint {
  timestamp: string;
  date: string;
  total_equity: number;
  cash_available: number;
  collateral_locked: number;
  realized_pnl_cum: number;
  unrealized_pnl: number;
  spy_benchmark_equity: number;
  drawdown_pct: number;
  open_positions_count: number;
}

export interface SimActivityEvent {
  timestamp: string;
  event_type: 'OPEN' | 'CLOSE' | 'MARK' | 'INIT';
  symbol: string;
  summary: string;
  pnl_dollars: number | null;
}

export interface SimPortfolioState {
  started_at: string;
  last_updated_at: string;
  days_running: number;
  total_runs: number;
  spy_entry_spot: number;
  spy_current_spot: number;
  config: SimConfig;
  total_equity: number;
  total_return_dollars: number;
  total_return_pct: number;
  spy_return_pct: number;
  cash_available: number;
  collateral_locked: number;
  utilization_pct: number;
  realized_pnl_cum: number;
  unrealized_pnl: number;
  win_count: number;
  loss_count: number;
  win_rate_pct: number;
  max_drawdown_pct: number;
  open_positions: SimPosition[];
  closed_positions: SimPosition[];
  equity_curve: SimEquityPoint[];
  activity_log: SimActivityEvent[];
}

