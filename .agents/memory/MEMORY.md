# Memory Index

- [Repo serving & git push](repo-serving-and-git-push.md) — Rust+Vite app, NOT the pnpm artifact scaffold; bash git push is blocked (push via code_execution GitHub token); validation gate requires origin/main...main == 0 0.
- [cargo builds killed in-tool](cargo-build-intool-sigterm.md) — cargo build/test via bash tool gets SIGTERM'd (exit 143); rebuild by restarting the workflow (hot-swap) and verify with live curl.
- [yoda-api test binary blocked](yoda-api-test-binary-blocked.md) — pre-existing broken tests in kyokushin_brothers.rs fail the shared bin test target; no yoda-api test runs until they're fixed/cfg-excluded (rustc still reports which module the errors are in).
- [Rust build vs LSP cargo check](rust-build-lsp-contention.md) — incremental backend builds starve on the shared target/ lock under the LSP's cargo check; free the lock, then restart_workflow to finish deterministically.
- [sqlx migration checksum drift](sqlx-migration-drift.md) — editing an already-applied migration aborts ALL pending migrations silently (new columns never land → 500s); never edit applied migrations, re-baseline the checksum to recover.
- [Route-verify & dist serving](yoda-build-deploy.md) — SPA fallback returns 200 text/html so verify API routes by content-type not status; dev serves frontend/dist so cp public→dist after edits.
- [Θ-lock possession factor](theta-lock-possession.md) — gate factor 2 is a locally-derived time reading, not SMS; Rust/TS derivations must agree bit-for-bit and grace windows need a replay ledger.
- [Torus Gate: no JWT](torus-gate-no-jwt.md) — gate login mints an opaque 32-byte handle (digest stored server-side), never a JWT/JSON; no refresh token by design.
- [Frontend WebGL fallback](frontend-webgl-fallback.md) — wrap three.js renderer creation in try/catch or an uncaught throw blanks the whole SPA; never gate login/critical UI behind WebGL.
- [Tauri desktop shell](tauri-desktop-shell.md) — standalone workspace, excluded from root; verify with `nix-shell -p webkitgtk_4_1 ...` (never `--pure`); packaged builds can't use relative /api.
- [Treatise plaintext cleaning](treatise-plaintext-cleaning.md) — Capomastro "Edified Treatise" attachments: unify duplicate drafts to one clean copy each; strip markdown but keep # | in KaTeX and convert multiplication * to ×.
