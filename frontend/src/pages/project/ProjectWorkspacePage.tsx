import { useState } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import {
  Loader2,
  Settings,
  BookOpen,
  Search,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useProject, useTasks, useTask, useUpdateProject, useDeleteTask } from '../../api/hooks';
import { ModeToggle } from '../../components/project/ModeToggle';
import { QueryInput } from '../../components/project/QueryInput';
import { TaskTree } from '../../components/project/TaskTree';
import { TaskThread } from '../../components/project/TaskThread';
import { DecompositionApproval } from '../../components/project/DecompositionApproval';
import type { QueryResult, TaskTree as TaskTreeType, TaskMessage } from '../../types';

export function ProjectWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isLoading: projectLoading } = useProject(id);
  const { data: tasks } = useTasks(id);
  const updateProject = useUpdateProject(id ?? '');

  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const { data: taskDetail } = useTask(selectedTaskId);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pendingTree, setPendingTree] = useState<TaskTreeType | null>(null);
  const deleteTask = useDeleteTask(id ?? '');

  function handleModeChange(mode: 'yoda' | 'ronin') {
    if (!project) return;
    updateProject.mutate({ mode });
  }

  function handleQueryResult(result: QueryResult) {
    if (result.status === 'pending_approval' && result.task_tree) {
      setPendingTree(result.task_tree);
    }
    if (result.task_id) {
      setSelectedTaskId(result.task_id);
    } else if (result.task_ids?.[0]) {
      setSelectedTaskId(result.task_ids[0]);
    }
  }

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

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* ── Left: Task Tree Sidebar ── */}
      {sidebarOpen && (
        <aside className="w-64 flex-shrink-0 border-r border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] flex flex-col">
          <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--color-border-subtle)]">
            <span className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              Tasks
            </span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <TaskTree
              tasks={tasks ?? []}
              selectedId={selectedTaskId}
              onSelect={setSelectedTaskId}
              onDelete={(taskId) => {
                deleteTask.mutate(taskId);
                if (selectedTaskId === taskId) setSelectedTaskId(undefined);
              }}
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
          <NavLink
            to={`/projects/${id}/tasks`}
            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
            title="DAG View"
          >
            <GitBranch className="w-4 h-4" />
          </NavLink>
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
          ) : !selectedTaskId && tasks && tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center flex-1">
              <div className="w-12 h-12 rounded-xl bg-[var(--color-gold-500)]/10 flex items-center justify-center mb-4">
                <GitBranch className="w-6 h-6 text-[var(--color-gold-400)]" />
              </div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
                No tasks yet
              </h3>
              <p className="text-sm text-[var(--color-text-muted)] max-w-xs">
                Submit a query below to start a new conversation thread.
              </p>
            </div>
          ) : !selectedTaskId && tasks && tasks.length > 0 ? (
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
    </div>
  );
}
