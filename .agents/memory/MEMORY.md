# Memory Index

- [Repo serving & git push](repo-serving-and-git-push.md) — Rust+Vite app (not the pnpm artifact scaffold); bash git push blocked → push via code_execution GitHub token.
- [cargo builds killed in-tool](cargo-build-intool-sigterm.md) — cargo build/test via bash gets SIGTERM'd (exit 143); rebuild by restarting the workflow, verify with live curl.
- [Rust build vs LSP cargo check](rust-build-lsp-contention.md) — incremental backend builds starve on the shared target/ lock under LSP cargo check; free lock then restart_workflow.
- [sqlx migration checksum drift](sqlx-migration-drift.md) — editing an applied migration silently aborts ALL pending migrations; never edit applied migrations, re-baseline to recover.
- [Route-verify & dist serving](yoda-build-deploy.md) — SPA fallback returns 200 text/html; verify API routes by content-type not status. dev serves frontend/dist → rebuild dist after frontend edits.
- [Frontend WebGL fallback](frontend-webgl-fallback.md) — wrap three.js renderer creation in try/catch or an uncaught throw blanks the whole SPA; never gate login/critical UI behind WebGL.
