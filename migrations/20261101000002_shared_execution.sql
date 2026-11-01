CREATE TABLE execution_events (
    id uuid PRIMARY KEY,
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    engine_slot text NOT NULL,
    configured_model text NOT NULL,
    route text NOT NULL,
    peer text,
    state text NOT NULL CHECK (state IN ('running','completed','failed')),
    output text,
    error text,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);
CREATE INDEX execution_events_task_idx ON execution_events(task_id, started_at);
