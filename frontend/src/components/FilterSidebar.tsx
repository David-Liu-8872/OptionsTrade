import { useState } from 'react';
import {
  DollarSign,
  Filter,
  Layers,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import type {
  PresetPool,
  RiskLevelType,
  ScreenerRequest,
  StrategyFilterType,
} from '../types/options';

interface FilterSidebarProps {
  pools: PresetPool[];
  filters: ScreenerRequest;
  loading: boolean;
  onChange: (next: ScreenerRequest) => void;
  onRunScan: (req?: ScreenerRequest) => void;
}

const STRATEGY_OPTIONS: Array<{
  value: StrategyFilterType;
  title: string;
  tag: string;
  desc: string;
}> = [
  {
    value: 'all',
    title: '智能综合推荐 (全部低风险)',
    tag: '全景对比',
    desc: '同时扫描垂直信用价差、现金担保卖 Put 与备兑看涨',
  },
  {
    value: 'bull_put_spread',
    title: '牛市看跌价差 (Bull Put Spread)',
    tag: '新手小资金首选',
    desc: '卖虚值 Put + 买更低 Put 保护，100% 锁死最大亏损 ($300-$800)',
  },
  {
    value: 'cash_secured_put',
    title: '现金担保卖 Put (CSP)',
    tag: '巴菲特折价接股',
    desc: '不加融资杠杆，涨了白赚权利金，跌破则按安全垫折价买入蓝筹股',
  },
  {
    value: 'covered_call',
    title: '备兑看涨收租 (Covered Call)',
    tag: '持股增强收租',
    desc: '持有 100 股正股基础上卖出虚值 Call，每月稳定降低持仓成本',
  },
];

const RISK_OPTIONS: Array<{
  value: RiskLevelType;
  label: string;
  sub: string;
}> = [
  { value: 'conservative', label: '极度稳健', sub: 'Delta 0.12-0.22 · 胜率 ~82%' },
  { value: 'balanced', label: '均衡收租', sub: 'Delta 0.18-0.29 · 胜率 ~76%' },
  { value: 'income', label: '增强收益', sub: 'Delta 0.25-0.36 · 胜率 ~70%' },
];

export function FilterSidebar({
  pools,
  filters,
  loading,
  onChange,
  onRunScan,
}: FilterSidebarProps) {
  const [tickerInput, setTickerInput] = useState('');

  const handleAddTicker = () => {
    const cleaned = tickerInput
      .split(/[\s,，]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!cleaned.length) return;
    const merged = Array.from(new Set([...filters.custom_symbols, ...cleaned]));
    const next = { ...filters, custom_symbols: merged };
    onChange(next);
    setTickerInput('');
  };

  const handleRemoveTicker = (sym: string) => {
    const next = {
      ...filters,
      custom_symbols: filters.custom_symbols.filter((s) => s !== sym),
    };
    onChange(next);
  };

  const activePool = pools.find((p) => p.id === filters.pool_id);

  return (
    <aside className="flex flex-col gap-4 rounded-2xl border border-slate-800/90 bg-slate-900/65 p-4 shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-orange-400" />
          <h2 className="text-sm font-semibold text-white">策略与风控筛选器</h2>
        </div>
        <span className="text-[11px] text-slate-400">美股 OPRA 标准合约</span>
      </div>

      {/* 1. Strategy Picker */}
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
          <Layers className="h-3.5 w-3.5 text-orange-400" />
          <span>1. 选择期权策略（拒绝裸买末日彩票）</span>
        </label>
        <div className="grid grid-cols-1 gap-1.5">
          {STRATEGY_OPTIONS.map((opt) => {
            const selected = filters.strategy === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  const next = { ...filters, strategy: opt.value };
                  onChange(next);
                  onRunScan(next);
                }}
                className={`group rounded-xl border p-2.5 text-left transition cursor-pointer ${
                  selected
                    ? 'border-orange-500/70 bg-orange-500/12 shadow-sm shadow-orange-500/10'
                    : 'border-slate-800/90 bg-slate-950/50 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-xs font-semibold ${
                      selected ? 'text-orange-200' : 'text-slate-200'
                    }`}
                  >
                    {opt.title}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      selected
                        ? 'bg-orange-500/25 text-orange-200'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {opt.tag}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  {opt.desc}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Stock Pool Selector */}
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
          <Sparkles className="h-3.5 w-3.5 text-sky-400" />
          <span>2. 标的股票池（高流动性防滑点）</span>
        </label>
        <select
          value={filters.pool_id}
          onChange={(e) => {
            const next = { ...filters, pool_id: e.target.value };
            onChange(next);
            onRunScan(next);
          }}
          className="w-full rounded-xl border border-slate-700/80 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-orange-500 focus:outline-none"
        >
          {pools.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="custom">仅扫描下方自定义股票代码</option>
        </select>

        {activePool && filters.pool_id !== 'custom' && (
          <div className="rounded-lg bg-slate-950/60 p-2 text-[11px] text-slate-400">
            <p>{activePool.description}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {activePool.symbols.map((sym) => (
                <span
                  key={sym}
                  className="rounded bg-slate-800/90 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
                >
                  {sym}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Custom Symbol Adder */}
        <div className="flex gap-1.5">
          <input
            type="text"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTicker()}
            placeholder="追加美股代码，如 COST, AMD"
            className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-orange-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAddTicker}
            className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            添加
          </button>
        </div>

        {filters.custom_symbols.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {filters.custom_symbols.map((sym) => (
              <span
                key={sym}
                className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/15 px-2 py-0.5 font-mono text-[11px] text-sky-200"
              >
                {sym}
                <button
                  type="button"
                  onClick={() => handleRemoveTicker(sym)}
                  className="hover:text-white cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 3. Capital Budget Per Trade */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 font-medium text-slate-300">
            <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
            单笔最大占用担保金
          </span>
          <span className="font-mono font-bold text-emerald-400 tabular-nums">
            ${filters.max_capital_per_trade.toLocaleString()}
          </span>
        </div>
        <input
          type="range"
          min={500}
          max={70000}
          step={500}
          value={filters.max_capital_per_trade}
          onChange={(e) =>
            onChange({ ...filters, max_capital_per_trade: Number(e.target.value) })
          }
          className="w-full accent-orange-500 cursor-pointer"
        />
        <div className="flex justify-between text-[10px] text-slate-500">
          <span>$500 (价差小账户)</span>
          <span>$10k (中等账户)</span>
          <span>$70k (整手SPY)</span>
        </div>
      </div>

      {/* 4. Risk Level (Target Delta) */}
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-slate-300">
          3. 风险档位（行权概率控制）
        </span>
        <div className="grid grid-cols-3 gap-1.5">
          {RISK_OPTIONS.map((r) => {
            const active = filters.risk_level === r.value;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => onChange({ ...filters, risk_level: r.value })}
                className={`rounded-lg border px-2 py-2 text-center transition cursor-pointer ${
                  active
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-semibold">{r.label}</div>
                <div className="mt-0.5 text-[10px] opacity-80">
                  {r.value === 'conservative'
                    ? '~82%胜率'
                    : r.value === 'balanced'
                      ? '~76%胜率'
                      : '~70%胜率'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 5. DTE Window & Spread Width */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1">
          <label className="text-[11px] text-slate-400">到期天数窗口 (DTE)</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={7}
              max={60}
              value={filters.min_dte}
              onChange={(e) =>
                onChange({ ...filters, min_dte: Number(e.target.value) })
              }
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-center text-xs tabular-nums text-white"
            />
            <span className="text-slate-500">-</span>
            <input
              type="number"
              min={14}
              max={90}
              value={filters.max_dte}
              onChange={(e) =>
                onChange({ ...filters, max_dte: Number(e.target.value) })
              }
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-center text-xs tabular-nums text-white"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] text-slate-400">垂直价差保护宽度</label>
          <select
            value={filters.spread_width}
            onChange={(e) =>
              onChange({ ...filters, spread_width: Number(e.target.value) })
            }
            className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white"
          >
            <option value={2.5}>$2.5 宽 (担保 $250)</option>
            <option value={5}>$5.0 宽 (担保 $500 · 推荐)</option>
            <option value={10}>$10.0 宽 (担保 $1,000)</option>
          </select>
        </div>
      </div>

      {/* 6. Beginner Safety Switches */}
      <div className="space-y-2 rounded-xl border border-slate-800/80 bg-slate-950/60 p-3">
        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="flex items-center gap-1.5 text-xs text-slate-200">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
            自动剔除跨财报标的
          </span>
          <input
            type="checkbox"
            checked={filters.exclude_earnings}
            onChange={(e) =>
              onChange({ ...filters, exclude_earnings: e.target.checked })
            }
            className="h-4 w-4 rounded accent-orange-500"
          />
        </label>

        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="flex items-center gap-1.5 text-xs text-slate-200">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            仅看均线多头趋势股
          </span>
          <input
            type="checkbox"
            checked={filters.only_uptrend}
            onChange={(e) =>
              onChange({ ...filters, only_uptrend: e.target.checked })
            }
            className="h-4 w-4 rounded accent-orange-500"
          />
        </label>
      </div>

      {/* Action Button */}
      <button
        type="button"
        disabled={loading}
        onClick={() => onRunScan()}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-orange-500/20 hover:brightness-110 disabled:opacity-50 transition cursor-pointer"
      >
        <Search className="h-4 w-4 stroke-[2.5]" />
        <span>{loading ? '正在实时扫描期权链...' : '立即扫描高胜率期权机会'}</span>
      </button>
    </aside>
  );
}
