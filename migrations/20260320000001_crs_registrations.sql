-- CRS registrations persisted to survive server restarts.
-- address_str is the Display representation of the CubeAddr assigned by inter-cube.
-- On CRS startup, all non-expired rows are re-registered to restore the routing table.
CREATE TABLE IF NOT EXISTS crs_registrations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    endpoint        VARCHAR(255) NOT NULL,     -- socket addr, e.g. "1.2.3.4:11434"
    public_key      TEXT NOT NULL,             -- public key string passed to CRS
    address_str     VARCHAR(128) NOT NULL UNIQUE, -- Display form of assigned CubeAddr
    session_token   VARCHAR(255),              -- optional YODA session token
    last_heartbeat  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crs_reg_heartbeat ON crs_registrations (last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_crs_reg_token     ON crs_registrations (session_token)
    WHERE session_token IS NOT NULL;
