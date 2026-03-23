import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Wifi, AlertCircle } from 'lucide-react';
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


  const isBusy = submit.isPending || relayState === 'pending' || relayState === 'relaying';

  function statusLabel() {
    if (submit.isPending)          return 'Queuing…';
    if (relayState === 'pending')  return 'Creating task…';
    if (relayState === 'relaying') return 'Calling engine…';
    return null;
  }

  function renderError() {
    if (!relayError && !submit.error) return null;

    if (submit.error && !relayError) {
      return (
        <div className="mt-3 rounded-lg border border-[var(--color-err)]/30 bg-[var(--color-err)]/5 p-3">
          <p className="text-sm text-[var(--color-err)]">
            Could not submit query. Make sure at least one engine is saved in Settings → AI Engines.
          </p>
        </div>
      );
    }

    const { kind, endpoint, detail } = relayError!;

    if (kind === 'not_running' || kind === 'cors') {
      return (
        <div className="mt-3 rounded-lg border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-[var(--color-warn)] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-[var(--color-warn)] font-medium">Daemon required — browser cannot reach localhost directly</p>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            Modern browsers block HTTPS pages from connecting to <code className="font-mono">{endpoint || 'http://localhost:8080'}</code> directly.
            {' '}The <strong>PlenumNET daemon</strong> acts as the secure bridge. Start it alongside llama-server:
          </p>
          <pre className="text-[10px] text-[var(--color-text-muted)] bg-[var(--color-surface-secondary)] rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap leading-relaxed">
{`$env:CUBE_MODE="cube"; $env:CUBE_API_PORT="8081"
$env:CUBE_CRS_URL="https://plenumnet.replit.app"
$env:CUBE_ROLE="inference"
& "C:\\Users\\Sigma\\PlenumNET\\target\\release\\inter-cube-daemon.exe"`}
          </pre>
          <button onClick={resetForRetry} className="text-xs text-[var(--color-plex-400)] hover:underline">Retry</button>
        </div>
      );
    }

    if (kind === 'timeout') {
      return (
        <div className="mt-3 rounded-lg border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/5 p-3 space-y-1">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-[var(--color-warn)] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-[var(--color-warn)] font-medium">Engine took too long to respond</p>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            Your model at <code className="font-mono text-xs">{endpoint}</code> is loading or under load. Wait a moment and try again.
          </p>
          <button onClick={resetForRetry} className="text-xs text-[var(--color-plex-400)] hover:underline">Retry</button>
        </div>
      );
    }

    if (kind === 'http') {
      return (
        <div className="mt-3 rounded-lg border border-[var(--color-err)]/30 bg-[var(--color-err)]/5 p-3 space-y-1">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-[var(--color-err)] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-[var(--color-err)] font-medium">Engine returned an error ({detail})</p>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            The engine at <code className="font-mono text-xs">{endpoint}</code> rejected the request. Check your engine configuration in Settings → AI Engines.
          </p>
          <button onClick={resetForRetry} className="text-xs text-[var(--color-plex-400)] hover:underline">Dismiss and retry</button>
        </div>
      );
    }

    return (
      <div className="mt-3 rounded-lg border border-[var(--color-err)]/30 bg-[var(--color-err)]/5 p-3 space-y-1">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-[var(--color-err)] flex-shrink-0 mt-0.5" />
          <p className="text-sm text-[var(--color-err)]">{detail ?? 'Something went wrong connecting to your engine. Check Settings → AI Engines.'}</p>
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
