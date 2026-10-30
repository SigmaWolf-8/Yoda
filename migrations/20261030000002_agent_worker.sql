CREATE TABLE agent_workers (
    org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    heartbeat_at TIMESTAMPTZ,
    lease_owner UUID,
    lease_until TIMESTAMPTZ,
    active_task UUID REFERENCES tasks(id) ON DELETE SET NULL,
    message TEXT NOT NULL DEFAULT 'Starting autonomous queue worker'
);
CREATE TABLE agent_worker_attempts (
    task_id UUID PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    protocol JSONB,
    last_error TEXT
);
