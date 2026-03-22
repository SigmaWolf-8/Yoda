import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BevelBox, BEVEL_NO_TL } from '../ui/BevelBox';
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
  Download,
  HardDriveDownload,
  Radio,
  Trash2,
  Wifi,
  WifiOff,
  ExternalLink,
  RefreshCcw,
} from 'lucide-react';
import { ModelInstallModal } from './ModelInstallModal';
import {
  detectOS,
  makeBashInstallScript,
  makeBatWrapper,
  makePsInstallScript,
  makePsStep1Script,
  makePsStep2Script,
  triggerDownload,
} from './installScripts';
import { useUpdateEngine, useDeleteEngine, useMarkEngineOnline, useMarkEngineOffline } from '../../api/hooks';
import { getStoredToken } from '../../api/client';
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
  'grok-4':                      { company: 'xAI', arch: 'Dense', type: 'LLM',          specialty: 'Frontier reasoning · 2M context · Coding', desc: "xAI's most powerful model. Deep multi-step reasoning, 2M-token context, and top coding performance. Use when maximum intelligence matters." },
  'grok-4-fast':                 { company: 'xAI', arch: 'Dense', type: 'LLM',          specialty: 'High throughput · 2M context · Non-reasoning', desc: "Non-reasoning variant of Grok 4 at 15× lower cost. Very fast throughput with 2M-token context — ideal for high-volume pipelines." },
  'grok-4-1-fast-reasoning':     { company: 'xAI', arch: 'Dense', type: 'Reasoning LLM', specialty: 'Reasoning · Speed · Cost-efficient · 2M context', desc: "xAI's recommended default. Best balance of reasoning quality, throughput, and cost — 2M-token context at $0.20/$0.50 per million tokens." },
  'grok-4-1-fast-non-reasoning': { company: 'xAI', arch: 'Dense', type: 'LLM',          specialty: 'Ultra-low latency · Instant responses · 2M context', desc: "Fastest Grok model. Non-reasoning variant of Grok 4.1 Fast — best for latency-sensitive tasks that don't need chain-of-thought." },
  'grok-code-fast-1':            { company: 'xAI', arch: 'Dense', type: 'Coding LLM',   specialty: 'Coding agents · Agentic tasks · 256K context', desc: "xAI's coding specialist. Economical reasoning optimised for code generation, agentic workflows, and multi-step coding tasks." },
  'grok-3':                      { company: 'xAI', arch: 'Dense', type: 'LLM',          specialty: 'Real-time data · Long context · Coding', desc: "Grok 3 flagship (superseded by Grok 4). Still capable — live web search, long context, and strong coding. Use Grok 4 for new projects." },
  'grok-3-mini':                 { company: 'xAI', arch: 'Dense', type: 'Reasoning LLM', specialty: 'Efficient · Chain-of-thought · Cost-effective', desc: "Grok 3 compact reasoning model. Budget-friendly with chain-of-thought capability. Consider grok-4-1-fast-reasoning for better value in 2025+." },
  'grok-3-fast':                 { company: 'xAI', arch: 'Dense', type: 'LLM',          specialty: 'High throughput · Real-time data · Coding', desc: "Faster-throughput variant of Grok 3 (legacy). Superseded by grok-4-fast for new deployments." },
  'grok-3-mini-fast':            { company: 'xAI', arch: 'Dense', type: 'Reasoning LLM', specialty: 'Fastest Grok 3 · Low latency · High volume', desc: "xAI's fastest Grok 3 variant (legacy). Superseded by grok-4-1-fast-non-reasoning." },
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

  // ── Additional models referenced by SECTION_LAYOUT ──────────────────
  'DeepSeek-V3.2-685B': {
    company: 'DeepSeek', arch: 'MoE', type: 'Coding LLM',
    specialty: 'Coding · Math · Cost-efficient frontier',
    desc: "DeepSeek's 685B MoE updated flagship. Competitive with GPT-4o on coding benchmarks — the open-weight frontier, but requires a multi-GPU server rack.",
    ramGbQ4: 350.0,
  },
  'Qwen3-235B-A22B': {
    company: 'Alibaba', arch: 'MoE', type: 'Coding LLM',
    specialty: 'Coding · Reasoning · 22B active params',
    desc: "Alibaba's 235B MoE with only 22B active parameters per token. High capability at reduced inference compute — needs ~118 GB at Q4 or ~59 GB at Q3.",
    ramGbQ4: 118.0, ramGbQ3: 59.0,
  },
  'Codestral-22B': {
    company: 'Mistral AI', arch: 'Dense', type: 'Coding LLM',
    specialty: 'Code completion · Fill-in-the-middle · 80+ languages',
    desc: "Mistral's dedicated 22B coding model. Trained on 80+ programming languages with fill-in-the-middle support — fits on a 16 GB machine.",
    ramGbQ4: 13.5, ramGbQ3: 10.5,
  },
  'DeepSeek-R1-Distill-Qwen-7B': {
    company: 'DeepSeek', arch: 'Dense', type: 'Reasoning LLM',
    specialty: 'Reasoning · Coding · Ultralight footprint',
    desc: "DeepSeek-R1's reasoning distilled into a 7B Qwen backbone. Excellent on machines with under 8 GB free RAM.",
    ramGbQ4: 4.5,
  },
  'DeepSeek-R1-671B': {
    company: 'DeepSeek', arch: 'Dense', type: 'Reasoning LLM',
    specialty: 'Chain-of-thought · Math · Complex problem-solving',
    desc: "DeepSeek's full 671B flagship reasoning model. Outstanding on maths, logic, and long-form analysis — requires a multi-GPU server.",
    ramGbQ4: 400.0,
  },
  'Qwen-QwQ-32B': {
    company: 'Alibaba', arch: 'Dense', type: 'Reasoning LLM',
    specialty: 'Deep thinking · Math · Multi-step logic',
    desc: "Alibaba's QwQ 32B reasoning model. Extended chain-of-thought for hard mathematical and logical problems.",
    ramGbQ4: 19.8, ramGbQ3: 15.4,
  },
  'Phi-4-14B': {
    company: 'Microsoft', arch: 'Dense', type: 'Reasoning LLM',
    specialty: 'Reasoning · STEM · Compact footprint',
    desc: "Microsoft's Phi-4 14B model. Exceptionally strong on STEM reasoning — fits comfortably on a 16 GB RAM machine.",
    ramGbQ4: 8.5,
  },
  'Mathstral-7B': {
    company: 'Mistral AI', arch: 'Dense', type: 'Reasoning LLM',
    specialty: 'Mathematics · Formal proofs · Scientific reasoning',
    desc: "Mistral's math-specialist 7B model. Fine-tuned for mathematical reasoning and formal proof generation.",
    ramGbQ4: 4.5,
  },
  'Qwen3.5-72B': {
    company: 'Alibaba', arch: 'Dense', type: 'LLM',
    specialty: 'General purpose · Coding · Multilingual',
    desc: "Alibaba's 72B dense model. Excellent across coding, instruction-following, and multilingual tasks.",
    ramGbQ4: 42.0, ramGbQ3: 32.5,
  },
  'Mistral-Small-3.2-24B': {
    company: 'Mistral AI', arch: 'Dense', type: 'LLM',
    specialty: 'Instruction-following · Multilingual · Efficient',
    desc: "Mistral's 24B general-purpose model. Outstanding quality-to-size ratio — fits on a 16–24 GB RAM machine.",
    ramGbQ4: 14.3, ramGbQ3: 11.1,
  },
  'Gemma-3-27B': {
    company: 'Google', arch: 'Dense', type: 'LLM',
    specialty: 'Multilingual · Vision · Broad capability',
    desc: "Google's 27B Gemma 3 model. Strong general-purpose performance with vision capability.",
    ramGbQ4: 16.0, ramGbQ3: 12.5,
  },
};

