---
name: Salvi engine — spec traps
description: Three places where the Salvi fixed-precision kernel's specification says something other than what its names imply; do not "fix" them by intuition.
---

# Salvi engine: spec traps

## The bijective base-9 digit buffer is 21, not 20

The specification set the buffer to 20 on the claim `9^20 > u64::MAX`. That is
false: `9^20 = 12_157_665_459_056_928_801` and `u64::MAX =
18_446_744_073_709_551_615`. The largest value expressible in 20 bijective
digits is `(9^21 - 9)/8 = 13_677_373_641_439_044_900`, still below `u64::MAX`,
so a 20-digit buffer makes `from_u64(u64::MAX)` return `IntegerOverflow` and
turns the spec's own round-trip proof into a reachable error branch.

**Why:** bijective base-b uses digits `1..=b`, so `n` digits cover
`(b^(n+1) - b)/(b-1)`, not `b^n`. The off-by-one comes from applying ordinary
positional-notation reasoning to a bijective numeral system.

**How to apply:** 21 is the tight bound. If anyone proposes 20 again, the
counter-example above settles it in one line.

## `f(x)` binds nothing

`compute_fx` is specified as `243 - rem + rem`, which is 243 for every input.
Any "seal verification" built on it succeeds for every possible hash and is
trivially forgeable, and a proof that `f(x) = 243` is discharged vacuously.

**Why:** the hash-dependent term is added back after being subtracted.

**How to apply:** the kernel implements it as specified — it is the owner's
stated invariant — but nothing may present it as verification. The HTTP surface
calls the endpoint *inspect*, returns `binds_hash: false` as a machine-readable
field, and exposes `reduced_word_sum` as the term that actually depends on the
hash. Keep that separation if this is ever re-exposed elsewhere.

## "Zero state balance" discharges at residue 1, not 0

`verify_zero_state_balance(cost, market, clifford)` is true when
`cost - market - clifford == 1` ("Unity Alpha"), despite the name and despite
`Z = 0` in the surrounding prose. A residue of exactly 0 is *not* discharged.

**Why:** it is what the specification says, and the spec's own worked example
(131, 96, 34) only passes under the `== 1` rule.

**How to apply:** do not "correct" it to `== 0`. Any surface that reports the
residue must also state the required value, or the response reads as a bug.

## Tests live in `tests/`, not behind `#[cfg(test)]`

The crate is unconditionally `#![no_std]`. A `#[cfg(test)]` module inside the
lib pulls `std` back in through the test harness and makes the attribute
decorative, so the suite is an integration test in `crates/salvi-engine/tests/`.
CI additionally builds the crate for `thumbv7em-none-eabihf`, which is the only
check that actually proves `std` is absent.
