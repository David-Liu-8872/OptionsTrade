import { CheckCircle2, PlugZap, ShieldAlert, X } from 'lucide-react';
import type { MoomooStatusResponse } from '../types/options';

interface MoomooGuideModalProps {
  open: boolean;
  status: MoomooStatusResponse | null;
  onClose: () => void;
  onRetest: () => void;
}

export function MoomooGuideModal({
  open,
  status,
  onClose,
  onRetest,
}: MoomooGuideModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3.5">
          <div className="flex items-center gap-2">
            <PlugZap className="h-5 w-5 text-orange-400" />
            <h2 className="text-base font-bold text-white">
              Moomoo OpenD 接入状态、费率模型与新手安全护栏
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-800 p-1.5 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4 text-xs leading-relaxed text-slate-300">
          {/* Connection Status Box */}
          <div
            className={`rounded-xl border p-3.5 ${
              status?.connected
                ? 'border-emerald-500/40 bg-emerald-500/10'
                : 'border-orange-500/35 bg-orange-500/10'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-white">
                当前网关状态 ({status?.host || '127.0.0.1'}:
                {status?.port || 11111})
              </span>
              <button
                type="button"
                onClick={onRetest}
                className="rounded-lg bg-orange-500 px-3 py-1 text-xs font-bold text-slate-950 hover:brightness-110 cursor-pointer"
              >
                重新检测连接
              </button>
            </div>
            <p className="mt-1.5 text-slate-200">{status?.message}</p>
            {status?.sim_total_assets != null && (
              <p className="mt-1 font-mono text-emerald-300">
                Moomoo 美股模拟账户总资产: $
                {status.sim_total_assets.toLocaleString()} (可用现金: $
                {status.sim_cash?.toLocaleString()})
              </p>
            )}
          </div>

          {/* How to connect OpenD */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="font-semibold text-white">
              如何开启 Moomoo OpenD 实时 OPRA 行情与模拟盘联动？（可选）
            </div>
            <ol className="mt-2 space-y-1.5 text-slate-300">
              <li>
                1. 前往 Moomoo 官网下载并启动 <b>moomoo OpenD</b>{' '}
                桌面网关程序，使用你的 Moomoo 账号登录（默认监听{' '}
                <code className="text-orange-300">127.0.0.1:11111</code>）。
              </li>
              <li>
                2. 在 Moomoo App 内确认已免费激活 <b>OPRA 美股期权实时行情权限</b>
                （入金账户通常免费赠送 Level 1/OPRA）。
              </li>
              <li>
                3. 点击上方「重新检测连接」，本系统将自动切换为{' '}
                <b>Moomoo OpenD 实时盘口 + 一键同步至 Moomoo 美股模拟盘 (Paper Trading)</b>
                ！即使不开 OpenD，系统也会自动使用免费数据源正常筛选。
              </li>
            </ol>
          </div>

          {/* Moomoo Fee & Beginner Guardrails */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3.5">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Moomoo 美股期权真实规费扣减
              </div>
              <p className="mt-1.5 text-slate-400">
                许多脚本忽略手续费导致小额价差虚高。本系统已按 Moomoo 美股费率（$0 佣金 + 合约平台费/ORF/OCC 监管费合计约{' '}
                <b className="text-slate-200">$0.68/张</b>）自动从权利金与盈亏曲线中扣除，所见皆为净收益。
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3.5">
              <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                <ShieldAlert className="h-4 w-4" />
                系统内置实盘保护锁
              </div>
              <p className="mt-1.5 text-slate-400">
                为防止新手误触，代码底层已硬编码锁定{' '}
                <code className="text-amber-200">TrdEnv.SIMULATE</code>
                （仅限模拟账户下单），绝不会自动触碰你的真实美元资金。实盘请在核对盘口后用限价单手动执行。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
