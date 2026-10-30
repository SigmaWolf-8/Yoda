import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../api/client';

type Runtime = {
  enabled: boolean; alive: boolean; queued: number; activeTask: string | null;
  heartbeatAt: string | null; message: string; maxAttempts: number; maxTaskSeconds: number;
};

/** Real server worker state, deliberately separate from the compiled roster. */
export function AgentRuntimePanel() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const { data } = await apiClient.get<Runtime>('/agents/runtime', { signal });
      if (typeof data?.alive !== 'boolean') throw new Error('Unexpected worker status response');
      if (!signal?.aborted) { setRuntime(data); setError(null); }
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Worker status unavailable');
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => void refresh(controller.signal), 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [refresh]);
  async function toggle() {
    if (!runtime) return;
    setSaving(true);
    try {
      await apiClient.put('/agents/runtime', { enabled: !runtime.enabled });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Worker control failed'); }
    finally { setSaving(false); }
  }
  return <section aria-label="Autonomous agent worker" className="border-b border-[var(--color-border-default)] bg-[var(--color-surface-primary)] px-4 py-3 text-xs">
    <div className="flex flex-wrap items-center gap-3">
      <Link to="/agents" className="font-bold text-[var(--color-gold-400)]">Autonomous agents</Link>
      <span>{error || !runtime ? 'Status unavailable' : !runtime.enabled ? 'Paused' : !runtime.alive ? 'Worker heartbeat missing' : runtime.activeTask ? 'Executing task' : 'Worker awake · waiting'}</span>
      {runtime && <span>{runtime.queued} queued</span>}
      <Link to="/settings" className="underline">Engine settings</Link>
      <button type="button" onClick={() => void toggle()} disabled={!runtime || saving || !!error} className="ml-auto border border-[var(--color-border-default)] px-3 py-1 disabled:opacity-50">
        {saving ? 'Updating…' : runtime?.enabled ? 'Pause worker' : 'Resume worker'}
      </button>
    </div>
    {error ? <p role="alert" className="mt-2 text-amber-400">{error}</p> : runtime && <>
      <p className="mt-2 text-[var(--color-text-muted)]">{runtime.message}</p>
      <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
        Heartbeat: {runtime.heartbeatAt || 'not yet received'} · Existing queued tasks only · Four-step review · At most {runtime.maxAttempts} attempts per task · Pause stops dispatch and interrupts an active attempt.
      </p>
    </>}
  </section>;
}
