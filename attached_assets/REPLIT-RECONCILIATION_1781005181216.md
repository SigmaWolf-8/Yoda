# Reconciliation Handoff — Local Changes → Replit

**Purpose:** A local working copy of the Yoda repo (on a Windows machine) was modified
outside Replit on **2026-06-08**. This file lists every local change so the Replit agent
can reconcile cleanly when regenerating the project zip. Paths are **repo-relative**
(relative to the Yoda repo root).

**Bottom line:** Only **3 local edits** matter. Everything else is build output you can ignore.
There are also **3 pre-existing bugs** worth fixing while you're in here (one is the New
Project button you're already on).

---

## 1. Local changes to reconcile

| # | Repo-relative path | Status | Action for Replit |
|---|---|---|---|
| A | `frontend/public/array3-cubes-flush.html` | **MODIFIED** (now 3416 lines) | Accept this as the canonical monitor. See §2. |
| B | `.cargo/config.toml` | **NEW FILE** | Keep only if building against a local `ternary-math` checkout. See §3. Safe to drop on Replit if you build from the git URL. |
| C | `migrations/20260608000001_complete_core_schema.sql` | **NEW FILE** | Keep. Idempotent DB repair. **Not yet applied to any DB.** See §4. |

| Build output (regenerate, do not diff) | Notes |
|---|---|
| `Cargo.lock`, `frontend/package-lock.json`, `frontend/node_modules/`, `frontend/dist/`, `target/` | Produced by `npm install` / `npm run build` / `cargo build`. Ignore. |

**No Rust (`.rs`) or React (`.tsx`) source was edited locally.** The only hand edits are A, B, C above.

---

## 2. The monitor (item A) — IMPORTANT

There are **two different monitor files** in `frontend/public/`:

| File | Lines | Date | Status |
|---|---|---|---|
| `array3-monitor.html` | 1779 | Jun 3 | **OLD** — this is what the app currently loads |
| `array3-cubes-flush.html` | 3416 | Jun 8 | **CURRENT** — all recent work is here |

`frontend/src/pages/MonitoringPage.tsx` (line ~31) embeds the monitor via:

```tsx
<iframe ref={iframeRef} src="/array3-monitor.html" title="Array3 Monitor" ... />
```

➡️ **Action:** point the iframe at the current file:

```tsx
src="/array3-cubes-flush.html"
```

(Alternatively, overwrite `array3-monitor.html` with the contents of `array3-cubes-flush.html`
and keep the iframe as-is. Either way, **`array3-cubes-flush.html` is the source of truth**.)

### What changed in `array3-cubes-flush.html` vs the old monitor
- **Navigation:** left-drag = rotate; right / middle / Shift+left = pan; arrow keys rotate;
  drag state clears on mouseup/blur/pointercancel; `contextmenu` calls `preventDefault` only
  (do **not** also end-drag there, or right-drag panning breaks). Added an on-screen nav legend.
- **Layout:** vertical spacing uses the Tribonacci ratio `vGap = width / 1.8392867552`
  (not a fixed value, not 2:1). Zoom ceiling `maxR = max(fitR()*2.4, sceneRadius()*2.2, 30)`.
- **Ports / addressing:** canonical per-slot port `nodePort + ((x-1)*9 + (y-1)*3 + (z-1))`;
  node address is the bare **4-trit Rep C vertex** (e.g. `2233`) — zero is excluded by design
  (no `0` series, no decimals, no cluster prefix). Node labels are `Node N`.
- **Tunnels:** drawn only when both endpoints have live flow; intra-array (3 pairs) plus
  inter-array vertical links between the same node across stacked arrays.
- **Coherence / telemetry:** real telemetry (occupancy, online count, tunnels, forwards,
  neighbors, registrations, uptime). Entropy is a **disorder measure that reaches 0 at full
  coherence** (zero-entropy model) — NOT Shannon entropy. Wave history is sampled live, not
  synthesized with `Math.sin`. SERVICES metric reads `occupied / (81 × N arrays)`.
- **Stability:** geometries/textures are disposed on every rebuild (shared-geometry cache +
  tree disposal) — fixes a GPU-memory leak that crashed the tab over time.
- **Sliders:** the tube-size slider drives tube radius; the glow slider drives a master glow.

---

## 3. `.cargo/config.toml` (item B)

```toml
[patch."https://github.com/SigmaWolf-8/Ternary"]
ternary-math = { path = "C:/PlenumNET/ternary-math" }
```

Redirects the `ternary-math` git dependency to a **local** checkout so the build uses local
code. This path is Windows-specific. **On Replit, drop this file** (or repoint the path) and
build `ternary-math` from its git source as normal.

> Separate-repo note: resolving the build also required fixing a **git merge conflict in
> `ternary-math/Cargo.toml`** (the `github.com/SigmaWolf-8/Ternary` repo, *not* this Yoda repo).
> Conflict markers were removed near line 64, keeping the `[[bench]] name="trit_benchmarks"`
> block. If that repo's `Cargo.toml` still has `<<<<<<<` / `=======` / `>>>>>>>` markers,
> resolve them the same way.

---

## 4. `migrations/20260608000001_complete_core_schema.sql` (item C)

**Why it exists:** the local `yoda` database was built only partway. Migration
`20260319000002_core_tables.sql` applied its **first 5 tables** (`projects`, `tasks`,
`task_results`, `task_reviews`, `task_bible_entries`) and **stopped before** `knowledge_base`,
`engine_configs`, `audit_log`, `project_keys`, `github_configs`, `capability_scores`.
Migration 003 (indexes) never ran. There is **no `_sqlx_migrations` tracking table**.
Net effect at runtime: every query against `engine_configs` failed → **"AI agents are offline / 0 agents."**

**What the new migration does:** idempotently creates the 5 missing non-vector tables, their
indexes and `updated_at` triggers, then folds in the 7 follow-on migrations. Every statement
uses `IF NOT EXISTS` / `DROP … IF EXISTS`, so it is a no-op on a clean DB and corrective on a
partial one.

**Deferred:** `knowledge_base` is **not** created — it needs the **pgvector** extension
(`vector(1536)`), which is **not installed and not available** on the local Postgres. Install
pgvector first, then apply `knowledge_base` from `core_tables.sql`.

**State:** this file was **NOT executed** against any database. No schema was changed locally.

---

## 5. Pre-existing bugs to fix on Replit (root causes, not local edits)

1. **New Project button does nothing.** (You're already on this.)
2. **Migrations never run.** `crates/yoda-api/src/main.rs` only opens a `PgPoolOptions`
   connection pool — there is **no `sqlx::migrate!(...).run(&db)`** anywhere. So a fresh DB is
   never migrated; `engine_configs` and the later tables simply never get created. **Fix:** run
   `sqlx::migrate!("./migrations").run(&db).await?` at startup (after baselining any
   already-built DB), or run migrations as a deploy step. This is the true root cause of the
   "agents offline" symptom — item C above is only a manual patch for one already-broken DB.
3. **Monitor iframe points at the stale file** — see §2.

---

## 6. Explicitly NOT changed locally (don't look for phantom edits)
- The `yoda` **database** — no migration applied; only read-only queries were run.
- `frontend/src/pages/MonitoringPage.tsx` — untouched (the `src="/array3-monitor.html"` is original).
- Any Rust crate source under `crates/`.
- The Windows installer panel (`installer-panel.html`, separate project) — last modified 2026-05-11, untouched.
