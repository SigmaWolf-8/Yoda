import { useId, useState, useSyncExternalStore } from 'react';
import { Download, Play } from 'lucide-react';
import {
  formulaRegistry,
  evidenceConclusion,
  getEvidenceSnapshot,
  runFormulaCheck,
  subscribeEvidence,
} from '../lib/formula-evidence';
import type { CheckStatus, EvidenceKind } from '../lib/formula-evidence';

const kinds: Record<EvidenceKind, { label: string; description: string }> = {
  'displayed-formula': {
    label: 'Displayed formula',
    description: 'A written claim, not executed evidence; never certifies a result.',
  },
  'ai-commentary': {
    label: 'AI commentary',
    description: 'Interpretation, not verification; never certifies a result.',
  },
  'deterministic-computation': {
    label: 'Deterministic computation',
    description: 'An executed calculation for the recorded inputs, not general certification.',
  },
  'symbolic-reasoning': {
    label: 'Symbolic reasoning',
    description: 'Explicit polynomial operations and stated rules, not a general theorem prover.',
  },
  'numerical-check': {
    label: 'Numerical check',
    description: 'Finite floating-point evidence within a tolerance, not a universal proof.',
  },
  'daemon-execution': {
    label: 'Daemon execution',
    description: 'Unavailable: no daemon adapter is registered. Local runs are not remote execution.',
  },
};

const statusLabels: Record<CheckStatus, string> = {
  'not-run': 'Not run',
  running: 'Running',
  passed: 'Passed · expected result matched',
  failed: 'Failed',
  unavailable: 'Unavailable · no executor',
};

const buttonClass = 'inline-flex items-center justify-center gap-2 border border-[var(--color-border-default)] px-3 py-2 text-xs font-semibold hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
const mutedClass = 'text-[var(--color-text-muted)]';

