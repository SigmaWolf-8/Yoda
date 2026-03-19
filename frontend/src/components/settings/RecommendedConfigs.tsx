import { Lightbulb } from 'lucide-react';
import type { HostingMode } from '../../types';

export interface ConfigPreset {
  label: string;
  engines: { mode: HostingMode; model: string }[];
  cost: string;
  licenses: string;
}

const PRESETS: ConfigPreset[] = [
  {
    label: 'Full self-hosted (laptop)',
    engines: [
      { mode: 'self_hosted', model: 'Qwen3.5-27B' },
      { mode: 'self_hosted', model: 'DeepSeek-R1-Distill-32B' },
      { mode: 'self_hosted', model: 'Qwen3.5-9B' },
    ],
    cost: '$0',
    licenses: 'Apache 2.0 / MIT / Apache 2.0',
  },
  {
    label: 'Full self-hosted (server)',
    engines: [
      { mode: 'self_hosted', model: 'Qwen3.5-122B' },
      { mode: 'self_hosted', model: 'Kimi-K2.5' },
      { mode: 'self_hosted', model: 'GLM-5' },
    ],
    cost: '$0',
    licenses: 'Apache 2.0 / MIT / MIT',
  },
  {
    label: 'Full commercial',
    engines: [
      { mode: 'commercial', model: 'claude-sonnet-4-6' },
      { mode: 'commercial', model: 'grok-3' },
      { mode: 'commercial', model: 'DeepSeek-V3.2' },
    ],
    cost: '$75–300/mo',
    licenses: 'Provider ToS',
  },
  {
    label: 'Hybrid',
    engines: [
      { mode: 'commercial', model: 'claude-sonnet-4-6' },
      { mode: 'self_hosted', model: 'DeepSeek-R1-Distill-32B' },
      { mode: 'free_tier', model: 'gemini-2.5-flash' },
    ],
    cost: '$25–75/mo',
    licenses: 'ToS / MIT / ToS',
  },
  {
    label: 'Bootstrap (no hardware)',
    engines: [
      { mode: 'free_tier', model: 'gemini-2.5-flash' },
      { mode: 'free_tier', model: 'DeepSeek-V3.2' },
      { mode: 'free_tier', model: 'grok-3' },
    ],
    cost: '$0 (rate-limited)',
    licenses: 'Provider ToS',
  },
];

interface Props {
  onApply?: (preset: ConfigPreset) => void;
}

const MODE_BADGE: Record<HostingMode, string> = {
  self_hosted: 'bg-green-500/10 text-green-400 border-green-500/20',
  commercial:  'bg-[var(--color-plex-500)]/10 text-[var(--color-plex-400)] border-[var(--color-plex-500)]/20',
  free_tier:   'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

export function RecommendedConfigs({ onApply }: Props) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="w-4 h-4 text-[var(--color-gold-400)]" />
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Recommended Configurations</h3>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border-subtle)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[var(--color-surface-tertiary)]/50">
              <th className="text-left font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 py-2">Scenario</th>
              <th className="text-left font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 py-2">Engine A</th>
              <th className="text-left font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 py-2">Engine B</th>
              <th className="text-left font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 py-2">Engine C</th>
              <th className="text-left font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 py-2">Cost</th>
              <th className="px-3 py-2 w-16" />
            </tr>
          </thead>
          <tbody>
            {PRESETS.map((p) => (
              <tr key={p.label} className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-tertiary)]/30 transition-colors">
                <td className="px-3 py-2.5 text-[var(--color-text-primary)] font-medium">{p.label}</td>
                {p.engines.map((eng, i) => (
                  <td key={i} className="px-3 py-2.5">
                    <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium ${MODE_BADGE[eng.mode]}`}>
                      {eng.mode.replace('_', ' ')}
                    </span>
                    <br />
                    <span className="text-[var(--color-text-secondary)]">{eng.model}</span>
                  </td>
                ))}
                <td className="px-3 py-2.5 text-[var(--color-text-muted)]">{p.cost}</td>
                <td className="px-3 py-2.5">
                  {onApply && (
                    <button
                      onClick={() => onApply(p)}
                      className="px-2 py-1 rounded text-[10px] font-semibold bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)] border border-[var(--color-gold-500)]/20 hover:bg-[var(--color-gold-500)]/20 transition-colors"
                    >
                      Apply
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--color-text-muted)] mt-2">
        Verify each model's license at its Hugging Face model card before downloading.
      </p>
    </div>
  );
}
