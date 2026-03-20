import { useState, useEffect, useRef, useCallback } from 'react';
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
  HardDriveDownload,
  Radio,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { ModelInstallModal } from './ModelInstallModal';
import {
  detectOS,
  makeBashInstallScript,
  makePsInstallScript,
  makeBatWrapper,
  triggerDownload,
} from './installScripts';
import { useUpdateEngine, useDeleteEngine } from '../../api/hooks';
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
export type ModelArch = 'Dense' | 'MoE';

export interface ModelMeta {
  company: string;
  arch: ModelArch;
  desc: string;
  specialty: string;
  type: string;
  ramGbQ4?: number;   // undefined = cloud-hosted
  ramGbQ3?: number;
}

export const MODEL_INFO: Record<string, ModelMeta> = {
  // ── Anthropic (cloud) ───────────────────────────────────────────────────
  'claude-opus-4-6':   { company: 'Anthropic', arch: 'Dense', type: 'LLM', specialty: 'Complex reasoning · Long documents · Nuanced writing', desc: "Anthropic's most powerful model. Best for deep analysis, intricate code review, and tasks requiring careful multi-step reasoning." },
  'claude-sonnet-4-6': { company: 'Anthropic', arch: 'Dense', type: 'LLM', specialty: 'Coding · Analysis · Speed + quality balance', desc: "Anthropic's balanced workhorse. Strong reasoning at faster speeds — the best all-round choice for most YODA pipelines." },
  'claude-haiku-4-5':  { company: 'Anthropic', arch: 'Dense', type: 'LLM', specialty: 'Fast summaries · Simple edits · Low latency', desc: "Anthropic's lightest Claude. Excellent for rapid classification, quick rewrites, and high-volume lightweight tasks." },
  // ── OpenAI (cloud) ──────────────────────────────────────────────────────
  'gpt-4.5':  { company: 'OpenAI', arch: 'Dense', type: 'LLM',          specialty: 'Frontier reasoning · Instruction-following · Multimodal', desc: "OpenAI's most capable model. Handles complex instructions with high fidelity; strong across coding, math, and creative tasks." },
  'gpt-4o':   { company: 'OpenAI', arch: 'Dense', type: 'LLM',          specialty: 'Fast · Multimodal · General purpose', desc: "OpenAI's versatile everyday model. Rapid responses with strong reasoning — ideal as a second or third reviewer engine." },
  'o3-mini':  { company: 'OpenAI', arch: 'Dense', type: 'Reasoning LLM', specialty: 'Math · Code · Step-by-step logic', desc: "OpenAI's compact reasoning model. Uses chain-of-thought internally to excel at structured problem-solving at lower cost than o3." },
  // ── xAI (cloud) ─────────────────────────────────────────────────────────
  'grok-3':           { company: 'xAI', arch: 'Dense', type: 'LLM',          specialty: 'Real-time data · Long context · Coding', desc: "xAI's flagship model. Live web search, very long context, and top coding performance." },
  'grok-3-fast':      { company: 'xAI', arch: 'Dense', type: 'LLM',          specialty: 'High throughput · Real-time data · Coding', desc: "Faster-throughput variant of Grok 3. Same capability ceiling at higher request volumes." },
  'grok-3-mini':      { company: 'xAI', arch: 'Dense', type: 'Reasoning LLM', specialty: 'Efficient · Chain-of-thought · Cost-effective', desc: "xAI's compact reasoning model. Thinks before answering — great for structured logic at lower cost than Grok 3." },
  'grok-3-mini-fast': { company: 'xAI', arch: 'Dense', type: 'Reasoning LLM', specialty: 'Fastest · Low latency · High volume', desc: "xAI's fastest and most cost-efficient model. Best for high-volume, latency-sensitive review passes." },
  // ── Google (cloud) ──────────────────────────────────────────────────────
  'gemini-2.5-pro':   { company: 'Google', arch: 'Dense', type: 'LLM', specialty: 'Long context · Code · Multi-step reasoning', desc: "Google's most capable model. Handles up to 1M-token contexts, excels at large codebase analysis and document-heavy tasks." },
  'gemini-2.5-flash': { company: 'Google', arch: 'Dense', type: 'LLM', specialty: 'High throughput · Summarisation · Extraction', desc: "Google's speed-optimised model. Very fast token generation — ideal for high-volume extraction and summarisation passes." },
  'gemini-3-pro':     { company: 'Google', arch: 'Dense', type: 'LLM', specialty: 'Advanced reasoning · Multimodal · Next-gen', desc: "Google's next-generation flagship. State-of-the-art reasoning across text, code, and images." },
  // ── DeepSeek (cloud) ────────────────────────────────────────────────────
  'DeepSeek-V3.2': { company: 'DeepSeek', arch: 'MoE',   type: 'LLM',          specialty: 'Coding · Math · Cost-efficient frontier', desc: "DeepSeek's latest MoE model. 671B total weights, ~37B active per token — competitive with frontier LLMs at significantly lower cost." },
  'DeepSeek-R1':   { company: 'DeepSeek', arch: 'Dense', type: 'Reasoning LLM', specialty: 'Chain-of-thought · Math · Complex problem-solving', desc: "DeepSeek's flagship reasoning model. Publishes its thinking step-by-step; outstanding on logic, proofs, and algorithmic problems." },

  // ── Self-hosted ─────────────────────────────────────────────────────────
  'Qwen3-4B': {
    company: 'Alibaba', arch: 'Dense', type: 'LLM',
    specialty: 'Ultra-compact · Coding · Multilingual',
    desc: "Alibaba's smallest Qwen3 model. Extremely low memory footprint — ideal as a fast secondary engine alongside a larger primary model.",
    ramGbQ4: 2.6,
  },
  'Gemma-3-4B': {
    company: 'Google', arch: 'Dense', type: 'LLM',
    specialty: 'Ultra-compact · Multilingual · Low memory',
    desc: "Google's compact 4B open model. Lightweight and fast — fits easily on machines with 8 GB RAM or more.",
    ramGbQ4: 3.1,
  },
  'Llama-3.1-8B': {
    company: 'Meta', arch: 'Dense', type: 'LLM',
    specialty: 'Compact · Fast · Widely supported',
    desc: "Meta's compact open model. Supported by every inference server — excellent on ARM and NPU hardware.",
    ramGbQ4: 4.7,
  },
  'Qwen3.5-9B': {
    company: 'Alibaba', arch: 'Dense', type: 'LLM',
    specialty: 'Compact · Fast · Coding · Multilingual',
    desc: "Alibaba's compact 9B model. Efficient on CPU/NPU, strong multilingual and coding performance. A popular first self-hosted choice.",
    ramGbQ4: 5.3,
  },
  'Mistral-Nemo-12B': {
    company: 'Mistral AI', arch: 'Dense', type: 'LLM',
    specialty: 'Efficient · Multilingual · Instruction-following',
    desc: "Mistral's efficient 12B model. Great quality-to-size ratio — strong multilingual and instruction-following with a small footprint.",
    ramGbQ4: 7.2,
  },
  'GLM-5': {
    company: 'Zhipu AI', arch: 'Dense', type: 'LLM',
    specialty: 'Chinese language · General reasoning',
    desc: "Zhipu AI's ~9B general model. Excellent Chinese language support alongside solid general reasoning and coding ability.",
    ramGbQ4: 5.3,
  },
  'Qwen3-Coder-30B': {
    company: 'Alibaba', arch: 'Dense', type: 'Coding LLM',
    specialty: 'Code generation · Agentic coding · Function calling',
    desc: "Alibaba's dedicated 30B code model. State-of-the-art open-weight coder — strong at multi-file edits, tool use, and agentic coding tasks.",
    ramGbQ4: 18.5, ramGbQ3: 14.4,
  },
  'Qwen3.5-27B': {
    company: 'Alibaba', arch: 'Dense', type: 'LLM',
    specialty: 'Coding · Multilingual · Balanced quality',
    desc: "Alibaba's mid-size 27B dense model. Strong quality across reasoning and code — may need Q3 quantization on machines with limited RAM.",
    ramGbQ4: 16.0, ramGbQ3: 12.5,
  },
  'Qwen3.5-35B-A3B': {
    company: 'Alibaba', arch: 'MoE', type: 'LLM',
    specialty: 'High capability · Efficient active compute · Coding',
    desc: "Alibaba's 35B MoE model — only 3B parameters active per token, but all 35B weights must load into RAM for fast routing.",
    ramGbQ4: 21.6, ramGbQ3: 16.8,
  },
  'DeepSeek-R1-Distill-Qwen-32B': {
    company: 'DeepSeek', arch: 'Dense', type: 'Reasoning LLM',
    specialty: 'Math · Code · Chain-of-thought reasoning',
    desc: "DeepSeek-R1's reasoning capability distilled into a 32B Qwen backbone. Excellent step-by-step reasoning at self-hosted scale.",
    ramGbQ4: 19.8, ramGbQ3: 15.4,
  },
  'DeepSeek-R1-Distill-Llama-70B': {
    company: 'DeepSeek', arch: 'Dense', type: 'Reasoning LLM',
    specialty: 'Complex reasoning · Large self-hosted option',
    desc: "DeepSeek-R1's reasoning capability distilled into Llama-70B. Powerful open-weight reasoning model for high-RAM workstations.",
    ramGbQ4: 41.0, ramGbQ3: 31.9,
  },
  'Llama-3.1-70B': {
    company: 'Meta', arch: 'Dense', type: 'LLM',
    specialty: 'Strong open-weight · Coding · General tasks',
    desc: "Meta's strong 70B open model. Competitive with many commercial models for coding and instruction-following tasks.",
    ramGbQ4: 41.0, ramGbQ3: 31.9,
  },
  'Mistral-Large-3': {
    company: 'Mistral AI', arch: 'Dense', type: 'LLM',
    specialty: 'Top-tier reasoning · Coding · Multilingual',
    desc: "Mistral's 123B flagship open model. Top-tier open-weight performance across coding, reasoning, and multilingual tasks.",
    ramGbQ4: 72.0, ramGbQ3: 56.0,
  },
  'Qwen3.5-122B': {
    company: 'Alibaba', arch: 'Dense', type: 'LLM',
    specialty: 'Near-frontier quality · Complex reasoning · Coding',
    desc: "Alibaba's largest dense Qwen. Matches frontier commercial quality for reasoning and code — requires a high-RAM workstation.",
    ramGbQ4: 73.0, ramGbQ3: 57.0,
  },
  'Llama-4-Maverick': {
    company: 'Meta', arch: 'MoE', type: 'Multimodal LLM',
    specialty: 'Native multimodal · Extended context · Next-gen',
    desc: "Meta's next-gen MoE flagship. ~400B total weights with native multimodal capability — requires enterprise-grade multi-GPU infrastructure.",
    ramGbQ4: 229.0,
  },
  'Kimi-K2.5': {
    company: 'Moonshot AI', arch: 'MoE', type: 'LLM',
    specialty: 'Long context · Document understanding · 200K tokens',
    desc: "Moonshot AI's large MoE model. Exceptional 200K-token context — the full weight set far exceeds any consumer or prosumer machine.",
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

const CATEGORY_ORDER = ['Coding', 'Reasoning', 'Well-Rounded'] as const;
type ModelCategory = typeof CATEGORY_ORDER[number];

// 27-slot layout: 3 sections × 3 memory tiers × 3 ranked models per tier.
// Models may appear in multiple sections. Order within each tier is Rank 1 → 3.
const TIER_LABELS = ['High Memory (>70 GB)', 'Mid Memory (16–70 GB)', 'Low Memory (<16 GB)'] as const;

const SECTION_LAYOUT: Record<ModelCategory, [string[], string[], string[]]> = {
  Coding: [
    // High — Rank 1: GLM-5, Rank 2: Kimi-K2.5, Rank 3: DeepSeek-V3.2-685B
    ['GLM-5',           'Kimi-K2.5',                  'DeepSeek-V3.2-685B'],
    // Mid  — Rank 4: Qwen3-235B-A22B, Rank 5: Qwen3.5-122B, Rank 6: Qwen3-Coder-30B
    ['Qwen3-235B-A22B', 'Qwen3.5-122B',               'Qwen3-Coder-30B'],
    // Low  — Rank 7: Codestral-22B, Rank 8: Llama-3.1-8B, Rank 9: DeepSeek-R1-Distill-Qwen-7B
    ['Codestral-22B',   'Llama-3.1-8B',               'DeepSeek-R1-Distill-Qwen-7B'],
  ],
  Reasoning: [
    // High — Rank 1: DeepSeek-R1-671B, Rank 2: Kimi-K2.5 (Thinking), Rank 3: GLM-5
    ['DeepSeek-R1-671B', 'Kimi-K2.5',                 'GLM-5'],
    // Mid  — Rank 4: Qwen3.5-122B (Thinking), Rank 5: DeepSeek-R1-Distill-Llama-70B, Rank 6: Qwen-QwQ-32B
    ['Qwen3.5-122B',    'DeepSeek-R1-Distill-Llama-70B', 'Qwen-QwQ-32B'],
    // Low  — Rank 7: Phi-4-14B, Rank 8: Mathstral-7B, Rank 9: DeepSeek-R1-Distill-Qwen-7B
    ['Phi-4-14B',       'Mathstral-7B',               'DeepSeek-R1-Distill-Qwen-7B'],
  ],
  'Well-Rounded': [
    // High — Rank 1: Kimi-K2.5, Rank 2: GLM-5, Rank 3: DeepSeek-V3.2-685B
    ['Kimi-K2.5',       'GLM-5',                      'DeepSeek-V3.2-685B'],
    // Mid  — Rank 4: Qwen3.5-122B, Rank 5: Llama-4-Maverick, Rank 6: Qwen3.5-72B
    ['Qwen3.5-122B',    'Llama-4-Maverick',            'Qwen3.5-72B'],
    // Low  — Rank 7: Mistral-Small-3.2-24B, Rank 8: Gemma-3-27B, Rank 9: Phi-4-14B
    ['Mistral-Small-3.2-24B', 'Gemma-3-27B',          'Phi-4-14B'],
  ],
};

// Flat de-duped set of every self-hosted model name (for "already assigned" checks).
const ALL_SELF_HOSTED_SET = new Set(
  (Object.values(SECTION_LAYOUT) as string[][][]).flatMap((tiers) => tiers.flat()),
);

// ── llama.cpp (llama-server) config ──────────────────────────────────────────
// Each engine slot gets its own port so instances can run truly in parallel.
export const SLOT_PORT: Record<Slot, number> = { a: 8080, b: 8081, c: 8082 };

// HuggingFace GGUF source for every self-hosted model.
// llama-server downloads the file on first run, then serves on SLOT_PORT.
export const GGUF_INFO: Record<string, { repo: string; file: string }> = {
  // ── Shared (multi-section) ───────────────────────────────────────────────
  'GLM-5':                          { repo: 'THUDM/GLM-5-GGUF',                                        file: 'GLM-5-Q4_K_M.gguf'                                 },
  'Kimi-K2.5':                      { repo: 'moonshotai/Kimi-K2-Instruct-GGUF',                        file: 'Kimi-K2-Instruct-Q4_K_M.gguf'                      },
  'DeepSeek-V3.2-685B':             { repo: 'bartowski/DeepSeek-V3-0324-GGUF',                         file: 'DeepSeek-V3-0324-Q4_K_M.gguf'                      },
  'Qwen3.5-122B':                   { repo: 'Qwen/Qwen3.5-122B-Instruct-GGUF',                         file: 'Qwen3.5-122B-Instruct-Q4_K_M.gguf'                 },
  // ── Coding ──────────────────────────────────────────────────────────────
  'Qwen3-235B-A22B':                { repo: 'Qwen/Qwen3-235B-A22B-Instruct-GGUF',                      file: 'Qwen3-235B-A22B-Instruct-Q4_K_M.gguf'              },
  'Qwen3-Coder-30B':                { repo: 'Qwen/Qwen3-Coder-30B-GGUF',                               file: 'Qwen3-Coder-30B-Q4_K_M.gguf'                       },
  'Codestral-22B':                  { repo: 'bartowski/Codestral-22B-v0.1-GGUF',                       file: 'Codestral-22B-v0.1-Q4_K_M.gguf'                    },
  'Llama-3.1-8B':                   { repo: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',               file: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf'            },
  'DeepSeek-R1-Distill-Qwen-7B':    { repo: 'bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF',             file: 'DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf'           },
  // ── Reasoning ───────────────────────────────────────────────────────────
  'DeepSeek-R1-671B':               { repo: 'unsloth/DeepSeek-R1-GGUF',                                file: 'DeepSeek-R1-Q4_K_M.gguf'                           },
  'DeepSeek-R1-Distill-Llama-70B':  { repo: 'bartowski/DeepSeek-R1-Distill-Llama-70B-GGUF',           file: 'DeepSeek-R1-Distill-Llama-70B-Q4_K_M.gguf'         },
  'Qwen-QwQ-32B':                   { repo: 'Qwen/QwQ-32B-GGUF',                                      file: 'QwQ-32B-Q4_K_M.gguf'                               },
  'Phi-4-14B':                      { repo: 'microsoft/Phi-4-GGUF',                                    file: 'Phi-4-Q4_K_M.gguf'                                 },
  'Mathstral-7B':                   { repo: 'bartowski/mathstral-7B-v0.1-GGUF',                        file: 'mathstral-7B-v0.1-Q4_K_M.gguf'                     },
  // ── Well-Rounded ─────────────────────────────────────────────────────────
  'Llama-4-Maverick':               { repo: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-GGUF',      file: 'Llama-4-Maverick-17B-128E-Instruct-Q4_K_M.gguf'    },
  'Qwen3.5-72B':                    { repo: 'Qwen/Qwen3.5-72B-Instruct-GGUF',                          file: 'Qwen3.5-72B-Instruct-Q4_K_M.gguf'                  },
  'Mistral-Small-3.2-24B':          { repo: 'bartowski/Mistral-Small-3.2-24B-Instruct-2506-GGUF',      file: 'Mistral-Small-3.2-24B-Instruct-2506-Q4_K_M.gguf'   },
  'Gemma-3-27B':                    { repo: 'google/gemma-3-27b-it-GGUF',                              file: 'gemma-3-27b-it-Q4_K_M.gguf'                        },
};

// Kept for resolving legacy DB records that stored Ollama tags (e.g. 'deepseek-r1:32b').
export const OLLAMA_TAG: Record<string, string> = {
  'Llama-3.1-8B':                   'llama3.1:8b',
  'Qwen3.5-27B':                    'qwen3:27b',
  'DeepSeek-R1-Distill-Qwen-32B':   'deepseek-r1:32b',
  'DeepSeek-R1-Distill-Llama-70B':  'deepseek-r1:70b',
  'Qwen3.5-122B':                   'qwen3:122b',
  'Llama-4-Maverick':               'llama4:maverick',
};

// Reverse map: legacy Ollama tag → display name (e.g. 'gemma3:4b' → 'Gemma-3-4B').
export const OLLAMA_TAG_DISPLAY: Record<string, string> = Object.fromEntries(
  Object.entries(OLLAMA_TAG).map(([display, tag]) => [tag, display]),
);

function normalizeQuery(s: string): string {
  return s.toLowerCase().replace(/[\s\-_.]/g, '');
}

function groupedModels(
  filter: string,
  usedModels: string[],
): { category: ModelCategory; tiers: { label: string; models: string[] }[] }[] {
  const q = normalizeQuery(filter);
  const isVisible = (m: string) =>
    (q === '' || normalizeQuery(m).includes(q)) && m !== filter && !usedModels.includes(m);

  return CATEGORY_ORDER
    .map((cat) => ({
      category: cat,
      tiers: SECTION_LAYOUT[cat]
        .map((tier, i) => ({
          label: TIER_LABELS[i],
          models: tier.filter(isVisible),
        }))
        .filter((t) => t.models.length > 0),
    }))
    .filter((g) => g.tiers.length > 0);
}

const PROVIDERS: Record<string, { authType: AuthType; models: string[] }> = {
  Anthropic: { authType: 'api_key', models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'] },
  OpenAI:    { authType: 'bearer',  models: ['gpt-4.5', 'gpt-4o', 'o3-mini'] },
  xAI:       { authType: 'bearer',  models: ['grok-3', 'grok-3-fast', 'grok-3-mini', 'grok-3-mini-fast'] },
  Google:    { authType: 'bearer',  models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-pro'] },
  DeepSeek:  { authType: 'api_key', models: ['DeepSeek-V3.2', 'DeepSeek-R1'] },
};

const SLOT_LABELS: Record<Slot, string> = { a: 'Engine A', b: 'Engine B', c: 'Engine C' };

// ── Downloaded-model registry (persisted to localStorage) ────────────────────

const DOWNLOADED_KEY = 'yoda_downloaded_models';

function useDownloadedModels(): [Set<string>, (name: string) => void] {
  const [downloaded, setDownloaded] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(DOWNLOADED_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set(); }
  });

  const mark = useCallback((name: string) => {
    setDownloaded(prev => {
      const next = new Set(prev);
      next.add(name);
      try { localStorage.setItem(DOWNLOADED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return [downloaded, mark];
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tooltip({ content, children, wide }: { content: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <span className="relative group/tip inline-flex items-center">
      {children}
      <span className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 ${wide ? 'w-80' : 'w-60'} p-3 rounded-xl
        bg-[var(--color-navy-850,#0d1829)] border border-[var(--color-navy-600)]
        text-sm text-[var(--color-navy-100)] shadow-xl
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
    <span className="flex items-center gap-1 text-sm font-medium text-emerald-400">
      <CheckCircle2 className="w-3.5 h-3.5" />{ram} · Fits
    </span>
  );
  if (fit === 'tight') return (
    <span className="flex items-center gap-1 text-sm font-medium text-amber-400">
      <AlertTriangle className="w-3.5 h-3.5" />{ram} · Tight — use Q3 quant
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-sm font-medium text-red-400">
      <XCircle className="w-3.5 h-3.5" />{ram} · Needs more RAM
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
    <div className="mt-2 px-3 py-2.5 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] text-sm space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-1.5 py-0.5 rounded bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)] font-medium text-sm">
          {info.type}
        </span>
        <span className="text-[var(--color-text-secondary)]">{info.specialty}</span>
      </div>
      {fit && ram && <ResourceBadge fit={fit} ram={ram} />}
      <p className="text-[var(--color-text-muted)] leading-relaxed">{info.desc}</p>
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
  const clearSlot = useDeleteEngine();
  const { toast } = useToast();

  const [mode, setMode] = useState<HostingMode>(config?.hosting_mode ?? 'self_hosted');
  const [confirmClear, setConfirmClear] = useState(false);
  const [endpoint, setEndpoint] = useState(config?.endpoint_url ?? '');
  const [authType, setAuthType] = useState<AuthType>(config?.auth_type ?? 'none');
  const [credentials, setCredentials] = useState('');
  const [modelName, setModelName] = useState(config?.model_name ?? '');
  const [provider, setProvider] = useState('');
  const [familyOverride, setFamilyOverride] = useState(config?.family_override ?? '');
  const [showSuggest, setShowSuggest] = useState(false);
  const [installModalMode, setInstallModalMode] = useState<'connect' | null>(null);
  const [downloaded, markDownloaded] = useDownloadedModels();
  type ProbeResult = { reachable: boolean; latency_ms?: number; http_status?: number; error?: string };
  const [probeState, setProbeState] = useState<null | 'loading' | ProbeResult>(null);

  type InstallPhase = 'idle' | 'polling' | 'connected' | 'timeout';
  const [installPhase,   setInstallPhase]   = useState<InstallPhase>('idle');
  const [installAddress, setInstallAddress] = useState('');
  const installPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const crsUrl = (import.meta.env.VITE_CRS_URL as string | undefined) ?? '';

  const hasMountedRef    = useRef(false);
  const autoSaveTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoFill     = useRef<string>('');

  function defaultEndpointFor(name: string): string {
    if (GGUF_INFO[name]) return `http://localhost:${SLOT_PORT[slot]}`;
    return `http://localhost:${SLOT_PORT[slot]}`;
  }

  function applyAutoEndpoint(name: string) {
    const def = defaultEndpointFor(name);
    lastAutoFill.current = def;
    setEndpoint(def);
  }

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
      if (!endpoint || endpoint === lastAutoFill.current) {
        applyAutoEndpoint(modelName);
      }
    }
  }, [mode]);

  useEffect(() => {
    if (mode === 'self_hosted' && modelName && (!endpoint || endpoint === lastAutoFill.current)) {
      applyAutoEndpoint(modelName);
    }
    setProbeState(null);
  }, [modelName]);

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

  async function probeEndpoint() {
    setProbeState('loading');
    try {
      const res = await fetch(`/api/settings/engines/${slot}/probe`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` },
      });
      const data: ProbeResult = await res.json();
      setProbeState(data);
    } catch {
      setProbeState({ reachable: false, error: 'Network error — could not reach server' });
    }
  }

  function handleDirectInstall() {
    const info = GGUF_INFO[modelName];
    if (!info) return;

    const token = crypto.randomUUID();
    const os    = detectOS();

    if (os === 'windows') {
      const ps  = makePsInstallScript(modelName, info.repo, info.file, SLOT_PORT[slot], token, crsUrl);
      const bat = makeBatWrapper(ps, modelName);
      triggerDownload(bat, 'yoda-setup.bat', 'text/plain');
    } else if (os === 'mac') {
      const sh = makeBashInstallScript(modelName, info.repo, info.file, SLOT_PORT[slot], token, crsUrl);
      triggerDownload(sh, 'yoda-setup.command', 'text/x-shellscript');
    } else {
      const sh = makeBashInstallScript(modelName, info.repo, info.file, SLOT_PORT[slot], token, crsUrl);
      triggerDownload(sh, 'yoda-setup.sh', 'text/x-shellscript');
    }

    if (!crsUrl) return;
    if (installPollRef.current) clearInterval(installPollRef.current);
    setInstallPhase('polling');
    setInstallAddress('');
    let count = 0;
    installPollRef.current = setInterval(async () => {
      count++;
      if (count > 200) {
        clearInterval(installPollRef.current!);
        setInstallPhase('timeout');
        return;
      }
      try {
        const res = await fetch(`${crsUrl}/api/yoda/crs/session/${token}`);
        if (!res.ok) return;
        const data: { status: string; address?: string } = await res.json();
        if (data.status === 'registered' && data.address) {
          clearInterval(installPollRef.current!);
          setInstallPhase('connected');
          setInstallAddress(data.address);
          markDownloaded(modelName);
        }
      } catch { /* keep polling */ }
    }, 3000);
  }

  useEffect(() => () => { if (installPollRef.current) clearInterval(installPollRef.current); }, []);

  // Notify parent on first render so parent state is in sync
  useEffect(() => { onModelChange(modelName); }, []);
  useEffect(() => { onModeChange(mode); }, []);

  function buildPayload() {
    return {
      slot,
      hosting_mode: mode,
      endpoint_url: endpoint || `http://localhost:${SLOT_PORT[slot]}`,
      auth_type: authType,
      credentials: credentials || undefined,
      model_name: modelName,
      model_family: '',
      family_override: familyOverride || null,
    };
  }

  function handleSave() {
    update.mutate(buildPayload(), {
      onSuccess: () => toast('success', `Engine ${slot.toUpperCase()} saved — ${modelName || 'configuration updated'}.`),
      onError:   () => toast('error',   `Failed to save Engine ${slot.toUpperCase()}. Check your connection and try again.`),
    });
  }

  function handleClear() {
    if (!confirmClear) { setConfirmClear(true); return; }
    clearSlot.mutate(slot, {
      onSuccess: () => {
        setModelName('');
        setFamilyOverride('');
        setEndpoint(`http://localhost:${SLOT_PORT[slot]}`);
        setCredentials('');
        setConfirmClear(false);
        onModelChange('');
        toast('success', `Engine ${slot.toUpperCase()} slot cleared.`);
      },
      onError: () => {
        setConfirmClear(false);
        toast('error', `Failed to clear Engine ${slot.toUpperCase()}.`);
      },
    });
  }

  useEffect(() => {
    if (!hasMountedRef.current) { hasMountedRef.current = true; return; }
    if (!modelName) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      update.mutate(buildPayload(), {
        onSuccess: () => toast('success', `Engine ${slot.toUpperCase()} — ${modelName} saved.`),
      });
    }, 800);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [modelName]);

  const healthDot = config?.health_status === 'online'
    ? 'bg-[var(--color-ok)]'
    : config?.health_status === 'suspect'
      ? 'bg-[var(--color-warn)]'
      : 'bg-[var(--color-err)]';

  const grouped = groupedModels(modelName, usedModels);
  const availableGb  = hostRam - OS_OVERHEAD_GB - reservedRam;

  const MODE_TIPS: Record<HostingMode, string> = {
    self_hosted: 'Run a model on your own hardware via a local endpoint (Ollama, llama.cpp, LM Studio, vLLM). No data leaves your machine.',
    commercial:  'Connect to a paid API from Anthropic, OpenAI, xAI, Google, or DeepSeek. Requires an API key and charges per token.',
    free_tier:   "Use a provider's free or trial tier — same setup as Commercial but typically rate-limited with daily message caps.",
  };

  return (
    <div className="bg-[var(--color-surface-primary)] border border-[var(--color-border-subtle)] rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{SLOT_LABELS[slot]}</h3>
        <div className="flex items-center gap-2">
          {config && (
            <>
              <span className={`w-2 h-2 rounded-full ${healthDot}`} />
              <span className="text-sm text-[var(--color-text-muted)]">
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
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium border transition-colors ${
                mode === m
                  ? 'bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)] border-[var(--color-gold-500)]/30'
                  : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border-default)] hover:border-[var(--color-border-strong)]'
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
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] text-sm text-[var(--color-text-muted)] leading-relaxed">
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
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Model</label>
              <input
                type="text"
                value={modelName}
                onChange={(e) => { changeModel(e.target.value); setShowSuggest(true); }}
                onFocus={() => setShowSuggest(true)}
                onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                placeholder="e.g. Llama-3.1-8B"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
              />
              {showSuggest && (
                <div className="absolute z-20 w-full mt-1 overflow-y-auto rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] shadow-lg" style={{ maxHeight: '32rem' }}>
                  {grouped.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-[var(--color-text-muted)] italic">
                      No matching models available
                    </div>
                  ) : grouped.map(({ category, tiers }) => (
                    <div key={category}>
                      <div className="px-3 py-2 text-sm font-bold uppercase tracking-widest text-white bg-black border-b border-[var(--color-border-subtle)] sticky top-0">
                        {category}
                      </div>
                      {tiers.map(({ label, models }) => (
                        <div key={label}>
                          <div className="px-3 py-1.5 text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] bg-[var(--color-surface-primary)] border-b border-[var(--color-border-subtle)]">
                            {label}
                          </div>
                          {models.map((m) => {
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
                                  <span className="text-sm text-[var(--color-text-primary)] font-medium flex-1 truncate">
                                    {info ? `${info.company} | ${m}` : m}
                                  </span>
                                  {downloaded.has(m) && (
                                    <HardDriveDownload className="w-3.5 h-3.5 shrink-0 text-emerald-400" aria-label="Already downloaded" />
                                  )}
                                  {ram && (
                                    <span className="text-sm text-[var(--color-text-muted)] shrink-0">
                                      {ram.split('·')[0].trim()}
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  ))}

                  {/* Models assigned to other slots */}
                  {usedModels.filter((u) => ALL_SELF_HOSTED_SET.has(u)).length > 0 && (
                    <div className="px-3 py-2 flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] border-t border-[var(--color-border-subtle)]">
                      <Ban className="w-3 h-3 flex-shrink-0" />
                      {usedModels.filter((u) => ALL_SELF_HOSTED_SET.has(u)).map((u) => (
                        <span key={u} className="line-through opacity-60">{u}</span>
                      )).reduce((acc: React.ReactNode[], el, i) => i === 0 ? [el] : [...acc, ', ', el], [])}
                      {' '}already assigned
                    </div>
                  )}
                </div>
              )}
            </div>

            <ModelCard modelName={modelName} hostRam={hostRam} reservedRam={reservedRam} />

            {/* Install / Connect buttons — visible for all self-hosted models */}
            {modelName && GGUF_INFO[modelName] && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  {downloaded.has(modelName) ? (
                    <button
                      onClick={handleDirectInstall}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-500/40 bg-emerald-500/8 text-emerald-400 text-sm font-medium hover:bg-emerald-500/15 hover:border-emerald-500/70 transition-colors"
                    >
                      <HardDriveDownload className="w-3.5 h-3.5" />
                      Re-Install
                    </button>
                  ) : (
                    <button
                      onClick={handleDirectInstall}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--color-gold-500)]/40 bg-[var(--color-gold-500)]/8 text-[var(--color-gold-400)] text-sm font-medium hover:bg-[var(--color-gold-500)]/15 hover:border-[var(--color-gold-500)]/70 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Install
                    </button>
                  )}
                  <button
                    onClick={() => setInstallModalMode('connect')}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-blue-500/40 bg-blue-500/8 text-blue-400 text-sm font-medium hover:bg-blue-500/15 hover:border-blue-500/70 transition-colors"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    Connect
                  </button>
                </div>

                {/* Inline install status — replaces the modal for install flow */}
                {installPhase === 'polling' && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-gold-500)]/8 border border-[var(--color-gold-500)]/25 text-sm text-[var(--color-gold-300)]">
                    <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                    <span>
                      Script downloaded — double-click it to run, then wait here for connection…
                    </span>
                  </div>
                )}
                {installPhase === 'connected' && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-300">
                    <Wifi className="w-3 h-3 flex-shrink-0" />
                    <span>Connected — {installAddress}</span>
                  </div>
                )}
                {installPhase === 'timeout' && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
                    <WifiOff className="w-3 h-3 flex-shrink-0" />
                    <span>Timed out. Click Install again and run the downloaded file.</span>
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-[var(--color-text-secondary)]">Endpoint URL</label>
                <button
                  onClick={probeEndpoint}
                  disabled={probeState === 'loading' || !endpoint}
                  className="flex items-center gap-1 text-sm px-2 py-0.5 rounded-md border border-[var(--color-border-default)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {probeState === 'loading' ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> Testing…</>
                  ) : (
                    <><Radio className="w-3 h-3" /> Test</>
                  )}
                </button>
              </div>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => { setEndpoint(e.target.value); setProbeState(null); }}
                placeholder="http://localhost:11434"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
              />
              {probeState !== null && probeState !== 'loading' && (
                <div className={`mt-1.5 flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-md ${probeState.reachable ? 'bg-[var(--color-ok)]/10 text-[var(--color-ok)]' : 'bg-red-500/10 text-red-400'}`}>
                  {probeState.reachable ? (
                    <><CheckCircle2 className="w-3 h-3 flex-shrink-0" /> Reachable — {probeState.latency_ms} ms</>
                  ) : (
                    <><XCircle className="w-3 h-3 flex-shrink-0" /> Unreachable{probeState.error ? ` — ${probeState.error.split('error sending')[0].trim()}` : ''}{!probeState.error && '. Start PlenumNET then try again.'}</>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Commercial / Free Tier fields ────────────────────────────── */}
        {(mode === 'commercial' || mode === 'free_tier') && (
          <>
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors"
              >
                <option value="">Select provider…</option>
                {Object.keys(PROVIDERS).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Auth Type</label>
                <select
                  value={authType}
                  onChange={(e) => setAuthType(e.target.value as AuthType)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors"
                >
                  <option value="bearer">Bearer</option>
                  <option value="api_key">x-api-key</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Model</label>
                {provider && PROVIDERS[provider] ? (
                  <select
                    value={modelName}
                    onChange={(e) => changeModel(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors"
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
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors"
                  />
                )}
              </div>
            </div>
            <ModelCard modelName={modelName} hostRam={hostRam} reservedRam={0} />
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                {mode === 'commercial' ? 'API Key' : 'Account / Token'}
              </label>
              <input
                type="password"
                value={credentials}
                onChange={(e) => setCredentials(e.target.value)}
                placeholder="••••••••••••••••"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
              />
            </div>
            {config?.daily_messages_limit && (
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                <AlertCircle className="w-3.5 h-3.5" />
                {config.daily_messages_used ?? 0} / {config.daily_messages_limit} daily messages
              </div>
            )}
          </>
        )}

        {/* ── Family override (all modes) ───────────────────────────────── */}
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text-secondary)] mb-1">
            Family Override <span className="font-normal text-[var(--color-text-muted)]">(optional)</span>
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
            className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center justify-between gap-2">
        {/* Clear slot — two-click confirm pattern */}
        {config && (
          <button
            onClick={handleClear}
            onBlur={() => setConfirmClear(false)}
            disabled={clearSlot.isPending}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
              confirmClear
                ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20'
                : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border-default)] hover:text-red-400 hover:border-red-500/30'
            }`}
          >
            {clearSlot.isPending
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Trash2 className="w-3 h-3" />}
            {confirmClear ? 'Confirm clear?' : 'Clear slot'}
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={handleSave}
          disabled={update.isPending || !modelName}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] text-sm font-semibold hover:bg-[var(--color-gold-400)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {update.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save
        </button>
      </div>

      {/* Connect (reconnect) modal — Install flow no longer uses a modal */}
      {installModalMode === 'connect' && (
        <ModelInstallModal
          modelName={modelName}
          port={SLOT_PORT[slot]}
          mode="connect"
          onClose={() => setInstallModalMode(null)}
          isDownloaded={downloaded.has(modelName)}
          onMarkDownloaded={() => markDownloaded(modelName)}
        />
      )}
    </div>
  );
}
