import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Download, FileCheck2, History, Scale, ShieldAlert } from 'lucide-react';
import { usePageHeader } from '../../context/PageHeader';
import { Panel } from './ui';
import { GateBadge, useGateContext } from './ConservationLayout';
import { correctionPath, evaluateGate, gateError, saveGate, verifyGate, type GateInput, type GateKind, type GateRecord, type GateResult } from './use-conservation';

const KINDS: Record<GateKind, { label: string; fields: Array<[string, string]>; description: string }> = {
  boundary: {
    label: 'Boundary balance',
    fields: [['opening', 'Opening balance'], ['closing', 'Closing balance'], ['inflows', 'Inflows'], ['outflows', 'Outflows'], ['adjustments', 'Signed adjustments']],
    description: 'Compare opening + inflows − outflows + adjustments with closing, over one declared system boundary and period.',
  },
  bridge: {
    label: 'NMT / XRP valuation bridge',
    fields: [['nmt', 'NMT quantity'], ['xrp', 'XRP quantity'], ['price', 'Observed price (USD / XRP)']],
    description: 'Compare declared NMT cost basis with XRP valuation under the fixed bridge assumptions. This is not an exchange or a physical measurement.',
  },
  reserve: {
    label: 'Reserve coverage',
    fields: [['reserves', 'Reserves'], ['liabilities', 'Liabilities']],
    description: 'Observe reserve coverage for one named account or block. Both quantities must use the same explicitly declared unit.',
  },
  writeOff: {
    label: 'Submersion write-off observation',
    fields: [['amount', 'Amount (USD)'], ['asset', 'Named asset account']],
    description: 'Preview Dr Submersion Loss / Cr the named asset. Saving records the observation only; it does not post to the historical ledger or erase evidence.',
  },
};
type Draft = Omit<GateInput, 'periodStart' | 'periodEnd'> & { periodStart: string; periodEnd: string };
const blank: Draft = { kind: 'boundary', scope: '', unit: '', periodStart: '', periodEnd: '', evidence: '', note: '', values: {} };

