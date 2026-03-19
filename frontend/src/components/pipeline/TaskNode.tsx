import { useState } from 'react';
import { Clock, Cpu } from 'lucide-react';
import { StepProgressIndicator } from './StepProgressIndicator';
import { TaskNodeContextMenu } from './TaskNodeContextMenu';
import type { Task } from '../../types';

interface Props {
  task: Task;
  selected?: boolean;
  onClick: () => void;
}

const STATUS_BORDER: Record<string, string> = {
  FINAL:     'border-[var(--color-ok)]/40',
  ESCALATED: 'border-[var(--color-warn)]/40',
  CANCELLED: 'border-[var(--color-err)]/40',
};

const STATUS_GLOW: Record<string, string> = {
  FINAL:     'shadow-[0_0_12px_rgba(34,197,94,0.15)]',
  ESCALATED: 'shadow-[0_0_12px_rgba(234,179,8,0.15)]',
};

function elapsedStr(created: string, updated: string): string {
  const ms = new Date(updated).getTime() - new Date(created).getTime();
  if (ms < 1000) return '<1s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function TaskNode({ task, selected, onClick }: Props) {
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const isActive = task.status.startsWith('STEP_');

  const borderColor = STATUS_BORDER[task.status]
    ?? (isActive ? 'border-[var(--color-plex-400)]/40' : 'border-[var(--color-border-subtle)]');
  const glow = STATUS_GLOW[task.status]
    ?? (isActive ? 'shadow-[0_0_12px_rgba(59,130,246,0.12)]' : '');

  function handleContext(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY });
  }

  return (
    <>
      <div
        onClick={onClick}
        onContextMenu={handleContext}
        className={`
          relative w-56 rounded-xl border p-3 cursor-pointer transition-all duration-200
          bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-tertiary)]/50
          ${borderColor} ${glow}
          ${selected ? 'ring-1 ring-[var(--color-gold-500)]/50' : ''}
        `}
      >
        {/* Header: task number + status */}
        <div className="flex items-center justify-between mb-1.5">
          <code className="text-[10px] font-mono text-[var(--color-text-muted)]">
            {task.task_number}
          </code>
          <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
            task.status === 'FINAL'
              ? 'text-[var(--color-ok)] bg-[var(--color-ok)]/10'
              : task.status === 'ESCALATED'
                ? 'text-[var(--color-warn)] bg-[var(--color-warn)]/10'
                : task.status === 'CANCELLED'
                  ? 'text-[var(--color-err)] bg-[var(--color-err)]/10'
                  : isActive
                    ? 'text-[var(--color-plex-400)] bg-[var(--color-plex-500)]/10'
                    : 'text-[var(--color-text-muted)] bg-[var(--color-surface-tertiary)]'
          }`}>
            {task.status.replace(/_/g, ' ')}
          </span>
        </div>

        {/* Title */}
        <p className="text-xs font-medium text-[var(--color-text-primary)] mb-2 line-clamp-2 leading-tight">
          {task.title}
        </p>

        {/* Step progress */}
        <div className="mb-2">
          <StepProgressIndicator status={task.status} compact />
        </div>

        {/* Footer: engine + elapsed */}
        <div className="flex items-center justify-between text-[9px] text-[var(--color-text-muted)]">
          <div className="flex items-center gap-1">
            <Cpu className="w-3 h-3" />
            <span>Engine {task.primary_engine?.toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>{elapsedStr(task.created_at, task.updated_at)}</span>
          </div>
        </div>
      </div>

      {/* Context menu */}
      {ctx && (
        <TaskNodeContextMenu
          taskId={task.id}
          x={ctx.x}
          y={ctx.y}
          onClose={() => setCtx(null)}
        />
      )}
    </>
  );
}
