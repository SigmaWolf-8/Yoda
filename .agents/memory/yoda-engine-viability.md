---
name: What makes a YODA query answerable
description: Where model credentials actually live, which paths can serve a query, and the status signal that lied about it.
---

# What makes a YODA query answerable

## Two paths, either one is enough

A submitted query reaches a model in one of two ways:

- **Cloud** — an engine slot with hosting mode `commercial`/`free_tier`, health `online`,
  not disabled. Called directly by the server.
- **Relay** — an enabled `self_hosted` slot dispatched over the PlenumLAN relay to a live
  cube peer (or a CRS registration that heartbeated within five minutes).

A self-hosted slot pointing at `localhost` is **never** reachable by the server itself.
The relay, not the endpoint, decides whether that slot can be used — so judging it by
whether the address responds is always wrong.

## Credentials live in the database, not the environment

Per-slot provider keys are stored encrypted in `engine_configs` and entered through
Settings → Engines. Environment variables do **not** feed the engines. Asking the owner
for an API-key secret is therefore the wrong move; the key belongs in the app's own field.

The separate `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `TOGETHER_API_KEY` trio builds a
cloud gateway that is read by one health endpoint and nothing else.

**Why this matters:** the dashboard's critical "AI agents are offline" banner was keyed to
that unused gateway. Setting all three keys would have cleared the banner and answered
zero queries, while the actual blocker — a rejected provider key on the one usable slot —
was never mentioned. When a status signal names a cause, verify the named thing is on the
path it claims to gate.

## Probe semantics

A credentialed probe treats `401/403` as **`suspect`**, not `offline`: the endpoint is up,
the key is bad. Only `5xx` or a connection failure is `offline`. Query selection requires
`online`, so a `suspect` slot is correctly skipped — but any UI reading "reachable" alone
will show a dead engine as healthy.

## Autonomous execution scope

Autonomy means executing existing approved queued work for an organization that
has explicitly enabled it. It does not authorize inventing recurring goals,
activating other organizations, or silently reducing independent review coverage
to fit whichever engines happen to be available.

**Why:** A roster and a polling heartbeat do not establish that inference works.
Automatic activation across tenants could also trigger unrequested model charges.

**How to apply:** Keep control organization-scoped; report engine and review
blockers truthfully. Prove real model execution separately from worker liveness.
