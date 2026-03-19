import { useState, useMemo } from 'react';
import { Users, Plus, Loader2 } from 'lucide-react';
import { MetatronCubeRoster } from '../components/agents/MetatronCubeRoster';
import { AgentDetailPanel } from '../components/agents/AgentDetailPanel';
import { AgentSyncBanner } from '../components/agents/AgentSyncBanner';
import { AgentEditor } from '../components/agents/AgentEditor';
import { useAgents, useAgentSyncStatus, useImportAgents } from '../api/hooks/useAgents';
import type { AgentDivision, AgentWithStats } from '../types';

type EditorMode =
  | { type: 'create' }
  | { type: 'edit'; agent: AgentWithStats }
  | { type: 'template'; from: AgentWithStats }
  | null;

export function AgentsPage() {
  const [selectedDivision, setSelectedDivision] = useState<AgentDivision | null>(null);
  const [selectedAgentIdx, setSelectedAgentIdx] = useState<number | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [syncDismissed, setSyncDismissed] = useState(false);

  const agentsQuery = useAgents();
  const syncQuery = useAgentSyncStatus();
  const importMutation = useImportAgents();

  const agents = agentsQuery.data ?? [];

  const totalCalls = useMemo(
    () => agents.reduce((s: number, a: AgentWithStats) => s + a.stats.total_calls, 0),
    [agents],
  );

  const showBanner =
    !syncDismissed &&
    syncQuery.data != null &&
    !syncQuery.data.up_to_date &&
    (syncQuery.data.new_agents.length > 0 || syncQuery.data.updated_agents.length > 0);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Sync banner — top of page */}
      {showBanner && (
        <AgentSyncBanner
          syncStatus={syncQuery.data!}
          isLoading={importMutation.isPending}
          onImport={(ids) => importMutation.mutate(ids)}
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
              {agentsQuery.isLoading
                ? 'Loading…'
                : `${agents.length} agents · 13 divisions · 3 shells · ${totalCalls.toLocaleString()} inference calls`}
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

      {/* Loading / error states */}
      {agentsQuery.isLoading && (
        <div className="flex-1 flex items-center justify-center gap-3 text-[var(--color-text-muted)]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading agent roster…</span>
        </div>
      )}

      {agentsQuery.isError && (
        <div className="flex-1 flex items-center justify-center text-center px-8">
          <div>
            <p className="text-sm font-medium text-red-400 mb-1">Failed to load agents</p>
            <p className="text-xs text-[var(--color-text-muted)]">{String(agentsQuery.error)}</p>
            <button
              onClick={() => agentsQuery.refetch()}
              className="mt-4 px-4 py-2 rounded-lg text-xs bg-[hsl(210,80%,55%)]/10 text-[hsl(210,70%,65%)] border border-[hsl(210,80%,55%)]/20"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Main content: 2/3 cube + 1/3 panel */}
      {!agentsQuery.isLoading && !agentsQuery.isError && (
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
      )}

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
