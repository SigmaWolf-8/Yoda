-- Task #29: Threads as first-class objects.
--
-- Adds thread-level metadata to the tasks table (used only on root tasks,
-- i.e. rows where parent_task_id IS NULL). Title editing reuses the
-- existing `title` column.

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS pinned      BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS archived    BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

-- Backs the sidebar query: list threads for a project, ordered by
-- pinned desc, then most-recent activity. Filtered by archived flag.
CREATE INDEX IF NOT EXISTS idx_tasks_threads_sidebar
    ON tasks (project_id, archived, pinned, updated_at DESC)
    WHERE parent_task_id IS NULL;
