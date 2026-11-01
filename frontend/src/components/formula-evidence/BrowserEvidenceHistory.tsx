import { useState } from 'react';
import type { SavedBrowserRun } from '../../lib/browser-formula-history';
import type { LocalAttempt } from './useBrowserEvidenceHistory';

const buttonClass = 'inline-flex items-center justify-center gap-2 border border-[var(--color-border-default)] px-3 py-2 text-xs font-semibold hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
const mutedClass = 'text-[var(--color-text-muted)]';

function downloadHistoryJson(payload: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Json({ value }: { value: unknown }) {
  return <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{JSON.stringify(value, null, 2)}</pre>;
}

export function AttemptStorage({ attempts, retry }: { attempts: LocalAttempt[]; retry: (id: string) => void }) {
  if (!attempts.length) return null;
  const unsaved = attempts.filter(attempt => attempt.storage !== 'saved').length;
  return <section aria-label="Local attempt storage" className="border border-[var(--color-border-default)] p-3 space-y-3 text-xs">
    <h3 className="font-semibold">Local attempts · {attempts.length} completed · {unsaved} not confirmed saved</h3>
    {!!unsaved && <p className="border-l-2 border-[var(--color-gold-400)] pl-3">Unsaved attempts, including failed saves, are view-local and not durable. Export current evidence JSON before leaving, reloading or changing accounts. Retry storage does not rerun the calculation.</p>}
    <ul className="space-y-3">
      {[...attempts].reverse().map(attempt => <li key={attempt.submission.submissionId} className="space-y-1">
        <p className="font-semibold">{attempt.submission.record.title}</p>
        <p>Calculation: {attempt.submission.record.status}{attempt.submission.record.kind === 'daemon-execution' ? ' · client reported; no daemon receipt' : ''}</p>
        <p role="status">Storage: {attempt.storage === 'saved' ? `Saved · server received ${attempt.saved?.receivedAt}` : attempt.storage === 'saving' ? 'Saving… not yet confirmed' : attempt.storage === 'failed' ? 'Save failed · not confirmed saved' : attempt.storage === 'unprepared' ? 'Unsaved · submission could not be prepared' : 'Unsaved · no credential at execution'}</p>
        <p className={`font-mono break-words ${mutedClass}`}>Submission {attempt.submission.submissionId}</p>
        {attempt.error && <p role="alert">{attempt.error}</p>}
        {attempt.storage === 'failed' && <button type="button" className={buttonClass} onClick={() => retry(attempt.submission.submissionId)}>Retry save</button>}
        {attempt.storage === 'unsigned' && <p><a className="underline" href="/login">Sign in</a> for future runs. This attempt will not be attributed to a later account.</p>}
      </li>)}
    </ul>
  </section>;
}

function comparisonFields(run: SavedBrowserRun): Record<string, unknown> {
  const record = run.submission.record;
  return {
    'Claim snapshot (not current registry)': run.submission.claim,
    'Inputs': record.inputs,
    'Implementation version': record.implementationVersion,
    'Test version': record.testVersion,
    'Assumptions': record.assumptions,
    'Expected': record.expected,
    'Observed': record.observed,
    'Calculation status': record.status,
    'Errors': record.error,
    'Tolerance': record.tolerance,
    'Limitation': record.limitation,
    'Client executedAt': record.executedAt,
    'Server receivedAt': run.receivedAt,
    'Execution provenance': { kind: record.kind, executionLocation: record.executionLocation, traceId: record.traceId, provenance: run.provenance, daemonReceipt: run.daemonReceipt },
    'Complete immutable saved payload': run,
  };
}

interface Props {
  runs: SavedBrowserRun[];
  signedIn: boolean;
  loading: boolean;
  error: string | null;
  nextCursor: string | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  retryLoad: () => Promise<void>;
}

export function BrowserEvidenceHistory({ runs, signedIn, loading, error, nextCursor, refresh, loadMore, retryLoad }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const chosen = runs.filter(run => selected.includes(run.id));
  function exportRuns(selection: boolean) {
    setExportError(null);
    try {
      downloadHistoryJson({
        exportedAt: new Date().toISOString(),
        scope: selection ? 'Selected saved records from loaded pages only; not complete account history.' : 'Loaded saved pages only; not complete account history.',
        morePagesAvailable: !!nextCursor,
        provenance: 'Client-submitted-unverified. Storage acknowledgment is not mathematical verification or a daemon receipt.',
        runs: selection ? chosen : runs,
      }, 'yoda-saved-browser-history');
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : 'Export failed. Retry export.');
    }
  }
  return <section aria-label="Saved browser run history" className="border-t border-[var(--color-border-default)] pt-5 space-y-3 text-xs">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-sm font-semibold">Saved browser run history</h3><p className={`mt-1 ${mutedClass}`}>Private to the authenticated owner · append-only snapshots</p></div>
      <button type="button" className={buttonClass} disabled={!signedIn || loading} onClick={() => void refresh()}>{loading ? 'Loading history…' : 'Refresh history'}</button>
    </div>
    <p className="leading-relaxed">Saved provenance: <code>client-submitted-unverified</code>. A server receipt records storage, not execution verification. Daemon evidence remains client reported unavailable; no daemon receipts. Historical success never certifies the current registry.</p>
    {!signedIn && <p className="border border-[var(--color-border-default)] p-3"><a href="/login" className="underline">Sign in to read private history</a>. Local checks and JSON export remain available.</p>}
    {loading && <div role="status" className="space-y-2 border border-[var(--color-border-default)] p-3"><p>Loading private snapshots…</p><div className="h-3 w-3/4 bg-[var(--color-border-default)]" /><div className="h-3 w-1/2 bg-[var(--color-border-default)]" /></div>}
    {error && <div role="alert" className="border border-current p-3 space-y-2"><p>{error}</p><button type="button" className={buttonClass} disabled={loading} onClick={() => void retryLoad()}>Retry history request</button></div>}
    {signedIn && !loading && !error && !runs.length && <p className="border border-[var(--color-border-default)] p-4">No saved browser runs loaded. Run a local check while signed in to submit its terminal result, including failure or unavailable outcomes.</p>}
    {!!runs.length && <>
      <div className="flex flex-wrap items-center gap-2">
        <span className={mutedClass}>{runs.length} loaded · {chosen.length} selected · {nextCursor ? 'more pages available' : 'end of loaded history'}</span>
        <button type="button" className={buttonClass} onClick={() => exportRuns(false)}>Export loaded history JSON</button>
        <button type="button" className={buttonClass} disabled={!chosen.length} onClick={() => exportRuns(true)}>Export selected JSON</button>
        <button type="button" className={buttonClass} disabled={chosen.length !== 2} onClick={() => setComparing(value => !value)}>{comparing ? 'Hide comparison' : 'Compare two selected runs'}</button>
        <button type="button" className={buttonClass} disabled={!selected.length} onClick={() => { setSelected([]); setComparing(false); }}>Clear selection</button>
      </div>
      <p className={mutedClass}>Exports contain complete saved payloads from loaded pages only, never an implied full-account archive. Select exactly two snapshots to compare, including across registry versions.</p>
      {exportError && <p role="alert">Export error: {exportError} Retry the export action.</p>}
      <ul className="space-y-2">
        {runs.map(run => <li key={run.id} className="border border-[var(--color-border-default)] p-3 space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5 accent-[var(--color-gold-400)]" checked={selected.includes(run.id)} onChange={event => { setSelected(old => event.target.checked ? [...old, run.id] : old.filter(id => id !== run.id)); setComparing(false); }} />
            <span className="min-w-0"><span className="font-semibold">{run.submission.record.title}</span><span className="block mt-1">Calculation: {run.submission.record.status} · Storage: saved</span><span className={`block font-mono break-words mt-1 ${mutedClass}`}>{run.id}</span></span>
          </label>
          <p className={mutedClass}>Client executedAt: {run.submission.record.executedAt ?? 'Not executed / unavailable'}<br />Server receivedAt: {run.receivedAt}</p>
          <p className={`font-mono break-words ${mutedClass}`}>{run.submission.record.implementationVersion} · {run.submission.record.testVersion}</p>
          <details><summary className="cursor-pointer font-semibold">Complete saved snapshot · inputs, versions and provenance</summary><Json value={run} /></details>
        </li>)}
      </ul>
      {comparing && chosen.length === 2 && <section aria-label="Run comparison" className="space-y-3 border-l-2 border-[var(--color-gold-400)] pl-3">
        <h4 className="font-semibold">Snapshot comparison · not a current-version verification</h4>
        {Object.entries(comparisonFields(chosen[0])).map(([label, left]) => {
          const right = comparisonFields(chosen[1])[label];
          return <div key={label} className="border-t border-[var(--color-border-default)] pt-2">
            <h5 className="font-semibold">{label} · {JSON.stringify(left) === JSON.stringify(right) ? 'same' : 'different'}</h5>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="min-w-0"><p className={`break-words ${mutedClass}`}>Run {chosen[0].id}</p><Json value={left} /></div>
              <div className="min-w-0"><p className={`break-words ${mutedClass}`}>Run {chosen[1].id}</p><Json value={right} /></div>
            </div>
          </div>;
        })}
      </section>}
      {nextCursor && <button type="button" className={buttonClass} disabled={loading} onClick={() => void loadMore()}>Load more saved runs</button>}
    </>}
  </section>;
}
