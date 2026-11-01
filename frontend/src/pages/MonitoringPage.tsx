import { HEADER_H } from '../components/layout/AppShell';
import { useEngineConfigs } from '../api/hooks/useEngines';
import { EngineHealthDashboard } from '../components/monitoring/EngineHealthDashboard';

export function MonitoringPage() {
  const engines = useEngineConfigs({ refetchInterval: 5_000 });
  const verified = engines.data?.filter(e => e.operational).length ?? 0;
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: `calc(100vh - ${HEADER_H}px)`,
        background: '#000',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <details className="bg-[var(--color-surface-secondary)] border-b border-[var(--color-border-subtle)] p-3 z-10 max-h-[55vh] overflow-auto shrink-0">
        <summary className="cursor-pointer text-sm">
          Engine operability · {engines.isError ? 'status unavailable' : `${verified} generation verified`} — view evidence and run verification
        </summary>
        <p className="text-xs my-2">Relay connections and occupied tunnels below do not certify AI execution. Certification requires a nonempty model answer and expires after five minutes.</p>
        {engines.isError ? <p role="alert">Could not load current engine status. No current operability claim is available.</p>
          : <EngineHealthDashboard engines={engines.data ?? []} />}
      </details>
      <iframe
        src="/array3-cubes-flush.html?gateway=1"
        title="Array3 Monitor"
        style={{
          width: '100%',
          flex: 1,
          minHeight: 0,
          border: 'none',
          background: '#000',
          display: 'block',
        }}
      />
    </div>
  );
}
