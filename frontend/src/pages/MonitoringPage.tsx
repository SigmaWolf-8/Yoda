import { useEffect, useState, Component } from 'react';
import type { ReactNode } from 'react';
import { BarChart3, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';

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

export function MonitoringPage() {
  const { data: engines, isLoading, refetch, isFetching } = useEngineConfigs({ refetchInterval: 30_000 });

  const [crsStats,    setCrsStats]    = useState<CrsStats | null>(null);
  const [ftsStats,    setFtsStats]    = useState<FtsStats | null>(null);
  const [crsError,    setCrsError]    = useState(false);
  const [nodeAddress, setNodeAddress] = useState<string | undefined>(undefined);

  usePageHeader({
    icon: BarChart3,
    title: 'Monitoring',
    subtitle: 'Node health · engine status · network view · AI metrics',
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      // CRS stats (always try)
      try {
        const data = await crsGet<CrsStats>('/api/salvi/inter-cube/crs/stats');
        if (!cancelled) { setCrsStats(data); setCrsError(false); }
      } catch {
        if (!cancelled) setCrsError(true);
      }

      // FTS status
      try {
        const data = await crsGet<FtsStats>('/api/salvi/inter-cube/fts/status');
        if (!cancelled) setFtsStats(data);
      } catch { /* FTS optional */ }

      // Registered nodes → pick YODA node address (most recent heartbeat)
      try {
        const data = await crsGet<{ nodes: RegisteredNode[] }>('/api/monitoring/registered-nodes');
        if (!cancelled && data.nodes.length > 0) {
          setNodeAddress(data.nodes[0].address);
        }
      } catch { /* address optional */ }
    }

    fetchAll();
    const id = setInterval(fetchAll, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const metricsData: { timestamp: string; engine_a?: number; engine_b?: number; engine_c?: number }[] = [];
  const allReviews: TaskReview[] = [];

  const crsReachable  = !crsError && crsStats !== null;
  const crsHasNode    = crsReachable && (crsStats?.registeredCount ?? 0) > 0;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[var(--color-text-muted)] p-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading engine status…</span>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in space-y-5">

      {/* Refresh */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-[var(--color-border-default)] bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ── Health strip ── */}
      <PanelErrorBoundary label="Health Strip">
        <NodeHealthStrip
          engines={engines ?? []}
          crsReachable={crsReachable}
          crsHasNode={crsHasNode}
        />
      </PanelErrorBoundary>

      {/* ── Node card + engine connections ── */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
        <div className="md:col-span-2">
          <PanelErrorBoundary label="Node Card">
            <NodeCard
              stats={crsStats}
              fts={ftsStats}
              error={crsError}
              nodeAddress={nodeAddress}
            />
          </PanelErrorBoundary>
        </div>
        <div className="md:col-span-3">
          <PanelErrorBoundary label="PlenumNET Panel">
            <PlenumNetPanel engines={engines ?? []} />
          </PanelErrorBoundary>
        </div>
      </div>

      {/* ── Engine health ── */}
      <PanelErrorBoundary label="Engine Health">
        <EngineHealthDashboard engines={engines ?? []} />
      </PanelErrorBoundary>

      {/* ── Cloud LLM Gateway (Alpha/Beta/Gamma) ── */}
      <PanelErrorBoundary label="Cloud LLM Gateway">
        <LlmGatewayPanel />
      </PanelErrorBoundary>

      {/* ── AI latency chart ── */}
      <PanelErrorBoundary label="Metrics Chart">
        <InferenceMetricsChart data={metricsData} />
      </PanelErrorBoundary>

      {/* ── Network neighbor view ── */}
      <PanelErrorBoundary label="Network View">
        <NeighborTable />
      </PanelErrorBoundary>

      {/* ── Cost + censorship ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <PanelErrorBoundary label="Cost Tracker">
          <CostTracker engines={engines ?? []} />
        </PanelErrorBoundary>
        <PanelErrorBoundary label="Censorship Log">
          <CensorshipLog reviews={allReviews} />
        </PanelErrorBoundary>
      </div>

      {/* ── Daemon logs ── */}
      <PanelErrorBoundary label="Daemon Logs">
        <DaemonLogsPanel />
      </PanelErrorBoundary>

    </div>
  );
}
