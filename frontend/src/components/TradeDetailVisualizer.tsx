import { useEffect, useMemo, useState } from 'react';
import * as echarts from 'echarts';
import {
  AlertTriangle,
  BookmarkPlus,
  CheckCircle2,
  Clock,
  Copy,
  Gauge,
  LineChart,
  Radar,
  ShieldCheck,
  Sliders,
} from 'lucide-react';
import { apiClient } from '../api/client';
import type { PayoffCurveResponse, StrategyCandidate } from '../types/options';
import { EChartBox } from './EChartBox';

interface TradeDetailVisualizerProps {
  candidate: StrategyCandidate | null;
  moomooConnected: boolean;
  onAddedToJournal: () => void;
}

export function TradeDetailVisualizer({
  candidate,
  moomooConnected,
  onAddedToJournal,
}: TradeDetailVisualizerProps) {
  const [activeTab, setActiveTab] = useState<'payoff' | 'cone' | 'playbook'>(
    'payoff'
  );
  const [daysPassed, setDaysPassed] = useState(0);
  const [ivShiftPct, setIvShiftPct] = useState(0);
  const [payoffData, setPayoffData] = useState<PayoffCurveResponse | null>(null);
  const [loadingCurve, setLoadingCurve] = useState(false);
  const [savingPaper, setSavingPaper] = useState(false);
  const [paperSuccess, setPaperSuccess] = useState<string | null>(null);

  // Reset sliders when switching candidate
  useEffect(() => {
    setDaysPassed(Math.min(10, Math.floor((candidate?.dte || 20) * 0.35)));
    setIvShiftPct(0);
    setPaperSuccess(null);
  }, [candidate?.id]);

  // Fetch payoff curves + price history + cone
  useEffect(() => {
    if (!candidate) return;
    let cancelled = false;
    setLoadingCurve(true);

    const timer = setTimeout(() => {
      apiClient
        .analyzePayoff({
          symbol: candidate.symbol,
          spot_price: candidate.spot_price,
          dte: candidate.dte,
          strategy: candidate.strategy,
          legs: candidate.legs,
          moomoo_fee_dollars: candidate.moomoo_fee_dollars,
          days_passed: daysPassed,
          iv_shift_pct: ivShiftPct,
        })
        .then((res) => {
          if (!cancelled) setPayoffData(res);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoadingCurve(false);
        });
    }, 90);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [candidate, daysPassed, ivShiftPct]);

  // 1. Payoff Chart Option (OptionStrat-style)
  const payoffOption = useMemo<echarts.EChartsCoreOption>(() => {
    if (!payoffData || !candidate) return {};
    const prices = payoffData.grid.map((g) => g.price);
    const expVals = payoffData.grid.map((g) => g.expiration_pnl);
    const maxExp = Math.max(...expVals, 1);
    const minExp = Math.min(...expVals, -1);
    const zeroStop = Math.max(0.01, Math.min(0.99, maxExp / (maxExp - minExp)));

    const splitLineColor = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: '#10b981' },
      { offset: zeroStop, color: '#10b981' },
      { offset: zeroStop, color: '#f43f5e' },
      { offset: 1, color: '#f43f5e' },
    ]);

    const splitAreaColor = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: 'rgba(16, 185, 129, 0.25)' },
      { offset: zeroStop, color: 'rgba(16, 185, 129, 0.04)' },
      { offset: zeroStop, color: 'rgba(244, 63, 94, 0.04)' },
      { offset: 1, color: 'rgba(244, 63, 94, 0.25)' },
    ]);
    const expSeries = payoffData.grid.map((g) => [g.price, g.expiration_pnl]);
    const todaySeries = payoffData.grid.map((g) => [g.price, g.today_pnl]);
    const simSeries = payoffData.grid.map((g) => [g.price, g.simulated_pnl]);

    return {
      backgroundColor: 'transparent',
      grid: { left: 58, right: 24, top: 42, bottom: 38 },
      legend: {
        top: 4,
        right: 8,
        textStyle: { color: '#cbd5e1', fontSize: 11 },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 23, 42, 0.96)',
        borderColor: '#334155',
        textStyle: { color: '#f1f5f9', fontSize: 12 },
        formatter: (params: Array<{ seriesName: string; data: [number, number]; color: string }>) => {
          if (!params?.length) return '';
          const px = params[0].data[0];
          const movePct = (((px - candidate.spot_price) / candidate.spot_price) * 100).toFixed(1);
          const lines = params
            .map((p) => {
              const val = p.data[1];
              const color = val >= 0 ? '#34d399' : '#fb7185';
              return `<div style="display:flex;justify-content:space-between;gap:16px">
                <span>${p.seriesName}:</span>
                <b style="color:${color}">${val >= 0 ? '+' : ''}$${val.toFixed(2)}</b>
              </div>`;
            })
            .join('');
          return `<div style="min-width:195px">
            <div style="font-weight:700;margin-bottom:4px;border-bottom:1px solid #334155;padding-bottom:4px">
              假设股价 $${px.toFixed(2)} (${Number(movePct) >= 0 ? '+' : ''}${movePct}%)
            </div>
            ${lines}
          </div>`;
        },
      },
      xAxis: {
        type: 'value',
        min: prices[0],
        max: prices[prices.length - 1],
        name: '到期正股价格 ($)',
        nameLocation: 'middle',
        nameGap: 25,
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.3)', type: 'dashed' } },
        axisLabel: { color: '#94a3b8', fontSize: 11, formatter: '${value}' },
      },
      yAxis: {
        type: 'value',
        name: '净盈亏 ($)',
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.3)', type: 'dashed' } },
        axisLabel: { color: '#94a3b8', fontSize: 11, formatter: '${value}' },
      },
      series: [
        {
          name: '到期净盈亏 (Expiration)',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 3, color: splitLineColor },
          areaStyle: { color: splitAreaColor },
          itemStyle: { color: '#10b981' },
          data: expSeries,
          markLine: {
            symbol: 'none',
            label: { fontSize: 10, formatter: '{b}' },
            data: [
              {
                yAxis: 0,
                name: '盈亏零轴',
                lineStyle: { color: '#64748b', width: 1, type: 'solid' },
                label: { show: false },
              },
              {
                xAxis: candidate.spot_price,
                name: `现价 $${candidate.spot_price}`,
                lineStyle: { color: '#38bdf8', width: 1.5, type: 'dashed' },
                label: { color: '#38bdf8', position: 'insideEndTop' },
              },
              {
                xAxis: candidate.breakeven_price,
                name: `平衡点 $${candidate.breakeven_price}`,
                lineStyle: { color: '#fbbf24', width: 1.5, type: 'dotted' },
                label: { color: '#fbbf24', position: 'insideStartTop' },
              },
            ],
          },
          markArea: {
            silent: true,
            itemStyle: { color: 'rgba(56, 189, 248, 0.06)' },
            data: [
              [
                {
                  name: '68% 概率波动区间 (±1SD)',
                  xAxis: payoffData.one_sd_low,
                  label: { color: '#64748b', fontSize: 10, position: 'insideBottom' },
                },
                { xAxis: payoffData.one_sd_high },
              ],
            ],
          },
        },
        {
          name: '今日理论曲线 (T+0)',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 1.5, type: 'dashed', color: '#94a3b8' },
          itemStyle: { color: '#94a3b8' },
          data: todaySeries,
        },
        {
          name: `仿真曲线 (T+${daysPassed}天, IV${ivShiftPct >= 0 ? '+' : ''}${ivShiftPct}%)`,
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 2.3, color: '#f97316' },
          itemStyle: { color: '#f97316' },
          data: simSeries,
        },
      ],
    };
  }, [payoffData, candidate, daysPassed, ivShiftPct]);

  // 2. Price History + Expected Move Probability Cone Option
  const coneOption = useMemo<echarts.EChartsCoreOption>(() => {
    if (!payoffData || !candidate) return {};
    const hist = payoffData.price_history.slice(-90);
    const cone = payoffData.probability_cone;

    const allDates = [
      ...hist.map((h) => h.date),
      ...cone.slice(1).map((c) => c.date),
    ];
    const histLen = hist.length;

    const closeSeries = [
      ...hist.map((h) => h.close),
      ...cone.slice(1).map(() => null),
    ];
    const sma50Series = [
      ...hist.map((h) => h.sma50),
      ...cone.slice(1).map(() => null),
    ];
    const sma200Series = [
      ...hist.map((h) => h.sma200),
      ...cone.slice(1).map(() => null),
    ];

    const padNulls = Array(Math.max(0, histLen - 1)).fill(null);
    const upper1Sd = [...padNulls, ...cone.map((c) => c.upper_1sd)];
    const lower1Sd = [...padNulls, ...cone.map((c) => c.lower_1sd)];
    const lower15Sd = [...padNulls, ...cone.map((c) => c.lower_15sd)];

    const markLines: Array<Record<string, unknown>> = [
      {
        yAxis: candidate.short_strike,
        name: `卖出执行价 $${candidate.short_strike}`,
        lineStyle: { color: '#f97316', width: 2, type: 'dashed' },
        label: { color: '#fb923c', formatter: '{b}', position: 'insideEndBottom' },
      },
      {
        yAxis: candidate.breakeven_price,
        name: `盈亏防线 $${candidate.breakeven_price}`,
        lineStyle: { color: '#10b981', width: 1.8, type: 'dotted' },
        label: { color: '#34d399', formatter: '{b}', position: 'insideStartBottom' },
      },
    ];
    if (candidate.long_strike) {
      markLines.push({
        yAxis: candidate.long_strike,
        name: `买入保护底 $${candidate.long_strike}`,
        lineStyle: { color: '#6366f1', width: 1.4, type: 'dashed' },
        label: { color: '#818cf8', formatter: '{b}', position: 'insideEndTop' },
      });
    }

    return {
      backgroundColor: 'transparent',
      grid: { left: 54, right: 26, top: 38, bottom: 32 },
      legend: {
        top: 4,
        right: 8,
        textStyle: { color: '#94a3b8', fontSize: 11 },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        borderColor: '#334155',
        textStyle: { color: '#f1f5f9', fontSize: 12 },
      },
      xAxis: {
        type: 'category',
        data: allDates,
        axisLabel: { color: '#94a3b8', fontSize: 10, formatter: (v: string) => v.slice(5) },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.3)', type: 'dashed' } },
        axisLabel: { color: '#94a3b8', fontSize: 11, formatter: '${value}' },
      },
      series: [
        {
          name: '正股收盘价',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 2.4, color: '#38bdf8' },
          itemStyle: { color: '#38bdf8' },
          data: closeSeries,
          markLine: { symbol: 'none', data: markLines },
        },
        {
          name: 'SMA50',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 1.3, color: '#a78bfa' },
          itemStyle: { color: '#a78bfa' },
          data: sma50Series,
        },
        {
          name: 'SMA200 牛熊线',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 1.3, color: '#facc15', type: 'dotted' },
          itemStyle: { color: '#facc15' },
          data: sma200Series,
        },
        {
          name: '68% 概率上沿 (+1SD)',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 1.4, type: 'dashed', color: 'rgba(148,163,184,0.65)' },
          data: upper1Sd,
        },
        {
          name: '68% 概率下沿 (-1SD)',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 1.6, type: 'dashed', color: '#34d399' },
          itemStyle: { color: '#34d399' },
          data: lower1Sd,
        },
        {
          name: '87% 极端下沿 (-1.5SD)',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 1.2, type: 'dotted', color: '#fb7185' },
          itemStyle: { color: '#fb7185' },
          data: lower15Sd,
        },
      ],
    };
  }, [payoffData, candidate]);

  // 3. 5D Beginner Safety Radar Option
  const radarOption = useMemo<echarts.EChartsCoreOption>(() => {
    if (!candidate) return {};
    const s = candidate.safety;
    return {
      backgroundColor: 'transparent',
      radar: {
        radius: '66%',
        indicator: [
          { name: `胜率安全\n(${s.win_rate_score})`, max: 100 },
          { name: `下跌安全垫\n(${s.cushion_score})`, max: 100 },
          { name: `盘口流动性\n(${s.liquidity_score})`, max: 100 },
          { name: `波动率性价比\n(${s.volatility_score})`, max: 100 },
          { name: `趋势&无财报\n(${s.trend_event_score})`, max: 100 },
        ],
        axisName: { color: '#cbd5e1', fontSize: 11 },
        splitArea: {
          areaStyle: {
            color: ['rgba(30,41,59,0.2)', 'rgba(15,23,42,0.4)'],
          },
        },
        splitLine: { lineStyle: { color: 'rgba(71,85,105,0.45)' } },
        axisLine: { lineStyle: { color: 'rgba(71,85,105,0.45)' } },
      },
      series: [
        {
          type: 'radar',
          data: [
            {
              value: [
                s.win_rate_score,
                s.cushion_score,
                s.liquidity_score,
                s.volatility_score,
                s.trend_event_score,
              ],
              name: '新手安全五维评分',
              areaStyle: { color: 'rgba(16, 185, 129, 0.25)' },
              lineStyle: { color: '#10b981', width: 2.2 },
              itemStyle: { color: '#34d399' },
            },
          ],
        },
      ],
    };
  }, [candidate]);

  const handleSavePaper = async (syncMoomoo: boolean) => {
    if (!candidate) return;
    setSavingPaper(true);
    try {
      const rec = await apiClient.addPaperTrade({
        candidate_id: candidate.id,
        symbol: candidate.symbol,
        strategy: candidate.strategy,
        strategy_label: candidate.strategy_label,
        expiration: candidate.expiration,
        dte_at_entry: candidate.dte,
        short_strike: candidate.short_strike,
        long_strike: candidate.long_strike,
        contracts: 1,
        entry_net_credit_dollars: candidate.net_credit_dollars,
        max_loss_dollars: candidate.max_loss_dollars,
        collateral_required: candidate.collateral_required,
        breakeven_price: candidate.breakeven_price,
        spot_at_entry: candidate.spot_price,
        moomoo_codes: candidate.legs.map((l) => l.moomoo_code),
        submit_to_moomoo_sim: syncMoomoo,
      });
      setPaperSuccess(rec.moomoo_order_status);
      onAddedToJournal();
    } catch (err) {
      setPaperSuccess(`保存失败: ${String(err)}`);
    } finally {
      setSavingPaper(false);
    }
  };

  if (!candidate) {
    return (
      <div className="flex h-full min-h-[480px] items-center justify-center rounded-2xl border border-slate-800/90 bg-slate-900/65 p-8 text-center text-sm text-slate-400">
        请在左侧选择任意期权策略查看深度可视化分析
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-800/90 bg-slate-900/65 p-4 shadow-xl">
      {/* Top Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/80 pb-3.5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-extrabold text-white">
              {candidate.symbol}
            </span>
            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-300 tabular-nums">
              现价 ${candidate.spot_price}
            </span>
            <span className="rounded-md border border-orange-500/40 bg-orange-500/15 px-2 py-0.5 text-xs font-semibold text-orange-300">
              {candidate.strategy_label}
            </span>
            <span className="text-xs text-slate-400">
              {candidate.expiration} 到期 ({candidate.dte} DTE)
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-300">
            {candidate.strategy_subtitle} · IV {candidate.atm_iv}% / HV20{' '}
            {candidate.hv_20}% · RSI {candidate.rsi_14}
          </p>
        </div>

        {/* Add to Paper Portfolio */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={savingPaper}
            onClick={() => handleSavePaper(moomooConnected)}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-500 px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-500/20 hover:bg-indigo-400 disabled:opacity-50 transition cursor-pointer"
          >
            <BookmarkPlus className="h-4 w-4" />
            <span>
              {moomooConnected
                ? '一键模拟下单 (同步 Moomoo 模拟盘)'
                : '加入本地模拟持仓跟踪'}
            </span>
          </button>
        </div>
      </div>

      {paperSuccess && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>
            已加入模拟持仓监控（系统将自动追踪 50% 止盈点与 21 天移仓线）：
            {paperSuccess}
          </span>
        </div>
      )}

      {/* 5 Key KPI Cards */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5 tabular-nums">
        <div className="rounded-xl border border-slate-800/90 bg-slate-950/70 p-2.5">
          <div className="text-[11px] text-slate-400">扣费净收权利金</div>
          <div className="mt-0.5 text-base font-bold text-emerald-400">
            +${candidate.net_credit_dollars.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-500">
            含 Moomoo 规费 ${candidate.moomoo_fee_dollars}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-slate-950/70 p-2.5">
          <div className="text-[11px] text-slate-400">
            {candidate.strategy === 'bull_put_spread'
              ? '锁死最大亏损'
              : '所需现金担保'}
          </div>
          <div className="mt-0.5 text-base font-bold text-rose-400">
            {candidate.strategy === 'bull_put_spread'
              ? `-$${candidate.max_loss_dollars.toFixed(0)}`
              : `$${candidate.collateral_required.toLocaleString()}`}
          </div>
          <div className="text-[10px] text-slate-500">
            绝不触发融资追保
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-slate-950/70 p-2.5">
          <div className="text-[11px] text-slate-400">理论到期胜率 POP</div>
          <div className="mt-0.5 text-base font-bold text-sky-300">
            {candidate.pop_pct.toFixed(1)}%
          </div>
          <div className="text-[10px] text-slate-500">
            50%止盈胜率通常更高
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-slate-950/70 p-2.5">
          <div className="text-[11px] text-slate-400">盈亏平衡安全垫</div>
          <div className="mt-0.5 text-base font-bold text-amber-300">
            ${candidate.breakeven_price}
          </div>
          <div className="text-[10px] text-slate-500">
            可抗跌 -{candidate.downside_cushion_pct.toFixed(1)}%
          </div>
        </div>

        <div className="col-span-2 sm:col-span-1 rounded-xl border border-slate-800/90 bg-slate-950/70 p-2.5">
          <div className="text-[11px] text-slate-400">每日躺赚时间价值</div>
          <div className="mt-0.5 text-base font-bold text-purple-300">
            {candidate.net_theta_per_day >= 0 ? '+' : ''}$
            {candidate.net_theta_per_day.toFixed(2)}/天
          </div>
          <div className="text-[10px] text-slate-500">
            Net Delta {candidate.net_delta.toFixed(1)}
          </div>
        </div>
      </div>

      {/* Visualization Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-slate-800/80 pb-2.5">
        <button
          type="button"
          onClick={() => setActiveTab('payoff')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
            activeTab === 'payoff'
              ? 'bg-orange-500 text-slate-950'
              : 'bg-slate-950/70 text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Sliders className="h-3.5 w-3.5" />
          <span>1. 到期盈亏与 T+N 动态仿真</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('cone')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
            activeTab === 'cone'
              ? 'bg-orange-500 text-slate-950'
              : 'bg-slate-950/70 text-slate-300 hover:bg-slate-800'
          }`}
        >
          <LineChart className="h-3.5 w-3.5" />
          <span>2. K线均线 + 概率锥与安全垫</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('playbook')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
            activeTab === 'playbook'
              ? 'bg-orange-500 text-slate-950'
              : 'bg-slate-950/70 text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Radar className="h-3.5 w-3.5" />
          <span>3. 五维风控雷达 & Moomoo 下单指南</span>
        </button>
      </div>

      {/* TAB 1: Payoff Simulator */}
      {activeTab === 'payoff' && (
        <div className="space-y-3">
          {/* Interactive Sliders */}
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 sm:grid-cols-2">
            <div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-300">
                  拖动模拟持仓流逝天数 (感受 Theta 时间收益)
                </span>
                <span className="font-mono font-bold text-orange-300 tabular-nums">
                  T + {daysPassed} 天 (剩 {Math.max(0, candidate.dte - daysPassed)} 天)
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={candidate.dte}
                value={daysPassed}
                onChange={(e) => setDaysPassed(Number(e.target.value))}
                className="mt-1.5 w-full accent-orange-500 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-300">
                  拖动模拟隐含波动率变化 (感受 Vega / 恐慌冲击)
                </span>
                <span className="font-mono font-bold text-sky-300 tabular-nums">
                  IV {ivShiftPct >= 0 ? '+' : ''}
                  {ivShiftPct}%
                </span>
              </div>
              <input
                type="range"
                min={-15}
                max={20}
                step={1}
                value={ivShiftPct}
                onChange={(e) => setIvShiftPct(Number(e.target.value))}
                className="mt-1.5 w-full accent-sky-400 cursor-pointer"
              />
            </div>
          </div>

          <div className="relative">
            {loadingCurve && (
              <div className="absolute right-3 top-2 z-10 rounded bg-slate-900/80 px-2 py-0.5 text-[10px] text-slate-400">
                更新曲线中...
              </div>
            )}
            <EChartBox option={payoffOption} height="310px" />
          </div>

          <div className="rounded-xl border border-slate-800/70 bg-slate-950/50 px-3.5 py-2.5 text-xs text-slate-300 leading-relaxed">
            <b className="text-orange-300">图表怎么看：</b>
            绿线区域代表到期赚钱区间，只要到期时 {candidate.symbol} 股价保持在{' '}
            <b className="text-amber-300">${candidate.breakeven_price}</b>{' '}
            上方（哪怕股价横盘不涨甚至小跌 {candidate.downside_cushion_pct}%），你都能稳拿权利金。拖动上方「持仓流逝天数」滑块可以看到橙色仿真线随时间流逝不断向绿色盈利区抬升。
          </div>
        </div>
      )}

      {/* TAB 2: Stock History + Expected Move Cone */}
      {activeTab === 'cone' && (
        <div className="space-y-3">
          <EChartBox option={coneOption} height="345px" />
          <div className="rounded-xl border border-slate-800/70 bg-slate-950/50 px-3.5 py-2.5 text-xs text-slate-300 leading-relaxed">
            <b className="text-emerald-300">概率锥安全验证：</b>
            右侧喇叭口是根据当前期权隐含波动率推算的未来 {candidate.dte} 天股价波动范围（绿色虚线为{' '}
            <b>68% 概率下沿 ${payoffData?.one_sd_low}</b>）。你的盈亏防线设在{' '}
            <b className="text-amber-300">${candidate.breakeven_price}</b>，位于历史支撑与常规波动下沿附近，形成天然安全护城河。
          </div>
        </div>
      )}

      {/* TAB 3: Safety Radar + Moomoo Execution Steps */}
      {activeTab === 'playbook' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Radar */}
            <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 lg:col-span-5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-white">
                  <Gauge className="h-3.5 w-3.5 text-emerald-400" />
                  五维安全评分：{candidate.safety.score_total} 分 (
                  {candidate.safety.grade})
                </span>
              </div>
              <EChartBox option={radarOption} height="225px" />
            </div>

            {/* Highlights & Warnings */}
            <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-950/60 p-3.5 lg:col-span-7">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-emerald-300">
                  核心优势与入选理由
                </div>
                {candidate.safety.highlights.map((h, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-xs text-slate-300"
                  >
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span>{h}</span>
                  </div>
                ))}

                {candidate.safety.warnings.length > 0 && (
                  <div className="pt-2 space-y-1.5">
                    <div className="text-xs font-semibold text-amber-300">
                      潜在风险提示
                    </div>
                    {candidate.safety.warnings.map((w, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 text-xs text-amber-200/90"
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Exit Playbook */}
              <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-2.5 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-indigo-200">
                  <Clock className="h-3.5 w-3.5" />
                  止盈止损铁律作战卡（必看）
                </div>
                <ul className="mt-1.5 space-y-1 text-[11px] text-slate-300">
                  <li>
                    • <b>50% 提前止盈：</b>当期权/价差价格从 $
                    {candidate.gross_credit_per_share.toFixed(2)} 回落至{' '}
                    <b className="text-emerald-300">
                      ${candidate.exit_playbook.take_profit_50_credit.toFixed(2)}
                    </b>{' '}
                    时直接平仓（净赚约 ${candidate.exit_playbook.take_profit_dollars}）。
                  </li>
                  <li>
                    • <b>21 DTE 时间防线：</b>在{' '}
                    <b className="text-sky-300">
                      {candidate.exit_playbook.dte_exit_date}
                    </b>
                    （距到期剩 21 天）前无论盈亏评估离场，避开末期 Gamma 暴涨。
                  </li>
                  <li>• {candidate.exit_playbook.stop_loss_rule}</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Contract Legs Table */}
          <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3">
            <div className="mb-2 text-xs font-semibold text-white">
              Moomoo 合约明细与盘口希腊值
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="text-[11px] text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="pb-2">方向</th>
                    <th className="pb-2">Moomoo 代码</th>
                    <th className="pb-2">行权价</th>
                    <th className="pb-2">买一 / 卖一 (中间价)</th>
                    <th className="pb-2">IV</th>
                    <th className="pb-2">Delta</th>
                    <th className="pb-2">Theta/天</th>
                    <th className="pb-2">未平仓 OI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {candidate.legs.map((leg) => (
                    <tr key={leg.moomoo_code}>
                      <td className="py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            leg.action === 'SELL'
                              ? 'bg-rose-500/20 text-rose-300'
                              : 'bg-emerald-500/20 text-emerald-300'
                          }`}
                        >
                          {leg.action === 'SELL' ? '卖出开仓' : '买入保护'}
                        </span>
                      </td>
                      <td className="py-2 font-mono text-[11px] text-orange-300">
                        <button
                          type="button"
                          onClick={() =>
                            navigator.clipboard?.writeText(leg.moomoo_code)
                          }
                          className="inline-flex items-center gap-1 hover:underline cursor-pointer"
                        >
                          {leg.moomoo_code}
                          <Copy className="h-3 w-3 text-slate-500" />
                        </button>
                      </td>
                      <td className="py-2 font-semibold text-white">
                        ${leg.strike} {leg.option_type}
                      </td>
                      <td className="py-2 text-slate-300">
                        ${leg.bid.toFixed(2)} / ${leg.ask.toFixed(2)}{' '}
                        <span className="text-amber-300">
                          (${leg.mid.toFixed(2)})
                        </span>
                      </td>
                      <td className="py-2 text-slate-300">
                        {(leg.iv * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 text-slate-300">
                        {leg.delta.toFixed(3)}
                      </td>
                      <td className="py-2 text-slate-300">
                        ${leg.theta.toFixed(3)}
                      </td>
                      <td className="py-2 text-slate-300">
                        {leg.open_interest.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Step-by-Step Moomoo App Execution Guide */}
          <div className="rounded-xl border border-orange-500/30 bg-orange-500/8 p-3.5">
            <div className="text-xs font-bold text-orange-300">
              Moomoo 客户端手把手下单步骤
            </div>
            <ol className="mt-2 space-y-1.5 text-xs text-slate-200">
              {candidate.moomoo_execution_steps.map((step, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-orange-500/25 text-[10px] font-bold text-orange-300">
                    {idx + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
