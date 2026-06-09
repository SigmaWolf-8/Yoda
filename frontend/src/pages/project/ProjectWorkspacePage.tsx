import { useState, useMemo } from 'react';
import { useParams, useNavigate, NavLink } from 'react-router-dom';
import {
  Loader2,
  Settings,
  BookOpen,
  Search,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import {
  useProject, useTasks, useTask, useUpdateProject, useDeleteTask,
  useThreads, useUpdateThread, useDeleteThread,
} from '../../api/hooks';
import { ModeToggle } from '../../components/project/ModeToggle';
import { QueryInput } from '../../components/project/QueryInput';
import { ThreadList } from '../../components/project/ThreadList';
import { TaskThread } from '../../components/project/TaskThread';
import { DecompositionApproval } from '../../components/project/DecompositionApproval';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { QueryResult, TaskTree as TaskTreeType, TaskMessage, Thread } from '../../types';

type PendingConfirm =
  | { kind: 'thread-soft'; thread: Thread }
  | { kind: 'thread-permanent'; thread: Thread }
  | { kind: 'subtask'; taskId: string; title: string };

export function ProjectWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading: projectLoading } = useProject(id);
  const { data: tasks } = useTasks(id);
  const updateProject = useUpdateProject(id ?? '');

  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>();
  const { data: taskDetail } = useTask(selectedTaskId);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pendingTree, setPendingTree] = useState<TaskTreeType | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const { data: threads } = useThreads(id, { includeArchived: showArchived, search });

  const deleteTask = useDeleteTask(id ?? '');
  const updateThread = useUpdateThread(id ?? '');
  const deleteThread = useDeleteThread(id ?? '');

  function handleModeChange(mode: 'yoda' | 'ronin') {
    if (!project) return;
    updateProject.mutate({ mode });
  }

  function handleQueryResult(result: QueryResult) {
    if (result.status === 'pending_approval' && result.task_tree) {
      setPendingTree(result.task_tree);
    }
    const newId = result.task_id ?? result.task_ids?.[0];
    if (newId) {
      setSelectedTaskId(newId);
      setSelectedThreadId(newId);
    }
  }

  const dagLink = useMemo(() => {
    if (!id) return '/';
    const tid = selectedThreadId ?? threads?.[0]?.id;
    return tid ? `/projects/${id}/threads/${tid}/dag` : `/projects/${id}/tasks`;
  }, [id, selectedThreadId, threads]);

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-muted)]" />
      </div>
    );
  }

  if (!project || !id) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--color-text-muted)]">Project not found.</p>
      </div>
    );
  }

  const task = taskDetail?.task;
  const messages: TaskMessage[] = taskDetail?.messages ?? [];

  function performConfirm() {
    if (!pendingConfirm) return;
    const c = pendingConfirm;
    setPendingConfirm(null);
    if (c.kind === 'thread-soft') {
      deleteThread.mutate(
        { threadId: c.thread.id, permanent: false },
        {
          onSuccess: () => {
            if (selectedThreadId === c.thread.id) {
              setSelectedThreadId(undefined);
              setSelectedTaskId(undefined);
            }
          },
        },
      );
    } else if (c.kind === 'thread-permanent') {
      deleteThread.mutate(
        { threadId: c.thread.id, permanent: true },
        {
          onSuccess: () => {
            if (selectedThreadId === c.thread.id) {
              setSelectedThreadId(undefined);
              setSelectedTaskId(undefined);
            }
          },
        },
      );
    } else if (c.kind === 'subtask') {
      deleteTask.mutate(c.taskId);
      if (selectedTaskId === c.taskId) setSelectedTaskId(undefined);
    }
  }

  function handleThreadDelete(thread: Thread) {
    // If already pending hard-delete (archived + scheduled), the menu offers
    // "Delete permanently" instead — this path is always the soft, recoverable one.
    setPendingConfirm({ kind: 'thread-soft', thread });
  }

  function handleThreadPurge(thread: Thread) {
    setPendingConfirm({ kind: 'thread-permanent', thread });
  }

  function handleSubtaskDelete(taskId: string, title: string) {
    setPendingConfirm({ kind: 'subtask', taskId, title });
  }

  const confirmTitle = pendingConfirm?.kind === 'thread-soft'
    ? 'Move thread to trash?'
    : pendingConfirm?.kind === 'thread-permanent'
      ? 'Permanently delete thread?'
      : 'Delete subtask?';

  const confirmMessage = !pendingConfirm
    ? null
    : pendingConfirm.kind === 'thread-soft'
      ? (
          <>
            <p className="mb-2">
              <strong className="text-[var(--color-text-primary)]">"{pendingConfirm.thread.title}"</strong>
              {pendingConfirm.thread.subtask_count > 0 && (
                <> and its {pendingConfirm.thread.subtask_count} subtask
                  {pendingConfirm.thread.subtask_count === 1 ? '' : 's'}</>
              )}{' '}
              will be moved to <em>Archived</em> and permanently deleted in 30 days.
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              You can restore it any time before then from the "Show archived" view.
            </p>
          </>
        )
      : pendingConfirm.kind === 'thread-permanent'
        ? (
            <>
              <p className="mb-2">
                <strong className="text-[var(--color-text-primary)]">"{pendingConfirm.thread.title}"</strong>
                {pendingConfirm.thread.subtask_count > 0 && (
                  <> and its {pendingConfirm.thread.subtask_count} subtask
                    {pendingConfirm.thread.subtask_count === 1 ? '' : 's'}</>
                )}{' '}
                will be permanently deleted right now.
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                This cannot be undone.
              </p>
            </>
          )
        : (
            <p>
              Delete subtask{' '}
              <strong className="text-[var(--color-text-primary)]">"{pendingConfirm.title}"</strong>?
            </p>
          );

  const confirmLabel = pendingConfirm?.kind === 'thread-soft'
    ? 'Move to trash'
    : pendingConfirm?.kind === 'thread-permanent'
      ? 'Delete permanently'
      : 'Delete';

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* ── Left: Threads Sidebar ── */}
      {sidebarOpen && (
        <aside className="w-72 flex-shrink-0 border-r border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] flex flex-col">
          <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--color-border-subtle)]">
            <span className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              Threads
            </span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <ThreadList
              threads={threads ?? []}
              tasks={tasks ?? []}
              selectedId={selectedTaskId}
              selectedThreadId={selectedThreadId}
              search={search}
              onSearchChange={setSearch}
              showArchived={showArchived}
              onToggleArchived={() => setShowArchived(s => !s)}
              onSelect={(taskId, threadId) => {
                setSelectedTaskId(taskId);
                setSelectedThreadId(threadId);
              }}
              onRename={(threadId, title) =>
                updateThread.mutate({ threadId, title })
              }
              onPin={(threadId, pinned) =>
                updateThread.mutate({ threadId, pinned })
              }
              onArchive={(threadId, archived) =>
                updateThread.mutate({ threadId, archived })
              }
              onDelete={handleThreadDelete}
              onDeletePermanent={handleThreadPurge}
              onDeleteSubtask={handleSubtaskDelete}
            />
          </div>
        </aside>
      )}

      {/* ── Center: Main Content ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Project toolbar */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]/50">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}

          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
            {project.name}
          </h2>

          <ModeToggle
            mode={project.mode}
            onChange={handleModeChange}
            disabled={updateProject.isPending}
          />

          <div className="flex-1" />

          {/* Quick-nav links */}
          <button
            onClick={() => navigate(dagLink)}
            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
            title="DAG View"
          >
            <GitBranch className="w-4 h-4" />
          </button>
          <NavLink
            to={`/projects/${id}/bible`}
            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
            title="Task Bible"
          >
            <BookOpen className="w-4 h-4" />
          </NavLink>
          <NavLink
            to={`/projects/${id}/kb`}
            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
            title="Knowledge Base"
          >
            <Search className="w-4 h-4" />
          </NavLink>
          <NavLink
            to="/settings/engines"
            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
            title="Engine Settings"
          >
            <Settings className="w-4 h-4" />
          </NavLink>
        </div>

        {/* Main area */}
        <div className="flex-1 overflow-hidden flex flex-col p-4 lg:p-6">
          {selectedTaskId && task ? (
            <div className="flex-1 overflow-hidden animate-fade-in">
              <TaskThread task={task} messages={messages} />
            </div>
          ) : !selectedTaskId && threads && threads.length === 0 && !search.trim() ? (
            <div className="flex flex-col items-center justify-center py-16 text-center flex-1">
              <div className="w-12 h-12 rounded-xl bg-[var(--color-gold-500)]/10 flex items-center justify-center mb-4">
                <GitBranch className="w-6 h-6 text-[var(--color-gold-400)]" />
              </div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
                No threads yet
              </h3>
              <p className="text-sm text-[var(--color-text-muted)] max-w-xs">
                Submit a query below to start your first thread.
              </p>
            </div>
          ) : !selectedTaskId ? (
            <div className="flex flex-col items-center justify-center py-16 text-center flex-1">
              <p className="text-sm text-[var(--color-text-muted)]">Select a thread from the sidebar.</p>
            </div>
          ) : null}
        </div>

        {/* Query input (pinned to bottom) */}
        <div className="p-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-primary)]">
          <QueryInput
            projectId={id}
            mode={project.mode}
            onResult={handleQueryResult}
          />
        </div>
      </div>

      {/* ── Decomposition Approval Modal ── */}
      {pendingTree && (
        <DecompositionApproval
          projectId={id}
          taskTree={pendingTree}
          onClose={() => setPendingTree(null)}
          onApproved={() => setPendingTree(null)}
        />
      )}

      {/* ── Confirm dialog (replaces window.confirm, which is blocked
              by the sandboxed Replit preview iframe) ── */}
      <ConfirmDialog
        open={!!pendingConfirm}
        destructive
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmLabel}
        cancelLabel="Cancel"
        onConfirm={performConfirm}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
