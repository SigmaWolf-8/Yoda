import { TreePine } from 'lucide-react';

interface Props {
  value: number | null; // null = unlimited
  onChange: (v: number | null) => void;
}

export function DecompositionBudgetControl({ value, onChange }: Props) {
  const unlimited = value === null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <TreePine className="w-4 h-4 text-[var(--color-gold-400)]" />
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Decomposition Budget</h3>
      </div>
      <div className="flex items-center gap-4">
        <input
          type="number"
          min={1}
          max={500}
          value={unlimited ? '' : value}
          disabled={unlimited}
          onChange={(e) => onChange(e.target.value ? parseInt(e.target.value, 10) : 30)}
          placeholder="30"
          className="w-24 px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] disabled:opacity-40 focus:outline-none focus:border-[var(--color-gold-500)] transition-colors"
        />
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer">
          <input
            type="checkbox"
            checked={unlimited}
            onChange={(e) => onChange(e.target.checked ? null : 30)}
            className="w-4 h-4 rounded border-[var(--color-border-default)] bg-[var(--color-surface-tertiary)] accent-[var(--color-gold-500)]"
          />
          Unlimited
        </label>
      </div>
      <p className="text-sm text-[var(--color-text-muted)] mt-2">
        Max atomic tasks per decomposition. Exceeding this asks for approval before proceeding.
      </p>
    </div>
  );
}
