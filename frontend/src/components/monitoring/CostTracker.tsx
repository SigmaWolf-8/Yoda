import { DollarSign, Coins } from 'lucide-react';
import type { EngineConfig } from '../../types';

interface Props {
  engines: EngineConfig[];
}

export function CostTracker({ engines }: Props) {
  const tracked = engines.filter((e) => e.hosting_mode !== 'self_hosted');

  if (!tracked.length) {
    return (
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] p-5">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="w-4 h-4 text-[var(--color-gold-400)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Cost Tracking</h3>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          All engines are self-hosted — no per-token costs to track.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] p-5">
      <div className="flex items-center gap-2 mb-4">
        <DollarSign className="w-4 h-4 text-[var(--color-gold-400)]" />
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Cost Tracking</h3>
      </div>

      <div className="space-y-3">
        {tracked.map((eng) => (
          <div
            key={eng.slot}
            className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-[var(--color-surface-tertiary)]/30 border border-[var(--color-border-subtle)]"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                Engine {eng.slot.toUpperCase()}
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)]">
                {eng.hosting_mode === 'commercial' ? 'Commercial' : 'Free Tier'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              {eng.daily_messages_limit != null && (
                <div className="flex items-center gap-1 text-[var(--color-text-tertiary)]">
                  <Coins className="w-3 h-3" />
                  <span>
                    {eng.daily_messages_used ?? 0} / {eng.daily_messages_limit}
                  </span>
                </div>
              )}
              <span className={`font-medium ${
                eng.hosting_mode === 'commercial' ? 'text-[var(--color-gold-400)]' : 'text-[var(--color-ok)]'
              }`}>
                {eng.hosting_mode === 'commercial' ? 'Per-token billing' : '$0 (rate-limited)'}
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[9px] text-[var(--color-text-muted)] mt-3">
        Detailed per-token cost tracking requires the backend cost aggregation endpoint (coming in Task List B).
      </p>
    </div>
  );
}
