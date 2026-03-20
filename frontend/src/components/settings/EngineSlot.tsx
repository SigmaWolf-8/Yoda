import { useState, useEffect } from 'react';
import {
  Server,
  Cloud,
  Gift,
  AlertCircle,
  Save,
  Loader2,
  HelpCircle,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Ban,
  Download,
} from 'lucide-react';
import { ModelInstallModal } from './ModelInstallModal';
import { useUpdateEngine } from '../../api/hooks';
import { useToast } from '../common/Toast';
import type {
  EngineConfig,
  EngineSlot as Slot,
  HostingMode,
  AuthType,
} from '../../types';

// ── Model knowledge base ──────────────────────────────────────────────────────
//
// ramGbQ4:  RAM in GB at Q4_K_M quantization (standard self-host preset)
// ramGbQ3:  RAM in GB at Q3_K_M quantization (fallback for borderline machines)
// Fit is computed dynamically — nothing hardcoded.

export type FitLevel = 'ok' | 'tight' | 'no';

export interface ModelMeta {
  desc: string;
  specialty: string;
  type: string;
  ramGbQ4?: number;   // undefined = cloud-hosted
  ramGbQ3?: number;
}

export const MODEL_INFO: Record<string, ModelMeta> = {
  // ── Anthropic (cloud) ───────────────────────────────────────────────────
  'claude-opus-4-6':   { type: 'LLM', specialty: 'Complex reasoning · Long documents · Nuanced writing', desc: "Anthropic's most powerful model. Best for deep analysis, intricate code review, and tasks requiring careful multi-step reasoning." },
  'claude-sonnet-4-6': { type: 'LLM', specialty: 'Coding · Analysis · Speed + quality balance', desc: "Anthropic's balanced workhorse. Strong reasoning at faster speeds — the best all-round choice for most YODA pipelines." },
  'claude-haiku-4-5':  { type: 'LLM', specialty: 'Fast summaries · Simple edits · Low latency', desc: "Anthropic's lightest Claude. Excellent for rapid classification, quick rewrites, and high-volume lightweight tasks." },
  // ── OpenAI (cloud) ──────────────────────────────────────────────────────
  'gpt-4.5':  { type: 'LLM', specialty: 'Frontier reasoning · Instruction-following · Multimodal', desc: "OpenAI's most capable model. Handles complex instructions with high fidelity; strong across coding, math, and creative tasks." },
  'gpt-4o':   { type: 'LLM', specialty: 'Fast · Multimodal · General purpose', desc: "OpenAI's versatile everyday model. Rapid responses with strong reasoning — ideal as a second or third reviewer engine." },
  'o3-mini':  { type: 'Reasoning LLM', specialty: 'Math · Code · Step-by-step logic', desc: "OpenAI's compact reasoning model. Uses chain-of-thought internally to excel at structured problem-solving at lower cost than o3." },
  // ── xAI (cloud) ─────────────────────────────────────────────────────────
  'grok-3':           { type: 'LLM', specialty: 'Real-time data · Long context · Coding', desc: "xAI's flagship model. Live web search, very long context, and top coding performance." },
  'grok-3-fast':      { type: 'LLM', specialty: 'High throughput · Real-time data · Coding', desc: "Faster-throughput variant of Grok 3. Same capability ceiling at higher request volumes." },
  'grok-3-mini':      { type: 'Reasoning LLM', specialty: 'Efficient · Chain-of-thought · Cost-effective', desc: "xAI's compact reasoning model. Thinks before answering — great for structured logic at lower cost than Grok 3." },
  'grok-3-mini-fast': { type: 'Reasoning LLM', specialty: 'Fastest · Low latency · High volume', desc: "xAI's fastest and most cost-efficient model. Best for high-volume, latency-sensitive review passes." },
  // ── Google (cloud) ──────────────────────────────────────────────────────
  'gemini-2.5-pro':   { type: 'LLM', specialty: 'Long context · Code · Multi-step reasoning', desc: "Google's most capable model. Handles up to 1M-token contexts, excels at large codebase analysis and document-heavy tasks." },
  'gemini-2.5-flash': { type: 'LLM', specialty: 'High throughput · Summarisation · Extraction', desc: "Google's speed-optimised model. Very fast token generation — ideal for high-volume extraction and summarisation passes." },
  'gemini-3-pro':     { type: 'LLM', specialty: 'Advanced reasoning · Multimodal · Next-gen', desc: "Google's next-generation flagship. State-of-the-art reasoning across text, code, and images." },
  // ── DeepSeek (cloud) ────────────────────────────────────────────────────
  'DeepSeek-V3.2': { type: 'LLM', specialty: 'Coding · Math · Cost-efficient frontier', desc: "DeepSeek's latest dense model. Competitive with frontier LLMs on coding and math benchmarks at significantly lower cost." },
  'DeepSeek-R1':   { type: 'Reasoning LLM', specialty: 'Chain-of-thought · Math · Complex problem-solving', desc: "DeepSeek's reasoning model. Publishes its thinking process step-by-step; outstanding on logic, proofs, and algorithmic problems." },

  // ── Self-hosted ─────────────────────────────────────────────────────────
  'Llama-3.1-8B': {
    type: 'LLM', specialty: 'Compact · Fast · Widely supported',
    desc: "Meta's compact open model. Supported by every inference server (Ollama, llama.cpp, LM Studio). Excellent on ARM/NPU hardware.",
    ramGbQ4: 4.7,
  },
  'Qwen3.5-9B': {
    type: 'LLM', specialty: 'Compact · Fast · Coding · Multilingual',
    desc: "Qwen's compact 9B model. Efficient on CPU/NPU, strong multilingual and coding performance. A popular first self-hosted choice.",
    ramGbQ4: 5.3,
  },
  'Mistral-Nemo-12B': {
    type: 'LLM', specialty: 'Efficient · Multilingual · Instruction-following',
    desc: "Mistral's efficient 12B model. Great quality-to-size ratio — strong multilingual and instruction-following with a small footprint.",
    ramGbQ4: 7.2,
  },
  'GLM-5': {
    type: 'LLM', specialty: 'Chinese language · General reasoning',
    desc: "Zhipu AI's ~9B model. Excellent Chinese language support alongside solid general reasoning and coding ability.",
    ramGbQ4: 5.3,
  },
  'Qwen3.5-27B': {
    type: 'LLM', specialty: 'Coding · Multilingual · Balanced quality',
    desc: "Alibaba's mid-size 27B model. Strong quality — may need Q3 quantization on machines with less RAM.",
    ramGbQ4: 16.0, ramGbQ3: 12.5,
  },
  'Qwen3.5-35B-A3B': {
    type: 'Mixture-of-Experts LLM', specialty: 'High capability · Efficient active compute · Coding',
    desc: "MoE model with only 3B active parameters per token — but all 35B weights must still load into RAM for fast routing.",
    ramGbQ4: 21.6, ramGbQ3: 16.8,
  },
  'DeepSeek-R1-Distill-Qwen-32B': {
    type: 'Reasoning LLM', specialty: 'Math · Code · Chain-of-thought reasoning',
    desc: "DeepSeek-R1 reasoning distilled into a 32B Qwen model. Excellent step-by-step reasoning at self-hosted scale.",
    ramGbQ4: 19.8, ramGbQ3: 15.4,
  },
  'DeepSeek-R1-Distill-Llama-70B': {
    type: 'Reasoning LLM', specialty: 'Complex reasoning · Large self-hosted option',
    desc: "DeepSeek-R1 reasoning distilled into Llama-70B. Powerful open-weight reasoning model for high-RAM workstations.",
    ramGbQ4: 41.0, ramGbQ3: 31.9,
  },
  'Llama-3.1-70B': {
    type: 'LLM', specialty: 'Strong open-weight · Coding · General tasks',
    desc: "Meta's strong 70B open model. Competitive with many commercial models for coding and instruction-following.",
    ramGbQ4: 41.0, ramGbQ3: 31.9,
  },
  'Mistral-Large-3': {
    type: 'LLM', specialty: 'Top-tier reasoning · Coding · Multilingual',
    desc: "Mistral's 123B flagship open model. Top-tier performance across coding, reasoning, and multilingual tasks.",
    ramGbQ4: 72.0, ramGbQ3: 56.0,
  },
  'Qwen3.5-122B': {
    type: 'LLM', specialty: 'Near-frontier quality · Complex reasoning · Coding',
    desc: "Alibaba's largest Qwen. Matches frontier commercial quality for reasoning and code — requires a high-RAM workstation.",
    ramGbQ4: 73.0, ramGbQ3: 57.0,
  },
  'Llama-4-Maverick': {
    type: 'Multimodal LLM', specialty: 'Native multimodal · Extended context · Next-gen',
    desc: "Meta's next-gen MoE model (~400B total weights). Requires enterprise-grade multi-GPU infrastructure.",
    ramGbQ4: 229.0,
  },
  'Kimi-K2.5': {
    type: 'Mixture-of-Experts LLM', specialty: 'Long context · Document understanding · 200K tokens',
    desc: "Moonshot AI's large MoE model. The full weight set far exceeds any consumer or prosumer machine.",
    ramGbQ4: 500.0,
  },
};

