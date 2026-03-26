import { useEffect, useState } from 'react';
import { Network, Radio, Globe2, Cpu, RefreshCw, AlertTriangle, Terminal } from 'lucide-react';
import type { EngineConfig } from '../../types';
import { ModelInstallModal } from '../settings/ModelInstallModal';
import { OLLAMA_TAG_DISPLAY } from '../settings/EngineSlot';

interface CrsStats {
  registeredCount: number;
  totalVertices: number;
  utilizationPercent: number;
}

interface Props {
  engines: EngineConfig[];
}

const CRS_URL = (import.meta.env.VITE_CRS_URL as string | undefined) ?? '';

export function PlenumNetPanel({ engines }: Props) {
  const [stats, setStats] = useState<CrsStats | null>(null);
  const [error, setError] = useState(false);
  const [connectingEngine, setConnectingEngine] = useState<EngineConfig | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      try {
        const base = CRS_URL || window.location.origin;
        const res = await fetch(`${base}/api/salvi/inter-cube/crs/stats`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: CrsStats = await res.json();
        if (!cancelled) { setStats(data); setError(false); }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    fetchStats();
    const id = setInterval(fetchStats, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const configuredEngines = engines.filter((e) => e.model_name?.trim());
  const selfHostedEngines = configuredEngines.filter((e) => e.hosting_mode === 'self_hosted');
  // Tunnel is active if CRS reports registrations OR any self-hosted engine is already online
  const crsActive = !error && stats !== null && stats.registeredCount > 0;
  const anySelfHostedActive = selfHostedEngines.some(
    (e) => e.health_status === 'online' || e.health_status === 'tunnel_open',
  );
  const hasActiveTunnel = crsActive || anySelfHostedActive;
  const needsReconnect = selfHostedEngines.length > 0 && !hasActiveTunnel && !error;

  function resolveModelName(eng: EngineConfig): string {
    const raw = eng.model_name ?? '';
    return OLLAMA_TAG_DISPLAY[raw] ?? raw;
  }

  return (
    <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-[var(--color-text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Open Connections</h2>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium border ${
          hasActiveTunnel
            ? 'bg-sky-400/10 border-sky-400/30 text-sky-300'
            : 'bg-[var(--color-surface-tertiary)] border-[var(--color-border-default)] text-[var(--color-text-muted)]'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            hasActiveTunnel ? 'bg-sky-300 animate-pulse' : 'bg-[var(--color-text-muted)]'
          }`} />
          {hasActiveTunnel
            ? crsActive
              ? `PlenumNET Active · ${stats!.registeredCount} node${stats!.registeredCount !== 1 ? 's' : ''}`
              : 'PlenumNET Active'
            : error
              ? 'CRS unreachable'
              : 'No active tunnels'}
        </div>
      </div>

      {/* Reconnect notice */}
      {needsReconnect && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[var(--color-plex-500)]/5 border border-[var(--color-plex-500)]/20 mb-3">
          <AlertTriangle className="w-3.5 h-3.5 text-[var(--color-plex-400)] flex-shrink-0 mt-0.5" />
          <div className="text-xs text-[var(--color-text-muted)] leading-relaxed">
            <span className="font-medium text-[var(--color-plex-400)]">No tunnel active.</span>{' '}
            Click <span className="font-medium text-[var(--color-text-secondary)]">Connect</span> on an engine below to get a script that starts the PlenumNET daemon on your machine.
          </div>
        </div>
      )}

      {/* Engine connection rows */}
      <div className="space-y-2 mb-4">
        {configuredEngines.length === 0 && (
          <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-subtle)]">
            <span className="w-2 h-2 rounded-full bg-[var(--color-text-muted)] flex-shrink-0" />
            <p className="text-sm text-[var(--color-text-muted)]">
              No engines configured yet. Go to{' '}
              <a href="/settings/engines" className="text-[var(--color-plex-400)] hover:underline">
                AI Engines settings
              </a>{' '}
              to set up your engine slots.
            </p>
          </div>
        )}
        {configuredEngines.map((eng) => {
          const isSelfHosted = eng.hosting_mode === 'self_hosted';
          const isOnline = eng.health_status === 'online';
          // Show PlenumNET label if self-hosted AND this engine is online (the connection IS the tunnel)
          const showTunnel = isSelfHosted && isOnline;
          const showApi = !isSelfHosted && isOnline;

          const dotColor = isSelfHosted
            ? showTunnel
              ? 'bg-sky-300 animate-pulse'
              : 'bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)]'
            : isOnline
              ? 'bg-sky-300'
              : 'bg-[var(--color-text-muted)]';

          const displayName = resolveModelName(eng);

          return (
            <div
              key={eng.slot}
              className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-subtle)]"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                <Cpu className="w-3.5 h-3.5 text-[var(--color-text-muted)] flex-shrink-0" />
                <div className="min-w-0">
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">
                    Engine {eng.slot.toUpperCase()}
                  </span>
                  <span className="text-sm text-[var(--color-text-muted)] ml-1.5 truncate">
                    {displayName || 'Not configured'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                {showTunnel && (
                  <span className="flex items-center gap-1 text-xs text-sky-300 font-medium">
                    <Radio className="w-3 h-3" />
                    PlenumNET
                  </span>
                )}
                {showApi && (
                  <span className="flex items-center gap-1 text-xs text-sky-300 font-medium">
                    <Globe2 className="w-3 h-3" />
                    API online
                  </span>
                )}
                {/* Connect button — only when self-hosted engine is not yet online */}
                {isSelfHosted && !isOnline && displayName && (
                  <button
                    onClick={() => setConnectingEngine(eng)}
                    className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border border-[var(--color-plex-500)]/40 bg-[var(--color-plex-500)]/8 text-[var(--color-plex-400)] hover:bg-[var(--color-plex-500)]/15 hover:border-[var(--color-plex-500)]/70 transition-colors"
                  >
                    <Terminal className="w-2.5 h-2.5" />
                    Connect
                  </button>
                )}
                {isSelfHosted && !isOnline && !displayName && (
                  <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                    <RefreshCw className="w-2.5 h-2.5" />
                    Not configured
                  </span>
                )}
                {!isSelfHosted && !showApi && (
                  <span className="text-xs text-[var(--color-text-muted)]">Offline</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Connect modal — opened inline from this panel */}
      {connectingEngine && (
        <ModelInstallModal
          modelName={resolveModelName(connectingEngine)}
          mode="connect"
          onClose={() => setConnectingEngine(null)}
        />
      )}
    </div>
  );
}
