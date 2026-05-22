import { useEffect, useState } from 'react';
import { Server } from 'lucide-react';
import { BevelBox } from '../ui/BevelBox';
import { useDaemons, useUpdateDaemons } from '../../api/hooks/useEngines';

function parsePorts(raw: string): { ports: number[]; error: string | null } {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return { ports: [], error: 'At least one port required' };
  const ports: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      return { ports: [], error: `"${p}" is not a valid port (1–65535)` };
    }
    if (ports.includes(n)) return { ports: [], error: `Duplicate port: ${n}` };
    ports.push(n);
  }
  return { ports, error: null };
}

export function DaemonsSettings() {
  const { data, isLoading } = useDaemons();
  const updateMutation = useUpdateDaemons();

  const [host, setHost] = useState('');
  const [portsRaw, setPortsRaw] = useState('');
  const [status, setStatus] = useState<{ kind: 'idle' | 'ok' | 'err'; msg: string }>({
    kind: 'idle',
    msg: '',
  });

  useEffect(() => {
    if (data) {
      setHost(data.host);
      setPortsRaw(data.ports.join(', '));
    }
  }, [data]);

  async function handleSave() {
    const trimmedHost = host.trim();
    if (!trimmedHost) {
      setStatus({ kind: 'err', msg: 'Host must not be empty' });
      return;
    }
    const { ports, error } = parsePorts(portsRaw);
    if (error) {
      setStatus({ kind: 'err', msg: error });
      return;
    }
    try {
      await updateMutation.mutateAsync({ host: trimmedHost, ports });
      setStatus({ kind: 'ok', msg: 'Saved — the Array3 monitor will pick this up on its next reload.' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setStatus({ kind: 'err', msg });
    }
  }

  return (
    <BevelBox className="bg-[var(--color-surface-primary)] p-5 mb-8">
      <div className="flex items-center gap-2 mb-3">
        <Server className="w-4 h-4 text-[var(--color-plex-400)]" />
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          Array3 Daemon Host &amp; Ports
        </h2>
      </div>
      <p className="text-sm text-[var(--color-text-muted)] mb-4">
        Where the Array3 monitor probes for the three Kernel HTTP daemons.
        Defaults: <code className="text-xs">127.0.0.1</code> on ports{' '}
        <code className="text-xs">11488, 11515, 11906</code>.
      </p>

      <div className="space-y-3">
        <label className="block">
          <span className="text-sm text-[var(--color-text-secondary)]">Daemon host</span>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            disabled={isLoading}
            placeholder="127.0.0.1 or my-node.tailnet.ts.net"
            className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors font-mono"
          />
        </label>

        <label className="block">
          <span className="text-sm text-[var(--color-text-secondary)]">
            Daemon ports <span className="text-[var(--color-text-muted)]">(comma-separated)</span>
          </span>
          <input
            type="text"
            value={portsRaw}
            onChange={(e) => setPortsRaw(e.target.value)}
            disabled={isLoading}
            placeholder="11488, 11515, 11906"
            className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors font-mono"
          />
        </label>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={updateMutation.isPending || isLoading}
            className="px-4 py-2 rounded-lg bg-[var(--color-plex-500)]/15 border border-[var(--color-plex-500)]/40 text-sm text-[var(--color-plex-300)] hover:bg-[var(--color-plex-500)]/25 transition-colors disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving…' : 'Save daemon config'}
          </button>
          {status.kind !== 'idle' && (
            <span
              className={`text-sm ${
                status.kind === 'ok' ? 'text-[var(--color-plex-400)]' : 'text-[var(--color-text-secondary)]'
              }`}
            >
              {status.msg}
            </span>
          )}
        </div>
      </div>
    </BevelBox>
  );
}