function exportJSON(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ResultView({ result }: { result: GateResult }) {
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3">
      <GateBadge status={result.status} />
      <span className="text-sm font-semibold">{result.classification}</span>
    </div>
    <div className="border-l-2 border-[var(--color-gold-400)] pl-4">
      <div className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">Server-computed residual · exact decimal</div>
      <div className="font-mono text-xl break-all mt-1">{result.residual}</div>
    </div>
    <dl className="space-y-2">
      {result.metrics.map((metric, i) => <div key={i} className="flex flex-wrap justify-between gap-2 border-b border-[var(--color-border-subtle)] pb-2 text-xs"><dt className="text-[var(--color-text-muted)]">{metric.label}</dt><dd className="font-mono break-all">{metric.value} {metric.unit}</dd></div>)}
    </dl>
    <p className="text-xs text-[var(--color-text-muted)]">Global balance in this computation: <GateBadge status={result.globalBalanced === null ? 'unknown' : result.globalBalanced ? 'pass' : 'fail'} />. This does not replace the workbook check.</p>
    <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">Local claim reported by server: {result.localClaim}</p>
    <div className="overflow-x-auto">
      <table className="gate-table"><caption className="text-left text-xs font-semibold mb-2">Supplemental journal preview · no ledger posting</caption><thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead><tbody>
        {result.journal.map((row, i) => <tr key={i}><td>{row.account}</td><td>{row.debit}</td><td>{row.credit}</td></tr>)}
        {!result.journal.length && <tr><td colSpan={3} className="text-[var(--color-text-muted)]">No journal entries returned for this check.</td></tr>}
      </tbody></table>
    </div>
  </div>;
}
function HistoryRecord({ record }: { record: GateRecord }) {
  return <details id={`record-${record.id}`} className="border border-[var(--color-border-default)] p-4 scroll-mt-6">
    <summary className="cursor-pointer text-xs">
      <span className="ml-2"><GateBadge status={record.result.status} /> <span className="mx-2 font-semibold">{KINDS[record.input.kind]?.label || record.input.kind}</span><span className="text-[var(--color-text-muted)]">{record.createdAt}</span></span>
      <span className="block mt-2 break-words text-[var(--color-text-muted)]">{record.input.scope} · {record.input.unit}</span>
    </summary>
    <div className="mt-5 space-y-5">
      <ResultView result={record.result} />
      <dl className="text-xs space-y-2">
        <div><dt className="text-[var(--color-text-muted)]">Observation period</dt><dd>{record.input.periodStart} → {record.input.periodEnd}</dd></div>
        <div><dt className="text-[var(--color-text-muted)]">Evidence reference · operator assertion, not attestation</dt><dd className="break-words whitespace-pre-wrap">{record.input.evidence}</dd></div>
        <div><dt className="text-[var(--color-text-muted)]">Operator note</dt><dd className="break-words whitespace-pre-wrap">{record.input.note}</dd></div>
        {[['Record ID', record.id], ['Previous hash', record.previousHash], ['Record hash', record.hash]].map(([label, value]) => <div key={label}><dt className="text-[var(--color-text-muted)]">{label}</dt><dd className="font-mono break-all">{value}</dd></div>)}
      </dl>
      <details><summary className="text-xs cursor-pointer text-[var(--color-gold-400)]">Inspect complete server record and original inputs</summary><pre className="gate-raw mt-3">{JSON.stringify(record, null, 2)}</pre></details>
      <button type="button" className="gate-button" onClick={() => exportJSON(record, `capomastro-record-${record.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`)}><Download size={13} />Download record JSON</button>
    </div>
  </details>;
}

export function ConservationPage() {
  usePageHeader({ icon: Scale, title: 'Conservation Gate', subtitle: 'Exact finite checks, declared provenance and persistent supplemental audit records' });
  const { data, error, loading, refresh } = useGateContext();
  const { hash } = useLocation();
  const handledHash = useRef('');
  useEffect(() => {
    if (!hash) { handledHash.current = ''; return; }
    if (handledHash.current === hash) return;
    let id: string;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    if (id !== 'audit-history' && !data?.records.some(record => `record-${record.id}` === id)) return;
    const target = document.getElementById(id);
    if (!target) return;
    if (target instanceof HTMLDetailsElement) target.open = true;
    target.scrollIntoView({ block: 'start' });
    handledHash.current = hash;
  }, [hash, data]);
  const [draft, setDraft] = useState<Draft>(blank);
  const [evaluation, setEvaluation] = useState<{ input: GateInput; result: GateResult } | null>(null);
  const [busy, setBusy] = useState<'evaluate' | 'save' | 'verify' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState<GateRecord | null>(null);
  const [verifiedMessage, setVerifiedMessage] = useState<string | null>(null);
  const revision = useRef(0);
  const requestId = useRef<string | null>(null);
  // Clear the result immediately on every edit; a late preview cannot revive it.
  function edit(next: Draft) {
    revision.current += 1;
    requestId.current = null;
    setDraft(next); setEvaluation(null); setConfirmed(false); setSaved(null); setActionError(null);
  }
  function buildInput(): GateInput {
    for (const key of ['scope', 'unit', 'periodStart', 'periodEnd', 'evidence', 'note'] as const) {
      if (!draft[key].trim()) throw new Error(`${key} is required.`);
    }
    for (const [key, label] of KINDS[draft.kind].fields) {
      const value = draft.values[key] || '';
      if (!value.trim()) throw new Error(`${label} is required.`);
      if (key !== 'asset' && !(key === 'adjustments' ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/).test(value)) throw new Error(`${label} must be an exact ${key === 'adjustments' ? 'signed' : 'nonnegative'} decimal string, without commas or exponent notation.`);
    }
    const start = new Date(draft.periodStart), end = new Date(draft.periodEnd);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) throw new Error('Provide valid timestamps with the end at or after the start.');
    return { ...draft, unit: draft.kind === 'bridge' || draft.kind === 'writeOff' ? 'USD' : draft.unit.trim(), periodStart: start.toISOString(), periodEnd: end.toISOString() };
  }
  async function evaluate(event: FormEvent) {
    event.preventDefault();
    const version = revision.current;
    setBusy('evaluate'); setActionError(null); setEvaluation(null); setConfirmed(false);
    try {
      const input = buildInput();
      const result = await evaluateGate(input);
      if (version === revision.current) setEvaluation({ input, result });
    } catch (err) { if (version === revision.current) setActionError(gateError(err)); }
    finally { setBusy(null); }
  }
  async function save() {
    if (!evaluation || !confirmed || !data?.chain.valid || error || loading || saved || busy) return;
    setBusy('save'); setActionError(null);
    try {
      const chain = await verifyGate();
      if (!chain.valid) { void refresh(); throw new Error('The audit chain failed verification. Saving is blocked; inspect chain errors below.'); }
      // A failed network response is retried with exactly the same key and input.
      requestId.current ??= crypto.randomUUID();
      const record = await saveGate(requestId.current, evaluation.input);
      setSaved(record); setConfirmed(false);
      await refresh();
    } catch (err) { setActionError(gateError(err)); }
    finally { setBusy(null); }
  }
  async function verify() {
    setBusy('verify'); setActionError(null); setVerifiedMessage(null);
    try {
      const chain = await verifyGate();
      setVerifiedMessage(`${chain.valid ? 'Chain verification passed' : 'Chain verification FAILED'} · ${chain.count} records. ${chain.errors.join(' ')}`);
      await refresh();
    } catch (err) { setActionError(gateError(err)); }
    finally { setBusy(null); }
  }
  const locked = busy === 'save';
  return <div className="conservation p-4 lg:p-8 max-w-7xl mx-auto space-y-6 animate-fade-in">
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-5">
      <div><p className="text-[10px] tracking-[.2em] uppercase text-[var(--color-gold-400)] mb-2">Capomastro / Supplemental audit</p><h1 className="text-2xl font-bold">A balance is a check. Not a proof.</h1><p className="text-xs text-[var(--color-text-muted)] max-w-2xl mt-3 leading-relaxed">Read the workbook, declare the boundary, inspect the computation, then deliberately record the observation. No minting, transfers, financial mutations or changes to sealed historical documents.</p></div>
      <Link className="gate-button gate-primary shrink-0" to={correctionPath}>Read Divergence–Flux Gate corrections</Link>
    </div>

    <Panel title="01 / Actual workbook checks" icon={Scale}>
      {loading && !data ? <div className="space-y-3 animate-pulse" aria-label="Loading workbook checks"><div className="h-5 w-2/3 bg-[var(--color-gold-400)]/10" /><div className="h-12 bg-[var(--color-gold-400)]/5" /></div> : !data ? <p className="text-xs text-[var(--color-text-muted)]">Unverified. No server computation is available. Use Refresh above to retry.</p> : <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {([['Ledger balance', data.ledger], ['Reserve check', data.reserve]] as const).map(([label, check]) => <div key={label} className="space-y-2">
          <div className="flex justify-between gap-3 text-sm font-semibold"><h3>{label}</h3><GateBadge status={error ? 'unknown' : check.status} /></div>
          <p className="font-mono text-sm break-all">Residual: {check.residual ?? 'not available'}{error ? ' (stale)' : ''}</p>
          <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">{check.message}</p>
          <p className="text-[11px] text-[var(--color-text-muted)] break-words">Source: {check.source}</p>
        </div>)}
      </div>}
      <p className="text-[10px] text-[var(--color-text-muted)] mt-5 border-t border-[var(--color-border-subtle)] pt-3">Computed by the server from existing workbook data. No passed state or balance is supplied by this interface. As of {data?.asOf || 'unavailable'}.</p>
    </Panel>

    <div className="border-l-2 border-[var(--color-gold-400)] pl-5 space-y-2 text-xs text-[var(--color-text-muted)]">
      <p><strong className="text-[var(--color-text-primary)]">Continuous local condition: always unverified.</strong> {data?.local.message || 'Finite observations cannot establish a continuous pointwise condition.'}</p>
      <p><strong className="text-[var(--color-text-primary)]">Physical/system boundary: unknown.</strong> {data?.boundary.message || 'No independent boundary or physical flux attestation is supplied.'}</p>
      <p>Saved finite checks below are scoped observations, not a substitute for either claim. Global cancellation can conceal local nonzero residuals.</p>
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_1fr] gap-6 items-start">
      <Panel title="02 / Declare an observation" icon={FileCheck2}>
        <form onSubmit={evaluate} className="space-y-5">
          <fieldset disabled={locked} className="space-y-5">
            <label className="gate-field">Check type<select className="gate-input" value={draft.kind} onChange={e => { const kind = e.target.value as GateKind; edit({ ...draft, kind, values: {}, unit: kind === 'bridge' || kind === 'writeOff' ? 'USD' : '' }); }}>
              {Object.entries(KINDS).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}
            </select></label>
            <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">{KINDS[draft.kind].description}</p>
            <label className="gate-field">Scope / system boundary / reserve account<input required className="gate-input" value={draft.scope} onChange={e => edit({ ...draft, scope: e.target.value })} /></label>
            <label className="gate-field">Unit / currency (one shared basis)<input required readOnly={draft.kind === 'bridge' || draft.kind === 'writeOff'} className="gate-input" value={draft.unit} onChange={e => edit({ ...draft, unit: e.target.value })} /></label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="gate-field">Period start · local time<input required type="datetime-local" step="1" className="gate-input" value={draft.periodStart} onChange={e => edit({ ...draft, periodStart: e.target.value })} /></label>
              <label className="gate-field">Period end · local time<input required type="datetime-local" step="1" className="gate-input" value={draft.periodEnd} onChange={e => edit({ ...draft, periodEnd: e.target.value })} /></label>
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)]">Timestamps convert to ISO 8601 UTC. Amounts remain exact decimal strings, unchanged.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {KINDS[draft.kind].fields.map(([key, label]) => <label key={key} className="gate-field">{label}<input required type="text" inputMode={key === 'asset' ? 'text' : 'decimal'} spellCheck={false} pattern={key === 'asset' ? undefined : key === 'adjustments' ? '-?[0-9]+(\\.[0-9]+)?' : '[0-9]+(\\.[0-9]+)?'} className="gate-input font-mono" value={draft.values[key] || ''} onChange={e => edit({ ...draft, values: { ...draft.values, [key]: e.target.value } })} /></label>)}
            </div>
            <label className="gate-field">Evidence / raw source reference · required<textarea required rows={3} className="gate-input" value={draft.evidence} onChange={e => edit({ ...draft, evidence: e.target.value })} /><span className="text-[10px]">Identify the workbook sheet/cells, statement, meter record or other source and its date. This is your assertion, not independent attestation. No meter feed is inferred.</span></label>
            <label className="gate-field">Operator note · required<textarea required rows={2} className="gate-input" value={draft.note} onChange={e => edit({ ...draft, note: e.target.value })} /></label>
          </fieldset>
          <button type="submit" disabled={!!busy} className="gate-button gate-primary w-full">{busy === 'evaluate' ? 'Computing exact preview…' : 'Evaluate without saving'}</button>
        </form>
      </Panel>
      <div className="space-y-6">
        <Panel title="03 / Inspect, then record" icon={ShieldAlert}>
          {!evaluation ? <div className="py-8 text-xs text-[var(--color-text-muted)] leading-relaxed"><div className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">{busy === 'evaluate' ? 'Waiting for the server computation' : 'No evaluated observation'}</div>Complete the declaration and evaluate it. Computed metrics and journal entries appear here before anything is saved. Editing any input invalidates the preview.{busy === 'evaluate' && <div className="animate-pulse h-16 mt-4 bg-[var(--color-gold-400)]/10" />}</div> : <>
            <ResultView result={evaluation.result} />
            <div className="mt-5 border-t border-[var(--color-border-subtle)] pt-4 space-y-4">
              <p className="text-xs text-[var(--color-text-muted)]">{evaluation.result.status === 'fail' ? 'This is a FAILED observation. It can be saved as a failure, never as proof.' : 'A passing finite computation is not a continuous physical conservation proof.'}</p>
              <label className="flex items-start gap-3 text-xs leading-relaxed"><input type="checkbox" className="mt-1 accent-[var(--color-gold-400)]" disabled={!!busy || !!saved} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>I inspected the inputs, residual and journal. Save this supplemental audit observation with my stated provenance. This does not amend the sealed ledger.</span></label>
              <button type="button" disabled={!confirmed || !!busy || !data?.chain.valid || !!error || loading || !!saved} onClick={() => void save()} className="gate-button gate-primary w-full">{busy === 'save' ? 'Verifying chain and saving…' : saved ? 'Audit record saved' : `Save / seal ${evaluation.result.status === 'fail' ? 'FAILED observation' : 'audit observation'}`}</button>
              {(!data?.chain.valid || error) && <p className="text-xs text-[#ef997c]">Saving is blocked until a fresh status and valid audit chain are available.</p>}
              {saved && <div role="status" className="text-xs space-y-2"><p>Server saved record <span className="font-mono break-all">{saved.id}</span>. The persisted history reloads below.</p><button className="gate-button" onClick={() => exportJSON(saved, 'capomastro-saved-record.json')}><Download size={12} />Download saved response</button></div>}
            </div>
          </>}
          {actionError && <p className="gate-error mt-4" role="alert">{actionError}</p>}
        </Panel>
        <Panel title="Bridge assumptions & interpretation">
          <div className="text-xs leading-relaxed text-[var(--color-text-muted)] space-y-3">
            <p>Fixed modeling assumptions: <strong>1 NMT = 1 kWh</strong>; electricity <strong>0.10 USD/NMT</strong> plus hardware <strong>0.02 USD/NMT</strong>, giving a declared cost basis of <strong>0.12 USD/NMT</strong>. These are assumptions, not live prices or attested energy deliveries.</p>
            <p>The stated ratio of <strong>200000 NMT per XRP</strong> therefore implies <strong>24000 USD/XRP</strong>. It is not a market quote.</p>
            <p>Use the correct denominator: observed XRP value as a percentage of NMT basis is (XRP × observed price) / (NMT × 0.12) × 100; the relative premium or shortfall subtracts 100 percentage points from that percentage. Server metrics, not browser arithmetic, supply evaluated values. A zero basis makes that ratio undefined.</p>
            <p><strong className="text-[var(--color-gold-400)]">Delta zero means valuation parity only — not lossless physics.</strong> Recording a write-off never erases the original evidence.</p>
          </div>
        </Panel>
      </div>
    </div>

    <div id="audit-history" className="scroll-mt-6">
    <Panel title="04 / Persistent audit history" icon={History} action={<button className="gate-button" disabled={!!busy} onClick={() => void verify()}>{busy === 'verify' ? 'Verifying…' : 'Verify hash chain'}</button>}>
      <div className="text-xs text-[var(--color-text-muted)] space-y-2 mb-5">
        <p>Chain integrity: <GateBadge status={error || !data ? 'unknown' : !data.chain.valid ? 'fail' : data.records.length ? 'pass' : 'unverified'} /> · {data?.chain.count ?? 'Unknown'} saved records · Server order: oldest first.</p>
        <p>Hash-chain integrity covers stored record linkage, not the truth of operator evidence. An empty chain is not verified observation history.</p>
        {data?.chain.head && <p className="font-mono break-all">Head: {data.chain.head}</p>}
        {data?.chain.errors.map((message, i) => <p key={i} className="gate-error">{message}</p>)}
        {verifiedMessage && <p role="status" className="border-l-2 border-[var(--color-gold-400)] pl-3">{verifiedMessage}</p>}
      </div>
      {!data?.records.length ? <div className="border border-dashed border-[var(--color-border-default)] p-6 text-xs text-[var(--color-text-muted)]"><h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">No recorded observations available · unverified</h3>{data ? 'Nothing has been invented or pre-populated. Evaluate an observation above, inspect it, and explicitly save it to begin the persistent audit trail.' : 'History cannot be read until the server responds. Refresh to retry.'}</div> : <div className="space-y-3">{data.records.map(record => <HistoryRecord key={record.id} record={record} />)}</div>}
      {data && <div className="mt-5 flex flex-wrap items-center gap-3"><button className="gate-button" onClick={() => exportJSON(data, 'capomastro-conservation-server-response.json')}><Download size={13} />Download full server response</button><span className="text-[10px] text-[var(--color-text-muted)]">{error ? 'Last received response · stale' : `Server snapshot: ${data.asOf}`}</span></div>}
      {!!data?.notes.length && <ul className="mt-4 list-disc pl-4 text-xs text-[var(--color-text-muted)] space-y-2">{data.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>}
    </Panel>
    </div>
  </div>;
}
