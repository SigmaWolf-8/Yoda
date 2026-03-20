import { BarChart3, Loader2, RefreshCw } from 'lucide-react';
import { useEngineConfigs } from '../api/hooks';
import { PlenumNetPanel } from '../components/monitoring/PlenumNetPanel';
import { EngineHealthDashboard } from '../components/monitoring/EngineHealthDashboard';
import { InferenceMetricsChart } from '../components/monitoring/InferenceMetricsChart';
import { CostTracker } from '../components/monitoring/CostTracker';
import { CensorshipLog } from '../components/monitoring/CensorshipLog';
import type { TaskReview } from '../types/task-review';
import { usePageHeader } from '../context/PageHeader';

export function MonitoringPage() {
  const { data: engines, isLoading, refetch, isFetching } = useEngineConfigs({ refetchInterval: 30_000 });

  usePageHeader({
    icon: BarChart3,
    title: 'Monitoring',
    subtitle: 'Open connections · engine health · AI metrics · cost tracking',
  });

  const metricsData: { timestamp: string; engine_a?: number; engine_b?: number; engine_c?: number }[] = [];
  const allReviews: TaskReview[] = [];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[var(--color-text-muted)] p-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading engine status…</span>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in space-y-6">
      {/* Manual refresh row */}
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
      <PlenumNetPanel engines={engines ?? []} />
      <EngineHealthDashboard engines={engines ?? []} />
      <InferenceMetricsChart data={metricsData} />
      <CostTracker engines={engines ?? []} />
      <CensorshipLog reviews={allReviews} />
    </div>
  );
}
