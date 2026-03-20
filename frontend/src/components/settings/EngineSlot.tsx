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
} from 'lucide-react';
import { ModelInstallModal } from './ModelInstallModal';
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
  // Ordered by doc tier: Coding → Reasoning → Well-Rounded, then High → Mid → Low memory

  // ── Coding ──────────────────────────────────────────────────────────────
  'GLM-5': {
    company: 'Zhipu AI', arch: 'MoE', type: 'Coding LLM',
    specialty: 'Agentic coding · Tool use · 1M context',
    desc: "Zhipu AI's 744B MoE flagship. Top-ranked open-weight coder — exceptional at agentic workflows, multi-file edits, and long-context understanding. Requires a server rack at Q4; feasible at 1.58-bit (~176 GB).",
    ramGbQ4: 350.0, ramGbQ3: 176.0,
  },
  'Kimi-K2.5': {
    company: 'Moonshot AI', arch: 'MoE', type: 'Coding LLM',
    specialty: 'Coding · Agentic · 128K context',
    desc: "Moonshot AI's 1-trillion-parameter MoE model. World-class coder and tool-use agent — rivalling frontier commercial APIs at 1.58-bit quantization (~240 GB). Designed for multi-step agentic coding tasks.",
    ramGbQ4: 480.0, ramGbQ3: 240.0,
  },
  'Qwen3.5-122B': {
    company: 'Alibaba', arch: 'Dense', type: 'Coding LLM',
    specialty: 'Coding · Reasoning · Near-frontier quality',
    desc: "Alibaba's largest dense Qwen. Matches frontier commercial quality for code and reasoning — the best mid-range self-hosted choice for a high-RAM workstation.",
    ramGbQ4: 73.0, ramGbQ3: 57.0,
  },
  'Qwen3-Coder-30B': {
    company: 'Alibaba', arch: 'Dense', type: 'Coding LLM',
    specialty: 'Code generation · Agentic coding · Function calling',
    desc: "Alibaba's dedicated 30B code model. State-of-the-art open-weight coder — strong at multi-file edits, tool use, and agentic coding tasks. The recommended primary engine for most YODA setups.",
    ramGbQ4: 18.5, ramGbQ3: 14.4,
  },
  'Codestral-22B': {
    company: 'Mistral AI', arch: 'Dense', type: 'Coding LLM',
    specialty: 'Code completion · Fill-in-the-middle · 80+ languages',
    desc: "Mistral's dedicated coding model. Trained on 80+ programming languages with fill-in-the-middle support — excellent for code completion, generation, and testing tasks on consumer hardware.",
    ramGbQ4: 13.5, ramGbQ3: 10.5,
  },
  'Llama-3.1-8B': {
    company: 'Meta', arch: 'Dense', type: 'Coding LLM',
    specialty: 'Compact · Fast · Coding fine-tunes',
    desc: "Meta's 8B instruction model. The base for many coding fine-tunes — lightweight, widely supported by every inference server, and excellent on Apple Silicon and ARM hardware.",
    ramGbQ4: 4.7,
  },
  'DeepSeek-R1-Distill-Qwen-7B': {
    company: 'DeepSeek', arch: 'Dense', type: 'Coding LLM',
    specialty: 'Reasoning · Coding · Ultralight footprint',
    desc: "DeepSeek-R1's reasoning distilled into a 7B Qwen backbone. Punches well above its size for code and logic tasks — the best choice for laptops and machines with under 8 GB free RAM.",
    ramGbQ4: 4.5,
  },

  // ── Reasoning ───────────────────────────────────────────────────────────
  'DeepSeek-R1-671B': {
    company: 'DeepSeek', arch: 'Dense', type: 'Reasoning LLM',
    specialty: 'Chain-of-thought · Math · Complex problem-solving',
    desc: "DeepSeek's full 671B flagship reasoning model. The open-weight equivalent of o1 — transparent step-by-step thinking, outstanding on maths, logic, and long-form analysis. Requires a multi-GPU server at Q4; ~162 GB at Q1.58.",
    ramGbQ4: 400.0, ramGbQ3: 162.0,
  },
  'DeepSeek-R1-Distill-Llama-70B': {
    company: 'DeepSeek', arch: 'Dense', type: 'Reasoning LLM',
    specialty: 'Complex reasoning · Math · Large self-hosted',
    desc: "DeepSeek-R1's reasoning distilled into a Llama-70B backbone. Powerful open-weight reasoning for high-RAM workstations — the best balance of capability and size in the reasoning tier.",
    ramGbQ4: 41.0, ramGbQ3: 31.9,
  },
  'DeepSeek-R1-Distill-Qwen-32B': {
    company: 'DeepSeek', arch: 'Dense', type: 'Reasoning LLM',
    specialty: 'Math · Code · Chain-of-thought reasoning',
    desc: "DeepSeek-R1's reasoning capability distilled into a 32B Qwen backbone. Excellent step-by-step reasoning at self-hosted scale — a top pick for workstations with 24–32 GB RAM.",
    ramGbQ4: 19.8, ramGbQ3: 15.4,
  },
  'Qwen-QwQ-32B': {
    company: 'Alibaba', arch: 'Dense', type: 'Reasoning LLM',
    specialty: 'Deep thinking · Math · Multi-step logic',
    desc: "Alibaba's QwQ reasoning model. Uses extended chain-of-thought to tackle hard mathematical and logical problems — comparable to o1-mini at self-hosted scale on a high-end consumer machine.",
    ramGbQ4: 19.8, ramGbQ3: 15.4,
  },
  'Phi-4-14B': {
    company: 'Microsoft', arch: 'Dense', type: 'Reasoning LLM',
    specialty: 'Reasoning · STEM · Compact footprint',
    desc: "Microsoft's Phi-4 14B model. Exceptionally strong on STEM reasoning and structured problem-solving for its size — fits comfortably on a machine with 16 GB RAM and outperforms many larger models on benchmarks.",
    ramGbQ4: 8.5,
  },
  'Mathstral-7B': {
    company: 'Mistral AI', arch: 'Dense', type: 'Reasoning LLM',
    specialty: 'Mathematics · Formal proofs · Scientific reasoning',
    desc: "Mistral's math-specialist 7B model. Fine-tuned specifically for mathematical reasoning and formal proof generation — the lightest option for structured quantitative tasks.",
    ramGbQ4: 4.5,
  },

  // ── Well-Rounded ─────────────────────────────────────────────────────────
  'Llama-4-Maverick': {
    company: 'Meta', arch: 'MoE', type: 'Multimodal LLM',
    specialty: 'Multimodal · General purpose · Instruction-following',
    desc: "Meta's Llama 4 Maverick MoE model. Strong general-purpose performance across text, code, and image understanding — a well-rounded option for multi-task YODA pipelines on server hardware.",
    ramGbQ4: 229.0,
  },
  'Qwen3.5-72B': {
    company: 'Alibaba', arch: 'Dense', type: 'LLM',
    specialty: 'General purpose · Coding · Multilingual',
    desc: "Alibaba's 72B dense model. Excellent across coding, instruction-following, and multilingual tasks — a versatile engine for high-RAM workstations that need broad capability rather than specialisation.",
    ramGbQ4: 42.0, ramGbQ3: 32.5,
  },
  'Qwen3.5-27B': {
    company: 'Alibaba', arch: 'Dense', type: 'LLM',
    specialty: 'Coding · Multilingual · Balanced quality',
    desc: "Alibaba's 27B dense model. Solid quality across reasoning and code — a well-rounded mid-range option that fits on machines with 24–32 GB RAM.",
    ramGbQ4: 16.0, ramGbQ3: 12.5,
  },
  'Mistral-Small-3.2-24B': {
    company: 'Mistral AI', arch: 'Dense', type: 'LLM',
    specialty: 'Instruction-following · Multilingual · Efficient',
    desc: "Mistral's 24B general-purpose model. Outstanding quality-to-size ratio — excellent multilingual support, strong instruction-following, and fits on a 16–24 GB RAM machine.",
    ramGbQ4: 14.3, ramGbQ3: 11.1,
  },
  'Gemma-3-27B': {
    company: 'Google', arch: 'Dense', type: 'LLM',
    specialty: 'Multilingual · Vision · Broad capability',
    desc: "Google's 27B Gemma 3 model. Strong general-purpose performance with vision capability — well-rounded across text, code, and image tasks on a mid-range workstation.",
    ramGbQ4: 16.0, ramGbQ3: 12.5,
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
  // Coding — High → Mid → Low
  'GLM-5',
  'Kimi-K2.5',
  'Qwen3.5-122B',
  'Qwen3-Coder-30B',
  'Codestral-22B',
  'Llama-3.1-8B',
  'DeepSeek-R1-Distill-Qwen-7B',
  // Reasoning — High → Mid → Low
  'DeepSeek-R1-671B',
  'DeepSeek-R1-Distill-Llama-70B',
  'DeepSeek-R1-Distill-Qwen-32B',
  'Qwen-QwQ-32B',
  'Phi-4-14B',
  'Mathstral-7B',
  // Well-Rounded — High → Mid → Low
  'Llama-4-Maverick',
  'Qwen3.5-72B',
  'Qwen3.5-27B',
  'Mistral-Small-3.2-24B',
  'Gemma-3-27B',
];

