-- Supplemental evidence records only. No mutation of the sealed workbook or
-- collections balances. An append is one serialized, idempotent operation.
CREATE TABLE conservation_audit (
    sequence BIGSERIAL PRIMARY KEY,
    id UUID NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    previous_hash TEXT NOT NULL CHECK (length(previous_hash) = 64),
    hash TEXT NOT NULL UNIQUE CHECK (length(hash) = 64),
    input JSONB NOT NULL,
    result JSONB NOT NULL
);

CREATE FUNCTION conservation_audit_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Conservation audit is append-only; append a correction with its evidence reference';
END;
$$;

CREATE TRIGGER conservation_audit_no_rewrite
BEFORE UPDATE OR DELETE OR TRUNCATE ON conservation_audit
FOR EACH STATEMENT EXECUTE FUNCTION conservation_audit_append_only();