// ── Resource helpers ──────────────────────────────────────────────────────────

export const OS_OVERHEAD_GB = 3;

/** Compute fit given total host RAM and RAM already reserved by other self-hosted slots. */
export function computeFit(info: ModelMeta, hostRam: number, reservedRam = 0): FitLevel | undefined {
  if (info.ramGbQ4 === undefined) return undefined;
  const available = hostRam - OS_OVERHEAD_GB - reservedRam;
  if (info.ramGbQ4 <= available) return 'ok';
  if (info.ramGbQ3 !== undefined && info.ramGbQ3 <= available) return 'tight';
  return 'no';
}

export function ramDisplay(info: ModelMeta): string | undefined {
  if (info.ramGbQ4 === undefined) return undefined;
  const q4 = `~${info.ramGbQ4} GB (Q4)`;
  return info.ramGbQ3 !== undefined ? `${q4} · ~${info.ramGbQ3} GB (Q3)` : q4;
}

const ALL_SELF_HOSTED = [
  'Llama-3.1-8B', 'Qwen3.5-9B', 'Mistral-Nemo-12B', 'GLM-5',
  'Qwen3.5-27B', 'Qwen3.5-35B-A3B',
  'DeepSeek-R1-Distill-Qwen-32B', 'DeepSeek-R1-Distill-Llama-70B',
  'Llama-3.1-70B', 'Mistral-Large-3', 'Qwen3.5-122B',
  'Llama-4-Maverick', 'Kimi-K2.5',
];

