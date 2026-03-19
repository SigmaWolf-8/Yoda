import { useState } from 'react';
import { RefreshCw, X, Check, Download } from 'lucide-react';
import type { AgentSyncStatus, SyncAgentPreview } from '../../types';
import { DIVISIONS } from '../../types/agent';

interface Props {
  syncStatus: AgentSyncStatus | undefined;
  isLoading: boolean;
  onImport: (agentIds: string[]) => void;
  onDismiss: () => void;
}

export function AgentSyncBanner({ syncStatus, isLoading, onImport, onDismiss }: Props) {
  const [showReview, setShowReview] = useState(false);
  const [imported, setImported] = useState<Set<string>>(new Set());

  if (isLoading) return null;

  // All synced state
  if (!syncStatus || syncStatus.up_to_date) {
    if (!syncStatus?.last_synced_at) return null;
    return (
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-[var(--color-border-subtle)] text-[10px] text-[var(--color-text-muted)]">
        <Check className="w-3.5 h-3.5 text-[hsl(210,70%,65%)]" />
        <span className="flex-1">
          Agent roster up to date · Last synced: {new Date(syncStatus.last_synced_at).toLocaleString()}
          {syncStatus.last_commit && <span className="font-mono ml-1">· {syncStatus.last_commit.slice(0, 7)}</span>}
        </span>
        <button
          onClick={onDismiss}
          className="text-[hsl(210,70%,65%)] font-medium hover:underline"
        >
          Check again
        </button>
      </div>
    );
  }

  const allPreviews = [...syncStatus.new_agents, ...syncStatus.updated_agents];
  const newCount = syncStatus.new_agents.length;
  const updCount = syncStatus.updated_agents.length;
  const totalNew = newCount + updCount;

  // Group by division for summary
  const divSummary: string[] = [];
  const divCounts: Record<string, number> = {};
  allPreviews.forEach(p => { divCounts[p.division] = (divCounts[p.division] || 0) + 1; });
  for (const [div, count] of Object.entries(divCounts)) {
    const label = DIVISIONS.find(d => d.id === div)?.label ?? div;
    divSummary.push(`${count} ${label}`);
  }

  if (showReview) {
    return (
      <div className="border-b border-[hsl(210,80%,55%)]/12 bg-[hsl(210,80%,55%)]/[0.02]">
        {/* Review header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border-subtle)]">
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-primary)]">Review upstream agents</p>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
              Import to add to your roster, or skip. You can always import later.
            </p>
          </div>
          <button onClick={() => setShowReview(false)} className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Agent cards */}
        <div className="px-5 py-3 space-y-2 max-h-80 overflow-y-auto">
          {allPreviews.map(preview => {
            const isImported = imported.has(preview.agent_id);
            const divLabel = DIVISIONS.find(d => d.id === preview.division)?.label ?? preview.division;
            return (
              <div key={preview.agent_id} className={`p-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-primary)] ${isImported ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-2 h-2 rounded-full bg-[hsl(210,70%,65%)]" />
                  <span className="text-xs font-medium text-[var(--color-text-primary)] flex-1">{preview.display_name}</span>
                  <span className="text-[8px] font-mono text-[var(--color-text-muted)]">{divLabel}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[7px] font-semibold ${
                    preview.change_type === 'new'
                      ? 'bg-[hsl(210,80%,55%)]/8 text-[hsl(210,70%,65%)]'
                      : 'bg-[hsl(270,50%,65%)]/8 text-[hsl(270,50%,65%)]'
                  }`}>
                    {preview.change_type === 'new' ? 'NEW' : 'UPDATED'}
                  </span>
                </div>
                {preview.change_summary && (
                  <p className="text-[10px] text-[var(--color-text-secondary)] mb-2">{preview.change_summary}</p>
                )}
                <div className="flex justify-end gap-2">
                  {isImported ? (
                    <span className="flex items-center gap-1 text-[10px] text-[hsl(210,70%,65%)] font-medium">
                      <Check className="w-3 h-3" /> Imported
                    </span>
                  ) : (
                    <>
                      <button className="px-3 py-1 rounded text-[9px] font-medium bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)] border border-[var(--color-border-default)]">
                        {preview.change_type === 'updated' ? 'Keep current' : 'Skip'}
                      </button>
                      <button
                        onClick={() => {
                          setImported(prev => new Set(prev).add(preview.agent_id));
                          onImport([preview.agent_id]);
                        }}
                        className="px-3 py-1 rounded text-[9px] font-medium bg-[hsl(210,80%,55%)]/8 text-[hsl(210,70%,65%)] border border-[hsl(210,80%,55%)]/18"
                      >
                        {preview.change_type === 'updated' ? 'Apply update' : 'Import'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-[var(--color-border-subtle)]">
          <span className="text-[9px] text-[var(--color-text-muted)]">
            {imported.size} of {totalNew} imported
          </span>
          <button
            onClick={() => {
              const remaining = allPreviews.filter(p => !imported.has(p.agent_id)).map(p => p.agent_id);
              setImported(new Set(allPreviews.map(p => p.agent_id)));
              onImport(remaining);
            }}
            className="px-3 py-1.5 rounded-lg text-[10px] font-medium bg-[hsl(210,80%,55%)]/8 text-[hsl(210,70%,65%)] border border-[hsl(210,80%,55%)]/18"
          >
            Import all remaining
          </button>
        </div>
      </div>
    );
  }

  // Compact banner
  return (
    <div className="flex items-center gap-3 px-5 py-2.5 bg-[hsl(210,80%,55%)]/[0.03] border-b border-[hsl(210,80%,55%)]/12">
      <span className="w-2 h-2 rounded-full bg-[hsl(210,70%,65%)] animate-pulse flex-shrink-0" />
      <span className="flex-1 text-[11px] text-[var(--color-text-secondary)]">
        <strong className="text-[var(--color-text-primary)] font-medium">{totalNew} new agent{totalNew !== 1 ? 's' : ''} available</strong>
        {' '}from upstream — {divSummary.join(', ')}
      </span>
      <button onClick={onDismiss} className="px-3 py-1 rounded text-[9px] font-medium text-[var(--color-text-muted)] bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)]">
        Dismiss
      </button>
      <button onClick={() => setShowReview(true)} className="px-3 py-1 rounded text-[9px] font-medium bg-[hsl(210,80%,55%)]/8 text-[hsl(210,70%,65%)] border border-[hsl(210,80%,55%)]/18">
        Review & import
      </button>
    </div>
  );
}
