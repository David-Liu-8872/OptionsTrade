import { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { apiClient } from './api/client';
import { AutoSimLabView } from './components/AutoSimLabView';
import { FilterSidebar } from './components/FilterSidebar';
import { HeaderBar } from './components/HeaderBar';
import { MoomooGuideModal } from './components/MoomooGuideModal';
import { OpportunityTable } from './components/OpportunityTable';
import { PaperJournalDrawer } from './components/PaperJournalDrawer';
import { ScatterOverviewChart } from './components/ScatterOverviewChart';
import { TradeDetailVisualizer } from './components/TradeDetailVisualizer';
import type {
  MoomooStatusResponse,
  PaperTradeRecord,
  PresetPool,
  ScreenerRequest,
  ScreenerResponse,
  SimPortfolioState,
  StrategyCandidate,
} from './types/options';

const INITIAL_FILTERS: ScreenerRequest = {
  strategy: 'all',
  pool_id: 'beginner_etf',
  custom_symbols: [],
  max_capital_per_trade: 8000,
  min_dte: 21,
  max_dte: 46,
  risk_level: 'conservative',
  spread_width: 5,
  exclude_earnings: true,
  only_uptrend: false,
  prefer_moomoo: true,
};

export function App() {
  const [activeView, setActiveView] = useState<'radar' | 'autosim'>('radar');
  const [pools, setPools] = useState<PresetPool[]>([]);
  const [filters, setFilters] = useState<ScreenerRequest>(INITIAL_FILTERS);
  const [moomooStatus, setMoomooStatus] = useState<MoomooStatusResponse | null>(
    null
  );
  const [scanResult, setScanResult] = useState<ScreenerResponse | null>(null);
  const [selectedCandidate, setSelectedCandidate] =
    useState<StrategyCandidate | null>(null);
  const [journalRecords, setJournalRecords] = useState<PaperTradeRecord[]>([]);

  const [simState, setSimState] = useState<SimPortfolioState | null>(null);
  const [isStaticMode, setIsStaticMode] = useState(false);
  const [runningSimCycle, setRunningSimCycle] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showMoomooModal, setShowMoomooModal] = useState(false);
  const [showJournal, setShowJournal] = useState(false);

  const loadJournal = useCallback(async () => {
    try {
      const list = await apiClient.getJournal();
      setJournalRecords(list);
    } catch {
      // ignore in static mode
    }
  }, []);

  const loadSimPortfolio = useCallback(async () => {
    try {
      const { data, isStatic } = await apiClient.getSimPortfolio();
      setSimState(data);
      setIsStaticMode(isStatic);
    } catch {
      // ignore
    }
  }, []);

  const refreshMoomooStatus = useCallback(async () => {
    try {
      const st = await apiClient.getMoomooStatus();
      setMoomooStatus(st);
    } catch {
      // ignore in static mode
    }
  }, []);

  const runScan = useCallback(
    async (overrideReq?: ScreenerRequest) => {
      const targetReq = overrideReq || filters;
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await apiClient.scanOptions(targetReq);
        setScanResult(res);
        if (res.candidates.length > 0) {
          setSelectedCandidate((prev) => {
            if (prev) {
              const stillThere = res.candidates.find((c) => c.id === prev.id);
              if (stillThere) return stillThere;
            }
            return res.candidates[0];
          });
        } else {
          setSelectedCandidate(null);
        }
      } catch (err) {
        setErrorMsg(`数据加载失败: ${String(err)}`);
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    apiClient
      .getPresets()
      .then((res) => setPools(res.pools))
      .catch(() => {});
    refreshMoomooStatus();
    loadJournal();
    loadSimPortfolio();
    runScan(INITIAL_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh portfolio every 3 minutes & whenever user returns to the browser tab
  useEffect(() => {
    const timer = window.setInterval(() => {
      loadSimPortfolio();
    }, 180_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        loadSimPortfolio();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [loadSimPortfolio]);

  const handleRunSimCycle = async (markOnly = false) => {
    setRunningSimCycle(true);
    try {
      const updated = await apiClient.runSimCycle(markOnly);
      setSimState(updated);
    } catch (err) {
      setErrorMsg(`自动模拟巡检执行失败: ${String(err)}`);
    } finally {
      setRunningSimCycle(false);
    }
  };

  const handleResetSim = async () => {
    setRunningSimCycle(true);
    try {
      const reset = await apiClient.resetSimPortfolio();
      setSimState(reset);
    } finally {
      setRunningSimCycle(false);
    }
  };

  const openAlerts = journalRecords.filter(
    (r) => r.status === 'OPEN' && r.alert_tag != null
  ).length;

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100">
      <HeaderBar
        activeView={activeView}
        onSwitchView={(v) => {
          setActiveView(v);
          if (v === 'autosim') loadSimPortfolio();
        }}
        simOpenCount={simState?.open_positions.length || 0}
        moomooStatus={moomooStatus}
        activeSource={scanResult?.active_source || ''}
        generatedAt={scanResult?.generated_at || ''}
        journalCount={journalRecords.filter((r) => r.status === 'OPEN').length}
        alertCount={openAlerts}
        loading={loading || runningSimCycle}
        onRefreshStatus={() => {
          refreshMoomooStatus();
          loadSimPortfolio();
          runScan();
        }}
        onOpenMoomooModal={() => setShowMoomooModal(true)}
        onOpenJournal={() => {
          loadJournal();
          setShowJournal(true);
        }}
      />

      <main className="mx-auto max-w-[1680px] px-4 py-4 sm:px-5">
        {errorMsg && (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            {errorMsg}
          </div>
        )}

        {activeView === 'autosim' ? (
          <AutoSimLabView
            simState={simState}
            isStaticMode={isStaticMode}
            runningCycle={runningSimCycle}
            onRunCycle={handleRunSimCycle}
            onReset={handleResetSim}
          />
        ) : (
          <>
            {scanResult?.market_notes && scanResult.market_notes.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
                <span className="font-semibold">智能排雷报告：</span>
                <span>{scanResult.market_notes.join(' ； ')}</span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
              <div className="xl:col-span-3">
                <FilterSidebar
                  pools={pools}
                  filters={filters}
                  loading={loading}
                  onChange={setFilters}
                  onRunScan={runScan}
                />
              </div>

              <div className="flex flex-col gap-4 xl:col-span-9">
                <ScatterOverviewChart
                  candidates={scanResult?.candidates || []}
                  selectedId={selectedCandidate?.id || null}
                  onSelect={setSelectedCandidate}
                />

                <div className="grid grid-cols-1 gap-4 2xl:grid-cols-12">
                  <div className="2xl:col-span-6">
                    <OpportunityTable
                      candidates={scanResult?.candidates || []}
                      selectedId={selectedCandidate?.id || null}
                      onSelect={setSelectedCandidate}
                    />
                  </div>

                  <div className="2xl:col-span-6">
                    <TradeDetailVisualizer
                      candidate={selectedCandidate}
                      moomooConnected={Boolean(moomooStatus?.connected)}
                      onAddedToJournal={loadJournal}
                    />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      <MoomooGuideModal
        open={showMoomooModal}
        status={moomooStatus}
        onClose={() => setShowMoomooModal(false)}
        onRetest={refreshMoomooStatus}
      />

      <PaperJournalDrawer
        open={showJournal}
        records={journalRecords}
        onClose={() => setShowJournal(false)}
        onMarkClosed={async (id) => {
          await apiClient.closePaperTrade(id);
          loadJournal();
        }}
        onDelete={async (id) => {
          await apiClient.deletePaperTrade(id);
          loadJournal();
        }}
      />
    </div>
  );
}

export default App;
