import { useState, useRef, useEffect, useMemo } from 'react';
import {
  CheckCircle2, AlertTriangle, Loader2, Circle, XCircle,
  ChevronRight, ChevronDown, Pin, PinOff, Archive, ArchiveRestore,
  Trash2, Pencil, MoreHorizontal, Search, Clock, RotateCcw,
} from 'lucide-react';
import type { Thread, ThreadRollupStatus, Task, TaskStatus } from '../../types';

interface Props {
  threads: Thread[];
  tasks: Task[]; // full project task list for subtree expansion
  selectedId?: string;
  selectedThreadId?: string;
  search: string;
  onSearchChange: (s: string) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  onSelect: (taskId: string, threadId: string) => void;
  onRename: (threadId: string, newTitle: string) => void;
  onPin: (threadId: string, pinned: boolean) => void;
  onArchive: (threadId: string, archived: boolean) => void;
  onDelete: (thread: Thread) => void;
  onDeletePermanent: (thread: Thread) => void;
  onDeleteSubtask?: (taskId: string, title: string) => void;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/* ── Status icons ── */

function rollupIcon(rollup: ThreadRollupStatus) {
  switch (rollup) {
    case 'final':
      return <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 text-[var(--color-ok)]" />;
    case 'escalated':
      return <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-[var(--color-warn)]" />;
    case 'cancelled':
      return <XCircle className="w-3.5 h-3.5 flex-shrink-0 text-[var(--color-err)]" />;
    case 'in_progress':
      return <Loader2 className="w-3.5 h-3.5 flex-shrink-0 text-[var(--color-plex-400)] animate-spin" />;
    default:
      return <Circle className="w-3.5 h-3.5 flex-shrink-0 text-[var(--color-text-muted)]" />;
  }
}

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  FINAL: CheckCircle2,
  ESCALATED: AlertTriangle,
  CANCELLED: XCircle,
};

const STATUS_COLOR: Record<string, string> = {
  FINAL: 'text-[var(--color-ok)]',
  ESCALATED: 'text-[var(--color-warn)]',
  CANCELLED: 'text-[var(--color-err)]',
};

