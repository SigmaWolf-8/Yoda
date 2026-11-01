---
name: What makes a YODA query answerable
description: Where model credentials actually live, which paths can serve a query, and the status signal that lied about it.
---

# What makes a YODA query answerable

## Transport reachability is not protocol readiness

A model call reaches an engine in one of two ways; a reviewed task still needs
every engine required by its project policy, not merely one reachable model:

- **Cloud** — an engine slot with hosting mode `commercial`/`free_tier`, health `online`,
  not disabled. Called directly by the server.
- **Relay** — an enabled `self_hosted` slot dispatched over the PlenumLAN relay to a live
  cube peer (or a CRS registration that heartbeated within five minutes).

A self-hosted slot pointing at `localhost` is **never** reachable by the server itself.
The relay, not the endpoint, decides whether that slot can be used — so judging it by
whether the address responds is always wrong.

## Credentials live in the database, not the environment

Per-slot provider keys are stored in the application database and entered through
Settings → Engines. Environment variables do **not** feed the engines. Asking the owner
for an API-key secret is therefore the wrong move; the key belongs in the app's own field.

Do not reintroduce a separate `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` /
`TOGETHER_API_KEY` gateway as a prerequisite for these engines.

**Why this matters:** the dashboard's critical "AI agents are offline" banner was keyed to
that unused gateway. Setting all three keys would have cleared the banner and answered
zero queries, while the actual blocker — a rejected provider key on the one usable slot —
was never mentioned. When a status signal names a cause, verify the named thing is on the
path it claims to gate.

## Freshness and autonomous queues

Refresh generation evidence on demand for actual queued work, with bounded
per-slot requests and failure backoff. Do not spend provider tokens on an idle
queue or dispatch local probes before the relay is armed.

**Why:** short-lived generation certification otherwise strands enabled workers
after proof expiry; probing during startup before relay authentication produces
false failures and delays legitimate work.

**How to apply:** keep freshness enforcement and autonomous re-verification
together; never solve expiry by treating old proof or a connection as success.

## Probe semantics

A credentialed probe treats `401/403` as **`suspect`**, not `offline`: the endpoint is up,
the key is bad. Only `5xx` or a connection failure is `offline`. Query selection requires
`online`, so a `suspect` slot is correctly skipped — but any UI reading "reachable" alone
will show a dead engine as healthy.

## Autonomous execution scope

Forge, Kyokushin, and native agent queries must operate together as interfaces
to one execution system, not independent engine configurations. The user
requires WYSIWYG: displayed execution and verification claims must correspond
to actual work and inspectable evidence.

**Why:** The user explicitly rejected the disconnect between these interfaces
and requested reliable engine-operability certification across all UI surfaces.

**How to apply:** Distinguish transport connection, successful nonempty model
generation, independent model identity, and mathematical correctness. Never
substitute an AI explanation or a hard-coded pass for an executed formula test.
Treat generation evidence as time-limited and invalidate it on configuration
changes. Relay registration order is not engine-slot identity; confirm routing
against advertised gateways and the responding peer.

Generation verification must run independently of the initiating HTTP request,
with persisted pending/final evidence and an interrupted-state deadline.

**Why:** A synchronous verification request returned a preview-gateway error
without retaining any result. A browser or proxy disconnect must not erase
evidence or be reported as proof that a model failed.

**How to apply:** Acknowledge the run promptly, poll its persisted record, and
never treat the acknowledgement as a passed test.

Keep the mixed setup: A and B local, C on xAI.
**Why:** The user explicitly chose to keep the mixed engine setup.
**How to apply:** Repair transports and credentials without replacing those
engine choices or silently lowering review intensity.

Autonomy means executing existing approved queued work for an organization that
has explicitly enabled it. It does not authorize inventing recurring goals,
activating other organizations, or silently reducing independent review coverage
to fit whichever engines happen to be available.

**Why:** A roster and a polling heartbeat do not establish that inference works.
Automatic activation across tenants could also trigger unrequested model charges.

**How to apply:** Keep control organization-scoped; report engine and review
blockers truthfully. Prove real model execution separately from worker liveness.

## Upstream relay compatibility

The deployed CRS expects a server-first challenge, followed by an `auth` frame
with a genuine TL-DSA-87 signature over the exact UTF-8 string
`nonce||address||publicKey`. A separate `challenge_response` frame is not supported.
Its service-identity derivation can return legacy identifiers containing zero.
Keep those wire identifiers opaque; never silently translate them to Rep C.

**Why:** Enforcing the daemon's Rep C digit constraint on the CRS-assigned
service identifier rejected an otherwise valid signed handshake. The client's
service identity must remain separate from the fixed Array3 daemon identities.

**How to apply:** Validate the signed binding and preserve its bytes. Peer events
may use hyphenated names and dotted addresses. Use authoritative upstream peer
lists and fresh, provenance-labelled slot reports, not this app's empty CRS cache.