const CATEGORY_ORDER = ['Coding', 'Reasoning', 'Well-Rounded'] as const;
type ModelCategory = typeof CATEGORY_ORDER[number];

const MODEL_CATEGORY: Record<string, ModelCategory> = {
  'GLM-5':                          'Coding',
  'Kimi-K2.5':                      'Coding',
  'Qwen3.5-122B':                   'Coding',
  'Qwen3-Coder-30B':                'Coding',
  'Codestral-22B':                  'Coding',
  'Llama-3.1-8B':                   'Coding',
  'DeepSeek-R1-Distill-Qwen-7B':    'Coding',
  'DeepSeek-R1-671B':               'Reasoning',
  'DeepSeek-R1-Distill-Llama-70B':  'Reasoning',
  'DeepSeek-R1-Distill-Qwen-32B':   'Reasoning',
  'Qwen-QwQ-32B':                   'Reasoning',
  'Phi-4-14B':                      'Reasoning',
  'Mathstral-7B':                   'Reasoning',
  'Llama-4-Maverick':               'Well-Rounded',
  'Qwen3.5-72B':                    'Well-Rounded',
  'Qwen3.5-27B':                    'Well-Rounded',
  'Mistral-Small-3.2-24B':          'Well-Rounded',
  'Gemma-3-27B':                    'Well-Rounded',
};

