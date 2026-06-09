---
name: sqlx migration checksum drift
description: Why "migration X was previously applied but has been modified" silently breaks new features, and how to recover.
---

# sqlx migration checksum drift

The workflow runs `sqlx migrate run --source migrations/` and on failure prints
`⚠ Migration failed or sqlx-cli not available. Continuing...` then keeps going.
This warning is NOT harmless: when an already-applied migration file's bytes
differ from the checksum stored in `_sqlx_migrations`, sqlx **aborts the entire
run** and applies **none** of the pending migrations. New columns silently never
land, so any handler querying them returns 500 and the matching page "crashes".

**Why:** a past edit to `migrations/20260321000001_engine_cube_endpoint.sql`
(after it was applied) blocked every later migration. The thread feature's
`pinned/archived/archived_at/deletion_scheduled_at` columns (added by
`20260522000002` + `20260524000001`) never applied, so `list_threads` 500'd and
the project workspace page failed to load.

**How to apply:**
1. Confirm with `SELECT version, success FROM _sqlx_migrations ORDER BY version;`
   — the DB will be stuck at the last good version.
2. Re-baseline the drifted migration's checksum (sqlx uses SHA-384 of the file
   bytes): compute `sha384` of the current file, then
   `UPDATE _sqlx_migrations SET checksum = decode('<hex>','hex') WHERE version=<v>;`
3. Re-run `sqlx migrate run --source migrations/` — pending migrations apply.
4. Restart the workflow and confirm the migration step logs no error.

**Do not** edit a migration file after it has been applied — add a new migration
instead. All migrations here are idempotent (`ADD COLUMN IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`), so re-baselining is safe.

Note: the `code_execution` `executeSql` callback and the app's `DATABASE_URL`
point at the same dev Postgres, so fixes applied via `executeSql`/`sqlx` are
seen by the running server.
