import { useState, useMemo } from 'react';
import { Users, Plus } from 'lucide-react';
import { MetatronCubeRoster } from '../components/agents/MetatronCubeRoster';
import { AgentDetailPanel } from '../components/agents/AgentDetailPanel';
import { AgentSyncBanner } from '../components/agents/AgentSyncBanner';
import { AgentEditor } from '../components/agents/AgentEditor';
import { getAllAgentsWithStats } from '../data/agent-roster';
import type { AgentDivision, AgentWithStats } from '../types';

type EditorMode =
  | { type: 'create' }
  | { type: 'edit'; agent: AgentWithStats }
  | { type: 'template'; from: AgentWithStats }
  | null;

/**
 * Mock sync status — in production this comes from useAgentSyncStatus() hook.
 * Set to null to hide the banner, or provide data to show it.
 */
const MOCK_SYNC = {
  up_to_date: false,
  last_synced_at: '2026-03-19T12:00:00Z',
  last_commit: 'a3f7c2d',
  new_agents: [
    { agent_id: 'engineering-infrastructure-planner', display_name: 'Infrastructure Planner', division: 'engineering' as const, change_type: 'new' as const, change_summary: 'Cloud infrastructure planning, capacity forecasting, and migration strategies' },
    { agent_id: 'testing-compliance-auditor', display_name: 'Compliance Auditor', division: 'testing' as const, change_type: 'new' as const, change_summary: 'GDPR, SOC 2, HIPAA, and PCI-DSS compliance verification' },
    { agent_id: 'specialized-prompt-engineer', display_name: 'Prompt Engineer', division: 'specialized' as const, change_type: 'new' as const, change_summary: 'Prompt design, evaluation, and optimization for LLM pipelines' },
  ],
  updated_agents: [
    { agent_id: 'engineering-security-engineer', display_name: 'Security Engineer', division: 'engineering' as const, change_type: 'updated' as const, change_summary: 'Added supply-chain attack detection competency and SBOM analysis' },
  ],
};

export function AgentsPage() {
  const [selectedDivision, setSelectedDivision] = useState<AgentDivision | null>(null);
  const [selectedAgentIdx, setSelectedAgentIdx] = useState<number | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [syncDismissed, setSyncDismissed] = useState(false);

  // In production: useAgentsWithStats() from the API
  // For now: static roster with mock stats
  const agents = useMemo(() => getAllAgentsWithStats(), []);

  const totalCalls = useMemo(
    () => agents.reduce((s: number, a: AgentWithStats) => s + a.stats.total_calls, 0),
    [agents],
  );

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Sync banner — top of page */}
      {!syncDismissed && (
        <AgentSyncBanner
          syncStatus={MOCK_SYNC}
          isLoading={false}
          onImport={(ids) => { /* TODO: call useImportAgents */ }}
          onDismiss={() => setSyncDismissed(true)}
        />
      )}

      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]/30 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-[hsl(210,70%,65%)]" />
          <div>
            <h1 className="text-lg font-bold text-[var(--color-text-primary)]">Agent roster</h1>
            <p className="text-[10px] text-[var(--color-text-muted)] font-mono">
              {agents.length} agents · 13 divisions · 3 shells · {totalCalls.toLocaleString()} inference calls
            </p>
          </div>
        </div>
        <button
          onClick={() => setEditorMode({ type: 'create' })}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(210,80%,55%)]/10 text-[hsl(210,70%,65%)] text-xs font-semibold border border-[hsl(210,80%,55%)]/20 hover:bg-[hsl(210,80%,55%)]/18 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New agent
        </button>
      </div>

      {/* Main content: 2/3 cube + 1/3 panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Metatron Cube — 2/3 */}
        <div className="flex-[2] min-w-0">
          <MetatronCubeRoster
            agents={agents}
            selectedDivision={selectedDivision}
            selectedAgentIdx={selectedAgentIdx}
            onSelectDivision={setSelectedDivision}
            onSelectAgent={setSelectedAgentIdx}
          />
        </div>

        {/* Detail panel — 1/3 */}
        <div className="flex-1 max-w-[400px] border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]">
          {selectedDivision ? (
            <AgentDetailPanel
              agents={agents}
              division={selectedDivision}
              selectedIdx={selectedAgentIdx}
              onSelectIdx={setSelectedAgentIdx}
              onEdit={(agent) => setEditorMode({ type: 'edit', agent })}
              onCopyTemplate={(agent) => setEditorMode({ type: 'template', from: agent })}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div className="text-4xl opacity-10 mb-4">⬡</div>
              <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">Select a division</p>
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                Click any node on the geometry to browse its agents.
                Each node is a division. Satellites are individual agents.
              </p>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-4 opacity-50">
                Node size = usage intensity · Pulse = active this week
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Editor modal */}
      {editorMode && (
        <AgentEditor
          agent={editorMode.type === 'edit' ? editorMode.agent : null}
          templateFrom={editorMode.type === 'template' ? editorMode.from : null}
          onClose={() => setEditorMode(null)}
        />
      )}
    </div>
  );
}
