import type { EngineConfig } from '../../types';

/** Shared wording and proof on Settings and Monitoring. Never infer generation
 * from reachability, relay occupancy, or an installer finishing. */
export function EngineVerificationEvidence({ engine }: { engine?: EngineConfig | null }) {
  const evidence = engine?.verification;
  const valid = engine?.operational === true && evidence?.verified &&
    Date.parse(evidence.expires_at) > Date.now();
  return (
    <section aria-label="Engine generation evidence" className="my-3 rounded-lg border border-[var(--color-border-subtle)] p-3 text-xs space-y-2 break-words">
      <p className="font-semibold">{engine?.is_disabled ? 'Disabled' : evidence?.status === 'verifying' ? 'Verification running — not yet operational' : valid ? 'Generation verified' : 'Not certified operational'}</p>
      {!evidence ? <p>No recorded generation test. A connection alone is not proof.</p> : <>
        <p>Tested: {new Date(evidence.checked_at).toLocaleString()} · {evidence.latency_ms} ms</p>
        <p>Evidence expires: {new Date(evidence.expires_at).toLocaleString()}</p>
        <p>Route: {evidence.route}{evidence.peer ? ` · peer ${evidence.peer}` : ''}</p>
        <p>Requested model: {evidence.configured_model}</p>
        {evidence.model_identity && <p>Identity evidence: {evidence.model_identity}</p>}
        {evidence.answer && <div><p>Recorded model answer:</p><pre className="whitespace-pre-wrap max-h-32 overflow-auto">{evidence.answer}</pre></div>}
        {evidence.error && <p role="status">Verification failed: {evidence.error}</p>}
        {!valid && evidence.verified && <p>This past answer is not a current certification. Re-verify generation.</p>}
        <p className="text-[var(--color-text-muted)]">Request: {evidence.request_id}</p>
      </>}
    </section>
  );
}
