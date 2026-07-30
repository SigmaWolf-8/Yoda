---
name: Θ-lock possession factor (Torus Gate)
description: Why the Torus Gate's second factor is a locally-derived time reading rather than SMS, and the invariants that keep the two implementations honest.
---

# Θ-lock replaces SMS as the Torus Gate's possession factor

The gate's second factor is a 6-digit reading both sides derive independently
from a per-account seed and the current angle of a fixed unified epoch. Nothing
secret crosses the wire and no carrier sits in the trust path.

**Why:** the owner ruled SMS unnecessary once a unified international epoch and
a fixed base-time theta constant existed — and SMS was actively locking him out
of his own pre-existing account, since enrollment demanded a round-trip he
could not complete. A carrier in the trust path also contradicts the gate's
sovereignty premise.

**How to apply:**
- Phone is contact information only. Never reintroduce it as a factor, never
  make it required at enrollment or registration.
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

## Known, accepted tradeoff

The seed lives in browser storage and is transferable by hand, so this is a
copyable shared secret rather than hardware-bound possession — weaker than SMS
on device binding, stronger on trust path. Hardware binding (WebAuthn) is the
upgrade path if that tradeoff is ever revisited.
