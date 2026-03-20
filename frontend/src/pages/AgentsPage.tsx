import { useState, useMemo } from 'react';
import { Users, Plus, Loader2, ChevronDown } from 'lucide-react';
import { MetatronCubeRoster } from '../components/agents/MetatronCubeRoster';
import { AgentDetailPanel } from '../components/agents/AgentDetailPanel';
import { AgentSyncBanner } from '../components/agents/AgentSyncBanner';
import { AgentEditor } from '../components/agents/AgentEditor';
import { useAgents, useAgentSyncStatus, useImportAgents } from '../api/hooks/useAgents';
import type { AgentDivision, AgentWithStats } from '../types';
import { DIVISIONS } from '../types/agent';
import { usePageHeader } from '../context/PageHeader';
import { HEADER_H } from '../components/layout/AppShell';

type EditorMode =
  | { type: 'create' }
  | { type: 'edit'; agent: AgentWithStats }
  | { type: 'template'; from: AgentWithStats }
  | null;

/* ── Mobile: accordion division list ─────────────────────────── */
function MobileDivisionAccordion({
  agents,
  selectedDivision,
  onSelectDivision,
  onEdit,
}: {
  agents: AgentWithStats[];
  selectedDivision: AgentDivision | null;
  onSelectDivision: (d: AgentDivision | null) => void;
  onEdit: (a: AgentWithStats) => void;
  onCopyTemplate: (a: AgentWithStats) => void;
}) {
  const populated = DIVISIONS.filter(d => agents.some(a => a.division === d.id));

  return (
    <div
      className="flex-1 overflow-y-auto divide-y divide-[var(--color-border-subtle)]"
      style={{ background: 'var(--color-surface-primary)' }}
    >
      {populated.map(div => {
        const divAgents = agents.filter(a => a.division === div.id);
        const isOpen    = selectedDivision === div.id;

        return (
          <div key={div.id}>
            <button
              className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors hover:bg-[var(--color-surface-secondary)]"
              onClick={() => onSelectDivision(isOpen ? null : div.id)}
            >
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: 'hsl(210,70%,65%)' }} />
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">{div.label}</span>
                <span className="text-sm text-[var(--color-text-muted)] font-mono">
                  {divAgents.length} agent{divAgents.length !== 1 ? 's' : ''}
                </span>
              </div>
              <ChevronDown
                className="w-4 h-4 text-[var(--color-text-muted)] transition-transform duration-200"
                style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            </button>

            {isOpen && (
              <div className="px-4 pb-4 space-y-2 bg-[var(--color-surface-secondary)]/40">
                {divAgents.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)] py-2 px-1">No agents in this division.</p>
                ) : (
                  divAgents.map(agent => (
                    <div
                      key={agent.agent_id}
                      className="rounded-lg px-4 py-3 border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]"
                      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{agent.display_name}</p>
                          <p className="text-sm text-[var(--color-text-muted)] mt-0.5 font-mono capitalize">
                            {agent.primary_role} · {agent.source}
                          </p>
                        </div>
                        {!agent.readonly && (
                          <button
                            onClick={() => onEdit(agent)}
                            className="px-2.5 py-1 rounded text-xs font-medium bg-[hsl(210,80%,55%)]/10 text-[hsl(210,70%,65%)] border border-[hsl(210,80%,55%)]/20 hover:bg-[hsl(210,80%,55%)]/18 transition-colors flex-shrink-0"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                      {agent.key_skills.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {agent.key_skills.slice(0, 4).map(skill => (
                            <span key={skill} className="px-1.5 py-0.5 rounded text-xs bg-white/[0.05] text-[var(--color-text-muted)] border border-white/[0.06]">
                              {skill}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────── */
export function AgentsPage() {
  const [selectedDivision, setSelectedDivision] = useState<AgentDivision | null>(null);
  const [selectedAgentIdx, setSelectedAgentIdx] = useState<number | null>(null);
  const [editorMode, setEditorMode]             = useState<EditorMode>(null);
  const [syncDismissed, setSyncDismissed]       = useState(false);

  const agentsQuery    = useAgents();
  const syncQuery      = useAgentSyncStatus();
  const importMutation = useImportAgents();

  const agents = agentsQuery.data ?? [];

  const totalCalls = useMemo(
    () => agents.reduce((s: number, a: AgentWithStats) => s + a.stats.total_calls, 0),
    [agents],
  );

  const subtitle = agentsQuery.isLoading
    ? 'Loading…'
    : `${agents.length} agent${agents.length !== 1 ? 's' : ''} · ${DIVISIONS.length} divisions · ${totalCalls.toLocaleString()} inference calls`;

  usePageHeader({ icon: Users, title: 'Agent Roster', subtitle });

  const showBanner =
    !syncDismissed &&
    syncQuery.data != null &&
    !syncQuery.data.up_to_date &&
    (syncQuery.data.new_agents.length > 0 || syncQuery.data.updated_agents.length > 0);

  /* Height of main content = full viewport minus the shared top bar */
  const contentH = `calc(100vh - ${HEADER_H}px)`;

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: contentH }}>
      {/* Sync banner */}
      {showBanner && (
        <AgentSyncBanner
          syncStatus={syncQuery.data!}
          isLoading={importMutation.isPending}
          onImport={(ids) => importMutation.mutate(ids)}
          onDismiss={() => setSyncDismissed(true)}
        />
      )}

      {/* Thin action strip — no title (title lives in the top bar now) */}
      <div className="flex items-center justify-end px-5 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]/30 flex-shrink-0">
        <button
          onClick={() => setEditorMode({ type: 'create' })}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[hsl(210,80%,55%)]/10 text-[hsl(210,70%,65%)] text-sm font-semibold border border-[hsl(210,80%,55%)]/20 hover:bg-[hsl(210,80%,55%)]/18 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New agent
        </button>
      </div>

      {/* Loading */}
      {agentsQuery.isLoading && (
        <div className="flex-1 flex items-center justify-center gap-3 text-[var(--color-text-muted)]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading agent roster…</span>
        </div>
      )}

      {/* Error */}
      {agentsQuery.isError && (
        <div className="flex-1 flex items-center justify-center text-center px-8">
          <div>
            <p className="text-sm font-medium text-red-400 mb-1">Failed to load agents</p>
            <p className="text-sm text-[var(--color-text-muted)]">{String(agentsQuery.error)}</p>
            <button onClick={() => agentsQuery.refetch()} className="mt-4 px-4 py-2 rounded-lg text-sm bg-[hsl(210,80%,55%)]/10 text-[hsl(210,70%,65%)] border border-[hsl(210,80%,55%)]/20">
              Retry
            </button>
          </div>
        </div>
      )}

      {!agentsQuery.isLoading && !agentsQuery.isError && (
        <>
          {/* ── Desktop: Cube + Detail panel ── */}
          <div className="hidden lg:flex flex-1 min-h-0 overflow-hidden">
            <div className="flex-[2] min-w-0">
              <MetatronCubeRoster
                agents={agents}
                selectedDivision={selectedDivision}
                selectedAgentIdx={selectedAgentIdx}
                onSelectDivision={setSelectedDivision}
                onSelectAgent={setSelectedAgentIdx}
              />
            </div>
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
                  <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
                    Click any node on the geometry to browse its agents.
                    Each node is a division. Satellites are individual agents.
                  </p>
                  <p className="text-sm text-[var(--color-text-muted)] mt-4 opacity-50">
                    Node size = usage intensity · Pulse = active this week
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── Mobile: Division accordion dropdowns ── */}
          <div className="lg:hidden flex flex-col flex-1 min-h-0 overflow-hidden">
            <MobileDivisionAccordion
              agents={agents}
              selectedDivision={selectedDivision}
              onSelectDivision={(d) => { setSelectedDivision(d); setSelectedAgentIdx(null); }}
              onEdit={(agent) => setEditorMode({ type: 'edit', agent })}
              onCopyTemplate={(agent) => setEditorMode({ type: 'template', from: agent })}
            />
          </div>
        </>
      )}

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
