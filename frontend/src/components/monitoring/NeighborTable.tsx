import { useState } from 'react';
import { Share2, ChevronDown, ChevronUp } from 'lucide-react';

interface Neighbor {
  address: string;
  status: 'registered' | 'empty';
  lastSeen?: string;
  latencyMs?: number;
}

interface Props {
  neighbors?: Neighbor[];
}

export function NeighborTable({ neighbors = [] }: Props) {
  const [open, setOpen] = useState(true);

  return (
    <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[var(--color-surface-secondary)]/80 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          <Share2 className="w-4 h-4 text-[var(--color-gold-400)]" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">Network View</span>
          {neighbors.length > 0 && (
            <span className="text-xs bg-[var(--color-plex-500)]/10 text-[var(--color-plex-400)] border border-[var(--color-plex-500)]/20 px-1.5 py-0.5 rounded font-medium">
              {neighbors.length}
            </span>
          )}
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-[var(--color-text-muted)]" />
          : <ChevronDown className="w-4 h-4 text-[var(--color-text-muted)]" />
        }
      </button>

      {open && (
        <div className="border-t border-[var(--color-border-subtle)]">
          {neighbors.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <Share2 className="w-6 h-6 text-[var(--color-text-muted)] mx-auto mb-2 opacity-40" />
              <p className="text-sm text-[var(--color-text-muted)]">
                Neighbor discovery requires daemon integration.
              </p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1 opacity-70">
                Once the cube daemon reports neighbors, they will appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--color-surface-tertiary)]/40">
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Address</th>
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Status</th>
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Last Seen</th>
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {neighbors.map((n) => (
                    <tr key={n.address} className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-secondary)]/60 transition-colors">
                      <td className="px-5 py-2.5 font-mono text-xs text-[var(--color-text-primary)]">{n.address}</td>
                      <td className="px-5 py-2.5">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                          n.status === 'registered'
                            ? 'text-[var(--color-plex-400)]'
                            : 'text-[var(--color-text-muted)]'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            n.status === 'registered'
                              ? 'bg-[var(--color-plex-400)]'
                              : 'bg-[var(--color-text-muted)]'
                          }`} />
                          {n.status === 'registered' ? 'Registered' : 'Empty'}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-xs text-[var(--color-text-muted)]">
                        {n.lastSeen ? new Date(n.lastSeen).toLocaleTimeString() : '—'}
                      </td>
                      <td className="px-5 py-2.5 text-xs text-[var(--color-text-secondary)]">
                        {n.latencyMs != null ? `${n.latencyMs}ms` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
