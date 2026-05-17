import { useState, useEffect, useRef } from 'react';
import { Zap, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp, Send, Loader2 } from 'lucide-react';

const API = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';
const BASE = API.replace(/\/api$/, '');

interface HealthStatus {
  alpha_ready: boolean;
  beta_ready: boolean;
  gamma_ready: boolean;
}

interface AnalysisResponse {
  problem_class: string;
  problem_size: number;
  complexity_bound: string;
  decomposition_steps: string[];
  key_insights: string[];
  recommended_approach: string;
  execution_ms: number;
}

interface ImplementationResponse {
  architecture_type: string;
  algorithm_outline: string[];
  qutrit_registers: number;
  estimated_runtime_ms: number;
  code_modules: string[];
}

interface ValidationResponse {
  verified: boolean;
  confidence: number;
  issues: string[];
  execution_ms: number;
}

interface ExecutionTimeline {
  alpha_start_ms: number;
  alpha_end_ms: number;
  beta_start_ms: number;
  beta_end_ms: number;
  gamma_start_ms: number;
  gamma_end_ms: number;
  parallel_efficiency: number;
}

interface UnifiedResponse {
  task_id: string;
  problem_class: string;
  analysis: AnalysisResponse;
  implementation: ImplementationResponse;
  validation: ValidationResponse;
  execution_timeline: ExecutionTimeline;
  merged_at_hptp: string;
  total_execution_ms: number;
  brothers: string[];
}

function WarriorPill({ name, ready }: { name: string; ready: boolean }) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold tracking-wide"
      style={{
        background: ready ? 'rgba(74,158,245,0.08)' : 'rgba(255,255,255,0.03)',
        borderColor: ready ? 'rgba(74,158,245,0.35)' : 'rgba(255,255,255,0.1)',
        color: ready ? '#4A9EF5' : '#6B655E',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
      }}
    >
      {ready
        ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
        : <XCircle className="w-3.5 h-3.5 flex-shrink-0" />}
      {name}
    </div>
  );
}

function TimeBar({ label, start, end, color, total }: { label: string; start: number; end: number; color: string; total: number }) {
  const left = total > 0 ? (start / total) * 100 : 0;
  const width = total > 0 ? ((end - start) / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3 text-xs" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
      <span className="w-14 text-right flex-shrink-0" style={{ color: '#998F82' }}>{label}</span>
      <div className="flex-1 relative h-4 rounded overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <div
          className="absolute top-0 h-full rounded"
          style={{ left: `${left}%`, width: `${width}%`, background: color, opacity: 0.8 }}
        />
      </div>
      <span className="w-16 flex-shrink-0" style={{ color: '#998F82' }}>{(end - start).toFixed(0)} ms</span>
    </div>
  );
}

