import { TreePine, Check, Minus, Settings } from 'lucide-react';
import { useApproveDecomposition } from '../../api/hooks';
import type { TaskTree } from '../../types';

interface Props {
  projectId: string;
  taskTree: TaskTree;
  onClose: () => void;
  onApproved: () => void;
}

export function DecompositionApproval({ projectId, taskTree, onClose, onApproved }: Props) {
  const approve = useApproveDecomposition(projectId);

  function handleApprove() {
    approve.mutate(
      { task_tree: taskTree },
      { onSuccess: () => onApproved() },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 animate-fade-in max-h-[80vh] flex flex-col">
        <div className="flex items-center gap-2 mb-4">
          <TreePine className="w-5 h-5 text-[var(--color-gold-400)]" />
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Decomposition Review
          </h3>
        </div>

        <div className="mb-4 p-3 rounded-lg bg-[var(--color-gold-500)]/5 border border-[var(--color-gold-500)]/20">
          <p className="text-sm text-[var(--color-gold-300)]">
            This query decomposes into <span className="font-bold">{taskTree.total_tasks} tasks</span>,
            which exceeds the budget of <span className="font-bold">{taskTree.budget}</span>.
            Review the breakdown before proceeding.
          </p>
        </div>

        {/* Task list (scrollable) */}
        <div className="flex-1 overflow-y-auto mb-4 rounded-lg border border-[var(--color-border-subtle)]">
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {taskTree.tasks.map((t) => (
              <div key={t.task_number} className="px-3 py-2 hover:bg-[var(--color-surface-tertiary)]/30 transition-colors">
                <div className="flex items-center gap-2">
                  <code className="text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-tertiary)] px-1.5 py-0.5 rounded flex-shrink-0">
                    {t.task_number}
                  </code>
                  <span className="text-xs text-[var(--color-text-primary)] truncate">{t.title}</span>
                </div>
                {t.competencies.length > 0 && (
                  <div className="mt-1 flex gap-1 flex-wrap">
                    {t.competencies.map((c) => (
                      <span
                        key={c}
                        className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[var(--color-plex-500)]/10 text-[var(--color-plex-400)] border border-[var(--color-plex-500)]/20"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium text-[var(--color-text-tertiary)] bg-[var(--color-surface-tertiary)] border border-[var(--color-border-default)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
            Reduce Scope
          </button>
          <button
            onClick={handleApprove}
            disabled={approve.isPending}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-semibold bg-[var(--color-gold-500)] text-[var(--color-navy-950)] hover:bg-[var(--color-gold-400)] disabled:opacity-50 transition-colors"
          >
            {approve.isPending ? (
              <span>Approving…</span>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                Approve All {taskTree.total_tasks} Tasks
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
