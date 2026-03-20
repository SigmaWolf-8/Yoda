import { useEffect, useState } from 'react';
import { Network, Radio, Globe2, Cpu, RefreshCw, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { EngineConfig } from '../../types';

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

  const selfHostedEngines = engines.filter((e) => e.hosting_mode === 'self_hosted');
  const hasActiveTunnel = !error && stats !== null && stats.registeredCount > 0;

  // Any self-hosted engine that is configured but has no active tunnel needs reconnecting
  const needsReconnect = selfHostedEngines.length > 0 && !hasActiveTunnel && !error;

  return (
    <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-[var(--color-text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Open Connections</h2>
        </div>
        {/* Overall PlenumNET status badge */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
          hasActiveTunnel
            ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
            : error
              ? 'bg-[var(--color-err)]/10 border-[var(--color-err)]/30 text-[var(--color-err)]'
              : 'bg-[var(--color-surface-tertiary)] border-[var(--color-border-default)] text-[var(--color-text-muted)]'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            hasActiveTunnel ? 'bg-blue-400 animate-pulse' : error ? 'bg-[var(--color-err)]' : 'bg-[var(--color-text-muted)]'
          }`} />
          {hasActiveTunnel
            ? `PlenumNET Active · ${stats!.registeredCount} node${stats!.registeredCount !== 1 ? 's' : ''}`
            : error
              ? 'CRS unreachable'
              : 'No active tunnels'}
        </div>
      </div>

      {/* Reconnect notice — shown when self-hosted engines are configured but tunnel is down */}
      {needsReconnect && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 mb-3">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
            <span className="font-medium text-amber-400">Tunnel disconnected.</span>{' '}
            PlenumNET registrations reset when the server restarts. Re-run the install script on your
            machine to reconnect.{' '}
            <Link to="/settings/engines" className="text-blue-400 hover:underline inline-flex items-center gap-0.5">
              <RefreshCw className="w-2.5 h-2.5" />
              Go to Engine Settings
            </Link>
            {' '}and click <strong className="text-[var(--color-text-secondary)]">Install &amp; Connect</strong> to get a fresh script.
          </div>
        </div>
      )}

      {/* Engine connection rows */}
      <div className="space-y-2 mb-4">
        {engines.length === 0 && (
          <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-subtle)]">
            <span className="w-2 h-2 rounded-full bg-[var(--color-text-muted)] flex-shrink-0" />
            <p className="text-xs text-[var(--color-text-muted)]">
              No engines configured yet.{' '}
              <Link to="/settings/engines" className="text-[var(--color-plex-400)] hover:underline">
                Go to AI Engines settings
              </Link>{' '}
              to set up your engine slots — selections save automatically.
            </p>
          </div>
        )}
        {engines.map((eng) => {
          const isSelfHosted = eng.hosting_mode === 'self_hosted';
          const isOnline = eng.health_status === 'online';

          const showTunnel = isSelfHosted && hasActiveTunnel;
          const showApi = !isSelfHosted && isOnline;

          const dotColor = isSelfHosted
            ? showTunnel
              ? 'bg-blue-400 animate-pulse'
              : 'bg-blue-500/30'
            : isOnline
              ? 'bg-[var(--color-ok)]'
              : 'bg-[var(--color-err)]';

          return (
            <div
              key={eng.slot}
              className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-subtle)]"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                <Cpu className="w-3.5 h-3.5 text-[var(--color-text-muted)] flex-shrink-0" />
                <div className="min-w-0">
                  <span className="text-xs font-medium text-[var(--color-text-primary)]">
                    Engine {eng.slot.toUpperCase()}
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)] ml-1.5 truncate">
                    {eng.model_name || 'Not configured'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                {showTunnel && (
                  <span className="flex items-center gap-1 text-[10px] text-blue-400 font-medium">
                    <Radio className="w-3 h-3" />
                    PlenumNET
                  </span>
                )}
                {showApi && (
                  <span className="flex items-center gap-1 text-[10px] text-[var(--color-ok)] font-medium">
                    <Globe2 className="w-3 h-3" />
                    API online
                  </span>
                )}
                {!showTunnel && !showApi && isSelfHosted && (
                  <Link
                    to="/settings/engines"
                    className="flex items-center gap-1 text-[10px] text-amber-400/80 hover:text-amber-400 transition-colors"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    Reconnect
                  </Link>
                )}
                {!showTunnel && !showApi && !isSelfHosted && (
                  <span className="text-[10px] text-[var(--color-text-muted)]">Offline</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* CRS network stats footer */}
      {stats && !error && (
        <div className="pt-3 border-t border-[var(--color-border-subtle)] flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-[var(--color-text-muted)]">
          <span>
            <span className="font-medium text-[var(--color-text-secondary)]">Network nodes: </span>
            {stats.totalVertices.toLocaleString()}
          </span>
          <span>
            <span className="font-medium text-[var(--color-text-secondary)]">Active registrations: </span>
            {stats.registeredCount}
          </span>
          <span>
            <span className="font-medium text-[var(--color-text-secondary)]">Utilization: </span>
            {(stats.utilizationPercent * 100).toFixed(6)}%
          </span>
          <span className="text-[var(--color-text-muted)]/60 italic">
            Registrations reset on server restart
          </span>
        </div>
      )}
      {error && (
        <p className="text-[10px] text-[var(--color-text-muted)] pt-2 border-t border-[var(--color-border-subtle)]">
          CRS stats unavailable — ensure the tunnel service is running.
        </p>
      )}
    </div>
  );
}
