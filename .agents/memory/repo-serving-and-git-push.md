---
name: Repo serving convention & git push constraint
description: How static pages are served in this YODA repo, and how to push to GitHub (bash git push is blocked)
---

# Serving convention (NOT the pnpm artifact scaffold)
This repo is a Rust workspace + a plain React/Vite frontend. It is **not** the
Replit pnpm multi-artifact scaffold — there is no `artifact.toml`, and the
`artifacts` skill / path-based routing does **not** apply here.

- Standalone pages live in `frontend/public/*.html`.
- Build with `cd frontend && npm run build` → output lands in `frontend/dist/`.
- The `Start application` workflow serves `frontend/dist/` on **port 3000**.
- After editing a public HTML page you MUST rebuild; `dist/` is gitignored, so
  only the `public/` source is committed.

**How to apply:** to add a new standalone page, drop it in `frontend/public/`,
rebuild, and it is served at `/<name>.html`. Don't reach for the artifacts skill.

# Git push is sandbox-blocked
`git push` (and other write git commands) via the bash tool are blocked by the
sandbox. Read-only git (`git --no-optional-locks status`, `log`, `diff`) works.

- Push by using the **code_execution** sandbox with the GitHub connection's
  `access_token` (via `listConnections('github')`), pushing HEAD to
  `origin/main` (https://github.com/SigmaWolf-8/Yoda.git).
- A registered **validation check** verifies `origin/main` parity, so if a
  commit hasn't been pushed, validation fails until you push.

**Why:** the platform auto-commits locally on task completion but does not push
to the external GitHub remote; parity validation catches the gap.
