import {
  Activity,
  Bot,
  Briefcase,
  Compass,
  PlugZap,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { MoomooStatusResponse } from '../types/options';

interface HeaderBarProps {
  activeView: 'radar' | 'autosim';
  onSwitchView: (v: 'radar' | 'autosim') => void;
  simOpenCount: number;
  moomooStatus: MoomooStatusResponse | null;
  activeSource: string;
  generatedAt: string;
  journalCount: number;
  alertCount: number;
  loading: boolean;
  onRefreshStatus: () => void;
  onOpenMoomooModal: () => void;
  onOpenJournal: () => void;
}

export function HeaderBar({
  activeView,
  onSwitchView,
  simOpenCount,
  moomooStatus,
  activeSource,
  generatedAt,
  journalCount,
  alertCount,
  loading,
  onRefreshStatus,
  onOpenMoomooModal,
  onOpenJournal,
}: HeaderBarProps) {
  const isConnected = Boolean(moomooStatus?.connected);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3 px-5 py-3">
        {/* Brand + Top View Switcher */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 shadow-lg shadow-orange-500/20">
              <ShieldCheck className="h-5 w-5 text-slate-950 stroke-[2.4]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold tracking-tight text-white">
                  Moomoo 美股稳健期权雷达
                </span>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                  新手低风险风控版
                </span>
              </div>
              <p className="text-xs text-slate-400">
                高胜率卖方价差与蓝筹收租 · 自动扣减 Moomoo 规费 · GitHub Actions 云跑批就绪
              </p>
            </div>
          </div>

          {/* Primary Mode Switcher */}
          <div className="flex rounded-xl border border-slate-800 bg-slate-900/90 p-1">
            <button
              type="button"
              onClick={() => onSwitchView('radar')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                activeView === 'radar'
                  ? 'bg-orange-500 text-slate-950 shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Compass className="h-3.5 w-3.5" />
              <span>实时选股与期权雷达</span>
            </button>

            <button
              type="button"
              onClick={() => onSwitchView('autosim')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                activeView === 'autosim'
                  ? 'bg-emerald-500 text-slate-950 shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Bot className="h-3.5 w-3.5" />
              <span>30天全自动模拟实验室</span>
              <span
                className={`rounded-md px-1.5 py-0.2 text-[10px] font-bold tabular-nums ${
                  activeView === 'autosim'
                    ? 'bg-slate-950/20 text-slate-950'
                    : 'bg-emerald-500/20 text-emerald-300'
                }`}
              >
                {simOpenCount}
              </span>
            </button>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="hidden items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-300 2xl:flex">
            <Activity className="h-3.5 w-3.5 text-sky-400" />
            <span>数据源：{activeSource || '准备就绪'}</span>
            {generatedAt && (
              <span className="text-slate-500 tabular-nums">({generatedAt.slice(11)})</span>
            )}
          </div>

          <button
            type="button"
            onClick={onOpenMoomooModal}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
              isConnected
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                : 'border-orange-500/35 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20'
            }`}
          >
            <PlugZap className="h-3.5 w-3.5" />
            <span>
              {isConnected
                ? `OpenD 已连接 (${moomooStatus?.host}:${moomooStatus?.port})`
                : 'Moomoo OpenD 状态 & 费率'}
            </span>
          </button>

          <button
            type="button"
            onClick={onRefreshStatus}
            disabled={loading}
            title="刷新实时数据"
            className="flex items-center justify-center rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-300 hover:border-slate-700 hover:text-white disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-orange-400' : ''}`} />
          </button>

          <button
            type="button"
            onClick={onOpenJournal}
            className="relative flex items-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/25 transition cursor-pointer"
          >
            <Briefcase className="h-3.5 w-3.5 text-indigo-300" />
            <span>手动自选账本</span>
            <span className="rounded-md bg-indigo-500/30 px-1.5 py-0.5 text-[11px] tabular-nums text-white">
              {journalCount}
            </span>
            {alertCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow">
                {alertCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
