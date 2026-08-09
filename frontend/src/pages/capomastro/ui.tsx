/** Shared presentation shells for the Capomastro statement surfaces. */

import type React from 'react';
import { BevelBox } from '../../components/ui/BevelBox';

export function Panel({
  title,
  icon: Icon,
  children,
  className = '',
  action,
}: {
  title: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  className?: string;
  /** Optional control rendered opposite the title, e.g. a refresh button. */
  action?: React.ReactNode;
}) {
  return (
    <BevelBox className={`bg-[var(--color-surface-primary)] p-5 ${className}`}>
      <div className="flex items-center gap-2.5 mb-4">
        {Icon && <Icon className="w-4 h-4 text-[var(--color-gold-400)] flex-shrink-0" />}
        <h2 className="text-sm font-bold tracking-wide text-[var(--color-text-primary)] uppercase">
          {title}
        </h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </BevelBox>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'gold' | 'good' | 'warn' | 'bad';
}) {
  const toneClass =
    tone === 'gold'
      ? 'text-[var(--color-gold-400)]'
      : tone === 'good'
        ? 'text-emerald-400'
        : tone === 'warn'
          ? 'text-amber-400'
          : tone === 'bad'
            ? 'text-red-400'
            : 'text-[var(--color-text-primary)]';
  return (
    <BevelBox className="bg-[var(--color-surface-primary)] p-4">
      <div className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
        {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="text-xs text-[var(--color-text-muted)] mt-1">{sub}</div>}
    </BevelBox>
  );
}
