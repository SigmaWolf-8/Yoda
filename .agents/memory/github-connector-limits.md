---
name: GitHub connector token limits
description: What the Replit GitHub connector token can and cannot do against a repo, and the workarounds — needed before planning any CI-fixing or push work.
---

# GitHub connector: what it can and cannot do

The connector token carries `repo` scope and full admin/push permissions, so it
can read anything and write ordinary files through the git data API. Two things
it cannot do, both of which look like unrelated failures:

## Cannot write `.github/workflows/**`

Any tree containing a workflow path fails with a bare **404 "Not Found"** from
`POST /git/trees` — not a 403, and no mention of scopes. The same tree with the
workflow file removed succeeds.

**Why:** the token is an OAuth credential without the `workflow` scope, and
GitHub answers 404 rather than leaking whether the path exists.

**How to apply:** when a fix spans workflow files and normal source, split it —
push the source, and hand the workflow diff to the user to apply (or ask for a
PAT with `workflow` scope). To confirm the cause quickly, POST two trees with
one throwaway blob: one at a normal path, one at `.github/workflows/<file>`. If
the first succeeds and the second 404s, it is the scope, not the payload.

## Cannot read Actions run/job logs

`/actions/jobs/<id>/logs` returns **403 Forbidden** through `proxyFetch`, with
no redirect to follow. Run and job *metadata* (conclusions, step names, which
step failed) all read fine — that metadata is usually enough to locate the
failure, and reproducing the step locally beats hunting for the log.

Check-run annotations are accessible through the job's `check_run_url`, even
when log downloads are forbidden. They can include the exact TypeScript errors.
Actions workflow enablement also works through the connector; lack of workflow
file-write permission does not mean all Actions operations are forbidden.

**Why:** stale failing badges can coexist with a workflow disabled for inactivity;
an upstream repair is not validated merely by writing a source patch.

**How to apply:** inspect workflow state and check annotations before reproducing
a whole build or treating a token restriction as universal.

## Gotcha unrelated to scopes

`POST /git/trees` also 404s when `base_tree` is given a **commit** SHA. It wants
the commit's `tree.sha`. The error is identical to the permission one, so check
this first before concluding anything about scopes.
