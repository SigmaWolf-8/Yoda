import { BarChart3, Loader2 } from 'lucide-react';
import { useEngineConfigs } from '../api/hooks';
import { PlenumNetPanel } from '../components/monitoring/PlenumNetPanel';
import { EngineHealthDashboard } from '../components/monitoring/EngineHealthDashboard';
import { InferenceMetricsChart } from '../components/monitoring/InferenceMetricsChart';
import { CostTracker } from '../components/monitoring/CostTracker';
import { CensorshipLog } from '../components/monitoring/CensorshipLog';
import type { TaskReview } from '../types/task-review';
import { usePageHeader } from '../context/PageHeader';

export function MonitoringPage() {
  const { data: engines, isLoading } = useEngineConfigs();

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
      <PlenumNetPanel engines={engines ?? []} />
      <EngineHealthDashboard engines={engines ?? []} />
      <InferenceMetricsChart data={metricsData} />
      <CostTracker engines={engines ?? []} />
      <CensorshipLog reviews={allReviews} />
    </div>
  );
}
