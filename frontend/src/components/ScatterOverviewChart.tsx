import { useMemo, useState } from 'react';
import type * as echarts from 'echarts';
import { Sparkles } from 'lucide-react';
import type { StrategyCandidate } from '../types/options';
import { EChartBox } from './EChartBox';

interface ScatterOverviewChartProps {
  candidates: StrategyCandidate[];
  selectedId: string | null;
  onSelect: (candidate: StrategyCandidate) => void;
}

const STRATEGY_COLORS: Record<string, string> = {
  bull_put_spread: '#10b981', // Emerald
  cash_secured_put: '#38bdf8', // Sky
  covered_call: '#f59e0b', // Amber
};

const STRATEGY_NAMES: Record<string, string> = {
  bull_put_spread: '牛市看跌价差 (锁死亏损)',
  cash_secured_put: '现金担保卖 Put (折价接股)',
  covered_call: '备兑看涨 (持股收租)',
};

export function ScatterOverviewChart({
  candidates,
  selectedId,
  onSelect,
}: ScatterOverviewChartProps) {
  const [yMetric, setYMetric] = useState<'ror' | 'cushion'>('ror');

  const option = useMemo<echarts.EChartsCoreOption>(() => {
    const grouped: Record<string, StrategyCandidate[]> = {
      bull_put_spread: [],
      cash_secured_put: [],
      covered_call: [],
    };
    for (const c of candidates) {
      grouped[c.strategy]?.push(c);
    }

    const series = Object.entries(grouped)
      .filter(([, list]) => list.length > 0)
      .map(([strat, list]) => ({
        name: STRATEGY_NAMES[strat] || strat,
        type: 'scatter',
        data: list.map((c) => {
          const isSelected = c.id === selectedId;
          const yVal =
            yMetric === 'ror' ? c.return_on_risk_pct : c.downside_cushion_pct;
          return {
            value: [c.pop_pct, yVal, c.safety.score_total, c.symbol, c.id],
            candidate: c,
            symbolSize: Math.max(14, (c.safety.score_total - 40) * 0.62),
            itemStyle: {
              color: STRATEGY_COLORS[strat],
              opacity: isSelected ? 1 : 0.78,
              borderColor: isSelected ? '#ffffff' : 'rgba(255,255,255,0.25)',
              borderWidth: isSelected ? 3 : 1,
              shadowBlur: isSelected ? 18 : 6,
              shadowColor: isSelected ? '#ffffff' : STRATEGY_COLORS[strat],
            },
            label: {
              show: true,
              formatter: () => `${c.symbol}`,
              position: 'top',
              fontSize: 10,
              fontWeight: isSelected ? 'bold' : 'normal',
              color: isSelected ? '#ffffff' : '#cbd5e1',
            },
          };
        }),
      }));

    return {
      backgroundColor: 'transparent',
      grid: { left: 52, right: 26, top: 40, bottom: 38 },
      legend: {
        top: 4,
        right: 8,
        textStyle: { color: '#94a3b8', fontSize: 11 },
        itemWidth: 10,
        itemHeight: 10,
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        borderColor: '#334155',
        textStyle: { color: '#f1f5f9', fontSize: 12 },
        formatter: (params: { data?: { candidate?: StrategyCandidate } }) => {
          const c = params?.data?.candidate;
          if (!c) return '';
          return `
            <div style="min-width:210px">
              <div style="font-weight:700;font-size:13px;margin-bottom:4px;color:#fff">
                ${c.symbol} · ${c.strategy_label}
              </div>
              <div style="color:#94a3b8;font-size:11px;margin-bottom:6px">${c.strategy_subtitle}</div>
              <div style="display:flex;justify-content:space-between"><span>理论胜率 (POP):</span><b style="color:#34d399">${c.pop_pct}%</b></div>
              <div style="display:flex;justify-content:space-between"><span>扣费净收权利金:</span><b style="color:#fbbf24">$${c.net_credit_dollars.toFixed(2)}</b></div>
              <div style="display:flex;justify-content:space-between"><span>单笔风险回报率:</span><b>${c.return_on_risk_pct}% (年化 ${c.annualized_roc_pct.toFixed(0)}%)</b></div>
              <div style="display:flex;justify-content:space-between"><span>下跌安全垫:</span><b style="color:#38bdf8">${c.downside_cushion_pct}% (平衡点 $${c.breakeven_price})</b></div>
              <div style="display:flex;justify-content:space-between"><span>新手安全评分:</span><b style="color:#f97316">${c.safety.score_total} 分 (${c.safety.grade})</b></div>
            </div>
          `;
        },
      },
      xAxis: {
        name: '理论到期胜率 POP (%) → 越右越稳',
        nameLocation: 'middle',
        nameGap: 25,
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.35)', type: 'dashed' } },
        axisLabel: { color: '#94a3b8', fontSize: 11, formatter: '{value}%' },
      },
      yAxis: {
        name: yMetric === 'ror' ? '单笔回报率 (%)' : '下跌安全垫 (%)',
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.35)', type: 'dashed' } },
        axisLabel: { color: '#94a3b8', fontSize: 11, formatter: '{value}%' },
      },
      series,
    };
  }, [candidates, selectedId, yMetric]);

  return (
    <div className="rounded-2xl border border-slate-800/90 bg-slate-900/65 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-white">
            胜率 vs 收益·安全垫全景气泡图
          </h3>
          <span className="text-xs text-slate-400">
            （气泡越大 = 新手安全评分越高 · 点击任一气泡查看右侧盈亏曲线）
          </span>
        </div>

        <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setYMetric('ror')}
            className={`rounded-md px-2.5 py-1 font-medium transition cursor-pointer ${
              yMetric === 'ror'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            纵轴：单笔回报率 %
          </button>
          <button
            type="button"
            onClick={() => setYMetric('cushion')}
            className={`rounded-md px-2.5 py-1 font-medium transition cursor-pointer ${
              yMetric === 'cushion'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            纵轴：下跌安全垫 %
          </button>
        </div>
      </div>

      <EChartBox
        option={option}
        height="245px"
        onItemClick={(params: unknown) => {
          const p = params as { data?: { candidate?: StrategyCandidate } };
          if (p?.data?.candidate) {
            onSelect(p.data.candidate);
          }
        }}
      />
    </div>
  );
}