function JsonValue({ value }: { value: unknown }) {
  return (
    <pre className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed font-mono">
      {value === null ? 'No observation recorded. See execution status and error details.' : JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Application-side evidence only; never mutates or certifies sealed documents. */
export function FormulaEvidence() {
  const records = useSyncExternalStore(subscribeEvidence, getEvidenceSnapshot, getEvidenceSnapshot);
  const headingId = useId();
  const [runningAll, setRunningAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const busy = runningAll || records.some(record => record.status === 'running');
  const matched = records.filter(record => record.status === 'passed').length;

  async function run(id?: string) {
    setActionError(null);
    if (!id) setRunningAll(true);
    try {
      if (id) await runFormulaCheck(id);
      else await Promise.all(formulaRegistry.flatMap(claim => claim.checks.map(check => runFormulaCheck(check.id))));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not run checks. Please retry.');
    } finally {
      if (!id) setRunningAll(false);
    }
  }

  function downloadEvidence() {
    setActionError(null);
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        persistence: 'Session-only, in-memory state in this browser tab; reload resets evidence.',
        scope: 'Initial registered divergence–flux example only. Other document claims remain unverified.',
        execution: 'Local browser JavaScript only; daemon adapter absent and unavailable.',
        interpretation: 'Passed means the recorded observation matched the expected result, not document certification. Displayed formulas, AI commentary, request hashes, model agreement and estimates are not mathematical proof or measured performance.',
        evidenceKinds: kinds,
        registry: formulaRegistry,
        records: getEvidenceSnapshot(),
        localVanishingConclusion: evidenceConclusion(getEvidenceSnapshot()),
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `yoda-formula-evidence-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Export failed. Please retry.');
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="my-5 min-w-0 border border-[var(--color-border-default)] p-4 sm:p-5 space-y-4"
      style={{
        background: 'var(--color-surface-primary, #181411)',
        color: 'var(--color-text-primary, #f0ede8)',
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className={`text-[10px] uppercase tracking-widest mb-1 ${mutedClass}`}>Application supplement · session-only evidence</p>
          <h2 id={headingId} className="text-base font-bold">Formula evidence</h2>
          <p className={`mt-1 text-xs leading-relaxed ${mutedClass}`}>Claims and executed observations are separate. Sealed source documents remain unchanged.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={busy || !records.length} onClick={() => void run()}>
            <Play size={13} aria-hidden="true" />{busy ? 'Checks running…' : 'Run all checks'}
          </button>
          <button type="button" className={buttonClass} onClick={downloadEvidence}>
            <Download size={13} aria-hidden="true" />Export current evidence JSON
          </button>
        </div>
      </div>

      <div className="border-l-2 border-[var(--color-gold-400)] pl-3 text-xs leading-relaxed space-y-1">
        <p><strong>Scope:</strong> Initial registered divergence–flux example only. All other document claims remain unverified by this registry.</p>
        <p><strong>Execution:</strong> Local browser JavaScript in this tab. The daemon adapter is absent and unavailable; no remote execution is claimed.</p>
        <p><strong>Persistence:</strong> Shared across these app pages in this tab only; reload resets the evidence. Export inputs, versions and observations for reproducibility.</p>
        <p>Request hashes, model agreement and estimates are neither mathematical proof nor measured performance. A passed check is not certification of a document.</p>
      </div>

      <details className="border border-[var(--color-border-default)] p-3 text-xs">
        <summary className="cursor-pointer font-semibold focus-visible:outline">Evidence types · six distinct categories</summary>
        <dl className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          {Object.entries(kinds).map(([kind, entry]) => (
            <div key={kind}>
              <dt className="font-semibold">{entry.label} <code className={`text-[10px] ${mutedClass}`}>({kind})</code></dt>
              <dd className={`mt-1 leading-relaxed ${mutedClass}`}>{entry.description}</dd>
            </div>
          ))}
        </dl>
      </details>

      <p role="status" aria-live="polite" className={`text-xs ${mutedClass}`}>
        {busy ? 'Executing registered checks locally…' : `${matched} of ${records.length} registered checks matched expected results. No document-wide verification.`}
      </p>
      <p className="text-xs leading-relaxed"><strong>Executed evidence conclusion:</strong> {evidenceConclusion(records)}</p>
      {actionError && <p role="alert" className="border border-current p-3 text-xs">Action error: {actionError} Use the relevant action above to retry.</p>}
      {!records.length && <p className="border border-[var(--color-border-default)] p-4 text-xs">No checks registered. No executable evidence is available; document claims remain unverified.</p>}

      {formulaRegistry.map(claim => (
        <article key={claim.id} className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">{claim.title}</h3>
            <p className={`mt-1 text-[10px] uppercase tracking-wide ${mutedClass}`}>Displayed formula · claim, not an execution result</p>
            <p className="my-2 font-mono text-xs leading-relaxed break-words">{claim.formula}</p>
            <p className="text-xs leading-relaxed">{claim.conclusion}</p>
            <p className={`mt-2 text-xs ${mutedClass}`}>Source contexts: {claim.sources.join(', ')}. These labels do not certify the source documents.</p>
          </div>
          <div className="space-y-2">
            {records.filter(record => claim.checks.some(check => check.id === record.id)).map(record => (
              <div key={record.id} className="border border-[var(--color-border-default)] p-3 sm:p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold">{record.title}</h4>
                    <p className={`mt-1 text-xs ${mutedClass}`}>{kinds[record.kind].label} · <code>{record.kind}</code></p>
                    <p className="mt-2 text-xs font-semibold" role="status">{statusLabels[record.status]}</p>
                  </div>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy}
                    aria-label={`${record.status === 'not-run' ? 'Run' : 'Re-run'}: ${record.title}`}
                    onClick={() => void run(record.id)}
                  >
                    <Play size={12} aria-hidden="true" />{record.status === 'running' ? 'Running…' : record.status === 'not-run' ? 'Run check' : 'Re-run check'}
                  </button>
                </div>
                {record.kind === 'daemon-execution' && <p className="text-xs">Adapter unavailable. Running this check records the missing executor, not a daemon result.</p>}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div><p className={`text-xs font-semibold ${mutedClass}`}>Expected</p><JsonValue value={record.expected} /></div>
                  <div><p className={`text-xs font-semibold ${mutedClass}`}>Observed</p><JsonValue value={record.observed} /></div>
                </div>
                <p className={`text-xs leading-relaxed ${mutedClass}`}>{record.limitation}</p>
                {record.error && <p role="alert" className="border-l-2 border-current pl-3 text-xs break-words">Error: {record.error}</p>}
                <details className="text-xs">
                  <summary className="cursor-pointer font-semibold focus-visible:outline">Inputs, assumptions and execution provenance</summary>
                  <div className="mt-3 space-y-3">
                    <div><p className={mutedClass}>Inputs</p><JsonValue value={record.inputs} /></div>
                    <div>
                      <p className={mutedClass}>Assumptions</p>
                      <ul className="list-disc pl-5 mt-1 space-y-1 leading-relaxed">{record.assumptions.map(assumption => <li key={assumption}>{assumption}</li>)}</ul>
                    </div>
                    <dl className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {[
                        ['Tolerance', record.tolerance === null ? 'Exact comparison; no numerical tolerance' : String(record.tolerance)],
                        ['Implementation version', record.implementationVersion],
                        ['Test version', record.testVersion],
                        ['Execution location', record.executionLocation],
                        ['Trace ID', record.traceId ?? 'None — no execution trace recorded'],
                        ['Executed at', record.executedAt ?? 'Not executed'],
                        ['Error', record.error ?? 'None recorded'],
                      ].map(([label, value]) => (
                        <div key={label} className="min-w-0"><dt className={mutedClass}>{label}</dt><dd className="mt-1 font-mono break-words">{value}</dd></div>
                      ))}
                    </dl>
                  </div>
                </details>
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
