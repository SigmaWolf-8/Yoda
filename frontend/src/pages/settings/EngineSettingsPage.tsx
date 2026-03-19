import { useState } from 'react';
import { Cpu, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEngineConfigs } from '../../api/hooks';
import { EngineSlotCard } from '../../components/settings/EngineSlot';
import { DiversityValidator } from '../../components/settings/DiversityValidator';
import { ReviewIntensityControl } from '../../components/settings/ReviewIntensityControl';
import { DecompositionBudgetControl } from '../../components/settings/DecompositionBudgetControl';
import { RecommendedConfigs } from '../../components/settings/RecommendedConfigs';
import { GitHubPATSetting } from '../../components/settings/GitHubPATSetting';
import type { EngineSlot } from '../../types';

const SLOTS: EngineSlot[] = ['a', 'b', 'c'];

export function EngineSettingsPage() {
  const { data: engines } = useEngineConfigs();

  // Local state for project-level settings (wired to backend in Task 10 via useUpdateProjectSettings)
  const [intensity, setIntensity] = useState<'full' | 'medium' | 'light'>('full');
  const [budget, setBudget] = useState<number | null>(30);

  const engineMap = new Map(engines?.map((e) => [e.slot, e]));

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Link
          to="/settings"
          className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <Cpu className="w-5 h-5 text-[var(--color-gold-400)]" />
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">AI Engines</h1>
      </div>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-8 ml-11">
        Configure your three engine slots — self-hosted, commercial, or free-tier.
      </p>

      {/* Engine Slots */}
      <div className="space-y-4 mb-8">
        {SLOTS.map((slot) => (
          <EngineSlotCard key={slot} slot={slot} config={engineMap.get(slot)} />
        ))}
      </div>

      {/* Diversity Validator */}
      <div className="mb-8">
        <DiversityValidator />
      </div>

      {/* Project Defaults */}
      <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl p-5 mb-8 space-y-6">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Project Defaults</h2>
        <ReviewIntensityControl value={intensity} onChange={setIntensity} />
        <DecompositionBudgetControl value={budget} onChange={setBudget} />
      </div>

      {/* GitHub PAT */}
      <div className="bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl p-5 mb-8">
        <GitHubPATSetting />
      </div>

      {/* Recommended Configs */}
      <div className="mb-8">
        <RecommendedConfigs />
      </div>
    </div>
  );
}
