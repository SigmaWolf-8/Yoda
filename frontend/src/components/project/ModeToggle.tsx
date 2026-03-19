import { GraduationCap, Swords } from 'lucide-react';

interface Props {
  mode: 'yoda' | 'ronin';
  onChange: (mode: 'yoda' | 'ronin') => void;
  disabled?: boolean;
}

export function ModeToggle({ mode, onChange, disabled }: Props) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-tertiary)] p-0.5">
      <button
        onClick={() => onChange('yoda')}
        disabled={disabled}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
          mode === 'yoda'
            ? 'bg-[var(--color-yoda-500)]/15 text-[var(--color-yoda-400)] shadow-sm'
            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <GraduationCap className="w-3.5 h-3.5" />
        Yoda
      </button>
      <button
        onClick={() => onChange('ronin')}
        disabled={disabled}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
          mode === 'ronin'
            ? 'bg-[var(--color-ronin-500)]/15 text-[var(--color-ronin-400)] shadow-sm'
            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <Swords className="w-3.5 h-3.5" />
        Ronin
      </button>
    </div>
  );
}
