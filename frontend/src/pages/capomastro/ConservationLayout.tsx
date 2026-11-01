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
  const failures = data?.records.filter(record => record.result.status === 'fail') ?? [];
  const failed = failures.length;
  const firstFailed = failures[0];
  return (
    <div className="conservation px-4 pt-4 lg:px-8">
      <BevelBox className="bg-[var(--color-surface-primary)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
          <Link to={conservationPath} className="inline-flex items-center gap-2 font-bold text-[var(--color-gold-400)]"><Scale size={15} />Conservation gate</Link>
          {loading && !data ? <div className="h-3 w-52 bg-[var(--color-gold-400)]/10 animate-pulse" aria-label="Reading live gate status" /> : <>
            <span>Workbook <GateBadge status={error ? 'unknown' : data?.ledger.status || 'unknown'} /></span>
            <span>Reserve <GateBadge status={error ? 'unknown' : data?.reserve.status || 'unknown'} /></span>
            <span>Audit chain <GateBadge status={error || !data ? 'unknown' : !data.chain.valid ? 'fail' : !data.records.length ? 'unverified' : 'pass'} /></span>
            <span>Saved historical observations {firstFailed ? <Link to={`${conservationPath}#record-${encodeURIComponent(firstFailed.id)}`} className="underline underline-offset-4" aria-label="Inspect first failed saved observation"><GateBadge status={firstFailed.result.status}>{error ? 'fail · stale snapshot' : 'fail'}</GateBadge></Link> : <GateBadge status={error || !data ? 'unknown' : !data.records.length ? 'unverified' : 'pass'} />}{data && ` · ${failed} failed / ${data.records.length} saved${error ? ' (stale)' : ''}`}</span>
          </>}
          <span className="text-[var(--color-text-muted)]">Continuous condition: unverified</span>
          <Link to={correctionPath} className="ml-auto inline-flex items-center gap-1 font-semibold text-[var(--color-gold-400)] underline underline-offset-4">Read the correction<ArrowUpRight size={13} /></Link>
          <button className="gate-button" disabled={loading} onClick={() => void refresh()}><RefreshCw size={12} />Refresh</button>
        </div>
        {firstFailed && <p className="mt-3 text-xs text-[var(--color-text-muted)] break-words">
          {error ? 'Last received historical failure (stale)' : 'First failed saved observation'}: <Link className="underline underline-offset-4 text-[var(--color-gold-400)]" to={`${conservationPath}#record-${encodeURIComponent(firstFailed.id)}`}>{firstFailed.input.scope}</Link>
          {' · '}{firstFailed.result.classification}{' · Residual: '}{firstFailed.result.residual} {firstFailed.input.unit}.
          {firstFailed.input.note && <> Operator note: {firstFailed.input.note}.</>}
          {' '}This saved observation is not the live workbook or reserve status.
          {failed > 1 && <> <Link to={`${conservationPath}#audit-history`} className="underline underline-offset-4">{failed - 1} additional failed saved {failed === 2 ? 'observation' : 'observations'} · inspect history</Link>.</>}
        </p>}
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
