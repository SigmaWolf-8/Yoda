import { Link } from 'react-router-dom';
import { useEngineConfigs } from '../../api/hooks';
import type { EngineSlot } from '../../types';

const SLOTS: EngineSlot[] = ['a', 'b', 'c'];

/** green = online, gold = tunnel open, yellow = suspect, red/dim = offline. */
const DOT: Record<string, string> = {
  online:      'bg-[var(--color-plex-400)]',
  tunnel_open: 'bg-[var(--color-gold-400)]',
  suspect:     'bg-amber-400',
  offline:     'bg-red-500/70',
};

const LABEL: Record<string, string> = {
  online:      'generation verified',
  tunnel_open: 'tunnel open',
  suspect:     'not verified',
  offline:     'offline',
};

/**
 * Compact engine status strip — slots A/B/C with coloured dots.
 *
 * Reads the shared `['engines']` react-query cache that the settings and
 * monitoring views already populate, so mounting it adds no extra polling.
 */
export function EngineStatusStrip() {
  const { data: engines, isLoading } = useEngineConfigs();
  const bySlot = new Map((engines ?? []).map((e) => [e.slot as EngineSlot, e]));

  return (
    <div className="flex items-center gap-4 flex-wrap px-4 py-2.5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]">
      <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        Engines
      </span>

      {SLOTS.map((slot) => {
        const eng = bySlot.get(slot);
        const status = eng?.is_disabled
          ? 'offline'
          : (eng?.health_status ?? 'offline');
        const configured = Boolean(eng?.model_name?.trim());
        const latency = eng?.latency_ms ?? eng?.avg_latency_ms;

        return (
          <span key={slot} className="flex items-center gap-1.5 text-sm">
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                configured ? (DOT[status] ?? DOT.offline) : 'bg-[var(--color-text-muted)]/30'
              } ${status === 'online' && configured ? 'animate-pulse' : ''}`}
            />
            <span className="text-[var(--color-text-secondary)] font-medium">
              {slot.toUpperCase()}
            </span>
            <span className="text-[var(--color-text-muted)]">
              {isLoading && !eng
                ? 'checking…'
                : !configured
                  ? 'not configured'
                  : eng?.is_disabled
                    ? 'disabled'
                    : `${LABEL[status] ?? status}${
                        status === 'online' && latency != null ? ` · ${latency}ms` : ''
                      }`}
            </span>
          </span>
        );
      })}

      <Link
        to="/settings/engines"
        className="ml-auto text-sm text-[var(--color-plex-400)] hover:underline"
      >
        Configure
      </Link>
    </div>
  );
}
