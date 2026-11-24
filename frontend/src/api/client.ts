import type {
  MoomooStatusResponse,
  OptionLeg,
  PaperTradeRecord,
  PayoffCurveResponse,
  PresetPool,
  ScreenerRequest,
  ScreenerResponse,
  SimPortfolioState,
  StrategyType,
} from '../types/options';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || contentType.includes('text/html')) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function fetchWithStaticFallback<T>(
  apiUrl: string,
  staticUrl: string,
  init?: RequestInit
): Promise<{ data: T; isStatic: boolean }> {
  try {
    const data = await requestJson<T>(apiUrl, init);
    return { data, isStatic: false };
  } catch {
    const res = await fetch(`${staticUrl}?t=${Date.now()}`);
    if (!res.ok) {
      throw new Error(`API and static snapshot (${staticUrl}) unavailable`);
    }
    const data = (await res.json()) as T;
    return { data, isStatic: true };
  }
}

export const apiClient = {
  getPresets: async () => {
    const { data } = await fetchWithStaticFallback<{ pools: PresetPool[] }>(
      '/api/presets',
      './data/presets.json'
    );
    return data;
  },

  getMoomooStatus: () => requestJson<MoomooStatusResponse>('/api/moomoo/status'),

  scanOptions: async (payload: ScreenerRequest) => {
    const { data } = await fetchWithStaticFallback<ScreenerResponse>(
      '/api/screener/scan',
      './data/latest_scan.json',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    return data;
  },

  analyzePayoff: (params: {
    symbol: string;
    spot_price: number;
    dte: number;
    strategy: StrategyType;
    legs: OptionLeg[];
    moomoo_fee_dollars: number;
    days_passed: number;
    iv_shift_pct: number;
  }) =>
    requestJson<PayoffCurveResponse>('/api/payoff/analyze', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  getJournal: () => requestJson<PaperTradeRecord[]>('/api/journal'),

  addPaperTrade: (payload: {
    candidate_id: string;
    symbol: string;
    strategy: StrategyType;
    strategy_label: string;
    expiration: string;
    dte_at_entry: number;
    short_strike: number;
    long_strike: number | null;
    contracts: number;
    entry_net_credit_dollars: number;
    max_loss_dollars: number;
    collateral_required: number;
    breakeven_price: number;
    spot_at_entry: number;
    moomoo_codes: string[];
    notes?: string;
    submit_to_moomoo_sim?: boolean;
  }) =>
    requestJson<PaperTradeRecord>('/api/journal', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  closePaperTrade: (id: number) =>
    requestJson<{ ok: boolean }>(`/api/journal/${id}/close`, { method: 'POST' }),

  deletePaperTrade: (id: number) =>
    requestJson<{ ok: boolean }>(`/api/journal/${id}`, { method: 'DELETE' }),

  getSimPortfolio: () =>
    fetchWithStaticFallback<SimPortfolioState>(
      '/api/sim/portfolio',
      './data/sim_portfolio.json'
    ),

  runSimCycle: (markOnly = false) =>
    requestJson<SimPortfolioState>(
      `/api/sim/run-cycle?mark_only=${markOnly}`,
      { method: 'POST' }
    ),

  resetSimPortfolio: () =>
    requestJson<SimPortfolioState>('/api/sim/reset', { method: 'POST' }),
};
