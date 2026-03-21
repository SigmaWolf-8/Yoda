import { useState } from 'react';
import { Terminal, ChevronDown, ChevronUp } from 'lucide-react';

interface LogLine {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

interface Props {
  lines?: LogLine[];
}

const LEVEL_COLOR: Record<string, string> = {
  info:  'text-[var(--color-text-muted)]',
  warn:  'text-[var(--color-plex-400)]',
  error: 'text-[var(--color-text-secondary)]',
};

export function DaemonLogsPanel({ lines = [] }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[var(--color-surface-secondary)]/80 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[var(--color-gold-400)]" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">Daemon Logs</span>
          <span className="text-xs text-[var(--color-text-muted)]">
            {lines.length > 0 ? `${lines.length} lines` : 'collapsible'}
          </span>
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-[var(--color-text-muted)]" />
          : <ChevronDown className="w-4 h-4 text-[var(--color-text-muted)]" />
        }
      </button>

      {open && (
        <div className="border-t border-[var(--color-border-subtle)]">
          {lines.length === 0 ? (
            <div className="px-5 py-6 text-center">
              <Terminal className="w-5 h-5 text-[var(--color-text-muted)] mx-auto mb-2 opacity-40" />
              <p className="text-sm text-[var(--color-text-muted)]">
                Daemon log streaming not yet wired.
              </p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1 opacity-70">
                Logs will appear here once the cube daemon pipes output to the API.
              </p>
            </div>
          ) : (
            <div className="bg-[hsl(20,8%,7%)] p-4 max-h-64 overflow-y-auto font-mono text-xs space-y-0.5">
              {lines.map((line, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-[var(--color-text-muted)] flex-shrink-0 select-none">
                    {new Date(line.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`font-semibold flex-shrink-0 w-8 ${LEVEL_COLOR[line.level]}`}>
                    {line.level.toUpperCase()}
                  </span>
                  <span className="text-[var(--color-text-secondary)] break-all">{line.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
