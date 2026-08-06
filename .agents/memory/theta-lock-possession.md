---
name: Θ-lock possession factor (Torus Gate)
description: Why the Torus Gate's second factor is a locally-derived time reading rather than SMS, and the invariants that keep the two implementations honest.
---

# The gate holds two possession factors, and they are not interchangeable

The Θ-lock (derived, never transmitted) and the texted code (minted at the gate,
delivered out of band) are complementary and the owner wants **both**: the first
proves the enrolled seed, the second proves the handset. An earlier reading of
"SMS is unnecessary" as "SMS is gone" was wrong — SMS was removed as the *sole*
possession factor, not removed from the product.

**How to apply:** the texted code is required exactly when an account has a
handset enrolled, and skipped when it does not, so a phoneless account is never
held at a stage it cannot clear. Enforce that on the server at the final factor,
never by trusting which stage the client says it is on.

# Θ-lock as the Torus Gate's derived possession factor

The gate's second factor is a 6-digit reading both sides derive independently
from a per-account seed and the current angle of a fixed unified epoch. Nothing
secret crosses the wire and no carrier sits in the trust path.

**Why:** the owner ruled SMS unnecessary once a unified international epoch and
a fixed base-time theta constant existed — and SMS was actively locking him out
of his own pre-existing account, since enrollment demanded a round-trip he
could not complete. A carrier in the trust path also contradicts the gate's
sovereignty premise.

**How to apply:**
- A phone is optional at enrollment and registration. Optional is the invariant,
  not absent: an account without one must still reach the dashboard.
- The Θ constants are Salvi Framework axioms, not tunables: 364° full circle,
  13° ternary radian, Z₂₈ stations, 169 s (13²) dwell. Changing them silently
  invalidates every enrolled Crystal.
- The epoch anchor is a single named constant. Re-anchoring it invalidates all
  existing seeds' readings — treat it as a migration, not a config tweak.

## The two implementations must agree bit-for-bit

The reading is derived in Rust on the server and in the browser via Web Crypto.
They are separate codebases computing the same number, so they drift silently:
a mismatch shows up only as "the gate rejects everyone".

Guard the agreement on: HMAC keyed with the seed's **ASCII hex text** (not the
decoded bytes), the station serialized as a **big-endian signed 64-bit**
integer, RFC-4226 dynamic truncation, and **Euclidean** division/modulo so
pre-epoch instants do not produce negative stations. The browser side must do
the station arithmetic in `BigInt` — plain JS numbers lose precision before the
`BigInt` cast and stop matching Rust's i64 at large magnitudes.

The cheap regression test is to derive the same reading from the same seed and
timestamp in both languages and compare, including negative and very large
timestamps.

## Grace implies a replay ledger

Accepting the previous station as well as the current one (so an operator is
not punished for the circle turning mid-login) makes a captured reading valid
for up to two stations — including from a freshly opened session. Single-use is
therefore enforced by recording the highest station an account has spent and
rejecting anything at or below it, in one atomic conditional UPDATE so two
racing requests cannot both win.

## Dev senders that echo secrets must fail closed

The console SMS sender writes the one-time code to the log and returns it to the
client. Selecting it on "is this production?" is the wrong question, because a
missing or misspelled environment variable then silently becomes a code leak.

**Why:** a review caught exactly this — the sender was chosen by
`APP_ENV == "production"`, so `APP_ENV=prod`, or no `APP_ENV` at all on a bare
server, quietly selected the echoing sender in a live deployment.

**How to apply:** an echoing sender is permitted only where the environment is
*positively* identified as development, with the platform's own deployment
marker taken as decisive. Everything unrecognised — including a completely bare
environment — is treated as production. Re-check the echo again at the response
boundary rather than trusting the selection, and prove it by booting the binary
under each environment combination and reading which sender it announces.

## Ritual language in the chrome, plain language in the instructions

The gate's identity — Torus Gate, Θ-lock, the Codex, the ornate brass styling —
is deliberate and stays. What must never be ritual is anything telling an
operator what to *do*: field labels, hints, button verbs and error messages.

**Why:** the owner hit his own enrollment screen and could not read it. Terms
like "Codepoint", "Crystal cube", "X/Y/Z" and "E.164" described the internals
accurately and told the person nothing. The three numbers are a PIN, the seed is
a secret key held on the device, and the phone is a mobile number that earns you
a texted code — say that.

**How to apply:** keep the brand nouns in headings and ornament; write the
instruction underneath in words a newcomer would use. Never make a wire format
(E.164, hex length, line protocol) the operator's problem — accept what people
type and normalize it server-side. Test copy by having someone walk the flow who
has not seen it, and ask them which of the three things on screen they could not
work out.

## Accounts that predate the gate cannot self-recover

A pre-Gate user row has a password hash nobody knows, so it cannot reach the
enrollment step that would issue a seed — the gate answers "invalid credentials"
forever. Recovery is to seat a passphrase directly on the row.

**How to apply:** never invent a passphrase on the owner's behalf and never take
one through chat. Have it supplied as a Replit Secret and read from the
environment by a script, so no human relays it. Produce the hash by registering
a throwaway account through the running API and lifting the hash the server
itself wrote — reimplementing argon2 risks a parameter mismatch the server
silently rejects. Clear **both** seed columns and the last-station marker when
resetting, or the fresh enrollment disagrees with a leftover value.

## Email comparison is case-insensitive

Every account lookup — gate begin, gate codepoint, legacy register and login —
compares on `lower(email)`, backed by a unique index on `lower(email)`.

**Why:** the owner was locked out of his own account for a session because his
row was stored `Capomastro@Outlook.com` and he typed it lower case. The gate
answered "Invalid credentials", which reads as a wrong password and sends you
hunting in entirely the wrong place.

**How to apply:** any new query that finds a user by email must use
`lower(email) = lower($1)`. The unique index is what stops two accounts existing
that differ only by case — without it, case-insensitive lookup would have to
pick one of them arbitrarily.

## Secrets must never reach a command line

Passphrases and hashes go to `curl` and `psql` on **stdin** (`--data-binary @-`,
`psql -f -`), never as arguments.

**Why:** every process on the host can read another's argv for as long as it
runs. A recovery script that took the passphrase as a curl argument leaked it to
the whole machine for the life of the request.

**How to apply:** when testing for this, remember that a watcher built on
`ps | grep <secret>` matches its own grep argv and reports a false positive —
dump `ps` output first, filter out the watcher's own lines, then search using a
pattern file rather than a pattern argument.

## Known, accepted tradeoff

The seed lives in browser storage and is transferable by hand, so this is a
copyable shared secret rather than hardware-bound possession — weaker than SMS
on device binding, stronger on trust path. Hardware binding (WebAuthn) is the
upgrade path if that tradeoff is ever revisited.
