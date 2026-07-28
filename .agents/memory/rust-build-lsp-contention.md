---
name: Rust build starved by LSP cargo check
description: Why incremental cargo builds can hang for 30+ min on Replit and how to unblock them
---

# Rust workspace builds starve under LSP `cargo check`

On this Replit shared-CPU container, the editor LSP runs `cargo check --workspace --all-targets`
continuously. It shares the SAME `target/` build lock as the workflow's `cargo build --bin yoda-api`.
Under load the check processes keep re-acquiring the lock, so an incremental backend build can sit
"running" for 30+ minutes without the binary mtime ever advancing — it looks deadlocked but is just starved.

**Why:** single `target/` dir → one cargo lock; LSP check and workflow build contend for it; shared CPU
makes the LSP win repeatedly.

**How to apply (when a backend build won't finish):**
- Confirm starvation: `cargo build --bin ...` is RUNNING but `stat -c %Y target/debug/<bin>` never changes,
  and `pgrep -af "cargo check"` shows live workspace checks.
- Free the lock once: `pkill -f "cargo check"` (note: pkill matches its own shell cmdline, so the bash call
  may exit 143 — that's fine; the check procs still die). The in-flight build then grabs the lock and the
  final crate compile + link finishes in a minute or two. LSP will respawn checks afterward.
- Cleanest deterministic finish: once the binary mtime has advanced (rebuild succeeded), `restart_workflow`.
  `scripts/replit-run.sh` hot-starts the freshly-built `target/debug/yoda-api` immediately (port 3000 opens
  at once), so the new binary serves regardless of any further background build contention.
- The workflow keeps serving the cached binary the whole time, so user-facing frontend (dist/) changes are
  never blocked by a slow backend rebuild.

**When "free the lock + restart" keeps failing (most reliable recovery):** build into a SEPARATE target dir so
you never contend for the shared lock at all: `CARGO_TARGET_DIR=/tmp/yoda-build cargo build --bin yoda-api`.
This also finishes fast enough to catch real compile errors in-tool (the default-dir build starves before it
even reaches your crate). Then seed the default target so the workflow's build is a near no-op and hot-starts
the fresh code: `cp -au /tmp/yoda-build/debug/. target/debug/` (note: `rsync` is NOT installed here), then
`restart_workflow`. Verify with live curl. Broad `pkill -f rust-analyzer` can kill the tool's own shell
(exit -1); if you must kill the lock holder, target the specific cargo/rustc PID and never match `bash`.
