---
name: yoda-api bin test target won't link
description: Why `cargo test -p yoda-api` fails to build regardless of your change, and how to still verify test code.
---

# The yoda-api test binary is blocked by unrelated broken tests
`yoda-api` is a **binary** crate (no lib target), so all `#[cfg(test)]` modules
compile into one shared bin test target. Some pre-existing tests in
`kyokushin_brothers.rs` reference APIs that no longer exist (e.g. `execute` now
takes a typed query, `UnifiedResponse` has no `.contains`, a renamed markdown
getter), so the whole test target fails to compile. That means **no** yoda-api
test can run until those are fixed or excluded — even a perfectly correct test in
another module.

**Why:** a single broken `#[cfg(test)]` item fails the entire crate's test
compile; a green build of the production binary does NOT imply the test target
links.

**How to apply:**
- To verify only YOUR test module compiles, run `cargo test -p yoda-api --bins <path>`
  once and read the error list: rustc reports *all* compile errors, so if the only
  errors are in `kyokushin_brothers.rs`, your module type-checks.
- To actually RUN your tests without fixing unrelated code, temporarily prepend
  `#[cfg(any())]` to each broken test fn (excludes it from compilation), run, then
  revert. Don't commit that.
- Running is still subject to the in-tool SIGTERM + shared `target/` lock
  contention (see cargo-build-intool-sigterm.md, rust-build-lsp-contention.md), so
  even with the target unblocked the run may not complete in-tool.
