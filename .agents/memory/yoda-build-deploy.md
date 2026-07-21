---
name: YODA build & deploy quirks
description: Non-obvious serving, route-verification, and Rust rebuild behavior in this repo's workflow (scripts/replit-run.sh) — read before editing frontend static files or Rust API routes.
---

# YODA build / deploy quirks

## The server serves frontend/dist/, NOT frontend/public/
- Vite copies `frontend/public/*` verbatim into `frontend/dist/` at build time.
- `scripts/replit-run.sh` **skips** the frontend rebuild when `frontend/dist/` already
  exists (`REBUILD_FRONTEND=1` forces it). So editing a `public/*.html` alone does
  **not** change what the dev server serves.
- **How to apply:** after editing any `frontend/public/` static file, also
  `cp` it into `frontend/dist/` (or force a rebuild). `dist/` is gitignored, so
  the tracked source of truth stays `public/`.

## SPA fallback makes HTTP status codes lie for API routes
- Unknown paths hit the SPA fallback and return `200 text/html` (index.html).
- **Verify an API route exists by `content-type: application/json`**, not by status
  code: `curl -s -w '%{content_type}' ...`. A 200 alone proves nothing.
- Inter-cube monitor routes are under `/api/salvi/inter-cube/...` (e.g. `/relay/status`,
  `/slots`, `/monitor/slots`). Bare `/slots` is NOT a route — it falls through to the SPA.

## Rust rebuild = restart the workflow (hot-swap), don't hand-roll it
- `replit-run.sh` hot-starts the cached `target/debug/yoda-api` immediately (port opens
  fast), then runs `cargo build --bin yoda-api` in the foreground under `set -e`; on
  success it kills the hot binary and starts the fresh one, logging
  `Build complete — swapping to updated binary`.
- A compile error makes the script exit (`set -e`) → the workflow crashes/restarts.
  So: a running workflow whose log shows `Finished ... / swapping` means the new Rust
  code compiled. Use `restart_workflow` to rebuild — it's incremental (~10s).

## Background builds started in a bash tool call get reaped
- `nohup cargo build ... &` inside a bash tool call is killed when that call's shell
  session ends, so it never reaches `Finished` across calls. Don't rely on backgrounded
  builds persisting between tool calls — use the workflow's build or one blocking call.

## pkill -f self-match (caused exit 143 killing my own shell)
- `pkill -f PATTERN` also matches the pkill command's own argv.
- The bracket trick (`cargo check --w[o]rkspace`) avoids matching the pattern's own
  literal text, but STILL matches if the **same command** also contains the
  un-bracketed real string (e.g. an actual `cargo build --bin yoda-api` later on the
  line). Keep kill patterns and real invocations in separate commands.
