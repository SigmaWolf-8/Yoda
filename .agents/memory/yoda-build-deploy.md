---
name: YODA route-verification & dist-serving gotchas
description: Two non-obvious traps when editing this repo's API routes or frontend static pages. (Rust rebuild, git push, and LSP contention live in their own topic files.)
---

# Verify API routes by content-type, not HTTP status
Unknown paths hit the SPA fallback and return `200 text/html` (index.html). So a
`200` alone never proves an API route exists — a missing route looks "OK".
**How to apply:** probe with `curl -s -w '%{content_type}'` and require
`application/json`. Inter-cube monitor routes live under
`/api/salvi/inter-cube/...` (`/relay/status`, `/slots`, `/monitor/slots`); bare
`/slots` is NOT a route and falls through to the SPA.

# The dev server serves frontend/dist/, not frontend/public/
`scripts/replit-run.sh` skips the frontend rebuild when `frontend/dist/` already
exists (`REBUILD_FRONTEND=1` forces it), and Vite copies `public/*` into `dist/`
only at build time. So editing a `public/*.html` alone does not change what's
served in dev.
**How to apply:** after editing a `frontend/public/` static file, also `cp` it to
`frontend/dist/`. `dist/` is gitignored, so the tracked source of truth stays
`public/`.
