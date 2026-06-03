-- Soft-delete grace period for threads.
-- When a user "deletes" a thread, it is archived AND given a deletion_scheduled_at
-- of NOW() + 30 days. The thread remains recoverable from the archived list until
-- that timestamp, at which point list_threads opportunistically hard-deletes it.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at TIMESTAMPTZ NULL;

-- Partial index used by the cleanup pass.
CREATE INDEX IF NOT EXISTS idx_tasks_pending_deletion
  ON tasks (deletion_scheduled_at)
  WHERE deletion_scheduled_at IS NOT NULL;
