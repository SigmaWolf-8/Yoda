import {
  Wifi,
  WifiOff,
  AlertCircle,
  Cpu,
  Clock,
  Layers,
  Gauge,
  TrendingUp,
} from 'lucide-react';
import type { EngineConfig } from '../../types';

interface Props {
  engines: EngineConfig[];
}

const MODE_LABEL: Record<string, string> = {
  self_hosted: 'Self-Hosted',
  commercial: 'Commercial',
  free_tier: 'Free Tier',
};

const HEALTH_STYLES: Record<string, { dot: string; bg: string; text: string }> = {
  online:  { dot: 'bg-[var(--color-ok)]',   bg: 'bg-[var(--color-ok)]/5',   text: 'text-[var(--color-ok)]' },
  suspect: { dot: 'bg-[var(--color-warn)]',  bg: 'bg-[var(--color-warn)]/5', text: 'text-[var(--color-warn)]' },
  offline: { dot: 'bg-[var(--color-err)]',   bg: 'bg-[var(--color-err)]/5',  text: 'text-[var(--color-err)]' },
};

export function EngineHealthDashboard({ engines }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {engines.map((eng) => {
        const style = HEALTH_STYLES[eng.health_status] ?? HEALTH_STYLES.offline;
        const HealthIcon = eng.health_status === 'online' ? Wifi : eng.health_status === 'suspect' ? AlertCircle : WifiOff;

        return (
          <div
            key={eng.slot}
            className={`rounded-xl border border-[var(--color-border-subtle)] p-4 ${style.bg}`}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                Engine {eng.slot.toUpperCase()}
              </h3>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${style.dot} ${eng.health_status === 'online' ? 'animate-pulse' : ''}`} />
                <HealthIcon className={`w-3.5 h-3.5 ${style.text}`} />
              </div>
            </div>

            {/* Model + mode */}
            <div className="space-y-2 mb-3">
              <div className="flex items-center gap-1.5 text-xs">
                <Cpu className="w-3 h-3 text-[var(--color-text-muted)]" />
                <span className="text-[var(--color-text-secondary)] font-medium truncate">
                  {eng.model_name || 'Not configured'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <Layers className="w-3 h-3 text-[var(--color-text-muted)]" />
                <span className="text-[var(--color-text-muted)]">{MODE_LABEL[eng.hosting_mode]}</span>
                <span className="text-[var(--color-text-muted)]">·</span>
                <span className="text-[var(--color-text-muted)]">{eng.model_family}</span>
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-[var(--color-surface-tertiary)]/50 px-2.5 py-2">
                <div className="flex items-center gap-1 text-[9px] text-[var(--color-text-muted)] mb-0.5">
                  <Clock className="w-2.5 h-2.5" /> Latency
                </div>
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {(eng.latency_ms ?? eng.avg_latency_ms) != null
                    ? `${eng.latency_ms ?? eng.avg_latency_ms}ms`
                    : '—'}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--color-surface-tertiary)]/50 px-2.5 py-2">
                <div className="flex items-center gap-1 text-[9px] text-[var(--color-text-muted)] mb-0.5">
                  <TrendingUp className="w-2.5 h-2.5" /> Err %
                </div>
                <p className={`text-sm font-semibold ${
                  (eng.error_rate ?? 0) > 0.05
                    ? 'text-[var(--color-err)]'
                    : 'text-[var(--color-text-primary)]'
                }`}>
                  {eng.error_rate != null
                    ? `${(eng.error_rate * 100).toFixed(1)}%`
                    : '—'}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--color-surface-tertiary)]/50 px-2.5 py-2">
                <div className="flex items-center gap-1 text-[9px] text-[var(--color-text-muted)] mb-0.5">
                  <Gauge className="w-2.5 h-2.5" /> Queue
                </div>
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {eng.queue_depth ?? 0}
                </p>
              </div>
            </div>

            {/* Free tier quota */}
            {eng.daily_messages_limit != null && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-[9px] text-[var(--color-text-muted)] mb-1">
                  <span>Daily messages</span>
                  <span>{eng.daily_messages_used ?? 0} / {eng.daily_messages_limit}</span>
                </div>
                <div className="h-1 rounded-full bg-[var(--color-surface-tertiary)] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      ((eng.daily_messages_used ?? 0) / eng.daily_messages_limit) > 0.9
                        ? 'bg-[var(--color-err)]'
                        : 'bg-[var(--color-plex-500)]'
                    }`}
                    style={{ width: `${Math.min(100, ((eng.daily_messages_used ?? 0) / eng.daily_messages_limit) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Last health check */}
            {eng.last_health_check && (
              <p className="text-[8px] text-[var(--color-text-muted)] mt-2">
                Last check: {new Date(eng.last_health_check).toLocaleTimeString()}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
