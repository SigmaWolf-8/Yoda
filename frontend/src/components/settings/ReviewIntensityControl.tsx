import { Gauge } from 'lucide-react';

interface Props {
  value: 'full' | 'medium' | 'light';
  onChange: (v: 'full' | 'medium' | 'light') => void;
}

const OPTIONS = [
  { v: 'full'   as const, label: 'Full',   calls: 13, desc: '3 reviewers per step' },
  { v: 'medium' as const, label: 'Medium', calls: 9,  desc: '2 reviewers per step' },
  { v: 'light'  as const, label: 'Light',  calls: 5,  desc: '1 reviewer per step' },
];

export function ReviewIntensityControl({ value, onChange }: Props) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Gauge className="w-4 h-4 text-[var(--color-gold-400)]" />
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Review Intensity</h3>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map(({ v, label, calls, desc }) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`p-3 rounded-lg text-left border transition-colors ${
              value === v
                ? 'bg-[var(--color-gold-500)]/10 border-[var(--color-gold-500)]/30'
                : 'bg-[var(--color-surface-tertiary)] border-[var(--color-border-default)] hover:border-[var(--color-border-strong)]'
            }`}
          >
            <p className={`text-sm font-semibold ${value === v ? 'text-[var(--color-gold-400)]' : 'text-[var(--color-text-primary)]'}`}>
              {label}
            </p>
            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{calls} calls/task</p>
            <p className="text-sm text-[var(--color-text-muted)]">{desc}</p>
          </button>
        ))}
      </div>
      <p className="text-sm text-[var(--color-text-muted)] mt-2">
        Defaults — Ronin: Full · Yoda: Medium
      </p>
    </div>
  );
}
