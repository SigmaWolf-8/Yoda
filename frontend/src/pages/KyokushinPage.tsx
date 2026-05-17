import { useState, useEffect, useRef } from 'react';
import {
  Zap, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp,
  Send, Loader2, AlertTriangle, Plus, X,
} from 'lucide-react';
import { usePageHeader } from '../context/PageHeader';

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

interface CheckResult {
  overall: 'PASS' | 'WARNING' | 'FAIL';
  notes: string;
}
interface SecurityCheck extends CheckResult {
  timing_safety: 'PASS' | 'WARNING' | 'FAIL';
  side_channel_resistance: 'PASS' | 'WARNING' | 'FAIL';
}
interface CorrectnessCheck extends CheckResult {
  algorithm_match: 'PASS' | 'WARNING' | 'FAIL';
  complexity_valid: 'PASS' | 'WARNING' | 'FAIL';
  completeness: 'PASS' | 'WARNING' | 'FAIL';
}
interface PerformanceCheck extends CheckResult {
  runtime_acceptable: boolean;
  memory_acceptable: boolean;
  parallelism_efficient: boolean;
  estimated_throughput: string;
}
interface ValidationResponse {
  gate_status: 'APPROVED' | 'REQUIRESREVISION' | 'BLOCKED';
  security_check: SecurityCheck;
  correctness_check: CorrectnessCheck;
  performance_check: PerformanceCheck;
  approval_notes: string;
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

/* ── Warrior status badge ── */
function WarriorBadge({ kanji, name, subtitle, ready }: { kanji: string; name: string; subtitle: string; ready: boolean }) {
  return (
    <div
      className="flex-1 flex flex-col items-center gap-3 py-6 rounded-2xl border transition-all"
      style={{
        background: ready ? 'rgba(74,158,245,0.06)' : 'rgba(255,255,255,0.02)',
        borderColor: ready ? 'rgba(74,158,245,0.3)' : 'rgba(255,255,255,0.07)',
      }}
    >
      <div
        className="text-4xl font-black select-none"
        style={{
          fontFamily: "'Noto Serif JP', 'Yu Mincho', serif",
          color: ready ? '#4A9EF5' : '#3A3530',
          textShadow: ready ? '0 0 24px rgba(74,158,245,0.4)' : 'none',
          transition: 'color 0.4s, text-shadow 0.4s',
        }}
      >
        {kanji}
      </div>
      <div className="text-center">
        <p className="text-sm font-bold tracking-widest uppercase" style={{ color: ready ? '#4A9EF5' : '#6B655E', fontFamily: "'Orbitron', sans-serif", fontSize: 11 }}>
          {name}
        </p>
        <p className="text-xs mt-1" style={{ color: '#998F82', fontFamily: "'JetBrains Mono', monospace" }}>{subtitle}</p>
      </div>
      <div className="flex items-center gap-1.5 text-xs" style={{ fontFamily: "'JetBrains Mono', monospace", color: ready ? '#4A9EF5' : '#6B655E' }}>
        {ready
          ? <><CheckCircle className="w-3.5 h-3.5" /> READY</>
          : <><XCircle className="w-3.5 h-3.5" /> OFFLINE</>}
      </div>
    </div>
  );
}

/* Strip "N. " or "N." prefixes the backend sometimes pre-attaches to list items */
function stripLeadingNumber(s: string): string {
  return s.replace(/^\d+\.\s*/, '');
}

/* ── Execution timeline bars ── */
function TimeBar({ label, start, end, color, total }: { label: string; start: number; end: number; color: string; total: number }) {
  const duration = end - start;
  // When total is 0 or all values are 0, fall back to a proportional display
  // using a minimum visible width so completed work is always shown.
  const effectiveTotal = total > 0 ? total : 1;
  const leftPct  = (start / effectiveTotal) * 100;
  const widthPct = total > 0
    ? Math.max(duration > 0 ? 2 : 0, (duration / effectiveTotal) * 100)
    : (duration >= 0 ? 100 : 0); // all bars full-width when total unknown
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 text-right text-xs flex-shrink-0" style={{ color: '#998F82', fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
      <div className="flex-1 relative h-5 rounded-md overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div
          className="absolute top-0 h-full rounded-md"
          style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: color, opacity: 0.75 }}
        />
        <span className="absolute right-2 top-0 h-full flex items-center text-xs" style={{ color: '#998F82', fontFamily: "'JetBrains Mono', monospace" }}>
          {(end - start).toFixed(0)} ms
        </span>
      </div>
    </div>
  );
}

