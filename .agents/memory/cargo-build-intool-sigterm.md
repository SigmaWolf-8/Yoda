---
name: cargo builds killed in-tool
description: Why cargo build/test fail with exit 143 in the bash tool and how to build/verify instead
---
Running `cargo build`/`cargo test` directly through the bash tool (foreground, nohup, or setsid-detached) reliably gets SIGTERM'd (exit 143) before finishing — LSP/cargo contention plus tool process limits.

**Why:** long cargo compiles exceed the bash tool's process lifetime and compete with the LSP's background `cargo check`.

**How to apply:** to compile the backend, restart the "Start application" workflow — its run script (`scripts/replit-run.sh`) hot-starts the cached binary, rebuilds in the background, and hot-swaps the new binary when done. Watch `/tmp/logs/Start_application_*.log` for the `428/429` build line and `Listening on 0.0.0.0:3000`. Verify behavior with live `curl` against localhost:3000 (unit tests can't be run in-tool). `pkill -f "cargo check"` first can help.
