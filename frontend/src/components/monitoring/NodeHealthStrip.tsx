import { Cpu, Radio, Globe2 } from 'lucide-react';
import type { EngineConfig } from '../../types';

type Level = 'live' | 'trouble' | 'down';

interface Props {
  engines: EngineConfig[];
  crsReachable: boolean;
  crsHasNode: boolean;
}

function Indicator({
  icon: Icon,
  label,
  status,
  level,
}: {
  icon: React.ElementType;
  label: string;
  status: string;
  level: Level;
}) {
  const dot =
    level === 'live'
      ? 'bg-sky-300 animate-pulse'
      : level === 'trouble'
      ? 'bg-[var(--color-text-muted)]'
      : 'bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)]';

  const iconColor =
    level === 'live'
      ? 'text-sky-300'
      : 'text-[var(--color-text-muted)]';

  const statusColor =
    level === 'live'
      ? 'text-sky-300'
      : 'text-[var(--color-text-muted)]';

  const bg =
    level === 'live'
      ? 'bg-sky-400/6 border-sky-400/20'
      : 'bg-[var(--color-surface-secondary)] border-[var(--color-border-subtle)]';

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${bg}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
      <Icon className={`w-4 h-4 flex-shrink-0 ${iconColor}`} />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider leading-none mb-0.5">
          {label}
        </p>
        <p className={`text-sm font-medium ${statusColor}`}>{status}</p>
      </div>
    </div>
  );
}

export function NodeHealthStrip({ engines, crsReachable, crsHasNode }: Props) {
  const configuredEngines = engines.filter((e) => e.model_name?.trim());
  const anyOnline      = configuredEngines.some((e) => e.health_status === 'online');
  const anyTunnelOpen  = configuredEngines.some((e) => e.health_status === 'tunnel_open');
  const onlineCount    = configuredEngines.filter((e) => e.health_status === 'online').length;
  const tunnelCount    = configuredEngines.filter((e) => e.health_status === 'tunnel_open').length;

  const llmLevel: Level = anyOnline
    ? 'live'
    : anyTunnelOpen || configuredEngines.length > 0
      ? 'trouble'
      : 'down';

  const llmStatus = anyOnline
    ? `${onlineCount} / ${configuredEngines.length} online`
    : anyTunnelOpen
      ? `${tunnelCount} tunnel${tunnelCount !== 1 ? 's' : ''} open — run Step 2`
      : configuredEngines.length > 0
        ? 'No engines responding'
        : 'Not configured';

  const cubeLevel: Level = crsHasNode ? 'live' : crsReachable ? 'trouble' : 'down';
  const cubeStatus = crsHasNode ? 'Registered' : crsReachable ? 'Not registered' : 'Daemon offline';

  const crsLevel: Level = crsReachable ? 'live' : 'down';
  const crsStatus = crsReachable ? 'Reachable' : 'Unreachable';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Indicator icon={Cpu}    label="LLM Engine" status={llmStatus}  level={llmLevel}  />
      <Indicator icon={Radio}  label="Cube Node"  status={cubeStatus} level={cubeLevel} />
      <Indicator icon={Globe2} label="CRS Link"   status={crsStatus}  level={crsLevel}  />
    </div>
  );
}