/* ── Result card ── */
function ResultCard({ result, index }: { result: UnifiedResponse; index: number }) {
  const [open, setOpen] = useState(index === 0);
  const t = result.execution_timeline;
  const total = result.total_execution_ms;

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: '#0F0C0A', borderColor: '#272220' }}>
      {/* Summary bar */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#8BA633' }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: '#E4DFD5' }}>
            {String(result.problem_class).replace(/_/g, ' ')}
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#998F82', fontFamily: "'JetBrains Mono', monospace" }}>
            {result.task_id.slice(0, 20)}… · {total.toFixed(0)} ms · η {(t.parallel_efficiency * 100).toFixed(0)}%
          </p>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          {result.brothers.map(b => (
            <span key={b} className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(74,158,245,0.1)', color: '#4A9EF5', fontFamily: "'JetBrains Mono', monospace" }}>{b}</span>
          ))}
        </div>
        {open ? <ChevronUp className="w-4 h-4 flex-shrink-0" style={{ color: '#6B655E' }} /> : <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: '#6B655E' }} />}
      </button>

      {open && (
        <div className="border-t px-6 pb-6 space-y-6" style={{ borderColor: '#272220' }}>

          {/* Complexity + approach */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-5">
            <div>
              <p className="text-xs font-mono mb-2" style={{ color: '#4A9EF5' }}>COMPLEXITY BOUND</p>
              <p className="text-sm" style={{ color: '#C9C1B4' }}>{result.analysis.complexity_bound}</p>
            </div>
            <div>
              <p className="text-xs font-mono mb-2" style={{ color: '#4A9EF5' }}>RECOMMENDED APPROACH</p>
              <p className="text-sm" style={{ color: '#C9C1B4' }}>{result.analysis.recommended_approach}</p>
            </div>
          </div>

          {/* Timeline */}
          <div>
            <p className="text-xs font-mono mb-3" style={{ color: '#4A9EF5' }}>EXECUTION TIMELINE</p>
            <div className="space-y-2">
              <TimeBar label="Alpha" start={t.alpha_start_ms} end={t.alpha_end_ms} color="#4A9EF5" total={total} />
              <TimeBar label="Beta"  start={t.beta_start_ms}  end={t.beta_end_ms}  color="#FFCC44" total={total} />
              <TimeBar label="Gamma" start={t.gamma_start_ms} end={t.gamma_end_ms} color="#8BA633" total={total} />
            </div>
          </div>

          {/* Alpha — key insights */}
          {result.analysis.key_insights?.length > 0 && (
            <div>
              <p className="text-xs font-mono mb-2" style={{ color: '#4A9EF5' }}>KEY INSIGHTS — α ALPHA</p>
              <ul className="space-y-1.5">
                {result.analysis.key_insights.map((ins, i) => (
                  <li key={i} className="flex gap-2 text-sm" style={{ color: '#C9C1B4' }}>
                    <span className="flex-shrink-0 mt-0.5" style={{ color: '#4A9EF5' }}>▸</span>{ins}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Decomposition steps */}
          {result.analysis.decomposition_steps?.length > 0 && (
            <div>
              <p className="text-xs font-mono mb-2" style={{ color: '#4A9EF5' }}>DECOMPOSITION — α ALPHA</p>
              <ol className="space-y-1.5">
                {result.analysis.decomposition_steps.map((s, i) => (
                  <li key={i} className="flex gap-2 text-sm" style={{ color: '#C9C1B4' }}>
                    <span className="flex-shrink-0 w-5 text-right" style={{ color: '#4A9EF5', fontFamily: "'JetBrains Mono', monospace" }}>{i + 1}.</span>{stripLeadingNumber(s)}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Beta — algorithm */}
          {result.implementation.algorithm_outline?.length > 0 && (
            <div>
              <p className="text-xs font-mono mb-2" style={{ color: '#FFCC44' }}>ALGORITHM OUTLINE — β BETA</p>
              <ol className="space-y-1.5">
                {result.implementation.algorithm_outline.map((step, i) => (
                  <li key={i} className="flex gap-2 text-sm" style={{ color: '#C9C1B4' }}>
                    <span className="flex-shrink-0 w-5 text-right" style={{ color: '#FFCC44', fontFamily: "'JetBrains Mono', monospace" }}>{i + 1}.</span>{stripLeadingNumber(step)}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Gamma — validation */}
          <div>
            <p className="text-xs font-mono mb-3" style={{ color: '#8BA633' }}>VALIDATION — γ GAMMA</p>

            {/* Gate status banner */}
            {(() => {
              const gs = result.validation.gate_status;
              const approved = gs === 'APPROVED';
              const blocked  = gs === 'BLOCKED';
              const color    = approved ? '#8BA633' : blocked ? '#ff6b6b' : '#FFCC44';
              const Icon     = approved ? CheckCircle : XCircle;
              return (
                <div className="flex items-center gap-3 mb-3 px-3 py-2 rounded-lg" style={{ background: `${color}18`, border: `1px solid ${color}40` }}>
                  <Icon className="w-4 h-4 flex-shrink-0" style={{ color }} />
                  <span className="text-sm font-mono" style={{ color }}>
                    {gs ?? 'UNKNOWN'}
                  </span>
                  <span className="text-xs ml-auto" style={{ color: '#998F82', fontFamily: "'JetBrains Mono', monospace" }}>
                    {typeof result.validation.execution_ms === 'number' ? `${result.validation.execution_ms.toFixed(2)} ms` : ''}
                  </span>
                </div>
              );
            })()}

            {/* Approval notes */}
            {result.validation.approval_notes && (
              <p className="text-sm mb-3" style={{ color: '#C9C1B4' }}>{result.validation.approval_notes}</p>
            )}

            {/* Check grid */}
            {result.validation.security_check && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
                {[
                  { label: 'Security',    overall: result.validation.security_check?.overall,    notes: result.validation.security_check?.notes },
                  { label: 'Correctness', overall: result.validation.correctness_check?.overall, notes: result.validation.correctness_check?.notes },
                  { label: 'Performance', overall: result.validation.performance_check?.overall, notes: result.validation.performance_check?.notes },
                ].map(({ label, overall, notes }) => {
                  const color = overall === 'PASS' ? '#8BA633' : overall === 'WARNING' ? '#FFCC44' : '#ff6b6b';
                  return (
                    <div key={label} className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${color}30` }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono" style={{ color, fontFamily: "'JetBrains Mono', monospace" }}>{overall ?? '—'}</span>
                        <span className="text-xs" style={{ color: '#998F82' }}>{label}</span>
                      </div>
                      {notes && <p className="text-xs" style={{ color: '#6B655E' }}>{notes}</p>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Throughput */}
            {result.validation.performance_check?.estimated_throughput && (
              <p className="text-xs font-mono" style={{ color: '#998F82' }}>
                throughput: <span style={{ color: '#C9C1B4' }}>{result.validation.performance_check.estimated_throughput}</span>
              </p>
            )}

            {/* Issues */}
            {result.validation.issues?.length > 0 && (
              <ul className="space-y-1 mt-2">
                {result.validation.issues.map((iss, i) => (
                  <li key={i} className="text-sm" style={{ color: '#ff6b6b' }}>⚠ {iss}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer meta */}
          <div className="flex flex-wrap gap-6 text-sm border-t pt-4" style={{ borderColor: '#272220', color: '#998F82' }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              <span style={{ color: '#4A9EF5' }}>arch:</span> {result.implementation.architecture_type}
            </span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              <span style={{ color: '#4A9EF5' }}>qutrits:</span> {result.implementation.qutrit_registers}
            </span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              <span style={{ color: '#4A9EF5' }}>merged:</span> {result.merged_at_hptp}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

const STORAGE_KEY = 'kyokushin-results-v1';

function loadStoredResults(): UnifiedResponse[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as UnifiedResponse[];
  } catch { return []; }
}

function saveResults(results: UnifiedResponse[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(results.slice(0, 20))); } catch { /* quota */ }
}

/* ── Page ── */
export function KyokushinPage() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [query, setQuery] = useState('');
  const [context, setContext] = useState('');
  const [constraints, setConstraints] = useState<string[]>([]);
  const [newConstraint, setNewConstraint] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<UnifiedResponse[]>(loadStoredResults);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  usePageHeader({
    icon: Zap,
    title: 'Kyokushin Brothers',
    subtitle: 'α Alpha · β Beta · γ Gamma — concurrent quantum-classical problem orchestration',
  });

  useEffect(() => {
    const load = () =>
      fetch(`${BASE}/health/kyokushin`)
        .then(r => r.json())
        .then(setHealth)
        .catch(() => {});
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  async function submit() {
    if (!query.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { text: query.trim() };
      if (context.trim()) body.problem_context = context.trim();
      if (constraints.length > 0) body.constraints = constraints;
      const res = await fetch(`${BASE}/query-kyokushin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data: UnifiedResponse = await res.json();
      setResults(prev => {
        const next = [data, ...prev.slice(0, 19)];
        saveResults(next);
        return next;
      });
      setQuery('');
      setContext('');
      setConstraints([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function addConstraint() {
    const c = newConstraint.trim();
    if (c && !constraints.includes(c)) {
      setConstraints(prev => [...prev, c]);
      setNewConstraint('');
    }
  }

  const allReady = health?.alpha_ready && health?.beta_ready && health?.gamma_ready;

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-8 animate-fade-in">

      {/* ── Warriors status row ── */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-1 h-5 rounded-full" style={{ background: '#4A9EF5' }} />
          <h2 className="text-xs font-bold tracking-widest uppercase" style={{ color: '#998F82', fontFamily: "'Orbitron', sans-serif" }}>
            Warrior Status
          </h2>
          {health === null && (
            <Loader2 className="w-3.5 h-3.5 animate-spin ml-1" style={{ color: '#6B655E' }} />
          )}
        </div>
        <div className="flex gap-3">
          <WarriorBadge kanji="剛" name="Alpha" subtitle="Analysis · O(n log n)" ready={health?.alpha_ready ?? false} />
          <WarriorBadge kanji="柔" name="Beta"  subtitle="Synthesis · O(n²)"    ready={health?.beta_ready  ?? false} />
          <WarriorBadge kanji="空" name="Gamma" subtitle="Validation · O(n)"    ready={health?.gamma_ready ?? false} />
        </div>
        {health && !allReady && (
          <p className="mt-3 text-xs flex items-center gap-2" style={{ color: '#6B655E', fontFamily: "'JetBrains Mono', monospace" }}>
            <AlertTriangle className="w-3.5 h-3.5" />
            Connect LLM engines in AI Engines to activate warriors
          </p>
        )}
      </div>

      {/* ── Query form ── */}
      <div className="rounded-2xl border overflow-hidden" style={{ background: '#0F0C0A', borderColor: '#272220' }}>
        <div
          className="flex items-center gap-3 px-6 py-4 border-b"
          style={{ borderColor: '#272220', background: 'linear-gradient(90deg, rgba(74,158,245,0.05) 0%, transparent 60%)' }}
        >
          <Zap className="w-4 h-4" style={{ color: '#4A9EF5' }} />
          <span className="text-xs font-bold tracking-widest uppercase" style={{ color: '#998F82', fontFamily: "'Orbitron', sans-serif" }}>
            Submit Problem
          </span>
        </div>

        <div className="p-6 space-y-4">
          <textarea
            ref={textareaRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
            placeholder="Describe the problem — SAT, TSP, graph coloring, integer programming, knapsack, factorization…&#10;&#10;⌘↵ or Ctrl+↵ to execute"
            rows={5}
            className="w-full resize-none rounded-xl px-5 py-4 text-sm outline-none leading-relaxed"
            style={{
              background: '#181411',
              border: '1px solid #272220',
              color: '#E4DFD5',
              fontFamily: "'Inter', system-ui, sans-serif",
              transition: 'border-color 0.15s',
            }}
            onFocus={e => (e.target.style.borderColor = 'rgba(74,158,245,0.5)')}
            onBlur={e => (e.target.style.borderColor = '#272220')}
          />

          <input
            value={context}
            onChange={e => setContext(e.target.value)}
            placeholder="Problem context — domain, scale, prior attempts (optional)"
            className="w-full rounded-xl px-5 py-3 text-sm outline-none"
            style={{
              background: '#181411',
              border: '1px solid #272220',
              color: '#E4DFD5',
              fontFamily: "'Inter', system-ui, sans-serif",
              transition: 'border-color 0.15s',
            }}
            onFocus={e => (e.target.style.borderColor = 'rgba(74,158,245,0.5)')}
            onBlur={e => (e.target.style.borderColor = '#272220')}
          />

          {/* Constraints */}
          <div>
            <div className="flex gap-2 mb-2">
              <input
                value={newConstraint}
                onChange={e => setNewConstraint(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addConstraint(); } }}
                placeholder="Add constraint (↵ to add)"
                className="flex-1 rounded-lg px-4 py-2.5 text-sm outline-none"
                style={{
                  background: '#181411',
                  border: '1px solid #272220',
                  color: '#E4DFD5',
                  fontFamily: "'Inter', system-ui, sans-serif",
                }}
                onFocus={e => (e.target.style.borderColor = 'rgba(74,158,245,0.35)')}
                onBlur={e => (e.target.style.borderColor = '#272220')}
              />
              <button
                onClick={addConstraint}
                className="px-3 py-2.5 rounded-lg border text-sm"
                style={{ border: '1px solid #272220', color: '#6B655E', background: '#181411' }}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {constraints.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {constraints.map(c => (
                  <span key={c} className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs" style={{ background: 'rgba(74,158,245,0.08)', border: '1px solid rgba(74,158,245,0.2)', color: '#4A9EF5', fontFamily: "'JetBrains Mono', monospace" }}>
                    {c}
                    <button onClick={() => setConstraints(prev => prev.filter(x => x !== c))}><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.2)', color: '#ff6b6b', fontFamily: "'JetBrains Mono', monospace" }}>
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={submit}
              disabled={!query.trim() || loading || !allReady}
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: 'rgba(74,158,245,0.12)',
                border: '1px solid rgba(74,158,245,0.35)',
                color: '#4A9EF5',
                fontFamily: "'Orbitron', sans-serif",
                fontSize: 12,
                letterSpacing: '0.1em',
              }}
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> EXECUTING…</>
                : <><Send className="w-4 h-4" /> EXECUTE</>}
            </button>
          </div>
        </div>
      </div>

      {/* ── Results ── */}
      {results.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-1 h-5 rounded-full" style={{ background: '#8BA633' }} />
            <h2 className="text-xs font-bold tracking-widest uppercase" style={{ color: '#998F82', fontFamily: "'Orbitron', sans-serif" }}>
              Execution Results
            </h2>
            <span className="ml-1 text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(139,166,51,0.12)', color: '#8BA633', fontFamily: "'JetBrains Mono', monospace" }}>
              {results.length}
            </span>
            <button
              onClick={() => { setResults([]); localStorage.removeItem(STORAGE_KEY); }}
              className="ml-auto text-xs px-2 py-0.5 rounded"
              style={{ color: '#6B655E', background: 'transparent', border: '1px solid #272220', cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace" }}
              title="Clear all results"
            >clear</button>
          </div>
          {results.map((r, i) => <ResultCard key={r.task_id} result={r} index={i} />)}
        </div>
      )}
    </div>
  );
}