export const OLLAMA_TAG: Record<string, string> = {
  'Llama-3.1-8B':                   'llama3.1:8b',
  'Qwen3.5-9B':                     'qwen3:9b',
  'Mistral-Nemo-12B':               'mistral-nemo',
  'Qwen3.5-27B':                    'qwen3:27b',
  'Qwen3.5-35B-A3B':                'qwen3:35b-a3b',
  'DeepSeek-R1-Distill-Qwen-32B':   'deepseek-r1:32b',
  'DeepSeek-R1-Distill-Llama-70B':  'deepseek-r1:70b',
  'Llama-3.1-70B':                  'llama3.1:70b',
  'Mistral-Large-3':                'mistral-large:123b',
  'Qwen3.5-122B':                   'qwen3:122b',
  'Llama-4-Maverick':               'llama4:maverick',
};

export const MANUAL_INSTALL_URL: Record<string, string> = {
  'GLM-5':     'https://huggingface.co/THUDM/GLM-4',
  'Kimi-K2.5': 'https://huggingface.co/moonshotai/Kimi-K2-Instruct',
};

const FIT_ORDER: Record<string, number> = { ok: 0, tight: 1, no: 2 };

function sortedModels(
  hostRam: number,
  filter: string,
  usedModels: string[],
  reservedRam: number,
): string[] {
  return ALL_SELF_HOSTED
    .filter((m) =>
      m.toLowerCase().includes(filter.toLowerCase())
      && m !== filter
      && !usedModels.includes(m),
    )
    .sort((a, b) => {
      const fa = FIT_ORDER[computeFit(MODEL_INFO[a], hostRam, reservedRam) ?? 'no'];
      const fb = FIT_ORDER[computeFit(MODEL_INFO[b], hostRam, reservedRam) ?? 'no'];
      return fa - fb;
    });
}

