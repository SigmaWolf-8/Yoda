import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { GitBranch, Loader2, ArrowLeft, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useTasks, useTask, useProject, usePipelineStatus, useThreads } from '../../api/hooks';
import { DAGCanvas } from '../../components/pipeline/DAGCanvas';
import { PipelineStatusBar } from '../../components/pipeline/PipelineStatusBar';
import { StepProgressIndicator } from '../../components/pipeline/StepProgressIndicator';
import type { Task } from '../../types';

/**
 * Collect a thread's root task plus all of its descendants from the flat
 * project-wide task list.
 */
function collectThreadTasks(rootId: string, all: Task[]): Task[] {
  const byParent = new Map<string, Task[]>();
  let root: Task | undefined;
  for (const t of all) {
    if (t.id === rootId) root = t;
    const p = t.parent_task_id ?? '';
    if (!p) continue;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(t);
  }
  if (!root) return [];
  const out: Task[] = [root];
  const queue: string[] = [rootId];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const child of byParent.get(parent) ?? []) {
      out.push(child);
      queue.push(child.id);
    }
  }
  return out;
}

export function TaskTreePage() {
  const { id, threadId: threadIdParam } = useParams<{ id: string; threadId?: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(id);
  const { data: allTasks, isLoading } = useTasks(id);
  const { data: threads } = useThreads(id, { includeArchived: true });
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const { data: taskDetail } = useTask(selectedId);
  const [detailOpen, setDetailOpen] = useState(true);

  // Effective thread: route param, or default to first thread.
  const effectiveThreadId = useMemo(() => {
    if (threadIdParam) return threadIdParam;
    return threads?.[0]?.id;
  }, [threadIdParam, threads]);

  // If we landed on /tasks without a thread, redirect once threads load.
  useEffect(() => {
    if (!threadIdParam && id && effectiveThreadId) {
      navigate(`/projects/${id}/threads/${effectiveThreadId}/dag`, { replace: true });
    }
  }, [threadIdParam, effectiveThreadId, id, navigate]);

  const threadTasks = useMemo(() => {
    if (!effectiveThreadId || !allTasks) return [];
    return collectThreadTasks(effectiveThreadId, allTasks);
  }, [effectiveThreadId, allTasks]);

  const { connected } = usePipelineStatus({
    projectId: id,
    enabled: !!id,
  });

  const startedAt = threadTasks.length
    ? threadTasks.reduce((min, t) => (t.created_at < min ? t.created_at : min), threadTasks[0].created_at)
    : undefined;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-muted)]" />
      </div>
    );
  }

  const hasNoThreads = !!threads && threads.length === 0;

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]/50 flex-shrink-0">
        <Link
          to={`/projects/${id}`}
          className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <GitBranch className="w-4 h-4 text-[var(--color-gold-400)]" />
        <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">
          DAG Pipeline
        </h1>
        {project && (
          <span className="text-sm text-[var(--color-text-muted)]">— {project.name}</span>
        )}

        {/* Thread picker */}
        {threads && threads.length > 0 && (
          <select
            value={effectiveThreadId ?? ''}
            onChange={(e) => navigate(`/projects/${id}/threads/${e.target.value}/dag`)}
            className="ml-2 px-2 py-1 text-xs bg-[var(--color-surface-primary)] border border-[var(--color-border-subtle)] rounded text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-plex-400)]"
            title="Switch thread"
          >
            {threads.map((t) => (
              <option key={t.id} value={t.id}>
                {t.pinned ? '📌 ' : ''}{t.archived ? '🗄 ' : ''}{t.title}
              </option>
            ))}
          </select>
        )}

        <div className="flex-1" />

        <button
          onClick={() => setDetailOpen(!detailOpen)}
          className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
          title={detailOpen ? 'Hide detail panel' : 'Show detail panel'}
        >
          {detailOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
        </button>
      </div>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* DAG Canvas */}
        <div className="flex-1 min-w-0">
          {hasNoThreads ? (
            <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-muted)]">
              No threads in this project yet. Submit a query from the workspace to create one.
            </div>
          ) : (
            <DAGCanvas
              tasks={threadTasks}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </div>

        {/* Detail panel */}
        {detailOpen && selectedId && taskDetail && (
          <aside className="w-80 flex-shrink-0 border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] overflow-y-auto animate-fade-in">
            <div className="p-4 space-y-4">
              {/* Header */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <code className="text-xs font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-tertiary)] px-1.5 py-0.5 rounded">
                    {taskDetail.task.task_number}
                  </code>
                  <span className={`text-[11px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                    taskDetail.task.status === 'FINAL'
                      ? 'text-[var(--color-ok)] bg-[var(--color-ok)]/10'
                      : taskDetail.task.status === 'ESCALATED'
                        ? 'text-[var(--color-warn)] bg-[var(--color-warn)]/10'
                        : 'text-[var(--color-plex-400)] bg-[var(--color-plex-500)]/10'
                  }`}>
                    {taskDetail.task.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {taskDetail.task.title}
                </h3>
              </div>

              {/* Step progress */}
              <div>
                <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                  Pipeline Progress
                </p>
                <StepProgressIndicator status={taskDetail.task.status} />
              </div>

              {/* Competencies */}
              {taskDetail.task.competencies.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
                    Competencies
                  </p>
                  <div className="flex gap-1 flex-wrap">
                    {taskDetail.task.competencies.map((c) => (
                      <span
                        key={c}
                        className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-[var(--color-plex-500)]/10 text-[var(--color-plex-400)] border border-[var(--color-plex-500)]/20"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Agent info */}
              <div>
                <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
                  Assignment
                </p>
                <div className="space-y-1 text-sm text-[var(--color-text-tertiary)]">
                  <p>Engine: <span className="text-[var(--color-text-secondary)]">{taskDetail.task.primary_engine?.toUpperCase()}</span></p>
                  <p>Agent: <span className="text-[var(--color-text-secondary)]">{taskDetail.task.primary_agent_role}</span></p>
                  <p>Position: <span className="text-[var(--color-text-secondary)]">#{taskDetail.task.workflow_position}</span></p>
                </div>
              </div>

              {/* Results summary */}
              <div>
                <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
                  History
                </p>
                <div className="space-y-1 text-sm text-[var(--color-text-tertiary)]">
                  <p>{taskDetail.results.length} result version(s)</p>
                  <p>{taskDetail.reviews.length} review assessment(s)</p>
                  {taskDetail.reviews.some((r) => r.censorship_flagged) && (
                    <p className="text-[var(--color-warn)]">⚠ Censorship flagged on some reviews</p>
                  )}
                </div>
              </div>

              {/* Dependencies */}
              {taskDetail.task.dependencies.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
                    Dependencies
                  </p>
                  <div className="space-y-0.5">
                    {taskDetail.task.dependencies.map((depId) => {
                      const dep = threadTasks.find((t) => t.id === depId);
                      return (
                        <button
                          key={depId}
                          onClick={() => setSelectedId(depId)}
                          className="w-full text-left px-2 py-1 rounded text-xs bg-[var(--color-surface-tertiary)]/50 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
                        >
                          {dep ? `${dep.task_number} — ${dep.title}` : depId.slice(0, 8)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Pipeline status bar */}
      <PipelineStatusBar
        tasks={threadTasks}
        connected={connected}
        intensity={project?.settings.review_intensity}
        startedAt={startedAt}
      />
    </div>
  );
}
