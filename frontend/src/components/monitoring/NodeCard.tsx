import { Server, Hash, Network, RotateCcw, Clock } from 'lucide-react';

interface CrsStats {
  registeredCount: number;
  totalVertices: number;
  utilizationPercent: number;
}

interface Props {
  stats: CrsStats | null;
  error: boolean;
  ternaryAddress?: string;
}

function Row({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--color-border-subtle)] last:border-0">
      <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        {label}
      </div>
      <span className="text-sm font-medium text-[var(--color-text-primary)] font-mono">{value}</span>
    </div>
  );
}

export function NodeCard({ stats, error, ternaryAddress }: Props) {
  const utilPct = stats ? (stats.utilizationPercent * 100).toFixed(6) + '%' : '—';
  const registered = stats ? stats.registeredCount.toLocaleString() : '—';
  const totalNodes = stats ? stats.totalVertices.toLocaleString() : '—';
  const addr = ternaryAddress ?? '—';

  return (
    <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl p-5 h-full">
      <div className="flex items-center gap-2 mb-4">
        <Server className="w-4 h-4 text-[var(--color-gold-400)]" />
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">My Node</h2>
        {error && (
          <span className="ml-auto text-xs text-[var(--color-text-muted)]">CRS unreachable</span>
        )}
      </div>

      <div className="space-y-0">
        <Row icon={Hash}       label="Ternary address"      value={addr}        />
        <Row icon={Network}    label="Network nodes"         value={totalNodes}  />
        <Row icon={Network}    label="Active registrations"  value={registered}  />
        <Row icon={Network}    label="Address utilization"   value={utilPct}     />
        <Row icon={RotateCcw}  label="Next key rotation"     value="—"           />
        <Row icon={Clock}      label="Node uptime"           value="—"           />
      </div>

      <p className="text-[10px] text-[var(--color-text-muted)] mt-3">
        Ternary address, uptime, and key rotation require daemon integration.
      </p>
    </div>
  );
}
