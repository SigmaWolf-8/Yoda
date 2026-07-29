---
name: cargo builds killed in-tool
description: Why cargo build/test fail with exit 143 in the bash tool and how to build/verify instead
---
Running `cargo build`/`cargo test` directly through the bash tool (foreground, nohup, or setsid-detached) reliably gets SIGTERM'd (exit 143) before finishing — LSP/cargo contention plus tool process limits.

**Why:** long cargo compiles exceed the bash tool's process lifetime and compete with the LSP's background `cargo check`.

**How to apply:** to compile the backend, restart the "Start application" workflow — its run script (`scripts/replit-run.sh`) hot-starts the cached binary, rebuilds in the background, and hot-swaps the new binary when done. Watch `/tmp/logs/Start_application_*.log` for the `428/429` build line and `Listening on 0.0.0.0:3000`. Verify behavior with live `curl` against localhost:3000 (unit tests can't be run in-tool). `pkill -f "cargo check"` first can help.

**Verifying `#[cfg(test)]` unit tests you cannot run:** the workflow restart only builds the *non-test* binary, so it never exercises `#[cfg(test)]` code, and a foreground/detached `cargo test` is killed before it links (the giant `yoda-api` test binary alone exceeds the window). Instead confirm the test module *compiles* with `getLatestLspDiagnostics()` — the LSP runs `cargo check --workspace --all-targets`, which type-checks the test target (wiremock usage, matchers, etc.); zero diagnostics ⇒ the tests compile. Then reason through runtime pass/fail by hand. A stale prebuilt binary in `target/debug/deps/yoda_api-*` won't contain new tests (`grep -a <test_fn_name>` to check).
