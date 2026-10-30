import { createContext, useContext, type ReactNode } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { ArrowUpRight, RefreshCw, Scale } from 'lucide-react';
import { BevelBox } from '../../components/ui/BevelBox';
import { conservationPath, correctionPath, useConservation, type GateStatus } from './use-conservation';
import './conservation.css';

type GateContextValue = ReturnType<typeof useConservation>;
const GateContext = createContext<GateContextValue | null>(null);
export function useGateContext() {
  const value = useContext(GateContext);
  if (!value) throw new Error('ConservationPage must be rendered inside ConservationLayout.');
  return value;
}
export function GateBadge({ status, children }: { status: GateStatus; children?: ReactNode }) {
  return <span className={`gate-status gate-${status}`}>{children || status}</span>;
}
export function LiveGateStatus() {
  const { data, loading, error, refresh } = useGateContext();
  const failed = data?.records.filter(record => record.result.status === 'fail').length ?? 0;
  return (
    <div className="conservation px-4 pt-4 lg:px-8">
      <BevelBox className="bg-[var(--color-surface-primary)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
          <Link to={conservationPath} className="inline-flex items-center gap-2 font-bold text-[var(--color-gold-400)]"><Scale size={15} />Conservation gate</Link>
          {loading && !data ? <div className="h-3 w-52 bg-[var(--color-gold-400)]/10 animate-pulse" aria-label="Reading live gate status" /> : <>
            <span>Workbook <GateBadge status={error ? 'unknown' : data?.ledger.status || 'unknown'} /></span>
            <span>Reserve <GateBadge status={error ? 'unknown' : data?.reserve.status || 'unknown'} /></span>
            <span>Audit chain <GateBadge status={error || !data ? 'unknown' : !data.chain.valid ? 'fail' : !data.records.length ? 'unverified' : 'pass'} /></span>
            <span>Recorded checks <GateBadge status={error || !data ? 'unknown' : !data.records.length ? 'unverified' : failed ? 'fail' : 'pass'} />{data && ` · ${failed} failed / ${data.records.length} recorded`}</span>
          </>}
          <span className="text-[var(--color-text-muted)]">Continuous condition: unverified</span>
          <Link to={correctionPath} className="ml-auto inline-flex items-center gap-1 font-semibold text-[var(--color-gold-400)] underline underline-offset-4">Read the correction<ArrowUpRight size={13} /></Link>
          <button className="gate-button" disabled={loading} onClick={() => void refresh()}><RefreshCw size={12} />Refresh</button>
        </div>
        <div className="mt-2 text-[10px] text-[var(--color-text-muted)]">As of {data?.asOf || 'not yet available'} · Refreshes every 30 seconds · Finite checks are not a proof of local conservation.</div>
        {error && <p role="alert" className="gate-error mt-3">Live status unavailable: {error}. Previous data, if shown below, is stale.</p>}
      </BevelBox>
    </div>
  );
}
export function ConservationLayout() {
  const state = useConservation();
  return <GateContext.Provider value={state}><LiveGateStatus /><Outlet /></GateContext.Provider>;
}
