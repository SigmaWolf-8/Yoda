#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Seat a passphrase on an existing account, taking it from a Replit Secret.
#
# Same job as sovereign-enroll.sh, for the case where the owner is not sitting
# at a terminal: the passphrase arrives as the secret GATE_PASSPHRASE instead of
# being typed at a prompt. Nobody has to read it out, and it never appears in
# chat, in a shell history, or in this file.
#
# As with the interactive script, the hash is produced by the server itself —
# a throwaway account is registered through the running API and its hash lifted
# — rather than reimplementing argon2 and risking a parameter mismatch the
# server would silently reject.
#
#   Usage:  bash scripts/gate-passphrase-from-secret.sh [email]
#   Default email: Capomastro@Outlook.com
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

EMAIL="${1:-Capomastro@Outlook.com}"
API="${API:-http://127.0.0.1:3000/api}"

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is not set — run this inside the workspace shell." >&2
    exit 1
fi

if [[ -z "${GATE_PASSPHRASE:-}" ]]; then
    echo "GATE_PASSPHRASE is not set. Add it as a Replit Secret first." >&2
    exit 1
fi

if [[ ${#GATE_PASSPHRASE} -lt 8 ]]; then
    echo "That passphrase is shorter than 8 characters — the server will refuse it." >&2
    exit 1
fi

exists=$(psql "$DATABASE_URL" -tAc \
    "SELECT count(*) FROM users WHERE lower(email) = lower('${EMAIL}')")
if [[ "$exists" != "1" ]]; then
    echo "No account found for ${EMAIL}." >&2
    exit 1
fi

if ! curl -sf -o /dev/null "${API}/health"; then
    echo "The API is not answering at ${API} — start the workflow first." >&2
    exit 1
fi

# Throwaway account, purely to borrow the server's own argon2 output.
SCRATCH="passphrase-scratch-$$@localhost.invalid"
cleanup() {
    psql "$DATABASE_URL" -qtAc \
        "DELETE FROM organizations WHERE id IN (
             SELECT org_id FROM org_members WHERE user_id IN (
                 SELECT id FROM users WHERE email = '${SCRATCH}'))" >/dev/null 2>&1 || true
    psql "$DATABASE_URL" -qtAc \
        "DELETE FROM users WHERE email = '${SCRATCH}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# The passphrase goes over a loopback socket to our own API and nowhere else.
curl -sf -X POST "${API}/gate/enroll" \
    -H 'Content-Type: text/plain' \
    --data-binary "email ${SCRATCH}
password ${GATE_PASSPHRASE}
name Scratch
cube 1.1.1" >/dev/null

HASH=$(psql "$DATABASE_URL" -tAc \
    "SELECT password_hash FROM users WHERE email = '${SCRATCH}'")
if [[ -z "$HASH" ]]; then
    echo "Could not produce a hash — is the API healthy?" >&2
    exit 1
fi

# Move the hash across and clear any stale enrollment, so the Gate walks the
# account through setting up again and issues a fresh key. Both seed columns
# are cleared: the Gate reads gate_possession_seed, and a leftover value in
# either one makes the new enrollment disagree with itself.
psql "$DATABASE_URL" -qtAc "
    UPDATE users
       SET password_hash = '${HASH}',
           gate_enrolled = FALSE,
           gate_possession_seed = NULL,
           gate_theta_seed = NULL,
           gate_theta_last_station = NULL
     WHERE lower(email) = lower('${EMAIL}')" >/dev/null

# Any sessions opened under the old passphrase are no longer ours to honour.
psql "$DATABASE_URL" -qtAc "
    UPDATE gate_sessions SET revoked = TRUE
     WHERE user_id = (SELECT id FROM users WHERE lower(email) = lower('${EMAIL}'))" >/dev/null

cat <<EOF

Done. ${EMAIL} now uses the passphrase held in GATE_PASSPHRASE.

Next, at the Gate (/login):
  1. Enter that email and passphrase.
  2. The Gate asks you to set up: pick three numbers, phone optional.
  3. It gives this browser a secret key and shows it once. Keep a copy — you
     need it to sign in from any other machine.

Delete the GATE_PASSPHRASE secret afterwards; it has done its job.
EOF
