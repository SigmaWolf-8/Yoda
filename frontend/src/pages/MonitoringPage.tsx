import { useEffect, useState } from 'react';
import { BarChart3, Loader2, RefreshCw } from 'lucide-react';
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
      <NodeHealthStrip
        engines={engines ?? []}
        crsReachable={crsReachable}
        crsHasNode={crsHasNode}
      />

      {/* ── Node card + engine connections ── */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
        <div className="md:col-span-2">
          <NodeCard
            stats={crsStats}
            fts={ftsStats}
            error={crsError}
            nodeAddress={nodeAddress}
          />
        </div>
        <div className="md:col-span-3">
          <PlenumNetPanel engines={engines ?? []} />
        </div>
      </div>

      {/* ── Engine health ── */}
      <EngineHealthDashboard engines={engines ?? []} />

      {/* ── AI latency chart ── */}
      <InferenceMetricsChart data={metricsData} />

      {/* ── Network neighbor view ── */}
      <NeighborTable />

      {/* ── Cost + censorship ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <CostTracker engines={engines ?? []} />
        <CensorshipLog reviews={allReviews} />
      </div>

      {/* ── Daemon logs ── */}
      <DaemonLogsPanel />

    </div>
  );
}
