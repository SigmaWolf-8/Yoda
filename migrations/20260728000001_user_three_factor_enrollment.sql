-- ═══════════════════════════════════════════════════════════════════════
-- Task #49 — Per-user 3-Factor enrollment for the Torus Gate.
--
-- The Gate is the real 3-factor flow: Knowledge (account password) ·
-- Possession (SMS one-time code to the enrolled phone) · Codepoint (the
-- enrolled Crystal cube). Enrollment is stored per user. No secret is kept
-- in plaintext form that reveals a factor: the possession seed is an opaque
-- deterministic scalar (like a TOTP seed) and the cube is a coordinate, not
-- a credential on its own.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE users
    ADD COLUMN gate_phone          TEXT,           -- E.164 delivery target for the possession code
    ADD COLUMN gate_possession_seed TEXT,          -- opaque u64 seed (decimal text), TOTP-style
    ADD COLUMN gate_cp_x           SMALLINT,        -- Crystal cube codepoint (Rep C trit 1..=3)
    ADD COLUMN gate_cp_y           SMALLINT,
    ADD COLUMN gate_cp_z           SMALLINT,
    ADD COLUMN gate_enrolled       BOOLEAN NOT NULL DEFAULT FALSE;