const PROVIDERS: Record<string, { authType: AuthType; models: string[] }> = {
  Anthropic: { authType: 'api_key', models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'] },
  OpenAI:    { authType: 'bearer',  models: ['gpt-4.5', 'gpt-4o', 'o3-mini'] },
  xAI:       { authType: 'bearer',  models: ['grok-3', 'grok-3-fast', 'grok-3-mini', 'grok-3-mini-fast'] },
  Google:    { authType: 'bearer',  models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-pro'] },
  DeepSeek:  { authType: 'api_key', models: ['DeepSeek-V3.2', 'DeepSeek-R1'] },
};

const SLOT_LABELS: Record<Slot, string> = { a: 'Engine A', b: 'Engine B', c: 'Engine C' };

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tooltip({ content, children, wide }: { content: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <span className="relative group/tip inline-flex items-center">
      {children}
      <span className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 ${wide ? 'w-80' : 'w-60'} p-3 rounded-xl
        bg-[var(--color-navy-850,#0d1829)] border border-[var(--color-navy-600)]
        text-xs text-[var(--color-navy-100)] shadow-xl
        opacity-0 pointer-events-none group-hover/tip:opacity-100
        transition-opacity duration-150 z-50 leading-relaxed text-left`}
      >
        {content}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[var(--color-navy-600)]" />
      </span>
    </span>
  );
}

// ── Resource badge ────────────────────────────────────────────────────────────

function ResourceBadge({ fit, ram }: { fit: FitLevel; ram: string }) {
  if (fit === 'ok') return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400">
      <CheckCircle2 className="w-3 h-3" />{ram} · Fits
    </span>
  );
  if (fit === 'tight') return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400">
      <AlertTriangle className="w-3 h-3" />{ram} · Tight — use Q3 quant
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-red-400">
      <XCircle className="w-3 h-3" />{ram} · Needs more RAM
    </span>
  );
}

// ── Model description card ────────────────────────────────────────────────────

function ModelCard({ modelName, hostRam, reservedRam }: { modelName: string; hostRam: number; reservedRam: number }) {
  const info = MODEL_INFO[modelName];
  if (!info) return null;
  const fit = computeFit(info, hostRam, reservedRam);
  const ram = ramDisplay(info);
  return (
    <div className="mt-2 px-3 py-2.5 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-subtle)] text-xs space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-1.5 py-0.5 rounded bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)] font-medium text-[10px]">
          {info.type}
        </span>
        <span className="text-[var(--color-text-muted)]">{info.specialty}</span>
      </div>
      {fit && ram && <ResourceBadge fit={fit} ram={ram} />}
      <p className="text-[var(--color-text-tertiary)] leading-relaxed">{info.desc}</p>
    </div>
  );
}

// ── Fit icon for typeahead ────────────────────────────────────────────────────

function FitDot({ fit }: { fit?: FitLevel }) {
  if (fit === 'ok')    return <CheckCircle2  className="w-3 h-3 flex-shrink-0 text-emerald-400" />;
  if (fit === 'tight') return <AlertTriangle className="w-3 h-3 flex-shrink-0 text-amber-400" />;
  if (fit === 'no')    return <XCircle       className="w-3 h-3 flex-shrink-0 text-red-400" />;
  return <span className="w-3 h-3 flex-shrink-0" />;
}

// ── Main component ────────────────────────────────────────────────────────────

export interface EngineSlotCardProps {
  slot: Slot;
  config?: EngineConfig;
  hostRam: number;
  /** RAM (GB) already committed by the other two self-hosted engine slots. */
  reservedRam: number;
  /** Model names already chosen in the other two slots — hidden from this slot's suggestions. */
  usedModels: string[];
  onModelChange: (model: string) => void;
  onModeChange: (mode: HostingMode) => void;
}

export function EngineSlotCard({
  slot, config, hostRam, reservedRam, usedModels,
  onModelChange, onModeChange,
}: EngineSlotCardProps) {
  const update = useUpdateEngine();
  const { toast } = useToast();

  const [mode, setMode] = useState<HostingMode>(config?.hosting_mode ?? 'self_hosted');
  const [endpoint, setEndpoint] = useState(config?.endpoint_url ?? '');
  const [authType, setAuthType] = useState<AuthType>(config?.auth_type ?? 'none');
  const [credentials, setCredentials] = useState('');
  const [modelName, setModelName] = useState(config?.model_name ?? '');
  const [provider, setProvider] = useState('');
  const [familyOverride, setFamilyOverride] = useState(config?.family_override ?? '');
  const [showSuggest, setShowSuggest] = useState(false);
  const [installModalOpen, setInstallModalOpen] = useState(false);

  function changeMode(m: HostingMode) {
    setMode(m);
    onModeChange(m);
  }

  function changeModel(m: string) {
    setModelName(m);
    onModelChange(m);
  }

  useEffect(() => {
    if (mode === 'self_hosted') {
      setAuthType('none');
      if (!endpoint) setEndpoint('http://localhost:8001');
    }
  }, [mode]);

  useEffect(() => {
    const p = PROVIDERS[provider];
    if (p) {
      setAuthType(p.authType);
      if (!endpoint) {
        const urls: Record<string, string> = {
          Anthropic: 'https://api.anthropic.com/v1/messages',
          OpenAI:    'https://api.openai.com/v1/chat/completions',
          xAI:       'https://api.x.ai/v1/chat/completions',
          Google:    'https://generativelanguage.googleapis.com/v1beta/models',
          DeepSeek:  'https://api.deepseek.com/v1/chat/completions',
        };
        setEndpoint(urls[provider] ?? '');
      }
    }
  }, [provider]);

  // Notify parent on first render so parent state is in sync
  useEffect(() => { onModelChange(modelName); }, []);
  useEffect(() => { onModeChange(mode); }, []);

  function handleSave() {
    update.mutate(
      {
        slot,
        hosting_mode: mode,
        endpoint_url: endpoint,
        auth_type: authType,
        credentials: credentials || undefined,
        model_name: modelName,
        family_override: familyOverride || null,
      },
      {
        onSuccess: () => toast('success', `Engine ${slot.toUpperCase()} saved — ${modelName || 'configuration updated'}.`),
        onError:   () => toast('error',   `Failed to save Engine ${slot.toUpperCase()}. Check your connection and try again.`),
      },
    );
  }

  const healthDot = config?.health_status === 'online'
    ? 'bg-[var(--color-ok)]'
    : config?.health_status === 'suspect'
      ? 'bg-[var(--color-warn)]'
      : 'bg-[var(--color-err)]';

  const suggestions = sortedModels(hostRam, modelName, usedModels, reservedRam);
  const availableGb  = hostRam - OS_OVERHEAD_GB - reservedRam;

  const MODE_TIPS: Record<HostingMode, string> = {
    self_hosted: 'Run a model on your own hardware via a local endpoint (Ollama, llama.cpp, LM Studio, vLLM). No data leaves your machine.',
    commercial:  'Connect to a paid API from Anthropic, OpenAI, xAI, Google, or DeepSeek. Requires an API key and charges per token.',
    free_tier:   "Use a provider's free or trial tier — same setup as Commercial but typically rate-limited with daily message caps.",
  };

  return (
    <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{SLOT_LABELS[slot]}</h3>
        <div className="flex items-center gap-2">
          {config && (
            <>
              <span className={`w-2 h-2 rounded-full ${healthDot}`} />
              <span className="text-xs text-[var(--color-text-muted)]">
                {config.health_status ?? 'unknown'}
                {config.latency_ms ? ` · ${config.latency_ms}ms` : ''}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Mode selector */}
      <div className="flex gap-2 mb-4">
        {([
          { m: 'self_hosted' as const, icon: Server, label: 'Self-Hosted' },
          { m: 'commercial' as const, icon: Cloud,  label: 'Commercial' },
          { m: 'free_tier'  as const, icon: Gift,   label: 'Free Tier'  },
        ]).map(({ m, icon: Icon, label }) => (
          <Tooltip key={m} content={MODE_TIPS[m]}>
            <button
              onClick={() => changeMode(m)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium border transition-colors ${
                mode === m
                  ? 'bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)] border-[var(--color-gold-500)]/30'
                  : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-tertiary)] border-[var(--color-border-default)] hover:border-[var(--color-border-strong)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          </Tooltip>
        ))}
      </div>

      <div className="space-y-3">
        {/* ── Self-Hosted fields ────────────────────────────────────────── */}
        {mode === 'self_hosted' && (
          <>
            {/* RAM context banner — shows available RAM accounting for other slots */}
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-subtle)] text-[10px] text-[var(--color-text-muted)] leading-relaxed">
              <span className="mt-0.5 flex-shrink-0">💡</span>
              <span>
                {reservedRam > 0
                  ? <>
                      RAM estimates are for <strong>Q4</strong> quant.
                      {' '}<strong>{hostRam} GB</strong> host
                      {' '}− {OS_OVERHEAD_GB} GB OS
                      {' '}− {reservedRam.toFixed(1)} GB other engines
                      {' '}= <strong className="text-[var(--color-text-secondary)]">{availableGb.toFixed(1)} GB free</strong> for this slot.
                    </>
                  : <>
                      RAM estimates are for <strong>Q4</strong> quant.
                      {' '}<strong>{hostRam} GB</strong> host − {OS_OVERHEAD_GB} GB OS
                      {' '}= <strong className="text-[var(--color-text-secondary)]">{availableGb.toFixed(1)} GB available</strong>.
                    </>
                }
                {' '}<span className="text-emerald-400">✓ Fits</span>{' · '}
                <span className="text-amber-400">⚠ Q3 only</span>{' · '}
                <span className="text-red-400">✗ Too large</span>.
              </span>
            </div>

            {/* Model typeahead */}
            <div className="relative">
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Model</label>
              <input
                type="text"
                value={modelName}
                onChange={(e) => { changeModel(e.target.value); setShowSuggest(true); }}
                onFocus={() => setShowSuggest(true)}
                onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                placeholder="e.g. Llama-3.1-8B"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
              />
              {showSuggest && (
                <div className="absolute z-20 w-full mt-1 max-h-72 overflow-y-auto rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] shadow-lg">
                  {suggestions.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-[var(--color-text-muted)] italic">
                      No matching models available
                    </div>
                  ) : suggestions.map((m) => {
                    const info = MODEL_INFO[m];
                    const fit  = computeFit(info, hostRam, reservedRam);
                    const ram  = ramDisplay(info);
                    return (
                      <button
                        key={m}
                        onMouseDown={() => { changeModel(m); setShowSuggest(false); }}
                        className="w-full text-left px-3 py-2 hover:bg-[var(--color-surface-hover)] transition-colors border-b border-[var(--color-border-subtle)] last:border-0"
                      >
                        <div className="flex items-center gap-2">
                          <FitDot fit={fit} />
                          <span className="text-sm text-[var(--color-text-secondary)] font-medium flex-1">{m}</span>
                          {ram && (
                            <span className="text-[10px] text-[var(--color-text-muted)] flex-shrink-0">
                              {ram.split('·')[0].trim()}
                            </span>
                          )}
                        </div>
                        {info && (
                          <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5 pl-5">{info.specialty}</div>
                        )}
                      </button>
                    );
                  })}

                  {/* Show count of models hidden because they're used elsewhere */}
                  {usedModels.filter((u) => ALL_SELF_HOSTED.includes(u)).length > 0 && (
                    <div className="px-3 py-2 flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)] border-t border-[var(--color-border-subtle)]">
                      <Ban className="w-3 h-3 flex-shrink-0" />
                      {usedModels.filter((u) => ALL_SELF_HOSTED.includes(u)).map((u) => (
                        <span key={u} className="line-through opacity-60">{u}</span>
                      )).reduce((acc: React.ReactNode[], el, i) => i === 0 ? [el] : [...acc, ', ', el], [])}
                      {' '}already assigned
                    </div>
                  )}
                </div>
              )}
            </div>

            <ModelCard modelName={modelName} hostRam={hostRam} reservedRam={reservedRam} />

            {/* Install & Connect button — only for Ollama-compatible and manual-install models */}
            {modelName && (OLLAMA_TAG[modelName] || MANUAL_INSTALL_URL[modelName]) && (
              <button
                onClick={() => setInstallModalOpen(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-gold-500)]/40 bg-[var(--color-gold-500)]/8 text-[var(--color-gold-400)] text-xs font-medium hover:bg-[var(--color-gold-500)]/15 hover:border-[var(--color-gold-500)]/70 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Install &amp; Connect
              </button>
            )}

            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Endpoint URL</label>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="http://localhost:8001"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
              />
            </div>
          </>
        )}

        {/* ── Commercial / Free Tier fields ────────────────────────────── */}
        {(mode === 'commercial' || mode === 'free_tier') && (
          <>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors"
              >
                <option value="">Select provider…</option>
                {Object.keys(PROVIDERS).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Auth Type</label>
                <select
                  value={authType}
                  onChange={(e) => setAuthType(e.target.value as AuthType)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors"
                >
                  <option value="bearer">Bearer</option>
                  <option value="api_key">x-api-key</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Model</label>
                {provider && PROVIDERS[provider] ? (
                  <select
                    value={modelName}
                    onChange={(e) => changeModel(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors"
                  >
                    <option value="">Select model…</option>
                    {PROVIDERS[provider].models
                      .filter((m) => !usedModels.includes(m))
                      .map((m) => <option key={m} value={m}>{m}</option>)
                    }
                    {/* Show used models as disabled */}
                    {PROVIDERS[provider].models
                      .filter((m) => usedModels.includes(m))
                      .map((m) => <option key={m} value={m} disabled>{m} (in use)</option>)
                    }
                  </select>
                ) : (
                  <input
                    type="text"
                    value={modelName}
                    onChange={(e) => changeModel(e.target.value)}
                    placeholder="Model name"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors"
                  />
                )}
              </div>
            </div>
            <ModelCard modelName={modelName} hostRam={hostRam} reservedRam={0} />
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                {mode === 'commercial' ? 'API Key' : 'Account / Token'}
              </label>
              <input
                type="password"
                value={credentials}
                onChange={(e) => setCredentials(e.target.value)}
                placeholder="••••••••••••••••"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
              />
            </div>
            {config?.daily_messages_limit && (
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <AlertCircle className="w-3.5 h-3.5" />
                {config.daily_messages_used ?? 0} / {config.daily_messages_limit} daily messages
              </div>
            )}
          </>
        )}

        {/* ── Family override (all modes) ───────────────────────────────── */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)] mb-1">
            Family Override <span className="font-normal">(optional)</span>
            <Tooltip wide content={
              <div className="space-y-2">
                <p className="font-semibold text-[var(--color-navy-100)]">What is Family Override?</p>
                <p>YODA's diversity system checks that your three engines come from <strong>different model families</strong> — so you're not getting three near-identical opinions from the same underlying architecture.</p>
                <p>It detects families automatically from the model name. If it doesn't recognise your model, set this field manually.</p>
                <p className="text-[var(--color-gold-400)]">Examples: <code>qwen</code> · <code>deepseek</code> · <code>llama</code> · <code>mistral</code> · <code>claude</code> · <code>gpt</code></p>
              </div>
            }>
              <HelpCircle className="w-3 h-3 text-[var(--color-text-muted)] cursor-help" />
            </Tooltip>
          </label>
          <input
            type="text"
            value={familyOverride}
            onChange={(e) => setFamilyOverride(e.target.value)}
            placeholder="e.g. qwen, deepseek, llama"
            className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors"
          />
        </div>
      </div>

      {/* Save */}
      <div className="mt-4 flex justify-end">
        <button
          onClick={handleSave}
          disabled={update.isPending || !modelName}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] text-sm font-semibold hover:bg-[var(--color-gold-400)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {update.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save
        </button>
      </div>

      {/* Install & Connect modal */}
      {installModalOpen && (
        <ModelInstallModal
          modelName={modelName}
          onClose={() => setInstallModalOpen(false)}
        />
      )}
    </div>
  );
}
