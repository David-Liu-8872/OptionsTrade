import { AlertCircle, CheckCircle, Trash2, X } from 'lucide-react';
import type { PaperTradeRecord } from '../types/options';

interface PaperJournalDrawerProps {
  open: boolean;
  records: PaperTradeRecord[];
  onClose: () => void;
  onMarkClosed: (id: number) => void;
  onDelete: (id: number) => void;
}

export function PaperJournalDrawer({
  open,
  records,
  onClose,
  onMarkClosed,
  onDelete,
}: PaperJournalDrawerProps) {
  if (!open) return null;

  const openTrades = records.filter((r) => r.status === 'OPEN');
  const totalCollateral = openTrades.reduce(
    (acc, r) => acc + r.collateral_required,
    0
  );
  const totalEstPnl = openTrades.reduce(
    (acc, r) => acc + r.estimated_current_pnl,
    0
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-xs">
      <div className="flex h-full w-full max-w-2xl flex-col border-l border-slate-800 bg-slate-950 p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-bold text-white">
              模拟持仓与 50% 止盈 / 21天风控监控台
            </h2>
            <p className="text-xs text-slate-400">
              建议新手先用模拟持仓跑满 10-15 笔交易，验证胜率与执行纪律后再投入实盘资金
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-800 p-1.5 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Summary Strip */}
        <div className="my-4 grid grid-cols-3 gap-3 tabular-nums">
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <div className="text-[11px] text-slate-400">在途持仓笔数</div>
            <div className="mt-1 text-lg font-bold text-white">
              {openTrades.length} 笔
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <div className="text-[11px] text-slate-400">占用担保资金</div>
            <div className="mt-1 text-lg font-bold text-sky-300">
              ${totalCollateral.toLocaleString()}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <div className="text-[11px] text-slate-400">当前浮动盈亏估算</div>
            <div
              className={`mt-1 text-lg font-bold ${
                totalEstPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {totalEstPnl >= 0 ? '+' : ''}${totalEstPnl.toFixed(2)}
            </div>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {records.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-800 py-14 text-center text-xs text-slate-400">
              暂无模拟持仓。在详情面板点击「加入本地模拟持仓跟踪」即可开始记录和监控止盈信号。
            </div>
          )}

          {records.map((r) => (
            <div
              key={r.id}
              className={`rounded-xl border p-3.5 tabular-nums ${
                r.status === 'CLOSED'
                  ? 'border-slate-800/60 bg-slate-900/30 opacity-65'
                  : 'border-slate-800 bg-slate-900/80'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white">{r.symbol}</span>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                    {r.strategy_label}
                  </span>
                  <span className="text-xs text-slate-400">
                    ${r.short_strike}
                    {r.long_strike ? `/$${r.long_strike}` : ''} · 剩{' '}
                    {r.current_dte} 天
                  </span>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                    r.status === 'OPEN'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {r.status === 'OPEN' ? '持仓监控中' : '已平仓结案'}
                </span>
              </div>

              {r.alert_message && r.status === 'OPEN' && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span>{r.alert_message}</span>
                </div>
              )}

              <div className="mt-2.5 grid grid-cols-4 gap-2 text-xs">
                <div>
                  <div className="text-[10px] text-slate-500">开仓净收权利金</div>
                  <div className="font-semibold text-amber-300">
                    +${r.entry_net_credit_dollars}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">入场价 → 现价</div>
                  <div className="text-slate-200">
                    ${r.spot_at_entry} → ${r.current_spot}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">估算浮盈进度</div>
                  <div
                    className={`font-semibold ${
                      r.estimated_current_pnl >= 0
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {r.estimated_current_pnl >= 0 ? '+' : ''}$
                    {r.estimated_current_pnl} ({r.pnl_pct_of_max_profit}%)
                  </div>
                </div>
                <div className="flex items-end justify-end gap-1.5">
                  {r.status === 'OPEN' && (
                    <button
                      type="button"
                      onClick={() => onMarkClosed(r.id)}
                      className="flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/30 cursor-pointer"
                    >
                      <CheckCircle className="h-3 w-3" />
                      止盈结案
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDelete(r.id)}
                    className="rounded bg-slate-800 p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-2 text-[10px] text-slate-500">
                {r.moomoo_order_status} · 创建于 {r.created_at}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
