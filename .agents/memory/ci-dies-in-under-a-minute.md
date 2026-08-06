---
name: CI jobs dying in under a minute
description: A whole build matrix failing fast almost always means lints promoted to errors, not broken logic — check RUSTFLAGS before reading the code.
---

# A whole matrix failing in 30–60 seconds is a lint gate, not a broken build

When every entry of a build matrix fails at once and fast, suspect the job's
`RUSTFLAGS: "-D warnings"` before suspecting the code. Warnings that would
normally be noise become hard errors, and they fire during the first crate's
metadata pass — long before anything architecture-specific runs.

**Why:** this pattern is very easy to misread. Nine bare-metal / `no_std` /
cross-target jobs going red at the same moment invites a diagnosis about linker
scripts, target support, or a bad dependency pin. The real cause can be three
undeclared `cfg` names.

**How to apply:** reproduce with the job's own flags on the *host* target first
— `RUSTFLAGS="-D warnings" cargo check --target x86_64-unknown-linux-gnu`. If it
reproduces there, no cross-compilation toolchain is involved and the fix is
usually declarative.

## The `unexpected_cfgs` family

Three distinct causes, three distinct fixes:

- A `feature = "x"` gate with no matching entry in `[features]` — declare the
  feature. If the gated code needs a crate, add it as an `optional` dependency
  and declare `x = ["dep:x"]`, or the feature compiles to nothing usable.
- A cfg set by an external tool (`kani`, `miri`, coverage harnesses) — declare
  it in `[lints.rust] unexpected_cfgs = { check-cfg = ['cfg(kani)'] }`.
- A cfg that is genuinely dead — delete it.

## Cargo features are additive, so `no_std` is not the opposite of `std`

`--features no_std` **does not** turn off a default `std` feature. A crate that
does `#![cfg_attr(feature = "no_std", no_std)]` while gating std-only modules on
`feature = "std"` will, under that flag, drop `std` *and* keep compiling modules
that call `eprintln!` and `vec!`.

**How to apply:** gate std-only items on `all(feature = "std", not(feature =
"no_std"))` so the crate is correct whether or not the caller also passed
`--no-default-features`. Watch for the second-order effect: SIMD helpers whose
call sites are gated on `not(feature = "no_std")` (because
`is_x86_feature_detected!` is std-only) become dead code under `no_std` unless
their *definitions* carry the same gate.

## A `#![no_std]` binary cannot be built for a `*-linux-gnu` target

It fails with `unwinding panics are not supported without std`, and no
`Cargo.toml` change fixes it — panic strategy is per-profile, not per-feature,
and forcing `panic = "abort"` workspace-wide breaks `cargo test`. Build `--lib`
for hosted targets and leave the binary to the bare-metal job.
