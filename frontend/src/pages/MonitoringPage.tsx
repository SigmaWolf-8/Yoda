import { useEffect, useState, Component } from 'react';
import type { ReactNode } from 'react';
import { BarChart3, Loader2, RefreshCw, AlertTriangle, Network, Activity } from 'lucide-react';

class PanelErrorBoundary extends Component<{ label: string; children: ReactNode }, { error: string | null }> {
  constructor(props: { label: string; children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex items-start gap-2 p-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] text-sm text-[var(--color-text-muted)]">
          <AlertTriangle className="w-4 h-4 text-[var(--color-text-muted)] flex-shrink-0 mt-0.5" />
          <span><strong className="text-[var(--color-text-secondary)]">{this.props.label}</strong> failed to render: {this.state.error}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

import { useEngineConfigs } from '../api/hooks';
import { NodeHealthStrip } from '../components/monitoring/NodeHealthStrip';
import { NodeCard } from '../components/monitoring/NodeCard';
import { PlenumNetPanel } from '../components/monitoring/PlenumNetPanel';
import { EngineHealthDashboard } from '../components/monitoring/EngineHealthDashboard';
import { InferenceMetricsChart } from '../components/monitoring/InferenceMetricsChart';
import { CostTracker } from '../components/monitoring/CostTracker';
import { CensorshipLog } from '../components/monitoring/CensorshipLog';
import { NeighborTable } from '../components/monitoring/NeighborTable';
import { DaemonLogsPanel } from '../components/monitoring/DaemonLogsPanel';
import { LlmGatewayPanel } from '../components/monitoring/LlmGatewayPanel';
import type { TaskReview } from '../types/task-review';
import { usePageHeader } from '../context/PageHeader';

interface CrsStats {
  registeredCount: number;
  totalVertices: number;
  utilizationPercent: number;
  neighborsPerCube?: number;
  dimensions?: number;
}

interface FtsStats {
  up: number;
  suspect: number;
  down: number;
  recovering: number;
  total: number;
}

interface RegisteredNode {
  address: string;
  endpoint: string;
  lastHeartbeat: string;
}

const BASE = (import.meta.env.VITE_CRS_URL as string | undefined) ?? '';

async function crsGet<T>(path: string): Promise<T> {
  const origin = BASE || window.location.origin;
  const res = await fetch(`${origin}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

type Tab = 'array3' | 'metrics';

const TABS: { id: Tab; label: string; icon: typeof Network }[] = [
  { id: 'array3',  label: 'Array3 3D', icon: Network  },
  { id: 'metrics', label: 'Metrics',   icon: Activity },
];

export function MonitoringPage() {
  const { data: engines, isLoading, refetch, isFetching } = useEngineConfigs({ refetchInterval: 30_000 });
  const [activeTab, setActiveTab] = useState<Tab>('array3');

  const [crsStats,    setCrsStats]    = useState<CrsStats | null>(null);
  const [ftsStats,    setFtsStats]    = useState<FtsStats | null>(null);
  const [crsError,    setCrsError]    = useState(false);
  const [nodeAddress, setNodeAddress] = useState<string | undefined>(undefined);

  usePageHeader({
    icon: BarChart3,
    title: 'Monitoring',
    subtitle: 'Array3 3D cluster view · node health · engine metrics',
  });

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      try {
        const data = await crsGet<CrsStats>('/api/salvi/inter-cube/crs/stats');
        if (!cancelled) { setCrsStats(data); setCrsError(false); }
      } catch { if (!cancelled) setCrsError(true); }
      try {
        const data = await crsGet<FtsStats>('/api/salvi/inter-cube/fts/status');
        if (!cancelled) setFtsStats(data);
      } catch { /* optional */ }
      try {
        const data = await crsGet<{ nodes: RegisteredNode[] }>('/api/monitoring/registered-nodes');
        if (!cancelled && data.nodes.length > 0) setNodeAddress(data.nodes[0].address);
      } catch { /* optional */ }
    }
    fetchAll();
    const id = setInterval(fetchAll, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const metricsData: { timestamp: string; engine_a?: number; engine_b?: number; engine_c?: number }[] = [];
  const allReviews: TaskReview[] = [];
  const crsReachable = !crsError && crsStats !== null;
  const crsHasNode   = crsReachable && (crsStats?.registeredCount ?? 0) > 0;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[var(--color-text-muted)] p-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">

      {/* ── Tab bar ── */}
      <div
        className="flex items-center gap-1 px-6 pt-4 pb-0 border-b flex-shrink-0"
        style={{ borderColor: 'rgba(255,255,255,0.07)' }}
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-semibold transition-all border-b-2 -mb-px"
            style={{
              color: activeTab === id ? '#4A9EF5' : '#6B655E',
              borderBottomColor: activeTab === id ? '#4A9EF5' : 'transparent',
              background: activeTab === id ? 'rgba(74,158,245,0.06)' : 'transparent',
            }}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 mb-1.5 rounded-lg text-sm border border-[var(--color-border-default)] bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ── Array3 tab — full-height iframe ── */}
      {activeTab === 'array3' && (
        <div className="flex-1 min-h-0">
          <iframe
            src="/array3-monitor.html"
            className="w-full h-full border-0"
            title="Array3 Monitor — PlenumNET 3D Cluster View"
            allow="autoplay"
          />
        </div>
      )}

      {/* ── Metrics tab ── */}
      {activeTab === 'metrics' && (
        <div className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="max-w-5xl mx-auto animate-fade-in space-y-5">

            <PanelErrorBoundary label="Health Strip">
              <NodeHealthStrip engines={engines ?? []} crsReachable={crsReachable} crsHasNode={crsHasNode} />
            </PanelErrorBoundary>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
              <div className="md:col-span-2">
                <PanelErrorBoundary label="Node Card">
                  <NodeCard stats={crsStats} fts={ftsStats} error={crsError} nodeAddress={nodeAddress} />
                </PanelErrorBoundary>
              </div>
              <div className="md:col-span-3">
                <PanelErrorBoundary label="PlenumNET Panel">
                  <PlenumNetPanel engines={engines ?? []} />
                </PanelErrorBoundary>
              </div>
            </div>

            <PanelErrorBoundary label="Engine Health">
              <EngineHealthDashboard engines={engines ?? []} />
            </PanelErrorBoundary>

            <PanelErrorBoundary label="Cloud LLM Gateway">
              <LlmGatewayPanel />
            </PanelErrorBoundary>

            <PanelErrorBoundary label="Metrics Chart">
              <InferenceMetricsChart data={metricsData} />
            </PanelErrorBoundary>

            <PanelErrorBoundary label="Network View">
              <NeighborTable />
            </PanelErrorBoundary>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <PanelErrorBoundary label="Cost Tracker">
                <CostTracker engines={engines ?? []} />
              </PanelErrorBoundary>
              <PanelErrorBoundary label="Censorship Log">
                <CensorshipLog reviews={allReviews} />
              </PanelErrorBoundary>
            </div>

            <PanelErrorBoundary label="Daemon Logs">
              <DaemonLogsPanel />
            </PanelErrorBoundary>

          </div>
        </div>
      )}
    </div>
  );
}
