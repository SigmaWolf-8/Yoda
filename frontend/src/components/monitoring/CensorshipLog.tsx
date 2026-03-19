import { useState } from 'react';
import { ShieldAlert, Eye, EyeOff, Filter } from 'lucide-react';
import type { TaskReview } from '../../types/task-review';

interface Props {
  reviews: TaskReview[];
}

export function CensorshipLog({ reviews }: Props) {
  const flagged = reviews.filter((r) => r.censorship_flagged);
  const [showAll, setShowAll] = useState(false);

  // Per-engine summary
  const engineCounts = new Map<string, number>();
  for (const r of flagged) {
    engineCounts.set(r.engine_id, (engineCounts.get(r.engine_id) ?? 0) + 1);
  }

  const displayed = showAll ? flagged : flagged.slice(0, 10);

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-[var(--color-warn)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Censorship Events</h3>
          {flagged.length > 0 && (
            <span className="text-[10px] font-semibold text-[var(--color-warn)] bg-[var(--color-warn)]/10 px-1.5 py-0.5 rounded">
              {flagged.length}
            </span>
          )}
        </div>
        {flagged.length > 10 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
          >
            {showAll ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {showAll ? 'Show less' : `Show all ${flagged.length}`}
          </button>
        )}
      </div>

      {/* Per-engine summary */}
      {engineCounts.size > 0 && (
        <div className="flex gap-2 mb-3">
          {[...engineCounts.entries()].map(([eng, count]) => (
            <div
              key={eng}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--color-warn)]/5 border border-[var(--color-warn)]/15 text-[10px]"
            >
              <Filter className="w-3 h-3 text-[var(--color-warn)]" />
              <span className="font-semibold text-[var(--color-text-secondary)]">Engine {eng.toUpperCase()}</span>
              <span className="text-[var(--color-warn)]">{count} flagged</span>
            </div>
          ))}
        </div>
      )}

      {flagged.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)] py-4 text-center">
          No censorship events detected. Self-hosted engines are never subject to censorship detection.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border-subtle)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--color-surface-tertiary)]/30">
                <th className="text-left font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 py-2 text-[9px]">Engine</th>
                <th className="text-left font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 py-2 text-[9px]">Step</th>
                <th className="text-left font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 py-2 text-[9px]">Agent Role</th>
                <th className="text-left font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 py-2 text-[9px]">Confidence</th>
                <th className="text-left font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 py-2 text-[9px]">Time</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((r, i) => (
                <tr
                  key={r.id ?? i}
                  className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-warn)]/5 transition-colors"
                >
                  <td className="px-3 py-2 font-semibold text-[var(--color-text-primary)]">
                    Engine {r.engine_id.toUpperCase()}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                    Step {r.step_number ?? '?'}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)] truncate max-w-[200px]">
                    {r.agent_role}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-warn)]">
                    {Math.round(r.verdict.confidence * 100)}%
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
