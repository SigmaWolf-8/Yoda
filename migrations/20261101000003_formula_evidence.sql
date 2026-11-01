CREATE TABLE formula_evidence_runs (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES organizations(id),
    formula_id text NOT NULL,
    executed_at timestamptz NOT NULL,
    record jsonb NOT NULL CHECK(jsonb_typeof(record)='object'),
    report_html text
);
CREATE INDEX formula_evidence_runs_org_date ON formula_evidence_runs(org_id,executed_at DESC);
CREATE FUNCTION protect_formula_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Formula evidence is append-only; create a new observation instead';
END;
$$;
CREATE TRIGGER formula_evidence_append_only BEFORE UPDATE OR DELETE ON formula_evidence_runs
FOR EACH ROW EXECUTE FUNCTION protect_formula_evidence();
