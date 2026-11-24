import { useMemo, useState } from 'react';
import { ArrowUpDown, Check, Copy, Shield } from 'lucide-react';
import type { StrategyCandidate } from '../types/options';

interface OpportunityTableProps {
  candidates: StrategyCandidate[];
  selectedId: string | null;
  onSelect: (c: StrategyCandidate) => void;
}

type SortKey = 'composite' | 'pop' | 'cushion' | 'ror';

function gradeBadgeStyle(grade: string) {
  if (grade.startsWith('A')) {
    return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300';
  }
  if (grade === 'B+') {
    return 'border-sky-500/40 bg-sky-500/15 text-sky-300';
  }
  if (grade === 'B') {
    return 'border-amber-500/40 bg-amber-500/15 text-amber-300';
  }
  return 'border-rose-500/40 bg-rose-500/15 text-rose-300';
}

function strategyTagStyle(strategy: string) {
  if (strategy === 'bull_put_spread') {
    return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  }
  if (strategy === 'cash_secured_put') {
    return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
  }
  return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
}

export function OpportunityTable({
  candidates,
  selectedId,
  onSelect,
}: OpportunityTableProps) {
  const [sortBy, setSortBy] = useState<SortKey>('composite');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const arr = [...candidates];
    arr.sort((a, b) => {
      if (sortBy === 'pop') return b.pop_pct - a.pop_pct;
      if (sortBy === 'cushion')
        return b.downside_cushion_pct - a.downside_cushion_pct;
      if (sortBy === 'ror') return b.return_on_risk_pct - a.return_on_risk_pct;
      return (
        b.safety.score_total * 0.72 +
        Math.min(b.return_on_risk_pct, 25) * 0.28 -
        (a.safety.score_total * 0.72 + Math.min(a.return_on_risk_pct, 25) * 0.28)
      );
    });
    return arr;
  }, [candidates, sortBy]);

  const copyCode = (e: React.MouseEvent, id: string, code: string) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="flex flex-col rounded-2xl border border-slate-800/90 bg-slate-900/65 overflow-hidden">
      {/* Header & Sort Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-orange-400" />
          <h3 className="text-sm font-semibold text-white">
            优选期权合约池 ({sorted.length})
          </h3>
          <span className="text-xs text-slate-400">
            点击任意行在右侧加载盈亏模拟与概率锥
          </span>
        </div>

        <div className="flex items-center gap-1 text-[11px]">
          <ArrowUpDown className="mr-1 h-3.5 w-3.5 text-slate-500" />
          {(
            [
              ['composite', '安全综合优先'],
              ['pop', '最高胜率'],
              ['cushion', '最大安全垫'],
              ['ror', '最高回报率'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSortBy(key)}
              className={`rounded-lg px-2.5 py-1 font-medium transition cursor-pointer ${
                sortBy === key
                  ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-950/95 text-[11px] font-medium text-slate-400 backdrop-blur">
            <tr className="border-b border-slate-800">
              <th className="py-2.5 pl-4 pr-2">安全评级</th>
              <th className="px-2 py-2.5">标的 / 现价</th>
              <th className="px-2 py-2.5">策略与行权腿</th>
              <th className="px-2 py-2.5">到期 (DTE)</th>
              <th className="px-2 py-2.5 text-right">理论胜率</th>
              <th className="px-2 py-2.5 text-right">下跌安全垫</th>
              <th className="px-2 py-2.5 text-right">扣费净收</th>
              <th className="px-2 py-2.5 text-right">最大风险/担保</th>
              <th className="py-2.5 pl-2 pr-4 text-right">回报率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 tabular-nums">
            {sorted.map((c) => {
              const active = c.id === selectedId;
              const primaryCode = c.legs[0]?.moomoo_code || '';
              return (
                <tr
                  key={c.id}
                  onClick={() => onSelect(c)}
                  className={`transition cursor-pointer ${
                    active
                      ? 'bg-orange-500/12 hover:bg-orange-500/15'
                      : 'hover:bg-slate-800/45'
                  }`}
                >
                  {/* Safety Grade */}
                  <td className="py-3 pl-4 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`inline-flex w-9 items-center justify-center rounded-md border py-0.5 text-xs font-bold ${gradeBadgeStyle(
                          c.safety.grade
                        )}`}
                      >
                        {c.safety.grade}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {c.safety.score_total}分
                      </span>
                    </div>
                  </td>

                  {/* Symbol */}
                  <td className="px-2 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-white">{c.symbol}</span>
                      <span className="text-slate-300">${c.spot_price}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400 truncate max-w-[115px]">
                      {c.name}
                    </div>
                  </td>

                  {/* Strategy & Strikes */}
                  <td className="px-2 py-3">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${strategyTagStyle(
                          c.strategy
                        )}`}
                      >
                        {c.strategy === 'bull_put_spread'
                          ? '看跌价差'
                          : c.strategy === 'cash_secured_put'
                            ? '现金卖Put'
                            : '备兑看涨'}
                      </span>
                      <span className="font-medium text-slate-200">
                        {c.long_strike
                          ? `$${c.short_strike}/$${c.long_strike}P`
                          : c.strategy === 'covered_call'
                            ? `$${c.short_strike}C`
                            : `$${c.short_strike}P`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => copyCode(e, c.id, primaryCode)}
                      title="点击复制 Moomoo 期权代码"
                      className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-slate-500 hover:text-orange-300 cursor-pointer"
                    >
                      <span>{primaryCode}</span>
                      {copiedId === c.id ? (
                        <Check className="h-2.5 w-2.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-2.5 w-2.5" />
                      )}
                    </button>
                  </td>

                  {/* Expiration */}
                  <td className="px-2 py-3">
                    <div className="text-slate-200">{c.expiration.slice(5)}</div>
                    <div className="text-[10px] text-slate-400">{c.dte} 天</div>
                  </td>

                  {/* POP */}
                  <td className="px-2 py-3 text-right">
                    <span className="font-semibold text-emerald-400">
                      {c.pop_pct.toFixed(1)}%
                    </span>
                    <div className="ml-auto mt-1 h-1 w-14 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full bg-emerald-400"
                        style={{ width: `${Math.min(100, c.pop_pct)}%` }}
                      />
                    </div>
                  </td>

                  {/* Downside Cushion */}
                  <td className="px-2 py-3 text-right">
                    <div className="font-medium text-sky-300">
                      -{c.downside_cushion_pct.toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-slate-500">
                      平衡 ${c.breakeven_price}
                    </div>
                  </td>

                  {/* Net Credit */}
                  <td className="px-2 py-3 text-right">
                    <div className="font-semibold text-amber-300">
                      +${c.net_credit_dollars.toFixed(1)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      已扣费 ${c.moomoo_fee_dollars}
                    </div>
                  </td>

                  {/* Max Risk / Collateral */}
                  <td className="px-2 py-3 text-right">
                    <div className="text-slate-200">
                      {c.strategy === 'bull_put_spread'
                        ? `锁亏 $${c.max_loss_dollars.toFixed(0)}`
                        : `担保 $${c.collateral_required.toLocaleString()}`}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      担保 ${c.collateral_required.toLocaleString()}
                    </div>
                  </td>

                  {/* Return */}
                  <td className="py-3 pl-2 pr-4 text-right">
                    <div className="font-bold text-white">
                      {c.return_on_risk_pct.toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-slate-400">
                      年化 {c.annualized_roc_pct.toFixed(0)}%
                    </div>
                  </td>
                </tr>
              );
            })}

            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="py-12 text-center text-sm text-slate-400"
                >
                  当前资金或过滤条件下暂无匹配合约，可尝试上调「单笔最大占用担保金」或切换至「牛市看跌价差」策略。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
