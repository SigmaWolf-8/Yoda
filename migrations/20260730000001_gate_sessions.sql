-- YODA Migration: Torus Gate opaque sessions
--
-- The Gate does not mint JWTs. It mints a 32-byte opaque handle and keeps all
-- authority here, server-side. Only the SHA-256 digest of the handle is
-- stored, so a dump of this table yields no usable sessions.
--
-- Consequences (the reason for doing it this way):
--   * a handle can be revoked instantly — a JWT cannot;
--   * the client holds no readable claims;
--   * nothing about the session is parsed out of user-supplied bytes.

CREATE TABLE gate_sessions (
    token_digest BYTEA PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    issued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked      BOOLEAN NOT NULL DEFAULT FALSE
);

-- Revoke-all-for-user and cleanup sweeps.
CREATE INDEX idx_gate_sessions_user ON gate_sessions (user_id);
CREATE INDEX idx_gate_sessions_expires ON gate_sessions (expires_at);