function ResponseCard({ result }: { result: UnifiedResponse }) {
  const [showDetail, setShowDetail] = useState(false);
  const t = result.execution_timeline;
  const total = result.total_execution_ms;

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: 'rgba(24,20,17,0.9)', borderColor: 'rgba(74,158,245,0.2)' }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-4 border-b"
        style={{ borderColor: 'rgba(74,158,245,0.15)', background: 'rgba(74,158,245,0.05)' }}
      >
        <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#8BA633' }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: '#E4DFD5' }}>
            {String(result.problem_class).replace(/_/g, ' ')}
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#998F82', fontFamily: "'JetBrains Mono', monospace" }}>
            {result.task_id.slice(0, 16)}… · {total.toFixed(0)} ms total · η {(t.parallel_efficiency * 100).toFixed(0)}%
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {result.brothers.map(b => (
            <span key={b} className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(74,158,245,0.12)', color: '#4A9EF5', fontFamily: "'JetBrains Mono', monospace" }}>{b}</span>
          ))}
        </div>
      </div>

      {/* Complexity */}
      <div className="px-5 pt-4 pb-2">
        <p className="text-xs font-mono mb-1" style={{ color: '#4A9EF5' }}>COMPLEXITY BOUND</p>
        <p className="text-sm" style={{ color: '#C9C1B4' }}>{result.analysis.complexity_bound}</p>
      </div>

      {/* Approach */}
      <div className="px-5 pb-4">
        <p className="text-xs font-mono mb-1 mt-3" style={{ color: '#4A9EF5' }}>RECOMMENDED APPROACH</p>
        <p className="text-sm" style={{ color: '#C9C1B4' }}>{result.analysis.recommended_approach}</p>
      </div>

      {/* Timeline bars */}
      <div className="px-5 pb-4 space-y-2">
        <p className="text-xs font-mono mb-2" style={{ color: '#4A9EF5' }}>EXECUTION TIMELINE</p>
        <TimeBar label="Alpha" start={t.alpha_start_ms} end={t.alpha_end_ms} color="#4A9EF5" total={total} />
        <TimeBar label="Beta"  start={t.beta_start_ms}  end={t.beta_end_ms}  color="#FFCC44" total={total} />
        <TimeBar label="Gamma" start={t.gamma_start_ms} end={t.gamma_end_ms} color="#8BA633" total={total} />
      </div>

      {/* Toggle detail */}
      <button
        onClick={() => setShowDetail(s => !s)}
        className="w-full flex items-center justify-center gap-1.5 py-3 text-xs border-t transition-colors"
        style={{ color: '#998F82', borderColor: 'rgba(255,255,255,0.06)', fontFamily: "'JetBrains Mono', monospace" }}
      >
        {showDetail ? <><ChevronUp className="w-3.5 h-3.5" /> Hide detail</> : <><ChevronDown className="w-3.5 h-3.5" /> Full breakdown</>}
      </button>

      {showDetail && (
        <div className="px-5 pb-5 border-t space-y-4" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {/* Key insights */}
          {result.analysis.key_insights?.length > 0 && (
            <div className="pt-4">
              <p className="text-xs font-mono mb-2" style={{ color: '#4A9EF5' }}>KEY INSIGHTS — ALPHA</p>
              <ul className="space-y-1">
                {result.analysis.key_insights.map((ins, i) => (
                  <li key={i} className="flex gap-2 text-sm" style={{ color: '#C9C1B4' }}>
                    <span style={{ color: '#4A9EF5' }}>▸</span>{ins}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Algorithm outline */}
          {result.implementation.algorithm_outline?.length > 0 && (
            <div>
              <p className="text-xs font-mono mb-2" style={{ color: '#FFCC44' }}>ALGORITHM OUTLINE — BETA</p>
              <ol className="space-y-1">
                {result.implementation.algorithm_outline.map((step, i) => (
                  <li key={i} className="flex gap-2 text-sm" style={{ color: '#C9C1B4' }}>
                    <span className="flex-shrink-0" style={{ color: '#FFCC44', fontFamily: "'JetBrains Mono', monospace" }}>{i + 1}.</span>{step}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {/* Validation */}
          <div>
            <p className="text-xs font-mono mb-2" style={{ color: '#8BA633' }}>VALIDATION — GAMMA</p>
            <div className="flex items-center gap-3">
              {result.validation.verified
                ? <CheckCircle className="w-4 h-4" style={{ color: '#8BA633' }} />
                : <XCircle className="w-4 h-4" style={{ color: '#ff6b6b' }} />}
              <span className="text-sm" style={{ color: '#C9C1B4' }}>
                Confidence {(result.validation.confidence * 100).toFixed(0)}% · {result.validation.execution_ms.toFixed(0)} ms
              </span>
            </div>
            {result.validation.issues?.length > 0 && (
              <ul className="mt-2 space-y-1">
                {result.validation.issues.map((iss, i) => (
                  <li key={i} className="text-sm" style={{ color: '#ff6b6b' }}>⚠ {iss}</li>
                ))}
              </ul>
            )}
          </div>
          {/* Qutrit registers */}
          <div className="flex gap-6 text-sm" style={{ color: '#C9C1B4' }}>
            <span><span className="font-mono" style={{ color: '#4A9EF5' }}>Arch:</span> {result.implementation.architecture_type}</span>
            <span><span className="font-mono" style={{ color: '#4A9EF5' }}>Qutrits:</span> {result.implementation.qutrit_registers}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function KyokushinPanel() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [query, setQuery] = useState('');
  const [context, setContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<UnifiedResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch(`${BASE}/health/kyokushin`)
      .then(r => r.json())
      .then(setHealth)
      .catch(() => {});
    const id = setInterval(() => {
      fetch(`${BASE}/health/kyokushin`).then(r => r.json()).then(setHealth).catch(() => {});
    }, 10_000);
    return () => clearInterval(id);
  }, []);

  async function submit() {
    if (!query.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { text: query.trim() };
      if (context.trim()) body.problem_context = context.trim();
      const res = await fetch(`${BASE}/query-kyokushin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const data: UnifiedResponse = await res.json();
      setResults(prev => [data, ...prev.slice(0, 4)]);
      setQuery('');
      setContext('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  }

  const allReady = health?.alpha_ready && health?.beta_ready && health?.gamma_ready;

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: '#0F0C0A', borderColor: '#272220' }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-4 px-6 py-4 border-b"
        style={{ borderColor: '#272220', background: 'linear-gradient(90deg, rgba(74,158,245,0.06) 0%, transparent 100%)' }}
      >
        <Zap className="w-5 h-5 flex-shrink-0" style={{ color: '#4A9EF5' }} />
        <div className="flex-1 min-w-0">
          <p style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 13, fontWeight: 800, letterSpacing: '0.12em', color: '#E4DFD5', textTransform: 'uppercase' }}>
            Kyokushin Brothers
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#998F82', fontFamily: "'JetBrains Mono', monospace" }}>
            Alpha · Beta · Gamma — concurrent quantum-classical orchestration
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {health ? (
            <>
              <WarriorPill name="α Alpha" ready={health.alpha_ready} />
              <WarriorPill name="β Beta"  ready={health.beta_ready}  />
              <WarriorPill name="γ Gamma" ready={health.gamma_ready} />
            </>
          ) : (
            <span className="text-xs flex items-center gap-1.5" style={{ color: '#6B655E', fontFamily: "'JetBrains Mono', monospace" }}>
              <Loader2 className="w-3 h-3 animate-spin" /> connecting…
            </span>
          )}
        </div>
      </div>

      {/* Query form */}
      <div className="px-6 py-5 space-y-3" style={{ borderBottom: '1px solid #272220' }}>
        <textarea
          ref={textareaRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Submit a problem — SAT, TSP, knapsack, graph coloring, integer programming… (⌘↵ to send)"
          rows={3}
          className="w-full resize-none rounded-xl px-4 py-3 text-sm outline-none transition-colors"
          style={{
            background: '#181411',
            border: '1px solid #272220',
            color: '#E4DFD5',
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
          onFocus={e => (e.target.style.borderColor = 'rgba(74,158,245,0.5)')}
          onBlur={e => (e.target.style.borderColor = '#272220')}
        />
        <div className="flex gap-3">
          <input
            value={context}
            onChange={e => setContext(e.target.value)}
            placeholder="Problem context (optional)"
            className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{
              background: '#181411',
              border: '1px solid #272220',
              color: '#E4DFD5',
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
            onFocus={e => (e.target.style.borderColor = 'rgba(74,158,245,0.5)')}
            onBlur={e => (e.target.style.borderColor = '#272220')}
          />
          <button
            onClick={submit}
            disabled={!query.trim() || loading || !allReady}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: 'rgba(74,158,245,0.15)',
              border: '1px solid rgba(74,158,245,0.35)',
              color: '#4A9EF5',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {loading ? 'Executing…' : 'Execute'}
          </button>
        </div>
        {error && (
          <p className="text-sm rounded-lg px-4 py-3" style={{ background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.25)', color: '#ff6b6b', fontFamily: "'JetBrains Mono', monospace" }}>
            ⚠ {error}
          </p>
        )}
        {!allReady && health && (
          <p className="text-xs" style={{ color: '#6B655E', fontFamily: "'JetBrains Mono', monospace" }}>
            Warriors not yet ready — connect LLM engines (Alpha/Beta/Gamma) in AI Engines to activate
          </p>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" style={{ color: '#998F82' }} />
            <span className="text-xs" style={{ color: '#998F82', fontFamily: "'JetBrains Mono', monospace" }}>
              RECENT EXECUTIONS ({results.length})
            </span>
          </div>
          {results.map(r => <ResponseCard key={r.task_id} result={r} />)}
        </div>
      )}
    </div>
  );
}
