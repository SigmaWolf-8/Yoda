import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Wifi, AlertCircle, Copy, Check } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
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

const RELAY_TIMEOUT_MS = 90_000;
const PING_TIMEOUT_MS  = 4_000;

type RelayState = 'idle' | 'pending' | 'relaying' | 'done' | 'error';
type RelayError  = { kind: 'not_running' | 'cors' | 'timeout' | 'http' | 'empty' | 'other'; endpoint: string; detail?: string };

interface Props {
  projectId: string;
  mode: 'yoda' | 'ronin';
  onResult?: (result: QueryResult) => void;
}

async function pingEngine(endpoint: string): Promise<'running' | 'not_running' | 'timeout'> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PING_TIMEOUT_MS);
  try {
    await fetch(`${endpoint}/`, { method: 'GET', mode: 'no-cors', signal: ac.signal });
    return 'running';
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'timeout';
    return 'not_running';
  } finally {
    clearTimeout(timer);
  }
}

export function QueryInput({ projectId, mode, onResult }: Props) {
  const [text, setText]           = useState('');
  const [relayState, setRelayState] = useState<RelayState>('idle');
  const [relayError, setRelayError] = useState<RelayError | null>(null);
  const [copied, setCopied]         = useState(false);
  const qc           = useQueryClient();
  const submit       = useSubmitQuery(projectId);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const abortRef     = useRef<AbortController | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }, [text]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  async function runBrowserRelay(taskId: string, endpoint: string, query: string) {
    setRelayState('relaying');
    const t0 = Date.now();

    const reach = await pingEngine(endpoint);
    if (reach === 'not_running') {
      setRelayError({ kind: 'not_running', endpoint });
      setRelayState('error');
      return;
    }
    if (reach === 'timeout') {
      setRelayError({ kind: 'timeout', endpoint });
      setRelayState('error');
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    const timer = setTimeout(() => ac.abort(), RELAY_TIMEOUT_MS);

    try {
      const llmRes = await fetch(`${endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          model: 'local',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user',   content: query },
          ],
          max_tokens: 4096,
          temperature: 0.3,
          stream: false,
        }),
      });

      clearTimeout(timer);

      if (!llmRes.ok) {
        setRelayError({ kind: 'http', endpoint, detail: `HTTP ${llmRes.status}` });
        setRelayState('error');
        return;
      }

      const llmData = await llmRes.json();
      const content: string =
        llmData?.choices?.[0]?.message?.content ??
        llmData?.choices?.[0]?.text ??
        '';

      if (!content) {
        setRelayError({ kind: 'empty', endpoint });
        setRelayState('error');
        return;
      }

      const latency_ms = Date.now() - t0;
      await apiClient.post(`/tasks/${taskId}/output`, {
        content,
        model: llmData?.model ?? 'local',
        latency_ms,
      });

      // Immediately refresh the task so the result shows without waiting for the next poll
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['tasks', projectId] });

      setRelayState('done');
      setText('');
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === 'AbortError') {
        setRelayError({ kind: 'timeout', endpoint });
      } else {
        setRelayError({ kind: 'cors', endpoint });
      }
      setRelayState('error');
    } finally {
      abortRef.current = null;
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
            runBrowserRelay(result.task_id, result.relay_endpoint, query);
          } else {
            setRelayState('done');
            setText('');
          }
        },
        onError: () => {
          setRelayError({ kind: 'other', endpoint: '', detail: 'Server rejected the query — check that at least one engine slot is saved.' });
          setRelayState('error');
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

  function resetForRetry() {
    abortRef.current?.abort();
    abortRef.current = null;
    setRelayState('idle');
    setRelayError(null);
  }

  function copyCmd(cmd: string) {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const isBusy = submit.isPending || relayState === 'pending' || relayState === 'relaying';

  function statusLabel() {
    if (submit.isPending)          return 'Queuing…';
    if (relayState === 'pending')  return 'Creating task…';
    if (relayState === 'relaying') return 'Calling engine…';
    return null;
  }

  function buildFixCmd(endpoint: string): string {
    try {
      const url  = new URL(endpoint);
      const port = url.port || '8080';
      return `llama-server --cors --host 0.0.0.0 --port ${port} -m <your-model>.gguf`;
    } catch {
      return `llama-server --cors --host 0.0.0.0 --port 8080 -m <your-model>.gguf`;
    }
  }

  function renderError() {
    if (!relayError && !submit.error) return null;

    if (submit.error && !relayError) {
      return (
        <div className="mt-3 rounded-lg border border-[var(--color-err)]/30 bg-[var(--color-err)]/5 p-3">
          <p className="text-sm text-[var(--color-err)]">
            Server rejected the query — check that at least one engine slot is saved in AI Engines settings.
          </p>
        </div>
      );
    }

    const { kind, endpoint, detail } = relayError!;

    if (kind === 'not_running') {
      const cmd = buildFixCmd(endpoint);
      return (
        <div className="mt-3 rounded-lg border border-[var(--color-err)]/30 bg-[var(--color-err)]/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-[var(--color-err)] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-[var(--color-err)] font-medium">Engine not running at <code className="font-mono text-xs">{endpoint}</code></p>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">Start llama-server on your machine:</p>
          <div className="flex items-center gap-2 bg-[var(--color-surface-tertiary)] rounded-md px-3 py-2">
            <code className="text-xs text-[var(--color-text-secondary)] flex-1 break-all">{cmd}</code>
            <button onClick={() => copyCmd(cmd)} className="flex-shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
              {copied ? <Check className="w-3.5 h-3.5 text-[var(--color-ok)]" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button onClick={resetForRetry} className="text-xs text-[var(--color-plex-400)] hover:underline">Dismiss and retry</button>
        </div>
      );
    }

    if (kind === 'cors') {
      const cmd = buildFixCmd(endpoint);
      return (
        <div className="mt-3 rounded-lg border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-[var(--color-warn)] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-[var(--color-warn)] font-medium">Engine is running but CORS is not enabled</p>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">Restart llama-server with the <code className="font-mono">--cors</code> flag:</p>
          <div className="flex items-center gap-2 bg-[var(--color-surface-tertiary)] rounded-md px-3 py-2">
            <code className="text-xs text-[var(--color-text-secondary)] flex-1 break-all">{cmd}</code>
            <button onClick={() => copyCmd(cmd)} className="flex-shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
              {copied ? <Check className="w-3.5 h-3.5 text-[var(--color-ok)]" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button onClick={resetForRetry} className="text-xs text-[var(--color-plex-400)] hover:underline">Dismiss and retry</button>
        </div>
      );
    }

    if (kind === 'timeout') {
      return (
        <div className="mt-3 rounded-lg border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/5 p-3 space-y-1">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-[var(--color-warn)] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-[var(--color-warn)] font-medium">Engine timed out at <code className="font-mono text-xs">{endpoint}</code></p>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">The model may still be loading. Wait a moment and try again.</p>
          <button onClick={resetForRetry} className="text-xs text-[var(--color-plex-400)] hover:underline">Dismiss and retry</button>
        </div>
      );
    }

    return (
      <div className="mt-3 rounded-lg border border-[var(--color-err)]/30 bg-[var(--color-err)]/5 p-3 space-y-1">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-[var(--color-err)] flex-shrink-0 mt-0.5" />
          <p className="text-sm text-[var(--color-err)]">{detail ?? 'Unknown error'}</p>
        </div>
        <button onClick={resetForRetry} className="text-xs text-[var(--color-plex-400)] hover:underline">Dismiss and retry</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className={`bg-[var(--color-surface-secondary)] border rounded-xl overflow-hidden transition-colors ${
        relayState === 'error'
          ? 'border-[var(--color-err)]/40'
          : 'border-[var(--color-border-subtle)] focus-within:border-[var(--color-gold-500)]/40'
      }`}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => { setText(e.target.value); if (relayState !== 'relaying') setRelayState('idle'); }}
          onKeyDown={handleKeyDown}
          placeholder={PLACEHOLDERS[mode] ?? PLACEHOLDERS.yoda}
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

      {relayState === 'relaying' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-sky-300 px-1">
          <Wifi className="w-3.5 h-3.5 animate-pulse" />
          Calling local engine directly — waiting for response…
        </div>
      )}

      {relayState === 'done' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-[var(--color-plex-400)] px-1">
          <Wifi className="w-3.5 h-3.5" />
          Response received and stored — see the task for output.
        </div>
      )}

      {renderError()}
    </form>
  );
}
