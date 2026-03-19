import { useState } from 'react';
import { ShieldCheck, AlertTriangle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useValidateDiversity } from '../../api/hooks';
import type { DiversityValidation, DiversityStatus } from '../../types';

const STATUS_STYLES: Record<DiversityStatus, string> = {
  green:  'text-[var(--color-ok)]   bg-[var(--color-ok)]/10   border-[var(--color-ok)]/20',
  yellow: 'text-[var(--color-warn)] bg-[var(--color-warn)]/10 border-[var(--color-warn)]/20',
  red:    'text-[var(--color-err)]  bg-[var(--color-err)]/10  border-[var(--color-err)]/20',
};

export function DiversityValidator() {
  const validate = useValidateDiversity();
  const result = validate.data as DiversityValidation | undefined;
  const [open, setOpen] = useState(false);

  function handleCheck() {
    validate.mutate();
    setOpen(true);
  }

  return (
    <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl overflow-hidden">
      {/* Compact header row */}
      <div className="flex items-center gap-2 px-4 py-3">
        <ShieldCheck className="w-4 h-4 text-[var(--color-gold-400)] flex-shrink-0" />
        <span className="text-sm font-medium text-[var(--color-text-primary)] flex-1">Diversity Check</span>

        {/* Quick status pill when a result exists */}
        {result && !open && (
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
            result.valid ? STATUS_STYLES.green : STATUS_STYLES.red
          }`}>
            {result.valid ? 'Pass' : 'Fail'}
          </span>
        )}

        <button
          onClick={handleCheck}
          disabled={validate.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] border border-[var(--color-border-default)] hover:border-[var(--color-border-strong)] disabled:opacity-50 transition-colors"
        >
          {validate.isPending
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <ShieldCheck className="w-3 h-3" />
          }
          {validate.isPending ? 'Checking…' : 'Check'}
        </button>

        {/* Expand/collapse toggle — only shown when a result exists */}
        {result && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            aria-label={open ? 'Collapse results' : 'Expand results'}
          >
            {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Expandable results panel */}
      {open && result && (
        <div className="px-4 pb-4 border-t border-[var(--color-border-subtle)] pt-3 space-y-2">
          {result.engines.map((eng) => (
            <div
              key={eng.slot}
              className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-medium ${STATUS_STYLES[eng.status]}`}
            >
              <span>Engine {eng.slot.toUpperCase()}: {eng.model_name || '(not configured)'}</span>
              <span className="uppercase opacity-70">{eng.family}</span>
            </div>
          ))}
          <div className={`flex items-start gap-2 text-xs pt-1 ${result.valid ? 'text-[var(--color-ok)]' : 'text-[var(--color-err)]'}`}>
            {result.valid
              ? <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            }
            <span>{result.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
