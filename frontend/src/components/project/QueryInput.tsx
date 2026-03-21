import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Wifi, AlertCircle } from 'lucide-react';
import { useSubmitQuery } from '../../api/hooks';
import apiClient from '../../api/client';
import type { QueryResult } from '../../types';

const PLACEHOLDERS = {
  yoda: 'Analyze the security implications of migrating from RSA-4096 to TL-DSA…',
  ronin: 'Build a REST API with create document, sign document, and verify signature endpoints…',
};

const SYSTEM_PROMPT = `You are YODA — a senior engineering intelligence system. 
Analyse the user's query thoroughly. Provide structured, expert-level analysis 
covering technical depth, security implications, trade-offs, and concrete recommendations. 
Be precise. Use markdown where appropriate.`;

type RelayState = 'idle' | 'pending' | 'relaying' | 'done' | 'error';

interface Props {
  projectId: string;
  mode: 'yoda' | 'ronin';
  onResult?: (result: QueryResult) => void;
}

export function QueryInput({ projectId, mode, onResult }: Props) {
  const [text, setText] = useState('');
  const [relayState, setRelayState] = useState<RelayState>('idle');
  const [relayError, setRelayError] = useState<string | null>(null);
  const submit = useSubmitQuery(projectId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }, [text]);

  async function runBrowserRelay(taskId: string, endpoint: string, query: string) {
    setRelayState('relaying');
    const t0 = Date.now();
    try {
      const llmRes = await fetch(`${endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'local',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: query },
          ],
          max_tokens: 4096,
          temperature: 0.3,
          stream: false,
        }),
      });

      if (!llmRes.ok) {
        throw new Error(`Engine returned HTTP ${llmRes.status}`);
      }

      const llmData = await llmRes.json();
      const content: string =
        llmData?.choices?.[0]?.message?.content ??
        llmData?.choices?.[0]?.text ??
        '';

      if (!content) throw new Error('Empty response from engine');

      const latency_ms = Date.now() - t0;
      await apiClient.post(`/tasks/${taskId}/output`, {
        content,
        model: llmData?.model ?? 'local',
        latency_ms,
      });

      setRelayState('done');
      setText('');
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Unknown error';
      const msg = raw === 'Failed to fetch'
        ? `Cannot reach engine at ${endpoint}. Start llama-server with --cors (e.g. llama-server --cors --host 0.0.0.0 --port 8080 -m model.gguf). "Failed to fetch" almost always means the CORS header is missing.`
        : raw;
      setRelayError(msg);
      setRelayState('error');
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || submit.isPending || relayState === 'relaying') return;
    setRelayState('pending');
    setRelayError(null);

    const query = text.trim();
    submit.mutate(
      { text: query, mode },
      {
        onSuccess: (result) => {
          onResult?.(result);

          if (result.relay_endpoint && result.task_id) {
            // Server created the task but can't reach the engine (Replit → local LAN gap).
            // Browser makes the LLM call directly then posts the result back.
            runBrowserRelay(result.task_id, result.relay_endpoint, query);
          } else {
            // Server executed successfully (decomposition or direct inference worked).
            setRelayState('done');
            setText('');
          }
        },
        onError: () => {
          setRelayState('error');
          setRelayError('Server rejected the query. Check that at least one engine slot is saved.');
        },
      },
    );
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  const isBusy = submit.isPending || relayState === 'pending' || relayState === 'relaying';

  function statusLabel() {
    if (submit.isPending) return 'Queuing…';
    if (relayState === 'pending') return 'Creating task…';
    if (relayState === 'relaying') return 'Relaying to engine…';
    return null;
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl overflow-hidden focus-within:border-[var(--color-gold-500)]/40 transition-colors">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => { setText(e.target.value); setRelayState('idle'); }}
          onKeyDown={handleKeyDown}
          placeholder={PLACEHOLDERS[mode]}
          rows={2}
          disabled={isBusy}
          className="w-full px-4 pt-4 pb-2 bg-transparent text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none focus:outline-none disabled:opacity-60"
        />
        <div className="flex items-center justify-between px-4 pb-3">
          <span className="text-xs text-[var(--color-text-muted)]">
            {mode === 'ronin'
              ? 'Produces code + implementation instructions'
              : 'Produces research + analysis'}
            {' · '}
            <kbd className="px-1 py-0.5 rounded bg-[var(--color-surface-tertiary)] text-[11px]">Enter</kbd> to send
            {' · '}
            <kbd className="px-1 py-0.5 rounded bg-[var(--color-surface-tertiary)] text-[11px]">Shift+Enter</kbd> for newline
          </span>
          <button
            type="submit"
            disabled={!text.trim() || isBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] text-sm font-semibold hover:bg-[var(--color-gold-400)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            {statusLabel() ?? 'Send'}
          </button>
        </div>
      </div>

      {/* Relay in-progress indicator */}
      {relayState === 'relaying' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-sky-300 px-1">
          <Wifi className="w-3.5 h-3.5 animate-pulse" />
          Browser relay active — calling local engine directly…
        </div>
      )}

      {/* Done */}
      {relayState === 'done' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-[var(--color-plex-400)] px-1">
          <Wifi className="w-3.5 h-3.5" />
          Response received and stored — see the task for output.
        </div>
      )}

      {/* Error */}
      {(relayState === 'error' || submit.error) && (
        <div className="mt-2 flex items-center gap-2 text-xs text-[var(--color-err)] px-1">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {relayError ??
            'Engine unreachable. Make sure your llama-server is running and the endpoint URL is correct in AI Engines settings.'}
        </div>
      )}
    </form>
  );
}
