-- YODA Migration: Θ-lock possession factor
--
-- The Gate's possession factor stops being an SMS round-trip and becomes a
-- reading derived from the unified epoch's theta angle. No carrier, no phone
-- number, no third party in the trust path.
--
-- `gate_theta_seed` holds the hex seed issued once at enrollment. The operator's
-- Crystal holds the same bytes and derives the same reading independently, so
-- nothing secret is ever transmitted during a login.

ALTER TABLE users ADD COLUMN gate_theta_seed TEXT;

-- Phone is no longer required to pass the Gate. The column stays for
-- notification purposes, but nothing in the login path reads it.
COMMENT ON COLUMN users.gate_phone IS
    'Contact number only — the Gate does not use SMS as a factor (see theta.rs).';
