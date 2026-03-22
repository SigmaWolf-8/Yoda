-- Add is_disabled flag to engine_configs so users can pause an engine
-- without deleting its configuration.
ALTER TABLE engine_configs
  ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT false;