// ── Resource helpers ──────────────────────────────────────────────────────────

export const OS_OVERHEAD_GB = 3;

/** Compute fit given total host RAM and RAM already reserved by other self-hosted slots. */
export function computeFit(info: ModelMeta | undefined, hostRam: number, reservedRam = 0): FitLevel | undefined {
  if (!info || info.ramGbQ4 === undefined) return undefined;
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
export const SLOT_PORT: Record<Slot, number>      = { a: 8080,  b: 8082,  c: 8084  };
export const CUBE_PORT: Record<Slot, number>      = { a: 8081,  b: 8083,  c: 8085  };

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
    (q === '' || normalizeQuery(m).includes(q)) && m !== filter;

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
  xAI:       { authType: 'bearer',  models: ['grok-4', 'grok-4-fast', 'grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning', 'grok-code-fast-1', 'grok-3', 'grok-3-mini', 'grok-3-fast', 'grok-3-mini-fast'] },
  Google:    { authType: 'bearer',  models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-pro'] },
  DeepSeek:  { authType: 'api_key', models: ['DeepSeek-V3.2', 'DeepSeek-R1'] },
};

const SLOT_LABELS: Record<Slot, string> = { a: 'Engine A', b: 'Engine B', c: 'Engine C' };

// Reverse lookup: model name → provider key (e.g. 'grok-4-1-fast-reasoning' → 'xAI')
const MODEL_TO_PROVIDER: Record<string, string> = {};
for (const [pName, { models }] of Object.entries(PROVIDERS)) {
  for (const m of models) MODEL_TO_PROVIDER[m] = pName;
}

const PROVIDER_URLS: Record<string, string> = {
  Anthropic: 'https://api.anthropic.com/v1/messages',
  OpenAI:    'https://api.openai.com/v1/chat/completions',
  xAI:       'https://api.x.ai/v1/chat/completions',
  Google:    'https://generativelanguage.googleapis.com/v1beta/models',
  DeepSeek:  'https://api.deepseek.com/v1/chat/completions',
};

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
    <span className="flex items-center gap-1 text-sm font-medium text-[var(--color-plex-400)]">
      <CheckCircle2 className="w-3.5 h-3.5" />{ram} · Fits
    </span>
  );
  if (fit === 'tight') return (
    <span className="flex items-center gap-1 text-sm font-medium text-blue-300">
      <AlertTriangle className="w-3.5 h-3.5" />{ram} · Tight — use Q3 quant
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-sm font-medium text-[var(--color-text-muted)]">
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
    <div className="mt-1.5 px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] text-sm space-y-1">
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
  if (fit === 'ok')    return <CheckCircle2  className="w-3 h-3 flex-shrink-0 text-[var(--color-plex-400)]" />;
  if (fit === 'tight') return <AlertTriangle className="w-3 h-3 flex-shrink-0 text-blue-300" />;
  if (fit === 'no')    return <XCircle       className="w-3 h-3 flex-shrink-0 text-[var(--color-text-muted)]" />;
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
  const markOnline = useMarkEngineOnline();
  const markOffline = useMarkEngineOffline();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [mode, setMode] = useState<HostingMode>(config?.hosting_mode ?? 'self_hosted');
  const [confirmClear, setConfirmClear] = useState(false);
  const [endpoint, setEndpoint] = useState(config?.endpoint_url ?? '');
  const [authType, setAuthType] = useState<AuthType>(config?.auth_type ?? 'none');
  const [credentials, setCredentials] = useState('');
  const [modelName, setModelName] = useState(config?.model_name ?? '');
  const [cubeEndpoint, setCubeEndpoint] = useState(
    config?.cube_endpoint_url ?? `http://localhost:${CUBE_PORT[slot]}`
  );
  const [provider, setProvider] = useState('');
  const [familyOverride, setFamilyOverride] = useState(config?.family_override ?? '');
  const [showSuggest, setShowSuggest] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [installModalMode, setInstallModalMode] = useState<'connect' | null>(null);
  const [downloaded, markDownloaded] = useDownloadedModels();
  type ProbeResult = { reachable: boolean; latency_ms?: number; http_status?: number; error?: string; note?: string | null };
  const [probeState, setProbeState] = useState<null | 'loading' | ProbeResult>(null);
  const [syncing,    setSyncing]    = useState(false);
  const [syncResult, setSyncResult] = useState<'ok' | 'fail' | null>(null);
  const [markOnlineError, setMarkOnlineError] = useState<string | null>(null);

  type InstallPhase = 'idle' | 'downloaded' | 'polling' | 'tunnel_ready' | 'step2_ready' | 'connected' | 'timeout';
  const PHASE_KEY = `yoda_install_phase_slot${slot}`;
  const [installPhase, setInstallPhaseRaw] = useState<InstallPhase>(
    () => (localStorage.getItem(PHASE_KEY) as InstallPhase | null) ?? 'idle',
  );
  function setInstallPhase(phase: InstallPhase) {
    setInstallPhaseRaw(phase);
    if (phase === 'idle' || phase === 'connected') localStorage.removeItem(PHASE_KEY);
    else localStorage.setItem(PHASE_KEY, phase);
  }
  const [installAddress, setInstallAddress] = useState('');
  const installPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const crsUrl = (import.meta.env.VITE_CRS_URL as string | undefined) ?? '';

  const hasMountedRef    = useRef(false);
  const autoSaveTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoFill     = useRef<string>('');
  const seededRef        = useRef(false);

  // One-shot: populate state from DB as soon as config arrives.
  // useState initializers only run on mount — if config is undefined then
  // (query still loading), the fields stay blank forever without this effect.
  useEffect(() => {
    if (seededRef.current || !config) return;
    seededRef.current = true;
    // Suppress the auto-save that would otherwise fire for the modelName change.
    hasMountedRef.current = false;
    const hostingMode = (config.hosting_mode as HostingMode) ?? 'self_hosted';
    setMode(hostingMode);
    setCubeEndpoint(config.cube_endpoint_url ?? `http://localhost:${CUBE_PORT[slot]}`);
    setFamilyOverride(config.family_override ?? '');
    setModelName(config.model_name ?? '');
    onModelChange(config.model_name ?? '');
    onModeChange(hostingMode);

    // Restore provider for commercial/free_tier engines.
    // The provider dropdown is pure UI state — never stored in DB — so we
    // reverse-look it up from the saved model name.
    const detectedProvider = MODEL_TO_PROVIDER[config.model_name ?? ''] ?? '';
    setProvider(detectedProvider);

    // Restore auth type (may be overridden below if endpoint is stale).
    setAuthType((config.auth_type as AuthType) ?? 'none');

    // Restore endpoint. If it looks like a stale default local slot URL but
    // the engine is actually a cloud provider, replace it with the correct URL
    // and immediately persist it so the server probe uses the right address.
    const storedEndpoint = config.endpoint_url ?? '';
    const defaultLocalUrl = `http://localhost:${SLOT_PORT[slot]}`;
    const isStaleLocal = storedEndpoint === defaultLocalUrl || storedEndpoint === '';
    if (isStaleLocal && detectedProvider && PROVIDER_URLS[detectedProvider]) {
      const fixedEndpoint = PROVIDER_URLS[detectedProvider];
      const fixedAuthType = PROVIDERS[detectedProvider]?.authType ?? 'none';
      setEndpoint(fixedEndpoint);
      setAuthType(fixedAuthType);

      // Silently auto-save the corrected config so the DB endpoint is fixed
      // without the user needing to click Save. Build payload from local
      // variables — state hasn't re-rendered yet. Credentials are omitted
      // intentionally: the server preserves them via COALESCE.
      const autoPayload = {
        slot,
        hosting_mode: hostingMode,
        endpoint_url: fixedEndpoint,
        cube_endpoint_url: config.cube_endpoint_url ?? `http://localhost:${CUBE_PORT[slot]}`,
        auth_type: fixedAuthType,
        credentials: undefined,
        model_name: config.model_name ?? '',
        model_family: '',
        family_override: config.family_override ?? null,
      };
      setTimeout(() => { update.mutate(autoPayload); }, 300);
    } else {
      setEndpoint(storedEndpoint);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

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
      const token = getStoredToken() ?? '';
      const res = await fetch(`/api/settings/engines/${slot}/probe`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        setProbeState({ reachable: false, error: 'Session expired — refresh the page to log in again' });
        return;
      }
      const data: ProbeResult = await res.json();
      setProbeState(data);
      qc.invalidateQueries({ queryKey: ['engines'] });
    } catch {
      setProbeState({ reachable: false, error: 'Network error — could not reach server' });
    }
  }

  async function openNewNode() {
    try {
      const res = await fetch('/api/salvi/inter-cube/node/info');
      if (res.ok) {
        const info = await res.json();
        const port = info?.ports?.engine ?? '8080';
        window.open(`http://localhost:${port}`, '_blank', 'noopener,noreferrer');
      } else {
        window.open('http://localhost:8080', '_blank', 'noopener,noreferrer');
      }
    } catch {
      window.open('http://localhost:8080', '_blank', 'noopener,noreferrer');
    }
  }

  const LOCAL_RE = /localhost|127\.0\.0\.1|192\.168\.|^10\.|172\.(1[6-9]|2\d|3[01])\./;

  /** For local endpoints: browser-fetch the model server before marking online.
   *  Returns true if the server responded (even with CORS error), false if refused. */
  async function browserProbeLocal(url: string): Promise<boolean> {
    try {
      // mode:'no-cors' returns an opaque response when the server is up,
      // and throws TypeError when the connection is refused.
      await fetch(`${url.replace(/\/$/, '')}/v1/models`, {
        mode: 'no-cors',
        signal: AbortSignal.timeout(5000),
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Mark online — but verify the model server is actually responding first
   *  for local self-hosted endpoints. */
  async function verifyAndMarkOnline() {
    setMarkOnlineError(null);
    const isLocal = mode === 'self_hosted' && LOCAL_RE.test(endpoint);
    if (isLocal && endpoint) {
      const running = await browserProbeLocal(endpoint);
      if (!running) {
        setMarkOnlineError(
          `Model server not responding at ${endpoint}. ` +
          `Make sure llama-server is running — complete Step 2 from the install flow first.`
        );
        return;
      }
    }
    markOnline.mutate(slot, {
      onSuccess: () => { setMarkOnlineError(null); qc.invalidateQueries({ queryKey: ['engines'] }); },
    });
  }

  async function syncNode() {
    setSyncing(true);
    setSyncResult(null);
    setMarkOnlineError(null);
    try {
      const token = getStoredToken() ?? '';
      const res = await fetch(`/api/settings/engines/${slot}/probe`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.reachable) {
          qc.invalidateQueries({ queryKey: ['engines'] });
          setSyncResult('ok');
          return;
        }
      }
      // Server probe can't reach localhost — verify from browser before marking online.
      const isLocal = mode === 'self_hosted' && LOCAL_RE.test(endpoint);
      if (isLocal && endpoint) {
        const running = await browserProbeLocal(endpoint);
        if (!running) {
          setSyncResult('fail');
          setMarkOnlineError(
            `Model server not responding at ${endpoint}. ` +
            `Run Step 2 from the install flow to download and start the model.`
          );
          return;
        }
      }
      markOnline.mutate(slot, {
        onSuccess: () => { setSyncResult('ok'); qc.invalidateQueries({ queryKey: ['engines'] }); },
        onError:   () => setSyncResult('fail'),
      });
    } catch {
      setSyncResult('fail');
    } finally {
      setSyncing(false);
    }
  }

  function handleDirectInstall() {
    const info = GGUF_INFO[modelName];
    if (!info) return;

    const os    = detectOS();
    const token = crypto.randomUUID();

    if (os === 'windows') {
      // Step 1: PlenumNET tunnel setup only
      const ps  = makePsStep1Script(modelName, SLOT_PORT[slot], token, crsUrl);
      const bat = makeBatWrapper(ps, modelName);
      triggerDownload(bat, 'yoda-step1-tunnel.bat', 'application/octet-stream');
    } else if (os === 'mac') {
      const sh = makeBashInstallScript(modelName, info.repo, info.file, SLOT_PORT[slot], token, crsUrl);
      triggerDownload(sh, 'yoda-setup.command', 'text/x-shellscript');
    } else {
      const sh = makeBashInstallScript(modelName, info.repo, info.file, SLOT_PORT[slot], token, crsUrl);
      triggerDownload(sh, 'yoda-setup.sh', 'text/x-shellscript');
    }

    if (!crsUrl) {
      setInstallPhase('downloaded');
      return;
    }
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
          // Tunnel is up — for Windows, advance to Step 2
          if (detectOS() === 'windows') {
            setInstallPhase('tunnel_ready');
            setInstallAddress(data.address);
          } else {
            // Mac/Linux: all-in-one script, go straight to connected
            setInstallPhase('connected');
            setInstallAddress(data.address);
            markDownloaded(modelName);
            markOnline.mutate(slot);
          }
        }
      } catch { /* keep polling */ }
    }, 3000);
  }

  function handleStep2Install() {
    const info = GGUF_INFO[modelName];
    if (!info) return;
    const ps  = makePsStep2Script(modelName, info.repo, info.file, SLOT_PORT[slot]);
    const bat = makeBatWrapper(ps, modelName);
    triggerDownload(bat, 'yoda-step2-model.bat', 'application/octet-stream');
    setInstallPhase('step2_ready');
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
      cube_endpoint_url: cubeEndpoint || `http://localhost:${CUBE_PORT[slot]}`,
      auth_type: authType,
      credentials: credentials || undefined,
      model_name: modelName,
      model_family: '',
      family_override: familyOverride || null,
    };
  }

  function handleSave() {
    update.mutate(buildPayload(), {
      onSuccess: () => {
        toast('success', `Engine ${slot.toUpperCase()} saved — ${modelName || 'configuration updated'}.`);
        // For cloud engines, probe runs in the background (~1–2 s).
        // Schedule a second invalidation to pick up the updated health_status.
        if (mode === 'commercial' || mode === 'free_tier') {
          setTimeout(() => { qc.invalidateQueries({ queryKey: ['engines'] }); }, 2500);
        }
      },
      onError: () => toast('error', `Failed to save Engine ${slot.toUpperCase()}. Check your connection and try again.`),
    });
  }

  function handleClear() {
    if (!confirmClear) { setConfirmClear(true); return; }
    clearSlot.mutate(slot, {
      onSuccess: () => {
        setModelName('');
        setFamilyOverride('');
        setEndpoint(`http://localhost:${SLOT_PORT[slot]}`);
        setCubeEndpoint(`http://localhost:${CUBE_PORT[slot]}`);
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
    ? 'bg-sky-400'
    : config?.health_status === 'suspect'
      ? 'bg-[var(--color-gold-400)]'
      : 'bg-[var(--color-text-muted)]';

  const healthLabel: Record<string, string> = {
    online:  'online',
    offline: 'offline',
    suspect: 'reachable — verify key',
    unknown: 'unknown',
  };

  const grouped = groupedModels(searchQuery, usedModels);
  const availableGb  = hostRam - OS_OVERHEAD_GB - reservedRam;

  const MODE_TIPS: Record<HostingMode, string> = {
    self_hosted: 'Run a model on your own hardware via a local endpoint (Ollama, llama.cpp, LM Studio, vLLM). No data leaves your machine.',
    commercial:  'Connect to a paid API from Anthropic, OpenAI, xAI, Google, or DeepSeek. Requires an API key and charges per token.',
    free_tier:   "Use a provider's free or trial tier — same setup as Commercial but typically rate-limited with daily message caps.",
  };

  return (
    <BevelBox bevel={BEVEL_NO_TL} className="bg-[var(--color-surface-primary)] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{SLOT_LABELS[slot]}</h3>
        <div className="flex items-center gap-2">
          {config && (
            <>
              <span className={`w-2 h-2 rounded-full ${healthDot}`} />
              <span className="text-sm text-[var(--color-text-muted)]">
                {healthLabel[config.health_status ?? ''] ?? config.health_status ?? 'unknown'}
                {config.latency_ms && config.health_status === 'online' ? ` · ${config.latency_ms}ms` : ''}
              </span>
              {/* Manual override: server-side probe can't reach local engines
                  or validate cloud API keys — let the user confirm. */}
              {config.health_status !== 'online' && modelName && (
                <button
                  onClick={verifyAndMarkOnline}
                  disabled={markOnline.isPending}
                  title="Mark this engine online — verifies model server is reachable first"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border border-[var(--color-plex-500)]/40 text-[var(--color-plex-400)] hover:bg-[var(--color-plex-500)]/10 disabled:opacity-50 transition-colors"
                >
                  {markOnline.isPending
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Wifi className="w-3 h-3" />
                  }
                  Mark online
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Mode selector */}
      <div className="flex gap-1.5 mb-2.5">
        {([
          { m: 'self_hosted' as const, icon: Server, label: 'Self-Hosted' },
          { m: 'commercial' as const, icon: Cloud,  label: 'Commercial' },
          { m: 'free_tier'  as const, icon: Gift,   label: 'Free Tier'  },
        ]).map(({ m, icon: Icon, label }) => (
          <Tooltip key={m} content={MODE_TIPS[m]}>
            <button
              onClick={() => changeMode(m)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                mode === m
                  ? 'bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)] border-[var(--color-gold-500)]/30'
                  : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border-default)] hover:text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]'
              }`}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          </Tooltip>
        ))}
      </div>

      <div className="space-y-2">
        {/* ── Self-Hosted fields ────────────────────────────────────────── */}
        {mode === 'self_hosted' && (
          <>
            {/* RAM context banner — shows available RAM accounting for other slots */}
            <div className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] text-xs text-[var(--color-text-muted)] leading-relaxed">
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
                {' '}<span className="text-[var(--color-plex-400)]">✓ Fits</span>{' · '}
                <span className="text-blue-300">⚠ Q3 only</span>{' · '}
                <span className="text-[var(--color-text-muted)]">✗ Too large</span>.
              </span>
            </div>

            {/* Model typeahead */}
            <div className="relative">
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Model</label>
              <input
                type="text"
                value={showSuggest ? searchQuery : modelName}
                onChange={(e) => { setSearchQuery(e.target.value); setShowSuggest(true); }}
                onFocus={() => { setSearchQuery(''); setShowSuggest(true); }}
                onBlur={() => setTimeout(() => { setShowSuggest(false); setSearchQuery(''); }, 150)}
                placeholder="e.g. Llama-3.1-8B"
                className="w-full px-3 py-1.5 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
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
                            const info    = MODEL_INFO[m];
                            const fit     = computeFit(info, hostRam, reservedRam);
                            const ram     = ramDisplay(info);
                            const inUse   = usedModels.includes(m);
                            const isDl    = downloaded.has(m);
                            return (
                              <button
                                key={m}
                                onMouseDown={() => { changeModel(m); setShowSuggest(false); setSearchQuery(''); }}
                                className={`w-full text-left px-3 py-2 transition-colors border-b border-[var(--color-border-subtle)] last:border-0 ${inUse ? 'opacity-60 hover:opacity-80' : 'hover:bg-[var(--color-surface-hover)]'}`}
                              >
                                <div className="flex items-center gap-2">
                                  <FitDot fit={fit} />
                                  <span className="text-sm text-[var(--color-text-primary)] font-medium flex-1 truncate">
                                    {info ? `${info.company} | ${m}` : m}
                                  </span>
                                  {inUse && (
                                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/25 shrink-0">
                                      In Use
                                    </span>
                                  )}
                                  {isDl && !inUse && (
                                    <HardDriveDownload className="w-3.5 h-3.5 shrink-0 text-[var(--color-plex-400)]" aria-label="Installed" />
                                  )}
                                  {isDl && (
                                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-plex-500)]/15 text-[var(--color-plex-400)] border border-[var(--color-plex-500)]/25 shrink-0">
                                      Installed
                                    </span>
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

                </div>
              )}
            </div>

            <ModelCard modelName={modelName} hostRam={hostRam} reservedRam={reservedRam} />

            {/* Install / Connect — hidden when engine is already online */}
            {modelName && GGUF_INFO[modelName] && config?.health_status !== 'online' && (() => {
              const isWin = detectOS() === 'windows';

              // Step completion flags
              const step1Done = isWin && (
                installPhase === 'tunnel_ready' ||
                installPhase === 'step2_ready'  ||
                installPhase === 'connected'
              );
              const step2Done = isWin && installPhase === 'connected';

              return (
                <div className="space-y-2">
                  {/* Windows step-progress indicator */}
                  {isWin && installPhase !== 'idle' && (
                    <div className="flex items-center gap-1 text-xs px-1">
                      {/* Step 1 */}
                      <div className={`flex items-center gap-1 ${step1Done ? 'text-[var(--color-plex-400)]' : installPhase === 'polling' || installPhase === 'downloaded' ? 'text-[var(--color-gold-400)]' : 'text-[var(--color-text-muted)]'}`}>
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold border ${step1Done ? 'border-[var(--color-plex-400)] bg-[var(--color-plex-400)]/15' : 'border-[var(--color-gold-500)]/60 bg-[var(--color-gold-500)]/10'}`}>
                          {step1Done ? '✓' : '1'}
                        </div>
                        <span className="font-medium">Tunnel</span>
                      </div>
                      <div className="flex-1 h-px bg-[var(--color-text-muted)]/20 mx-1" />
                      {/* Step 2 */}
                      <div className={`flex items-center gap-1 ${step2Done ? 'text-[var(--color-plex-400)]' : step1Done ? 'text-[var(--color-gold-400)]' : 'text-[var(--color-text-muted)]/40'}`}>
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold border ${step2Done ? 'border-[var(--color-plex-400)] bg-[var(--color-plex-400)]/15' : step1Done ? 'border-[var(--color-gold-500)]/60 bg-[var(--color-gold-500)]/10' : 'border-[var(--color-text-muted)]/20'}`}>
                          {step2Done ? '✓' : '2'}
                        </div>
                        <span className="font-medium">Model</span>
                      </div>
                      <div className="flex-1 h-px bg-[var(--color-text-muted)]/20 mx-1" />
                      {/* Step 3 */}
                      <div className={`flex items-center gap-1 ${installPhase === 'connected' ? 'text-sky-400' : 'text-[var(--color-text-muted)]/40'}`}>
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold border ${installPhase === 'connected' ? 'border-sky-400 bg-sky-400/15' : 'border-[var(--color-text-muted)]/20'}`}>
                          {installPhase === 'connected' ? '✓' : '3'}
                        </div>
                        <span className="font-medium">Online</span>
                      </div>
                    </div>
                  )}

                  {/* Primary action button */}
                  <div className="flex gap-2">
                    {/* Step 1 / Install button — idle, timeout, downloaded */}
                    {(installPhase === 'idle' || installPhase === 'timeout' || installPhase === 'downloaded') && (
                      <button
                        onClick={handleDirectInstall}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                          downloaded.has(modelName)
                            ? 'border-[var(--color-plex-500)]/40 bg-[var(--color-plex-500)]/8 text-[var(--color-plex-400)] hover:bg-[var(--color-plex-500)]/15 hover:border-[var(--color-plex-500)]/70'
                            : 'border-[var(--color-gold-500)]/40 bg-[var(--color-gold-500)]/8 text-[var(--color-gold-400)] hover:bg-[var(--color-gold-500)]/15 hover:border-[var(--color-gold-500)]/70'
                        }`}
                      >
                        <Download className="w-3.5 h-3.5" />
                        {isWin
                          ? (installPhase === 'timeout' ? 'Retry Step 1 — Network Setup' : 'Step 1: Network Setup')
                          : (downloaded.has(modelName) ? 'Re-Install' : 'Install')}
                      </button>
                    )}

                    {/* Step 2 button — tunnel confirmed, model not yet installed */}
                    {installPhase === 'tunnel_ready' && (
                      <button
                        onClick={handleStep2Install}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--color-gold-500)]/60 bg-[var(--color-gold-500)]/12 text-[var(--color-gold-300)] text-sm font-semibold hover:bg-[var(--color-gold-500)]/20 hover:border-[var(--color-gold-500)]/80 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Step 2: Install Model
                      </button>
                    )}
                  </div>

                  {/* Status messages */}
                  {installPhase === 'polling' && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--color-gold-500)]/8 border border-[var(--color-gold-500)]/25 text-xs text-[var(--color-gold-300)]">
                      <Loader2 className="w-3 h-3 animate-spin flex-shrink-0 mt-0.5" />
                      <span>
                        <strong>yoda-step1-tunnel.bat</strong> downloaded — double-click it to run.
                        {isWin ? ' Waiting for tunnel confirmation…' : ' Waiting for connection…'}
                      </span>
                    </div>
                  )}
                  {installPhase === 'downloaded' && (
                    <div className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--color-gold-500)]/8 border border-[var(--color-gold-500)]/25 text-xs text-[var(--color-gold-300)]">
                      <HardDriveDownload className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      <span>Installer downloaded — double-click to run, then click <strong>Mark Online</strong> when ready.</span>
                    </div>
                  )}
                  {installPhase === 'tunnel_ready' && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--color-gold-500)]/10 border border-[var(--color-gold-500)]/35 text-xs text-[var(--color-gold-200)]">
                      <Wifi className="w-3 h-3 flex-shrink-0 mt-0.5 text-[var(--color-gold-400)]" />
                      <span>
                        <strong>Tunnel established</strong> — {installAddress && `node ${installAddress} — `}now download and run <strong>Step 2</strong> to install the AI model on your machine.
                      </span>
                    </div>
                  )}
                  {installPhase === 'step2_ready' && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--color-gold-500)]/8 border border-[var(--color-gold-500)]/25 text-xs text-[var(--color-gold-300)]">
                      <Loader2 className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      <span>
                        <strong>yoda-step2-model.bat</strong> downloaded — double-click it to download and start the model (4–8 GB, takes a while). When the script says "Step 2 Complete", click <strong>Mark Online</strong> below.
                      </span>
                    </div>
                  )}
                  {installPhase === 'connected' && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-400/8 border border-sky-400/25 text-xs text-sky-300">
                      <Wifi className="w-3 h-3 flex-shrink-0" />
                      <span>Connected{installAddress ? ` — ${installAddress}` : ''}</span>
                    </div>
                  )}
                  {installPhase === 'timeout' && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-text-muted)]/5 border border-[var(--color-text-muted)]/15 text-xs text-[var(--color-text-muted)]">
                      <WifiOff className="w-3 h-3 flex-shrink-0" />
                      <span>Timed out waiting for tunnel. Click Retry above and re-run the script.</span>
                    </div>
                  )}
                </div>
              );
            })()}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-[var(--color-text-secondary)]">Endpoint URL</label>
                <div className="flex items-center gap-1">
                  {config?.health_status !== 'online' && endpoint && (
                    <button
                      onClick={verifyAndMarkOnline}
                      disabled={markOnline.isPending}
                      title="Mark online — verifies model server is reachable from your browser first"
                      className="flex items-center gap-1 text-sm px-2 py-0.5 rounded-md border border-[var(--color-plex-500)]/40 text-[var(--color-plex-400)] hover:border-[var(--color-plex-400)] hover:text-[var(--color-plex-300)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {markOnline.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Wifi className="w-3 h-3" />
                      )}
                      Mark Online
                    </button>
                  )}
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
              </div>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => { setEndpoint(e.target.value); setProbeState(null); setMarkOnlineError(null); }}
                placeholder="http://localhost:11434"
                className="w-full px-3 py-1.5 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
              />
              {probeState !== null && probeState !== 'loading' && (
                <div className={`mt-1.5 flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-md ${
                  probeState.reachable
                    ? probeState.note
                      ? 'bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)]'
                      : 'bg-[var(--color-plex-500)]/10 text-[var(--color-plex-400)]'
                    : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)]'
                }`}>
                  {probeState.reachable ? (
                    probeState.note ? (
                      <><AlertTriangle className="w-3 h-3 flex-shrink-0" />{' '}{probeState.note}{probeState.http_status ? ` (HTTP ${probeState.http_status})` : ''}</>
                    ) : (
                      <><CheckCircle2 className="w-3 h-3 flex-shrink-0" /> Reachable — {probeState.latency_ms} ms{probeState.http_status ? ` · HTTP ${probeState.http_status}` : ''}</>
                    )
                  ) : (
                    <>
                      <XCircle className="w-3 h-3 flex-shrink-0" />
                      {' '}
                      {/localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\./.test(endpoint)
                        ? 'Local/LAN address — the cloud server cannot reach it. Your browser will relay inference calls directly. This is expected.'
                        : `Unreachable${probeState.error ? ` — ${probeState.error.split('error sending')[0].trim()}` : '. Check the URL and ensure the engine is running.'}`}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ── Cube (PlenumNET) endpoint ── */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                  Cube Node Endpoint
                </label>
                <span className="text-[10px] text-[var(--color-text-muted)]/70 font-mono">
                  default :{CUBE_PORT[slot]}
                </span>
              </div>
              <input
                type="text"
                value={cubeEndpoint}
                onChange={(e) => setCubeEndpoint(e.target.value)}
                placeholder={`http://localhost:${CUBE_PORT[slot]}`}
                className="w-full px-3 py-1.5 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
              />
              <p className="text-[11px] text-[var(--color-text-muted)]/80 leading-snug">
                PlenumNET Cube daemon port paired with this engine slot.
                Runs alongside the LLM inference server for network mesh participation.
              </p>
            </div>

            {/* ── Node actions — Open New Node + Sync Node ── */}
            {modelName && (
              <div className="flex gap-2">
                <button
                  onClick={openNewNode}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] text-sm font-medium hover:text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open New Node
                </button>
                <button
                  onClick={syncNode}
                  disabled={syncing || markOnline.isPending}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-plex-500)]/40 bg-[var(--color-plex-500)]/6 text-[var(--color-plex-400)] text-sm font-medium hover:bg-[var(--color-plex-500)]/12 hover:border-[var(--color-plex-500)]/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {syncing || markOnline.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="w-3.5 h-3.5" />
                  )}
                  Sync Node
                </button>
              </div>
            )}
            {/* Sync result feedback */}
            {syncResult && !markOnlineError && (
              <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md ${
                syncResult === 'ok'
                  ? 'bg-sky-400/8 border border-sky-400/20 text-sky-300'
                  : 'bg-[var(--color-surface-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-muted)]'
              }`}>
                {syncResult === 'ok'
                  ? <><CheckCircle2 className="w-3 h-3 flex-shrink-0" /> Node synced — connection confirmed</>
                  : <><XCircle className="w-3 h-3 flex-shrink-0" /> Sync failed — is the daemon running?</>
                }
              </div>
            )}
            {/* Mark-online verification error — shown when the model server isn't reachable */}
            {markOnlineError && (
              <div className="flex flex-col gap-2.5 px-2.5 py-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] text-xs">
                <div className="flex items-start gap-2 text-[var(--color-text-secondary)]">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-[var(--color-gold-500)]" />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-[var(--color-text-primary)]">Model server not responding yet</span>
                    <span className="text-[var(--color-text-muted)]">
                      llama-server takes 30–60 sec to load the model before it accepts connections.
                      If you just ran Step 2, wait a moment then retry — or mark it online anyway if you know it&apos;s running.
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-5">
                  {/* Retry — re-probes the local server */}
                  <button
                    type="button"
                    onClick={() => syncNode()}
                    disabled={syncing}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-sky-400/10 border border-sky-400/25 text-sky-300 hover:bg-sky-400/20 transition-colors font-medium disabled:opacity-50"
                  >
                    {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCcw className="w-3 h-3" />}
                    Retry
                  </button>
                  {/* Mark online anyway — bypasses the probe */}
                  <button
                    type="button"
                    onClick={() => {
                      setMarkOnlineError(null);
                      markOnline.mutate(slot, {
                        onSuccess: () => { setSyncResult('ok'); qc.invalidateQueries({ queryKey: ['engines'] }); },
                        onError:   () => setSyncResult('fail'),
                      });
                    }}
                    disabled={markOnline.isPending}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--color-gold-500)]/10 border border-[var(--color-gold-500)]/30 text-[var(--color-gold-400)] hover:bg-[var(--color-gold-500)]/20 transition-colors font-medium disabled:opacity-50"
                  >
                    {markOnline.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                    Mark Online Anyway
                  </button>
                  {/* Step 2 download — only shown if model info is known (they may not have run it) */}
                  {GGUF_INFO[modelName] && (
                    <button
                      type="button"
                      onClick={() => {
                        if (detectOS() === 'windows') {
                          handleStep2Install();
                        } else {
                          const info = GGUF_INFO[modelName];
                          if (!info) return;
                          const token = getStoredToken() ?? '';
                          const crsUrl = 'https://plenumnet.replit.app';
                          const sh = makeBashInstallScript(modelName, info.repo, info.file, SLOT_PORT[slot], token, crsUrl);
                          triggerDownload(sh, 'yoda-install.sh', 'text/plain');
                        }
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--color-surface-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      {detectOS() === 'windows' ? 'Re-download Step 2' : 'Download Script'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setMarkOnlineError(null)}
                    className="px-2 py-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
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
                className="w-full px-3 py-1.5 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors"
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
                  className="w-full px-3 py-1.5 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors"
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
                    className="w-full px-3 py-1.5 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors"
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
                    className="w-full px-3 py-1.5 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors"
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
                className="w-full px-3 py-1.5 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] focus:ring-1 focus:ring-[var(--color-gold-500)]/30 transition-colors"
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
            className="w-full px-3 py-1.5 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-3 flex items-center justify-between gap-2">
        {/* Clear slot — two-click confirm pattern */}
        {config && (
          <button
            onClick={handleClear}
            onBlur={() => setConfirmClear(false)}
            disabled={clearSlot.isPending}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              confirmClear
                ? 'bg-[var(--color-plex-600)]/20 text-[var(--color-plex-300)] border-[var(--color-plex-500)]/40 hover:bg-[var(--color-plex-600)]/30'
                : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border-default)] hover:text-[var(--color-plex-400)] hover:border-[var(--color-plex-500)]/40'
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
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-[var(--color-gold-500)] text-[var(--color-navy-950)] text-sm font-semibold hover:bg-[var(--color-gold-400)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {update.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save
        </button>
      </div>

      {/* Connect (reconnect) modal — Install flow no longer uses a modal */}
      {installModalMode === 'connect' && (
        <ModelInstallModal
          modelName={modelName}
          slot={slot}
          port={SLOT_PORT[slot]}
          mode="connect"
          onClose={() => setInstallModalMode(null)}
          isDownloaded={downloaded.has(modelName)}
          onMarkDownloaded={() => markDownloaded(modelName)}
          onConnected={() => markOnline.mutate(slot)}
        />
      )}
    </BevelBox>
  );
}
