import {
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Circle,
  ChevronRight,
  ChevronDown,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import type { Task, TaskStatus } from '../../types';

interface Props {
  tasks: Task[];
  selectedId?: string;
  onSelect: (taskId: string) => void;
}

/* ── Status rendering ── */

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  FINAL: CheckCircle2,
  ESCALATED: AlertTriangle,
  CANCELLED: XCircle,
};

const STATUS_COLOR: Record<string, string> = {
  FINAL:      'text-[var(--color-ok)]',
  ESCALATED:  'text-[var(--color-warn)]',
  CANCELLED:  'text-[var(--color-err)]',
};

function statusIndicator(status: TaskStatus) {
  const Icon = STATUS_ICON[status];
  const color = STATUS_COLOR[status];

  if (Icon && color) return <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${color}`} />;

  // In-progress statuses
  if (status.startsWith('STEP_')) {
    const step = status.match(/STEP_(\d)/)?.[1] ?? '?';
    return (
      <div className="relative w-3.5 h-3.5 flex-shrink-0">
        <Loader2 className="w-3.5 h-3.5 text-[var(--color-plex-400)] animate-spin" />
        <span className="absolute inset-0 flex items-center justify-center text-[6px] font-bold text-[var(--color-plex-400)]">
          {step}
        </span>
      </div>
    );
  }

  return <Circle className="w-3.5 h-3.5 flex-shrink-0 text-[var(--color-text-muted)]" />;
}

/* ── Build tree from flat list ── */

interface TreeNode {
  task: Task;
  children: TreeNode[];
}

function buildTree(tasks: Task[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Create nodes
  for (const t of tasks) {
    map.set(t.id, { task: t, children: [] });
  }

  // Link parents
  for (const t of tasks) {
    const node = map.get(t.id)!;
    if (t.parent_task_id && map.has(t.parent_task_id)) {
      map.get(t.parent_task_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort by task_number
  const sortFn = (a: TreeNode, b: TreeNode) => a.task.task_number.localeCompare(b.task.task_number);
  function sortTree(nodes: TreeNode[]) {
    nodes.sort(sortFn);
    for (const n of nodes) sortTree(n.children);
  }
  sortTree(roots);

  return roots;
}

/* ── Tree node component ── */

function TreeNodeRow({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isSelected = node.task.id === selectedId;

  return (
    <div>
      <button
        onClick={() => onSelect(node.task.id)}
        className={`w-full flex items-center gap-2 py-1.5 pr-3 text-left rounded-lg transition-colors ${
          isSelected
            ? 'bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Expand toggle */}
        {hasChildren ? (
          <span
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="flex-shrink-0 cursor-pointer"
          >
            {expanded
              ? <ChevronDown className="w-3 h-3 text-[var(--color-text-muted)]" />
              : <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" />
            }
          </span>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}

        {/* Status */}
        {statusIndicator(node.task.status)}

        {/* Task number + title */}
        <span className="flex-1 min-w-0 truncate text-xs">
          <span className="font-mono text-[var(--color-text-muted)] mr-1.5">{node.task.task_number}</span>
          {node.task.title}
        </span>
      </button>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.task.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main component ── */

export function TaskTree({ tasks, selectedId, onSelect }: Props) {
  const tree = buildTree(tasks);

  if (!tasks.length) {
    return (
      <div className="p-4 text-center">
        <p className="text-xs text-[var(--color-text-muted)]">
          Submit a query to see tasks here.
        </p>
      </div>
    );
  }

  return (
    <div className="py-2 space-y-0.5 overflow-y-auto">
      {tree.map((node) => (
        <TreeNodeRow
          key={node.task.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