function subtaskStatusIcon(status: TaskStatus) {
  const Icon = STATUS_ICON[status];
  const color = STATUS_COLOR[status];
  if (Icon && color) return <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${color}`} />;
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

/* ── Subtree (tasks under a thread root) ── */

interface TreeNode { task: Task; children: TreeNode[]; }

function buildSubtree(rootId: string, tasks: Task[]): TreeNode[] {
  const byParent = new Map<string, Task[]>();
  for (const t of tasks) {
    const p = t.parent_task_id ?? '';
    if (!p) continue;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(t);
  }
  function build(parentId: string): TreeNode[] {
    const kids = (byParent.get(parentId) ?? []).slice()
      .sort((a, b) => a.task_number.localeCompare(b.task_number));
    return kids.map(t => ({ task: t, children: build(t.id) }));
  }
  return build(rootId);
}

function SubtaskRow({
  node, depth, selectedId, onSelect, onDelete,
}: {
  node: TreeNode; depth: number; selectedId?: string;
  onSelect: (id: string) => void;
  onDelete?: (id: string, title: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isSelected = node.task.id === selectedId;

  return (
    <div>
      <div className="w-full overflow-hidden flex items-center">
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node.task.id, node.task.title);
            }}
            title="Delete task"
            className="flex-shrink-0 ml-1 p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-err)] hover:bg-[var(--color-err)]/10 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={() => onSelect(node.task.id)}
          className={`flex-1 min-w-0 flex items-center gap-2 py-1 text-left rounded-md transition-colors ${
            isSelected
              ? 'bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]'
          }`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          {hasChildren ? (
            <span
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
              className="flex-shrink-0 cursor-pointer"
            >
              {expanded
                ? <ChevronDown className="w-3 h-3 text-[var(--color-text-muted)]" />
                : <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" />}
            </span>
          ) : (
            <span className="w-3 flex-shrink-0" />
          )}
          {subtaskStatusIcon(node.task.status)}
          <span className="flex-1 min-w-0 truncate text-xs">
            <span className="font-mono text-[var(--color-text-muted)] mr-1.5">{node.task.task_number}</span>
            {node.task.title}
          </span>
        </button>
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <SubtaskRow
              key={child.task.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Thread row ── */

function ThreadRow({
  thread, tasks, selected, selectedSubtaskId, onSelect, onRename, onPin, onArchive,
  onDelete, onDeletePermanent, onDeleteSubtask,
}: {
  thread: Thread; tasks: Task[]; selected: boolean;
  selectedSubtaskId?: string;
  onSelect: (taskId: string) => void;
  onRename: (newTitle: string) => void;
  onPin: (pinned: boolean) => void;
  onArchive: (archived: boolean) => void;
  onDelete: () => void;
  onDeletePermanent: () => void;
  onDeleteSubtask?: (taskId: string, title: string) => void;
}) {
  const daysLeft = daysUntil(thread.deletion_scheduled_at);
  const pendingDelete = daysLeft !== null;
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(thread.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setDraftTitle(thread.title); }, [thread.title]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const subtree = useMemo(() => buildSubtree(thread.id, tasks), [thread.id, tasks]);

  function commitRename() {
    const next = draftTitle.trim();
    setEditing(false);
    if (!next) { setDraftTitle(thread.title); return; }
    if (next !== thread.title) onRename(next);
  }

  return (
    <div className={`border-b border-[var(--color-border-subtle)] ${thread.archived ? 'opacity-60' : ''}`}>
      <div className={`w-full flex items-center gap-1 px-1 py-1.5 ${
        selected ? 'bg-[var(--color-gold-500)]/5' : ''
      }`}>
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex-shrink-0 p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded
            ? <ChevronDown className="w-3.5 h-3.5" />
            : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        {rollupIcon(thread.rollup_status)}

        {editing ? (
          <input
            ref={inputRef}
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') { setDraftTitle(thread.title); setEditing(false); }
            }}
            className="flex-1 min-w-0 px-1 py-0.5 text-sm bg-[var(--color-surface-primary)] border border-[var(--color-plex-400)] rounded text-[var(--color-text-primary)] focus:outline-none"
          />
        ) : (
          <button
            onClick={() => onSelect(thread.id)}
            onDoubleClick={() => setEditing(true)}
            className={`flex-1 min-w-0 text-left text-sm truncate ${
              selected
                ? 'text-[var(--color-gold-400)] font-medium'
                : 'text-[var(--color-text-primary)]'
            }`}
            title={thread.title}
          >
            {thread.title}
          </button>
        )}

        {thread.pinned && (
          <Pin className="w-3 h-3 flex-shrink-0 text-[var(--color-gold-400)]" />
        )}

        {thread.subtask_count > 0 && (
          <span className="flex-shrink-0 text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-tertiary)] px-1 rounded">
            {thread.subtask_count}
          </span>
        )}

        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
            className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]"
            title="Thread actions"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 w-40 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-primary)] shadow-lg py-1 text-xs">
              <button
                onClick={() => { setMenuOpen(false); setEditing(true); }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]"
              >
                <Pencil className="w-3 h-3" /> Rename
              </button>
              <button
                onClick={() => { setMenuOpen(false); onPin(!thread.pinned); }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]"
              >
                {thread.pinned
                  ? <><PinOff className="w-3 h-3" /> Unpin</>
                  : <><Pin className="w-3 h-3" /> Pin</>}
              </button>
              {pendingDelete ? (
                <button
                  onClick={() => { setMenuOpen(false); onArchive(false); }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]"
                >
                  <RotateCcw className="w-3 h-3" /> Restore
                </button>
              ) : (
                <button
                  onClick={() => { setMenuOpen(false); onArchive(!thread.archived); }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]"
                >
                  {thread.archived
                    ? <><ArchiveRestore className="w-3 h-3" /> Unarchive</>
                    : <><Archive className="w-3 h-3" /> Archive</>}
                </button>
              )}
              {!pendingDelete && (
                <button
                  onClick={() => { setMenuOpen(false); onDelete(); }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[var(--color-err)] hover:bg-[var(--color-err)]/10"
                >
                  <Trash2 className="w-3 h-3" /> Delete thread
                </button>
              )}
              <button
                onClick={() => { setMenuOpen(false); onDeletePermanent(); }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[var(--color-err)] hover:bg-[var(--color-err)]/10"
              >
                <Trash2 className="w-3 h-3" /> Delete permanently
              </button>
            </div>
          )}
        </div>
      </div>

      {pendingDelete && (
        <div className="flex items-center gap-2 px-3 py-1 text-[10px] bg-[var(--color-err)]/5 border-t border-[var(--color-err)]/20">
          <Clock className="w-3 h-3 flex-shrink-0 text-[var(--color-err)]" />
          <span className="flex-1 text-[var(--color-err)]">
            Deletes in {daysLeft} day{daysLeft === 1 ? '' : 's'}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(false); }}
            className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]"
            title="Restore"
          >
            <RotateCcw className="w-3 h-3" /> Restore
          </button>
        </div>
      )}

      {expanded && (
        <div className="pb-1.5">
          {subtree.length === 0 ? (
            <div className="px-3 py-1 text-[11px] text-[var(--color-text-muted)] italic">
              No subtasks.
            </div>
          ) : (
            subtree.map((node) => (
              <SubtaskRow
                key={node.task.id}
                node={node}
                depth={0}
                selectedId={selectedSubtaskId}
                onSelect={onSelect}
                onDelete={onDeleteSubtask}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main list ── */

export function ThreadList({
  threads, tasks, selectedId, selectedThreadId, search, onSearchChange,
  showArchived, onToggleArchived,
  onSelect, onRename, onPin, onArchive, onDelete, onDeletePermanent, onDeleteSubtask,
}: Props) {
  return (
    <div className="flex flex-col h-full">
      {/* Search + toggle */}
      <div className="flex-shrink-0 px-2 py-2 space-y-1.5 border-b border-[var(--color-border-subtle)]">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--color-text-muted)]" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search threads…"
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-[var(--color-surface-primary)] border border-[var(--color-border-subtle)] rounded text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-plex-400)]"
          />
        </div>
        <button
          onClick={onToggleArchived}
          className={`w-full flex items-center justify-center gap-1.5 px-2 py-1 text-[11px] rounded transition-colors ${
            showArchived
              ? 'text-[var(--color-gold-400)] bg-[var(--color-gold-500)]/10'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]'
          }`}
        >
          <Archive className="w-3 h-3" />
          {showArchived ? 'Hiding none' : 'Show archived'}
        </button>
      </div>

      {/* Threads */}
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-sm text-[var(--color-text-muted)]">
              {search.trim()
                ? `No threads match "${search.trim()}".`
                : 'Submit a query to start your first thread.'}
            </p>
          </div>
        ) : (
          threads.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              tasks={tasks}
              selected={t.id === selectedThreadId}
              selectedSubtaskId={selectedId}
              onSelect={(taskId) => onSelect(taskId, t.id)}
              onRename={(title) => onRename(t.id, title)}
              onPin={(pinned) => onPin(t.id, pinned)}
              onArchive={(archived) => onArchive(t.id, archived)}
              onDelete={() => onDelete(t)}
              onDeletePermanent={() => onDeletePermanent(t)}
              onDeleteSubtask={onDeleteSubtask}
            />
          ))
        )}
      </div>
    </div>
  );
}
