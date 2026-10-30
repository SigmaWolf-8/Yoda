-- Autonomy is an organization-scoped operator choice, not a workspace-wide
-- side effect of starting the HTTP server.
ALTER TABLE agent_workers ALTER COLUMN enabled SET DEFAULT FALSE;
-- Narrow the initial bootstrap to explicit opt-in before any task was run.
-- Preserve any organization that already has execution evidence.
UPDATE agent_workers w SET enabled=FALSE,message='Paused; enable the worker to execute approved queued tasks'
WHERE active_task IS NULL AND NOT EXISTS (
    SELECT 1 FROM agent_worker_attempts a JOIN tasks t ON t.id=a.task_id
    JOIN projects p ON p.id=t.project_id WHERE p.org_id=w.org_id
);
