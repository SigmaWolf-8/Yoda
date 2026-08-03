#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Sovereign enrollment — seat a passphrase on an existing account.
#
# For the case where an account predates the Gate: the row exists, but its
# passphrase is unknown, so there is no way to reach the enrollment step that
# would issue a Θ-lock seed.
#
# This script sets a passphrase you type here, locally, at your own terminal.
# It never travels through anything but this machine.
#
# It does NOT touch your organization, membership, projects or any other data —
# only the password hash on your user row.
#
# How the hash is produced: rather than reimplement argon2 (and risk a
# parameter mismatch the server would silently reject), it registers a
# throwaway account through the running API, lifts the hash the server itself
# produced, moves it onto your row, and deletes the throwaway.
#
#   Usage:  bash scripts/sovereign-enroll.sh [email]
#   Default email: Capomastro@Outlook.com
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

EMAIL="${1:-Capomastro@Outlook.com}"
API="${API:-http://127.0.0.1:3000/api}"

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is not set — run this inside the workspace shell." >&2
    exit 1
fi

exists=$(psql "$DATABASE_URL" -tAc \
    "SELECT count(*) FROM users WHERE lower(email) = lower('${EMAIL}')")
if [[ "$exists" != "1" ]]; then
    echo "No account found for ${EMAIL}." >&2
    echo "Existing accounts:" >&2
    psql "$DATABASE_URL" -tAc "SELECT email FROM users ORDER BY created_at" >&2
    exit 1
fi

if ! curl -sf -o /dev/null "${API}/health"; then
    echo "The API is not answering at ${API} — start the workflow first." >&2
    exit 1
fi

echo "Setting the passphrase for: ${EMAIL}"
read -r -s -p "New passphrase (min 8 chars): " PASS; echo
read -r -s -p "Again: " PASS2; echo
if [[ "$PASS" != "$PASS2" ]]; then
    echo "Those do not match." >&2
    exit 1
fi
if [[ ${#PASS} -lt 8 ]]; then
    echo "Passphrase must be at least 8 characters." >&2
    exit 1
fi

# Throwaway account, purely to borrow the server's own argon2 output.
SCRATCH="sovereign-scratch-$$@localhost.invalid"
cleanup() {
    psql "$DATABASE_URL" -qtAc \
        "DELETE FROM organizations WHERE id IN (
             SELECT org_id FROM org_members WHERE user_id IN (
                 SELECT id FROM users WHERE email = '${SCRATCH}'))" >/dev/null 2>&1 || true
    psql "$DATABASE_URL" -qtAc \
        "DELETE FROM users WHERE email = '${SCRATCH}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

curl -sf -X POST "${API}/gate/enroll" \
    -H 'Content-Type: text/plain' \
    --data-binary "email ${SCRATCH}
password ${PASS}
name Scratch
cube 1.1.1" >/dev/null

HASH=$(psql "$DATABASE_URL" -tAc \
    "SELECT password_hash FROM users WHERE email = '${SCRATCH}'")
if [[ -z "$HASH" ]]; then
    echo "Could not produce a hash — is the API healthy?" >&2
    exit 1
fi

# Move the hash across, and clear any stale enrollment so the Gate walks you
# through choosing a Crystal cube and issues a fresh Θ-lock seed.
psql "$DATABASE_URL" -qtAc "
    UPDATE users
       SET password_hash = '${HASH}',
           gate_enrolled = FALSE,
           gate_possession_seed = NULL,
           gate_theta_seed = NULL,
           gate_theta_last_station = NULL
     WHERE lower(email) = lower('${EMAIL}')" >/dev/null

# Any sessions opened under the old passphrase are no longer yours to honour.
psql "$DATABASE_URL" -qtAc "
    UPDATE gate_sessions SET revoked = TRUE
     WHERE user_id = (SELECT id FROM users WHERE lower(email) = lower('${EMAIL}'))" >/dev/null

cat <<EOF

Done. ${EMAIL} now uses the passphrase you just typed.

Next, at the Gate (/login):
  1. Enter that email and passphrase.
  2. The Gate will ask you to enroll — choose your Crystal cube (phone optional).
  3. It seats a Θ-lock seed on that browser and shows it once. Keep a copy;
     you need it to pass the Gate from any other device.
EOF
