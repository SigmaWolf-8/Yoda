-- YODA Migration: Θ-lock replay guard
--
-- A reading is honoured at its own station and one station of grace, so
-- without a ledger the same six digits would pass twice inside that window —
-- including from a fresh gate session. Recording the highest station an
-- account has already spent makes every reading single-use: the circle only
-- ever turns forwards.

ALTER TABLE users ADD COLUMN gate_theta_last_station BIGINT;

COMMENT ON COLUMN users.gate_theta_last_station IS
    'Highest Θ-lock station already spent by this account. A reading at or below it is a replay.';
