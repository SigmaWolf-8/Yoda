import { useState, useEffect } from 'react';
import { Cpu, ArrowLeft, MemoryStick } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePageHeader } from '../../context/PageHeader';
import { useEngineConfigs } from '../../api/hooks';
import { EngineSlotCard, MODEL_INFO, OS_OVERHEAD_GB } from '../../components/settings/EngineSlot';
import { DiversityValidator } from '../../components/settings/DiversityValidator';
import { ReviewIntensityControl } from '../../components/settings/ReviewIntensityControl';
import { DecompositionBudgetControl } from '../../components/settings/DecompositionBudgetControl';
import { RecommendedConfigs } from '../../components/settings/RecommendedConfigs';
import { GitHubPATSetting } from '../../components/settings/GitHubPATSetting';
import type { EngineSlot, HostingMode } from '../../types';

const SLOTS: EngineSlot[] = ['a', 'b', 'c'];
const RAM_PRESETS = [8, 16, 24, 32, 48, 64, 96, 128];
const STORAGE_KEY = 'yoda_host_ram_gb';

function loadHostRam(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  const parsed = stored ? parseInt(stored, 10) : NaN;
  return isNaN(parsed) || parsed < 1 ? 16 : parsed;
}

type SlotRecord<T> = Record<EngineSlot, T>;

