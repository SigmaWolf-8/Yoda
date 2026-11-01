-- Browser observations are never mixed with server-generated calculations.
CREATE TABLE browser_formula_runs (
    sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id uuid NOT NULL UNIQUE,
    org_id uuid NOT NULL REFERENCES organizations(id),
    user_id uuid NOT NULL REFERENCES users(id),
    submission_id uuid NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    UNIQUE (org_id, user_id, submission_id)
);
CREATE INDEX browser_formula_runs_owner_sequence
    ON browser_formula_runs(org_id, user_id, sequence DESC);
CREATE TRIGGER browser_formula_runs_append_only
    BEFORE UPDATE OR DELETE ON browser_formula_runs
    FOR EACH ROW EXECUTE FUNCTION protect_formula_evidence();
CREATE TRIGGER browser_formula_runs_no_truncate
    BEFORE TRUNCATE ON browser_formula_runs
    FOR EACH STATEMENT EXECUTE FUNCTION protect_formula_evidence();