// ── llama.cpp (llama-server) config ──────────────────────────────────────────
// Each engine slot gets its own port so instances can run truly in parallel.
export const SLOT_PORT: Record<Slot, number> = { a: 8080, b: 8081, c: 8082 };

// HuggingFace GGUF source for every self-hosted model.
// llama-server downloads the file on first run, then serves on SLOT_PORT.
export const GGUF_INFO: Record<string, { repo: string; file: string }> = {
  // ── Coding ─────────────────────────────────────────────────────────────
  'GLM-5':                          { repo: 'THUDM/GLM-5-GGUF',                                        file: 'GLM-5-Q4_K_M.gguf'                                 },
  'Kimi-K2.5':                      { repo: 'moonshotai/Kimi-K2-Instruct-GGUF',                        file: 'Kimi-K2-Instruct-Q4_K_M.gguf'                      },
  'Qwen3.5-122B':                   { repo: 'Qwen/Qwen3.5-122B-Instruct-GGUF',                        file: 'Qwen3.5-122B-Instruct-Q4_K_M.gguf'                 },
  'Qwen3-Coder-30B':                { repo: 'Qwen/Qwen3-Coder-30B-GGUF',                               file: 'Qwen3-Coder-30B-Q4_K_M.gguf'                       },
  'Codestral-22B':                  { repo: 'bartowski/Codestral-22B-v0.1-GGUF',                       file: 'Codestral-22B-v0.1-Q4_K_M.gguf'                    },
  'Llama-3.1-8B':                   { repo: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',               file: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf'            },
  'DeepSeek-R1-Distill-Qwen-7B':    { repo: 'bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF',             file: 'DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf'           },
  // ── Reasoning ───────────────────────────────────────────────────────────
  'DeepSeek-R1-671B':               { repo: 'unsloth/DeepSeek-R1-GGUF',                                file: 'DeepSeek-R1-Q4_K_M.gguf'                           },
  'DeepSeek-R1-Distill-Llama-70B':  { repo: 'bartowski/DeepSeek-R1-Distill-Llama-70B-GGUF',           file: 'DeepSeek-R1-Distill-Llama-70B-Q4_K_M.gguf'         },
  'DeepSeek-R1-Distill-Qwen-32B':   { repo: 'bartowski/DeepSeek-R1-Distill-Qwen-32B-GGUF',            file: 'DeepSeek-R1-Distill-Qwen-32B-Q4_K_M.gguf'          },
  'Qwen-QwQ-32B':                   { repo: 'Qwen/QwQ-32B-GGUF',                                      file: 'QwQ-32B-Q4_K_M.gguf'                               },
  'Phi-4-14B':                      { repo: 'microsoft/Phi-4-GGUF',                                    file: 'Phi-4-Q4_K_M.gguf'                                 },
  'Mathstral-7B':                   { repo: 'bartowski/mathstral-7B-v0.1-GGUF',                        file: 'mathstral-7B-v0.1-Q4_K_M.gguf'                     },
  // ── Well-Rounded ─────────────────────────────────────────────────────────
  'Llama-4-Maverick':               { repo: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-GGUF',      file: 'Llama-4-Maverick-17B-128E-Instruct-Q4_K_M.gguf'    },
  'Qwen3.5-72B':                    { repo: 'Qwen/Qwen3.5-72B-Instruct-GGUF',                          file: 'Qwen3.5-72B-Instruct-Q4_K_M.gguf'                  },
  'Qwen3.5-27B':                    { repo: 'Qwen/Qwen3.5-27B-Instruct-GGUF',                          file: 'Qwen3.5-27B-Instruct-Q4_K_M.gguf'                  },
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
): { category: ModelCategory; models: string[] }[] {
  const q = normalizeQuery(filter);
  const eligible = ALL_SELF_HOSTED.filter(
    (m) => (q === '' || normalizeQuery(m).includes(q)) && m !== filter && !usedModels.includes(m),
  );
  return CATEGORY_ORDER
    .map((cat) => ({
      category: cat,
      models: eligible.filter((m) => MODEL_CATEGORY[m] === cat).sort((a, b) => a.localeCompare(b)),
    }))
    .filter((g) => g.models.length > 0);
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
  const [installModalMode, setInstallModalMode] = useState<'install' | 'connect' | null>(null);
  const [downloaded, markDownloaded] = useDownloadedModels();
  type ProbeResult = { reachable: boolean; latency_ms?: number; http_status?: number; error?: string };
  const [probeState, setProbeState] = useState<null | 'loading' | ProbeResult>(null);

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
                <div className="absolute z-20 w-full mt-1 overflow-y-auto rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] shadow-lg" style={{ maxHeight: '32rem' }}>
                  {grouped.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-[var(--color-text-muted)] italic">
                      No matching models available
                    </div>
                  ) : grouped.map(({ category, models }) => (
                    <div key={category}>
                      <div className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-white bg-black border-b border-[var(--color-border-subtle)] sticky top-0">
                        {category}
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
                              <span className="text-sm text-[var(--color-text-secondary)] font-medium flex-1">{m}</span>
                              {downloaded.has(m) && (
                                <HardDriveDownload className="w-3 h-3 flex-shrink-0 text-emerald-400" aria-label="Already downloaded" />
                              )}
                              {ram && (
                                <span className="text-[10px] text-[var(--color-text-muted)] flex-shrink-0">
                                  {ram.split('·')[0].trim()}
                                </span>
                              )}
                            </div>
                            {info && (
                              <div className="flex items-center gap-1.5 mt-0.5 pl-5 flex-wrap">
                                <span className="text-[10px] text-[var(--color-text-muted)]">{info.company}</span>
                                <span className="text-[10px] text-[var(--color-border-subtle)]">|</span>
                                <span className="text-[10px] text-[var(--color-text-muted)]">{info.type}</span>
                                {info.arch === 'MoE' && (
                                  <>
                                    <span className="text-[10px] text-[var(--color-border-subtle)]">|</span>
                                    <span className="text-[10px] font-semibold text-[var(--color-gold-500)]">MoE</span>
                                  </>
                                )}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}

                  {/* Models assigned to other slots */}
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

            {/* Install / Connect buttons — visible for all self-hosted models */}
            {modelName && GGUF_INFO[modelName] && (
              <div className="flex gap-2">
                {downloaded.has(modelName) ? (
                  <button
                    onClick={() => setInstallModalMode('install')}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-500/40 bg-emerald-500/8 text-emerald-400 text-xs font-medium hover:bg-emerald-500/15 hover:border-emerald-500/70 transition-colors"
                  >
                    <HardDriveDownload className="w-3.5 h-3.5" />
                    Downloaded
                  </button>
                ) : (
                  <button
                    onClick={() => setInstallModalMode('install')}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--color-gold-500)]/40 bg-[var(--color-gold-500)]/8 text-[var(--color-gold-400)] text-xs font-medium hover:bg-[var(--color-gold-500)]/15 hover:border-[var(--color-gold-500)]/70 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Install
                  </button>
                )}
                <button
                  onClick={() => setInstallModalMode('connect')}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-blue-500/40 bg-blue-500/8 text-blue-400 text-xs font-medium hover:bg-blue-500/15 hover:border-blue-500/70 transition-colors"
                >
                  <Radio className="w-3.5 h-3.5" />
                  Connect
                </button>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-[var(--color-text-secondary)]">Endpoint URL</label>
                <button
                  onClick={probeEndpoint}
                  disabled={probeState === 'loading' || !endpoint}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border border-[var(--color-border-default)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
              />
              {probeState !== null && probeState !== 'loading' && (
                <div className={`mt-1.5 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md ${probeState.reachable ? 'bg-[var(--color-ok)]/10 text-[var(--color-ok)]' : 'bg-red-500/10 text-red-400'}`}>
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

      {/* Actions */}
      <div className="mt-4 flex items-center justify-between gap-2">
        {/* Clear slot — two-click confirm pattern */}
        {config && (
          <button
            onClick={handleClear}
            onBlur={() => setConfirmClear(false)}
            disabled={clearSlot.isPending}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
              confirmClear
                ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20'
                : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)] border-[var(--color-border-default)] hover:text-red-400 hover:border-red-500/30'
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

      {/* Install / Connect modal */}
      {installModalMode !== null && (
        <ModelInstallModal
          modelName={modelName}
          port={SLOT_PORT[slot]}
          mode={installModalMode}
          onClose={() => setInstallModalMode(null)}
          isDownloaded={downloaded.has(modelName)}
          onMarkDownloaded={() => markDownloaded(modelName)}
        />
      )}
    </div>
  );
}