export function EngineSettingsPage() {
  const { data: engines } = useEngineConfigs();

  const [intensity, setIntensity] = useState<'full' | 'medium' | 'light'>('full');
  const [budget, setBudget] = useState<number | null>(30);
  const [hostRam, setHostRam] = useState<number>(loadHostRam);
  const [ramInput, setRamInput] = useState<string>(String(loadHostRam()));

  // Live model and mode state per slot — updated by each card in real time
  const [liveModels, setLiveModels] = useState<SlotRecord<string>>({ a: '', b: '', c: '' });
  const [liveModes,  setLiveModes]  = useState<SlotRecord<HostingMode>>({ a: 'self_hosted', b: 'self_hosted', c: 'self_hosted' });

  // Sync initial values once backend data loads
  useEffect(() => {
    if (!engines) return;
    const map = new Map(engines.map((e) => [e.slot as EngineSlot, e]));
    setLiveModels({
      a: map.get('a')?.model_name ?? '',
      b: map.get('b')?.model_name ?? '',
      c: map.get('c')?.model_name ?? '',
    });
    setLiveModes({
      a: map.get('a')?.hosting_mode ?? 'self_hosted',
      b: map.get('b')?.hosting_mode ?? 'self_hosted',
      c: map.get('c')?.hosting_mode ?? 'self_hosted',
    });
  }, [engines]);

  function applyRam(value: number) {
    const clamped = Math.max(1, Math.min(1024, value));
    setHostRam(clamped);
    setRamInput(String(clamped));
    localStorage.setItem(STORAGE_KEY, String(clamped));
  }

  function handleRamInputChange(raw: string) {
    setRamInput(raw);
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0) applyRam(n);
  }

  /**
   * RAM already committed by the other two self-hosted slots.
   * Only counts Q4 RAM for self-hosted slots that have a known model selected.
   */
  function reservedRamFor(slot: EngineSlot): number {
    return SLOTS
      .filter((s) => s !== slot && liveModes[s] === 'self_hosted')
      .reduce((sum, s) => sum + (MODEL_INFO[liveModels[s]]?.ramGbQ4 ?? 0), 0);
  }

  /** Models already chosen in the other two slots (any mode). */
  function usedModelsFor(slot: EngineSlot): string[] {
    return SLOTS
      .filter((s) => s !== slot)
      .map((s) => liveModels[s])
      .filter(Boolean);
  }

  const engineMap = new Map(engines?.map((e) => [e.slot, e]));

  usePageHeader({
    icon: Cpu,
    title: 'AI Engines',
    subtitle: 'Configure your three engine slots — self-hosted, commercial, or free-tier.',
  });

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto animate-fade-in">
      {/* Back breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <Link
          to="/settings"
          className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <span className="text-sm text-[var(--color-text-muted)]">Back to Settings</span>
      </div>

      {/* Host RAM selector */}
      <div className="bg-[var(--color-surface-primary)] border border-[var(--color-border-subtle)] rounded-xl p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <MemoryStick className="w-4 h-4 text-[var(--color-gold-400)]" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">Self-Host Machine RAM</span>
          <span className="text-sm text-[var(--color-text-muted)]">— used to calculate which models fit</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {RAM_PRESETS.map((gb) => (
            <button
              key={gb}
              onClick={() => applyRam(gb)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                hostRam === gb
                  ? 'bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)] border-[var(--color-gold-500)]/30'
                  : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-tertiary)] border-[var(--color-border-default)] hover:border-[var(--color-border-strong)]'
              }`}
            >
              {gb} GB
            </button>
          ))}
          <div className="flex items-center gap-1.5 ml-1">
            <span className="text-sm text-[var(--color-text-muted)]">Custom:</span>
            <input
              type="number"
              min={1}
              max={1024}
              value={ramInput}
              onChange={(e) => handleRamInputChange(e.target.value)}
              className="w-20 px-2 py-1.5 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-gold-500)] transition-colors text-center"
            />
            <span className="text-sm text-[var(--color-text-muted)]">GB</span>
          </div>
        </div>

        {/* Live RAM budget bar — always visible */}
        {(() => {
          const slotRam = SLOTS.map((s) => ({
            slot: s,
            label: liveModels[s] || '—',
            gb: liveModes[s] === 'self_hosted' ? (MODEL_INFO[liveModels[s]]?.ramGbQ4 ?? 0) : 0,
          }));
          const usedByModels = slotRam.reduce((sum, r) => sum + r.gb, 0);
          const totalUsed = OS_OVERHEAD_GB + usedByModels;
          const free = hostRam - totalUsed;
          const overBudget = free < 0;

          // Bar segment widths as percentages of hostRam
          const osPct  = Math.min((OS_OVERHEAD_GB / hostRam) * 100, 100);
          const slotColors = ['bg-blue-500/70', 'bg-violet-500/70', 'bg-cyan-500/70'];

          return (
            <div className="mt-3 pt-3 border-t border-[var(--color-border-subtle)]">
              {/* Stacked bar */}
              <div className="flex h-3 rounded-full overflow-hidden bg-[var(--color-surface-tertiary)] mb-2">
                <div className="bg-[var(--color-gold-500)]/40 flex-shrink-0 transition-all duration-300" style={{ width: `${osPct}%` }} />
                {(() => {
                  let cumPct = osPct;
                  return slotRam.map((r, i) => {
                    if (!r.gb) return null;
                    const rawPct = (r.gb / hostRam) * 100;
                    const pct = Math.max(0, Math.min(rawPct, 100 - cumPct));
                    cumPct += pct;
                    return (
                      <div
                        key={r.slot}
                        className={`${slotColors[i]} flex-shrink-0 transition-all duration-300`}
                        style={{ width: `${pct}%` }}
                      />
                    );
                  });
                })()}
                {/* free space — implicit via flex */}
              </div>

              {/* Legend row */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--color-text-muted)]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-[var(--color-gold-500)]/40 inline-block" />
                  OS overhead: <strong className="ml-0.5 text-[var(--color-text-secondary)]">{OS_OVERHEAD_GB} GB</strong>
                </span>
                {slotRam.map((r, i) => r.gb > 0 && (
                  <span key={r.slot} className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-sm ${slotColors[i]} inline-block`} />
                    Engine {r.slot.toUpperCase()} ({r.label}):
                    <strong className="ml-0.5 text-[var(--color-text-secondary)]">{r.gb} GB</strong>
                  </span>
                ))}
                <span className={`flex items-center gap-1 font-medium ${overBudget ? 'text-red-400' : 'text-[var(--color-ok)]'}`}>
                  {overBudget
                    ? `⚠ ${Math.abs(free).toFixed(1)} GB over budget`
                    : `✓ ${free.toFixed(1)} GB free`}
                </span>
              </div>

              {/* "What fits?" hint when there is free space */}
              {!overBudget && free > 0 && (
                <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">
                  Models that fit in remaining space:{' '}
                  {Object.entries(MODEL_INFO)
                    .filter(([, m]) => m.ramGbQ4 !== undefined && m.ramGbQ4 <= free)
                    .sort(([, a], [, b]) => (b.ramGbQ4 ?? 0) - (a.ramGbQ4 ?? 0))
                    .slice(0, 4)
                    .map(([name, m]) => `${name} (~${m.ramGbQ4} GB)`)
                    .join(' · ') || 'none — not enough free RAM for any known model'}
                </p>
              )}
            </div>
          );
        })()}
      </div>

      {/* Engine Slots */}
      <div className="space-y-4 mb-8">
        {SLOTS.map((slot) => (
          <EngineSlotCard
            key={slot}
            slot={slot}
            config={engineMap.get(slot)}
            hostRam={hostRam}
            reservedRam={reservedRamFor(slot)}
            usedModels={usedModelsFor(slot)}
            onModelChange={(m) => setLiveModels((prev) => ({ ...prev, [slot]: m }))}
            onModeChange={(m) => setLiveModes((prev) => ({ ...prev, [slot]: m }))}
          />
        ))}
      </div>

      {/* Diversity Validator */}
      <div className="mb-8">
        <DiversityValidator />
      </div>

      {/* Project Defaults */}
      <div className="bg-[var(--color-surface-primary)] border border-[var(--color-border-subtle)] rounded-xl p-5 mb-8 space-y-6">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Project Defaults</h2>
        <ReviewIntensityControl value={intensity} onChange={setIntensity} />
        <DecompositionBudgetControl value={budget} onChange={setBudget} />
      </div>

      {/* GitHub PAT */}
      <div className="bg-[var(--color-surface-primary)] border border-[var(--color-border-subtle)] rounded-xl p-5 mb-8">
        <GitHubPATSetting />
      </div>

      {/* Recommended Configs */}
      <div className="mb-8">
        <RecommendedConfigs />
      </div>
    </div>
  );
}
