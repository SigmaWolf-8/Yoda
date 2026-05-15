import { useEffect, useState } from 'react';
import { Cpu, Shield, RefreshCw, WifiOff } from 'lucide-react';

interface LlmHealth {
  alpha: boolean;
  beta: boolean;
  gamma: boolean;
  any_available: boolean;
  all_available: boolean;
  note?: string;
}

const AGENTS = [
  {
    key: 'alpha' as const,
    label: 'Alpha',
    provider: 'Anthropic Claude',
    model: 'claude-3-5-sonnet',
    port: 19443,
    color: 'text-[var(--color-plex-400)]',
    dotOn: 'bg-[var(--color-plex-400)]',
    bgOn: 'bg-[var(--color-plex-500)]/8',
  },
  {
    key: 'beta' as const,
    label: 'Beta',
    provider: 'OpenAI',
    model: 'gpt-4-turbo',
    port: 19444,
    color: 'text-[var(--color-gold-400)]',
    dotOn: 'bg-[var(--color-gold-400)]',
    bgOn: 'bg-[var(--color-gold-500)]/8',
  },
  {
    key: 'gamma' as const,
    label: 'Gamma',
    provider: 'Together AI',
    model: 'Llama-3-70B',
    port: 19445,
    color: 'text-[var(--color-text-secondary)]',
    dotOn: 'bg-[var(--color-text-secondary)]',
    bgOn: 'bg-[var(--color-surface-tertiary)]',
  },
];

export function LlmGatewayPanel() {
  const [health, setHealth] = useState<LlmHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  async function fetchHealth() {
    try {
      const res = await fetch('/api/health/llm');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as LlmHealth;
      setHealth(data);
      setError(false);
      setLastRefresh(new Date());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, 15_000);
    return () => clearInterval(id);
  }, []);

  const notConfigured = health?.note != null;
  const liveCount = health
    ? [health.alpha, health.beta, health.gamma].filter(Boolean).length
    : 0;

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-[var(--color-text-muted)]" />
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">
            Cloud LLM Gateway
          </span>
          <span className="text-xs text-[var(--color-text-muted)]">
            Alpha · Beta · Gamma — TLS 1.3
          </span>
        </div>
        <div className="flex items-center gap-3">
          {!loading && !error && health && (
            <span className="text-xs text-[var(--color-text-muted)]">
              {liveCount}/3 agents live
            </span>
          )}
          <button
            onClick={() => { setLoading(true); fetchHealth(); }}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Not configured */}
      {notConfigured && (
        <div className="flex items-start gap-3 px-4 py-4 text-sm text-[var(--color-text-muted)]">
          <WifiOff className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[var(--color-text-secondary)] font-medium mb-0.5">Gateway not configured</p>
            <p className="text-xs leading-relaxed">
              Set <code className="font-mono bg-[var(--color-surface-tertiary)] px-1 rounded">ANTHROPIC_API_KEY</code>,{' '}
              <code className="font-mono bg-[var(--color-surface-tertiary)] px-1 rounded">OPENAI_API_KEY</code>, and{' '}
              <code className="font-mono bg-[var(--color-surface-tertiary)] px-1 rounded">TOGETHER_API_KEY</code>, then
              run <code className="font-mono bg-[var(--color-surface-tertiary)] px-1 rounded">./llm-tunnel-manager.sh gen-certs &amp;&amp; ./llm-tunnel-manager.sh gen-config</code> to bring up the tunnels.
            </p>
          </div>
        </div>
      )}

      {/* Fetch error */}
      {error && (
        <div className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
          Could not reach <code className="font-mono">/api/health/llm</code>
        </div>
      )}

      {/* Agent grid */}
      {!error && !notConfigured && (
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[var(--color-border-subtle)]">
          {AGENTS.map((agent) => {
            const live = health?.[agent.key] ?? false;
            return (
              <div
                key={agent.key}
                className={`flex flex-col gap-2 px-4 py-4 transition-colors ${live ? agent.bgOn : ''}`}
              >
                {/* Agent label + status dot */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        loading
                          ? 'bg-[var(--color-border-subtle)] animate-pulse'
                          : live
                          ? agent.dotOn
                          : 'bg-[var(--color-text-primary)]/20'
                      }`}
                    />
                    <span className={`text-sm font-semibold ${live ? agent.color : 'text-[var(--color-text-muted)]'}`}>
                      {agent.label}
                    </span>
                  </div>
                  <span className={`text-xs font-medium ${live ? agent.color : 'text-[var(--color-text-muted)]'}`}>
                    {loading ? '…' : live ? 'LIVE' : 'DOWN'}
                  </span>
                </div>

                {/* Provider + model */}
                <div className="space-y-0.5">
                  <p className="text-xs text-[var(--color-text-secondary)]">{agent.provider}</p>
                  <p className="text-xs text-[var(--color-text-muted)] font-mono">{agent.model}</p>
                </div>

                {/* Port + TLS badge */}
                <div className="flex items-center gap-2 mt-1">
                  <Cpu className="w-3 h-3 text-[var(--color-text-muted)]" />
                  <span className="text-xs text-[var(--color-text-muted)] font-mono">:{agent.port}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border-subtle)] text-[var(--color-text-muted)] leading-none">
                    TLS 1.3
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer: last refresh + tunnel command hint */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-primary)]/40">
        <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
          {lastRefresh
            ? `last checked ${lastRefresh.toLocaleTimeString()}`
            : 'checking…'}
        </span>
        {!notConfigured && (
          <span className="text-[11px] text-[var(--color-text-muted)]">
            manage via <code className="font-mono">./llm-tunnel-manager.sh monitor</code>
          </span>
        )}
      </div>
    </div>
  );
}
