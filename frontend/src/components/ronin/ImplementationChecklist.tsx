import { useState } from 'react';
import { ListChecks, CheckCircle2, Circle } from 'lucide-react';
import type { Task } from '../../types';

interface Props {
  tasks: Task[];
}

export function ImplementationChecklist({ tasks }: Props) {
  // Local checked state (UI-only — doesn't persist to backend)
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const sorted = [...tasks].sort((a, b) => a.task_number.localeCompare(b.task_number));
  const finalTasks = sorted.filter((t) => t.status === 'FINAL');
  const totalChecked = checked.size;
  const progress = sorted.length > 0 ? (totalChecked / sorted.length) * 100 : 0;

  function toggleCheck(taskId: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function checkAllFinal() {
    setChecked(new Set(finalTasks.map((t) => t.id)));
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-[var(--color-ronin-400)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            Implementation Checklist
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-muted)]">
            {totalChecked}/{sorted.length}
          </span>
          {finalTasks.length > 0 && totalChecked < finalTasks.length && (
            <button
              onClick={checkAllFinal}
              className="text-xs text-[var(--color-ronin-400)] hover:underline"
            >
              Check all complete
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-[var(--color-surface-tertiary)] mb-3 overflow-hidden">
        <div
          className="h-full rounded-full bg-[var(--color-ronin-500)] transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Task list */}
      <div className="space-y-0.5 max-h-96 overflow-y-auto">
        {sorted.map((task) => {
          const isChecked = checked.has(task.id);
          const isFinal = task.status === 'FINAL';
          const isEscalated = task.status === 'ESCALATED';

          return (
            <button
              key={task.id}
              onClick={() => toggleCheck(task.id)}
              className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                isChecked
                  ? 'bg-[var(--color-ok)]/5'
                  : 'hover:bg-[var(--color-surface-tertiary)]/30'
              }`}
            >
              {/* Checkbox */}
              {isChecked ? (
                <CheckCircle2 className="w-4 h-4 text-[var(--color-ok)] flex-shrink-0 mt-0.5" />
              ) : (
                <Circle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                  isFinal ? 'text-[var(--color-ok)]/40' : 'text-[var(--color-text-muted)]'
                }`} />
              )}

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <code className="text-[11px] font-mono text-[var(--color-text-muted)]">
                    {task.task_number}
                  </code>
                  {isEscalated && (
                    <span className="text-[8px] font-semibold text-[var(--color-warn)] bg-[var(--color-warn)]/10 px-1 py-0.5 rounded uppercase">
                      escalated
                    </span>
                  )}
                </div>
                <p className={`text-sm leading-tight ${
                  isChecked
                    ? 'text-[var(--color-text-muted)] line-through'
                    : 'text-[var(--color-text-secondary)]'
                }`}>
                  {task.title}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
