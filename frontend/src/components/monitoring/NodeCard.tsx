import { Server, Hash, Network, Layers, Users, Activity } from 'lucide-react';
import { formatTernaryAddress } from '../../utils/ternary';
import { BevelBox } from '../ui/BevelBox';

interface CrsStats {
  registeredCount: number;
  totalVertices: number;
  utilizationPercent: number;
  neighborsPerCube?: number;
  dimensions?: number;
}

interface FtsStats {
  up: number;
  suspect: number;
  down: number;
  recovering: number;
  total: number;
}

interface Props {
  stats: CrsStats | null;
  fts: FtsStats | null;
  error: boolean;
  nodeAddress?: string;
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

function FtsBadge({ label, count, active }: { label: string; count: number; active: boolean }) {
  return (
    <div className={`flex flex-col items-center px-2.5 py-1.5 rounded-lg border text-center min-w-0 flex-1 ${
      active
        ? 'bg-sky-400/8 border-sky-400/25 text-sky-300'
        : 'bg-[var(--color-surface-tertiary)] border-[var(--color-border-subtle)] text-[var(--color-text-muted)]'
    }`}>
      <span className="text-base font-semibold font-mono leading-none">{count}</span>
      <span className="text-[9px] uppercase tracking-wider mt-0.5 leading-none opacity-80">{label}</span>
    </div>
  );
}

export function NodeCard({ stats, fts, error, nodeAddress }: Props) {
  const utilPct  = stats ? (stats.utilizationPercent * 100).toFixed(6) + '%' : '—';
  const registered = stats ? stats.registeredCount.toLocaleString() : '—';
  const totalNodes = stats ? stats.totalVertices.toLocaleString() : '—';
  const dimensions  = stats?.dimensions ?? 13;
  const neighbors   = stats?.neighborsPerCube ?? 26;
  const addr = nodeAddress ? formatTernaryAddress(nodeAddress) : '—';

  return (
    <BevelBox className="bg-[var(--color-surface-secondary)] p-5 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <Server className="w-4 h-4 text-[var(--color-gold-400)]" />
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">My Node</h2>
        {error && (
          <span className="ml-auto text-xs text-[var(--color-text-muted)]">CRS unreachable</span>
        )}
      </div>

      <div className="space-y-0 flex-1">
        <Row icon={Hash}    label="Ternary address"      value={addr}        />
        <Row icon={Layers}  label="Dimensions"            value={String(dimensions)} />
        <Row icon={Users}   label="Neighbors per cube"    value={String(neighbors)}  />
        <Row icon={Network} label="Network capacity"      value={totalNodes}  />
        <Row icon={Network} label="Active registrations"  value={registered}  />
        <Row icon={Network} label="Address utilization"   value={utilPct}     />
      </div>

      {/* FTS status */}
      <div className="mt-4 pt-3 border-t border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-1.5 mb-2">
          <Activity className="w-3 h-3 text-[var(--color-text-muted)]" />
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold">
            Fault Tolerance
          </span>
        </div>
        {fts ? (
          <div className="flex gap-1.5">
            <FtsBadge label="Up"         count={fts.up}         active={fts.up > 0}         />
            <FtsBadge label="Suspect"    count={fts.suspect}    active={fts.suspect > 0}    />
            <FtsBadge label="Down"       count={fts.down}       active={fts.down > 0}       />
            <FtsBadge label="Recovering" count={fts.recovering} active={fts.recovering > 0} />
          </div>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">
            {error ? 'FTS unavailable' : 'Loading…'}
          </p>
        )}
      </div>
    </BevelBox>
  );
}
