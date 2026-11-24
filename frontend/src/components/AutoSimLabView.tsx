import { useMemo } from 'react';
import type * as echarts from 'echarts';
import {
  Activity,
  Award,
  CalendarClock,
  CheckCircle2,
  Cloud,
  Play,
  RotateCcw,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import type { SimPortfolioState } from '../types/options';
import { EChartBox } from './EChartBox';

interface AutoSimLabViewProps {
  simState: SimPortfolioState | null;
  isStaticMode: boolean;
  runningCycle: boolean;
  onRunCycle: (markOnly?: boolean) => void;
  onReset: () => void;
}

export function AutoSimLabView({
  simState,
  isStaticMode,
  runningCycle,
  onRunCycle,
  onReset,
}: AutoSimLabViewProps) {
  const equityChartOption = useMemo<echarts.EChartsCoreOption>(() => {
    if (!simState || simState.equity_curve.length === 0) return {};
    const pts = simState.equity_curve;
    const labels = pts.map((p, idx) =>
      idx === 0 ? `${p.date.slice(5)} 起步` : p.timestamp.slice(5, 16)
    );
    const eqValues = pts.map((p) => p.total_equity);
    const spyValues = pts.map((p) => p.spy_benchmark_equity);

    return {
      backgroundColor: 'transparent',
      grid: { left: 62, right: 28, top: 42, bottom: 36 },
      legend: {
        top: 4,
        right: 10,
        textStyle: { color: '#cbd5e1', fontSize: 11 },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 23, 42, 0.96)',
        borderColor: '#334155',
        textStyle: { color: '#f1f5f9', fontSize: 12 },
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: '#94a3b8', fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        name: '账户净值 ($)',
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        splitLine: { lineStyle: { color: 'rgba(51,65,85,0.35)', type: 'dashed' } },
        axisLabel: { color: '#94a3b8', fontSize: 11, formatter: '${value}' },
      },
      series: [
        {
          name: '期权稳健收租净值 ($)',
          type: 'line',
          smooth: 0.25,
          symbolSize: 7,
          lineStyle: { width: 3, color: '#10b981' },
          itemStyle: { color: '#10b981' },
          areaStyle: { color: 'rgba(16, 185, 129, 0.12)' },
          data: eqValues,
        },
        {
          name: '同期买入持有 SPY 基准 ($)',
          type: 'line',
          smooth: 0.25,
          symbolSize: 5,
          lineStyle: { width: 2, type: 'dashed', color: '#38bdf8' },
          itemStyle: { color: '#38bdf8' },
          data: spyValues,
        },
      ],
    };
  }, [simState]);

  if (!simState) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/65 p-12 text-center text-sm text-slate-400">
        正在加载 30 天全自动模拟账户数据...
      </div>
    );
  }

  const alphaPct = (simState.total_return_pct - simState.spy_return_pct).toFixed(2);

  return (
    <div className="space-y-4">
      {/* Top Cloud / Cron Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-slate-900/80 to-indigo-500/10 p-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Cloud className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white">
              30天无人值守全自动模拟实验室（GitHub Actions 免费云跑批就绪）
            </h2>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
              已运行第 {simState.days_running} 天 · 累计巡检 {simState.total_runs} 次
            </span>
            {isStaticMode && (
              <span className="rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-300">
                GitHub Pages 云端报表视图
              </span>
            )}
          </div>
          <p className="text-xs text-slate-300">
            每个美股交易日盘中（美东 10:30 & 15:15）自动拉取真实期权 Bid/Ask 盘口盯市：达{' '}
            <b className="text-emerald-300">{simState.config.take_profit_pct}% 净利自动止盈</b>、剩{' '}
            <b className="text-sky-300">≤{simState.config.dte_exit_threshold} 天自动平仓</b>、亏损达{' '}
            <b className="text-rose-300">{simState.config.stop_loss_mult}x 权利金自动止损</b>，并严格扣减双边 Moomoo 规费与滑点。
          </p>
        </div>

        {!isStaticMode && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={runningCycle}
              onClick={() => onRunCycle(false)}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:brightness-110 disabled:opacity-50 transition cursor-pointer"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>
                {runningCycle ? '正在扫描盘口与盯市...' : '立即执行一次自动巡检 & 建仓'}
              </span>
            </button>

            <button
              type="button"
              disabled={runningCycle}
              onClick={onReset}
              title="清空并重置 $10,000 模拟挑战"
              className="flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>重置账本</span>
            </button>
          </div>
        )}
      </div>

      {/* 6 Core KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6 tabular-nums">
        <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-3.5">
          <div className="text-xs text-slate-400">模拟账户总净值</div>
          <div className="mt-1 text-xl font-extrabold text-white">
            ${simState.total_equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div
            className={`mt-0.5 text-xs font-semibold ${
              simState.total_return_dollars >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {simState.total_return_dollars >= 0 ? '+' : ''}$
            {simState.total_return_dollars.toFixed(2)} ({simState.total_return_pct >= 0 ? '+' : ''}
            {simState.total_return_pct}%)
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-3.5">
          <div className="text-xs text-slate-400">对比同期 SPY 基准</div>
          <div className="mt-1 text-xl font-extrabold text-sky-300">
            {simState.spy_return_pct >= 0 ? '+' : ''}
            {simState.spy_return_pct}%
          </div>
          <div className="mt-0.5 text-xs text-slate-400">
            超额收益 Alpha:{' '}
            <b className={Number(alphaPct) >= 0 ? 'text-emerald-400' : 'text-amber-300'}>
              {Number(alphaPct) >= 0 ? '+' : ''}
              {alphaPct}%
            </b>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-3.5">
          <div className="text-xs text-slate-400">已实现落袋 / 在途浮盈</div>
          <div className="mt-1 text-lg font-bold text-emerald-400">
            {simState.realized_pnl_cum >= 0 ? '+' : ''}${simState.realized_pnl_cum.toFixed(2)}
          </div>
          <div className="mt-0.5 text-xs text-slate-400">
            在途盯市:{' '}
            <span className={simState.unrealized_pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
              {simState.unrealized_pnl >= 0 ? '+' : ''}${simState.unrealized_pnl.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-3.5">
          <div className="text-xs text-slate-400">已平仓实战胜率</div>
          <div className="mt-1 text-xl font-extrabold text-amber-300">
            {simState.win_count + simState.loss_count > 0
              ? `${simState.win_rate_pct}%`
              : '待平仓结案'}
          </div>
          <div className="mt-0.5 text-xs text-slate-400">
            {simState.win_count} 胜 / {simState.loss_count} 负 (在途 {simState.open_positions.length} 笔)
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-3.5">
          <div className="text-xs text-slate-400">最大净值回撤</div>
          <div className="mt-1 text-xl font-extrabold text-rose-300">
            -{simState.max_drawdown_pct.toFixed(2)}%
          </div>
          <div className="mt-0.5 text-xs text-slate-400">
            起始本金 ${simState.config.initial_capital.toLocaleString()}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-3.5">
          <div className="text-xs text-slate-400">担保金仓位水位</div>
          <div className="mt-1 text-xl font-extrabold text-indigo-300">
            {simState.utilization_pct}%
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-indigo-400"
              style={{ width: `${Math.min(100, simState.utilization_pct)}%` }}
            />
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            占用 ${simState.collateral_locked.toLocaleString()} (风控上限 {simState.config.max_total_utilization_pct}%)
          </div>
        </div>
      </div>

      {/* Equity Curve + Config Side-by-Side */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="rounded-2xl border border-slate-800/90 bg-slate-900/65 p-4 xl:col-span-8">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-semibold text-white">
                30天净值曲线 vs 标普500 (SPY) 基准走势
              </h3>
            </div>
            <span className="text-xs text-slate-400 tabular-nums">
              最近更新：{simState.last_updated_at}
            </span>
          </div>
          <EChartBox option={equityChartOption} height="275px" />
        </div>

        <div className="flex flex-col justify-between rounded-2xl border border-slate-800/90 bg-slate-900/65 p-4 xl:col-span-4">
          <div>
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2.5">
              <ShieldCheck className="h-4 w-4 text-orange-400" />
              <h3 className="text-sm font-semibold text-white">
                自动化风控引擎纪律参数
              </h3>
            </div>
            <ul className="mt-3 space-y-2 text-xs text-slate-300">
              <li className="flex justify-between">
                <span className="text-slate-400">准入安全评级门槛：</span>
                <b className="text-emerald-300">≥ {simState.config.min_safety_score} 分 (B+ / A 级)</b>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-400">最多同时持仓标的数：</span>
                <b>{simState.config.max_open_positions} 个不重复标的</b>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-400">单笔最大担保金占用：</span>
                <b>${simState.config.max_collateral_per_trade.toLocaleString()}</b>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-400">账户总仓位硬上限：</span>
                <b>≤ {simState.config.max_total_utilization_pct}% (留足 40% 现金)</b>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-400">开/平仓真实摩擦扣减：</span>
                <b className="text-amber-300">$0.68/腿规费 + 盘口滑点惩罚</b>
              </li>
            </ul>
          </div>

          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[11px] text-slate-400 leading-relaxed">
            <b className="text-slate-200">为什么刚开仓第 1 天净值会微跌约 0.2%？</b>
            <br />
            因为引擎按真实交易标准扣除了开仓滑点（$2/组）与双边 Moomoo 期权规费（约 $1.36/组）。随着接下来 10~20 天时间价值（Theta）衰减，期权买回成本下降，净值将逐步释放正收益。
          </div>
        </div>
      </div>

      {/* Open Positions Table */}
      <div className="rounded-2xl border border-slate-800/90 bg-slate-900/65 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">
              当前在途模拟持仓 ({simState.open_positions.length} / {simState.config.max_open_positions})
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            实时读取期权链 Bid/Ask 计算平仓买回成本
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="bg-slate-950/80 text-[11px] text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2.5 pl-4 pr-2">标的 / 评级</th>
                <th className="px-2 py-2.5">策略与行权腿</th>
                <th className="px-2 py-2.5">到期 (剩余DTE)</th>
                <th className="px-2 py-2.5 text-right">入场价 → 现价</th>
                <th className="px-2 py-2.5 text-right">盈亏平衡点</th>
                <th className="px-2 py-2.5 text-right">开仓净收权利金</th>
                <th className="px-2 py-2.5 text-right">当前买回平仓成本</th>
                <th className="px-2 py-2.5 text-right">净浮盈 (50%止盈进度)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {simState.open_positions.map((pos) => {
                const progressTo50 = Math.max(
                  0,
                  Math.min(100, (pos.pnl_pct_of_credit / simState.config.take_profit_pct) * 100)
                );
                return (
                  <tr key={pos.pos_id} className="hover:bg-slate-800/40">
                    <td className="py-3 pl-4 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-white">{pos.symbol}</span>
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                          {pos.safety_grade_at_entry}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        入场胜率 {pos.pop_at_entry}%
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <div className="font-medium text-slate-200">
                        {pos.strategy_label}
                      </div>
                      <div className="font-mono text-[10px] text-slate-400">
                        卖 ${pos.short_strike}
                        {pos.long_strike ? ` / 买 $${pos.long_strike}` : ''} · 担保 $
                        {pos.collateral_required}
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <div className="text-slate-200">{pos.expiration}</div>
                      <div className="text-[10px] text-sky-300">
                        剩 {pos.current_dte} 天 (≤21天离场)
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right text-slate-200">
                      ${pos.spot_at_entry} → <b>${pos.current_spot}</b>
                    </td>
                    <td className="px-2 py-3 text-right text-amber-300">
                      ${pos.breakeven_price}
                    </td>
                    <td className="px-2 py-3 text-right font-semibold text-emerald-300">
                      +${pos.entry_net_credit_dollars.toFixed(2)}
                    </td>
                    <td className="px-2 py-3 text-right text-slate-300">
                      -${pos.current_close_debit_dollars.toFixed(2)}
                    </td>
                    <td className="py-3 pl-2 pr-4 text-right">
                      <div
                        className={`font-bold ${
                          pos.net_pnl_dollars >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {pos.net_pnl_dollars >= 0 ? '+' : ''}$
                        {pos.net_pnl_dollars.toFixed(2)} ({pos.pnl_pct_of_credit}%)
                      </div>
                      <div className="ml-auto mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full bg-emerald-400"
                          style={{ width: `${progressTo50}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {simState.open_positions.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    暂无在途模拟持仓
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom Grid: Closed Audit Table + Activity Log */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Closed Positions */}
        <div className="rounded-2xl border border-slate-800/90 bg-slate-900/65 p-4 xl:col-span-7">
          <div className="mb-3 flex items-center gap-2">
            <Award className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-white">
              历史自动平仓结案记录 ({simState.closed_positions.length})
            </h3>
          </div>
          {simState.closed_positions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 py-10 text-center text-xs text-slate-400">
              目前持仓仍在收租孵化中。当任意持仓达到 50% 止盈、剩余 ≤21 天或触发风控线时，将自动结案并记录在此。
            </div>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto tabular-nums">
              {simState.closed_positions.map((cp) => (
                <div
                  key={cp.pos_id}
                  className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs"
                >
                  <div>
                    <div className="font-bold text-white">
                      {cp.symbol} · {cp.strategy_label} (${cp.short_strike}
                      {cp.long_strike ? `/$${cp.long_strike}` : ''})
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {cp.opened_at.slice(0, 10)} → {cp.closed_at?.slice(0, 10)} ·{' '}
                      <span className="text-sky-300">{cp.exit_reason_label}</span>
                    </div>
                  </div>
                  <div
                    className={`text-sm font-extrabold ${
                      cp.net_pnl_dollars >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {cp.net_pnl_dollars >= 0 ? '+' : ''}${cp.net_pnl_dollars.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activity Timeline */}
        <div className="rounded-2xl border border-slate-800/90 bg-slate-900/65 p-4 xl:col-span-5">
          <div className="mb-3 flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-white">
              自动化机器人运行日志
            </h3>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1 text-xs">
            {simState.activity_log.map((ev, i) => (
              <div
                key={i}
                className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-2.5"
              >
                <div className="flex items-center justify-between text-[10px] text-slate-400 tabular-nums">
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" />
                    [{ev.event_type}] {ev.symbol}
                  </span>
                  <span>{ev.timestamp}</span>
                </div>
                <p className="mt-1 text-slate-300 leading-relaxed">{ev.summary}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
