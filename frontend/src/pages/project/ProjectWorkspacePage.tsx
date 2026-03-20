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
import { useProject, useTasks, useTask, useUpdateProject } from '../../api/hooks';
import { ModeToggle } from '../../components/project/ModeToggle';
import { QueryInput } from '../../components/project/QueryInput';
import { TaskTree } from '../../components/project/TaskTree';
import { DecompositionApproval } from '../../components/project/DecompositionApproval';
import type { QueryResult, TaskTree as TaskTreeType } from '../../types';

export function ProjectWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isLoading: projectLoading } = useProject(id);
  const { data: tasks } = useTasks(id);
  const updateProject = useUpdateProject(id ?? '');

  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const { data: taskDetail } = useTask(selectedTaskId);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pendingTree, setPendingTree] = useState<TaskTreeType | null>(null);

  function handleModeChange(mode: 'yoda' | 'ronin') {
    if (!project) return;
    updateProject.mutate({ mode });
  }

  function handleQueryResult(result: QueryResult) {
    if (result.status === 'pending_approval' && result.task_tree) {
      setPendingTree(result.task_tree);
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
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          {/* Selected task detail */}
          {selectedTaskId && taskDetail ? (
            <div className="mb-6 bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-xl p-5 animate-fade-in">
              <div className="flex items-center gap-2 mb-2">
                <code className="text-sm font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-tertiary)] px-1.5 py-0.5 rounded">
                  {taskDetail.task.task_number}
                </code>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${
                  taskDetail.task.status === 'FINAL'
                    ? 'bg-[var(--color-ok)]/10 text-[var(--color-ok)]'
                    : taskDetail.task.status === 'ESCALATED'
                      ? 'bg-[var(--color-warn)]/10 text-[var(--color-warn)]'
                      : 'bg-[var(--color-plex-500)]/10 text-[var(--color-plex-400)]'
                }`}>
                  {taskDetail.task.status.replace(/_/g, ' ')}
                </span>
              </div>
              <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-2">
                {taskDetail.task.title}
              </h3>

              {/* Competencies */}
              <div className="flex gap-1.5 flex-wrap mb-3">
                {taskDetail.task.competencies.map((c) => (
                  <span
                    key={c}
                    className="px-2 py-0.5 rounded text-xs font-medium bg-[var(--color-plex-500)]/10 text-[var(--color-plex-400)] border border-[var(--color-plex-500)]/20"
                  >
                    {c}
                  </span>
                ))}
              </div>

              {/* Results summary */}
              <div className="text-sm text-[var(--color-text-muted)]">
                {taskDetail.results.length} result(s) · {taskDetail.reviews.length} review(s)
                {taskDetail.task.primary_agent_role && (
                  <> · Agent: <span className="text-[var(--color-text-tertiary)]">{taskDetail.task.primary_agent_role}</span></>
                )}
              </div>
            </div>
          ) : !selectedTaskId && tasks && tasks.length === 0 ? (
            /* No tasks yet — prompt to submit */
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-xl bg-[var(--color-gold-500)]/10 flex items-center justify-center mb-4">
                <GitBranch className="w-6 h-6 text-[var(--color-gold-400)]" />
              </div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
                No tasks yet
              </h3>
              <p className="text-sm text-[var(--color-text-muted)] max-w-xs">
                Submit a query below to decompose it into tasks. Each task passes through the four-step adversarial refinement protocol.
              </p>
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
