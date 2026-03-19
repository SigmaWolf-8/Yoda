import { ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import { useValidateDiversity } from '../../api/hooks';
import type { DiversityValidation, DiversityStatus } from '../../types';

const STATUS_STYLES: Record<DiversityStatus, string> = {
  green:  'bg-[var(--color-ok)]/10 text-[var(--color-ok)] border-[var(--color-ok)]/20',
  yellow: 'bg-[var(--color-warn)]/10 text-[var(--color-warn)] border-[var(--color-warn)]/20',
  red:    'bg-[var(--color-err)]/10 text-[var(--color-err)] border-[var(--color-err)]/20',
};

export function DiversityValidator() {
  const validate = useValidateDiversity();
  const result = validate.data as DiversityValidation | undefined;

  return (
    <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[var(--color-gold-400)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Diversity Check</h3>
        </div>
        <button
          onClick={() => validate.mutate()}
          disabled={validate.isPending}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] border border-[var(--color-border-default)] hover:border-[var(--color-border-strong)] disabled:opacity-50 transition-colors"
        >
          {validate.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
          Validate Diversity
        </button>
      </div>

      {result && (
        <div className="space-y-2">
          {result.engines.map((eng) => (
            <div
              key={eng.slot}
              className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-medium ${STATUS_STYLES[eng.status]}`}
            >
              <span>Engine {eng.slot.toUpperCase()}: {eng.model_name || '(not configured)'}</span>
              <span className="uppercase">{eng.family}</span>
            </div>
          ))}

          <div className={`mt-3 flex items-start gap-2 text-xs ${result.valid ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'}`}>
            {result.valid
              ? <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            }
            <span>{result.message}</span>
          </div>
        </div>
      )}

      {!result && !validate.isPending && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Click "Validate Diversity" to check that your three engines are from distinct model families.
        </p>
      )}
    </div>
  );
}
