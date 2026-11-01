import { useId, useState } from 'react';
import { Download, ExternalLink, Play, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { evidenceError, useExecuteFormula, useFormulaCatalog, useFormulaRuns } from './use-formula-evidence';
import type { EvidenceFormula, FormulaEvidenceRun } from './use-formula-evidence';
import './formula-evidence.css';

function display(value: unknown) {
  return value === undefined ? 'Not supplied' : JSON.stringify(value, null, 2);
}
function exportRecord(run: FormulaEvidenceRun) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `formula-evidence-${run.id}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function RunDetail({ run }: { run: FormulaEvidenceRun }) {
  const reportUrl = run.result.outputs.report_url;
  const hasReport = typeof reportUrl === 'string' &&
    /^\/api\/formula-evidence\/runs\/[a-f0-9-]+\/report$/i.test(reportUrl);
  return <div className="fe-detail">
    <div className="flex flex-wrap justify-between items-center gap-3">
      <h3>Recorded result · {run.formula_id}</h3>
      <strong className={run.result.status === 'pass' ? 'fe-pass' : 'fe-fail'}>
        {run.result.status === 'pass' ? 'PASS' : 'FAIL'} · scoped checks only
      </strong>
    </div>
    <p className="fe-muted">Method: {run.result.method}</p>
    <p className="fe-muted">Scope: {run.result.scope}</p>
    <dl className="fe-metadata">
      <div><dt>Run ID</dt><dd>{run.id}</dd></div>
      <div><dt>Executed at (server timestamp)</dt><dd>{run.executed_at}</dd></div>
      <div><dt>Source SHA-256</dt><dd>{run.source_sha256 || 'Not supplied'}</dd></div>
      <div><dt>Evidence SHA-256</dt><dd>{run.evidence_sha256 || 'Not supplied'}</dd></div>
    </dl>
    <details><summary className="cursor-pointer text-sm py-2">Recorded inputs</summary><pre>{display(run.inputs)}</pre></details>
    <h3 className="mt-4">Computed outputs</h3>
    <pre>{display(run.result.outputs)}</pre>
    {hasReport && <div className="mt-3">
      <a className="earth-instrument-action" href={reportUrl} target="_blank" rel="noreferrer">
        <ExternalLink size={14} />Open generated full instrument
      </a>
      <p className="fe-muted mt-2">The complete generated report saved with this server run, separate from the supplied original instruments.</p>
    </div>}
    <h3 className="mt-4">Checks and tolerances</h3>
    {!run.result.checks.length && <p className="fe-muted">No individual checks were recorded.</p>}
    {run.result.checks.map((check, index) => <div key={`${check.name}-${index}`} className="fe-check">
      <p className="text-sm font-semibold"><span className={check.passed ? 'fe-pass' : 'fe-fail'}>{check.passed ? 'PASS' : 'FAIL'}</span> · {check.name}</p>
      <dl className="fe-metadata">
        <div><dt>Actual</dt><dd>{display(check.actual)}</dd></div>
        <div><dt>Expected</dt><dd>{display(check.expected)}</dd></div>
        <div><dt>Tolerance</dt><dd>{display(check.tolerance)}</dd></div>
      </dl>
    </div>)}
    <h3 className="mt-4">Recorded limitations</h3>
    {run.result.limitations.length ? <ul>{run.result.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul> :
      <p className="fe-muted">No additional limitations supplied by the server; catalog coverage remains finite.</p>}
    <button type="button" className="mt-4" onClick={() => exportRecord(run)}><Download size={14} /> Export this record JSON</button>
  </div>;
}
function FormulaForm({ formula, onRecorded }: { formula: EvidenceFormula; onRecorded: (id: string) => void }) {
  const [inputs, setInputs] = useState<Record<string, string>>({ ...formula.inputs });
  const execute = useExecuteFormula();
  return <form onSubmit={event => {
    event.preventDefault();
    execute.mutate({ formula_id: formula.id, inputs: { ...inputs } }, { onSuccess: run => onRecorded(run.id) });
  }}>
    <p className="fe-muted mt-3">Method: {formula.method}</p>
    {formula.id === 'isopsephy' && <p className="fe-muted mt-2">Enter explicit Greek glyphs. This calculation follows the server’s finite glyph table, not the full embedded corpus.</p>}
    {formula.id === 'isopsephy-document' && <p className="fe-muted mt-2">Runs the canonical Python document pipeline on your text and saves the complete generated report. This is separate from the limited Greek-glyph checker. Maximum 8,192 characters.</p>}
    <div className="fe-fields">{Object.entries(inputs).map(([key, value]) => <label key={key}>
      {key}
      {key === 'text' ?
        <textarea required maxLength={8192} value={value} disabled={execute.isPending} onChange={e => setInputs(old => ({ ...old, [key]: e.target.value }))} /> :
        <input required type="text" spellCheck={false} value={value} disabled={execute.isPending} onChange={e => setInputs(old => ({ ...old, [key]: e.target.value }))} />}
    </label>)}</div>
    {formula.limitations.length > 0 && <ul className="fe-muted mb-4">{formula.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul>}
    <button disabled={execute.isPending} type="submit"><Play size={14} />{execute.isPending ? 'Executing and saving…' : 'Run deterministic server calculation'}</button>
    <div aria-live="polite" className="mt-2 text-xs">
      {execute.isPending && <p>No result assumed. Waiting for the server record.</p>}
      {execute.isSuccess && <p>Server record saved. Inspect the recorded result below.</p>}
    </div>
    {execute.isError && <p role="alert" className="text-xs mt-3">Run failed: {evidenceError(execute.error)} No successful record is assumed. You can retry the calculation.</p>}
  </form>;
}
export function FormulaEvidencePanel() {
  const id = useId();
  const catalog = useFormulaCatalog();
  const history = useFormulaRuns();
  const [formulaId, setFormulaId] = useState('');
  const [selectedId, setSelectedId] = useState(() => {
    try { return localStorage.getItem('capomastro.selectedFormulaEvidence') ?? ''; } catch { return ''; }
  });
  const active = catalog.data?.find(formula => formula.id === formulaId) ?? catalog.data?.[0];
  const selected = history.data?.find(run => run.id === selectedId) ?? history.data?.[0];
  function selectRecord(runId: string) {
    setSelectedId(runId);
    try { localStorage.setItem('capomastro.selectedFormulaEvidence', runId); } catch { /* Server history remains authoritative. */ }
  }
  return <section className="formula-evidence" aria-labelledby={`${id}-heading`}>
    <p className="fe-kicker">Deterministic calculations / inspectable records</p>
    <h2 id={`${id}-heading`}>Formula evidence</h2>
    <p className="fe-muted mt-2">Only the finite, explicit server catalog is executable here. A passing record is not certification of all Codex formulas, geodetic accuracy, or daemon execution. Embedded instrument outputs are separate from these saved server calculations.</p>
    <p className="fe-muted mt-2">Agent model answers and reviewer agreement are separate from deterministic evidence. <Link to="/forge#shared-agent-execution" className="underline text-[var(--color-gold-400)]">Shared agent execution in Forge</Link></p>
    <a href="/api/formula-evidence/source" target="_blank" rel="noreferrer" className="earth-instrument-action mt-3">
      <ExternalLink size={14} />Inspect deterministic math implementation · Rust source & hash
    </a>
    <div className="fe-layout">
      <div>
        <h3>01 / Configure a calculation</h3>
        {catalog.isLoading && <div role="status" aria-label="Loading formula catalog" className="fe-skeleton" />}
        {catalog.isError && <div role="alert"><p>{evidenceError(catalog.error)}</p><button type="button" onClick={() => void catalog.refetch()}>Retry catalog</button></div>}
        {catalog.isSuccess && !catalog.data.length && <p className="fe-muted">The server catalog is empty. No executable formula is claimed.</p>}
        {active && <><label>Server formula
          <select value={active.id} onChange={e => setFormulaId(e.target.value)}>
            {catalog.data?.map(formula => <option key={formula.id} value={formula.id}>{formula.title} · {formula.id}</option>)}
          </select>
        </label><FormulaForm key={active.id} formula={active} onRecorded={selectRecord} /></>}
      </div>
      <div>
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h3>02 / Persisted recent history</h3>
          <button type="button" disabled={history.isFetching} onClick={() => void history.refetch()}><RefreshCw size={13} />{history.isFetching ? 'Loading…' : 'Refresh'}</button>
        </div>
        <p className="fe-muted mb-3">Latest 50 server records, scoped to your organization. Selecting a record restores its full evidence, not the editable form.</p>
        {history.isLoading && <div role="status" aria-label="Loading evidence history" className="fe-skeleton" />}
        {history.isError && <p role="alert">History unavailable: {evidenceError(history.error)} Any previously loaded records shown here may be stale. Use Refresh to retry.</p>}
        {history.isSuccess && !history.data.length && <div className="fe-check"><h3>No recorded calculations yet</h3><p className="fe-muted">Configure a catalog formula and run it to create the first inspectable server record.</p></div>}
        {!!history.data?.length && <label>Inspect saved record<select value={selected?.id ?? ''} onChange={e => selectRecord(e.target.value)}>
          {history.data.map(run => <option key={run.id} value={run.id}>{run.formula_id} · {run.result.status.toUpperCase()} · {run.executed_at} · {run.id}</option>)}
        </select></label>}
      </div>
    </div>
    {selected && <RunDetail run={selected} />}
  </section>;
}
