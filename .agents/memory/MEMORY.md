# Memory Index

- [Repo serving & git push](repo-serving-and-git-push.md) — Rust+Vite app, NOT the pnpm artifact scaffold; bash git push is blocked (push via code_execution GitHub token); validation gate requires origin/main...main == 0 0.
- [cargo builds killed in-tool](cargo-build-intool-sigterm.md) — cargo build/test via bash tool gets SIGTERM'd (exit 143); rebuild by restarting the workflow (hot-swap) and verify with live curl.
- [Rust build vs LSP cargo check](rust-build-lsp-contention.md) — incremental backend builds starve on the shared target/ lock under the LSP's cargo check; free the lock, then restart_workflow to finish deterministically.
- [sqlx migration checksum drift](sqlx-migration-drift.md) — editing an already-applied migration aborts ALL pending migrations silently (new columns never land → 500s); never edit applied migrations, re-baseline the checksum to recover.
- [Route-verify & dist serving](yoda-build-deploy.md) — SPA fallback returns 200 text/html so verify API routes by content-type not status; dev serves frontend/dist so cp public→dist after edits.
