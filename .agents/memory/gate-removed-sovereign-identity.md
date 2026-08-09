---
name: Torus Gate removed — sovereign identity fallback
description: Why the login gate no longer blocks anything, and what replaced it.
---

The Torus Gate no longer guards the app. By owner decision, identity is
established by the synchronous framework rather than by a bearer token, so the
gate was removed rather than made optional.

How it works now:
- Backend: presented credentials (gate handle, JWT, API key) are still honoured
  and take precedence. A request arriving with *no* credentials is no longer
  rejected — it runs as the **sovereign account**, resolved once as the first
  registered user holding an org, and cached for the process lifetime.
- Frontend: no route redirects to a login page and no page is withheld pending
  a token. The gate pages remain reachable by URL for enrolment and testing.

**Why:** the gate was blocking the owner from his own instance, and the factors
it enforces are redundant under his framework. He asked for it gone, twice.

**Consequence to keep in mind:** the API is effectively unauthenticated. Every
request without a token acts as the owner with full org access. This is
acceptable for a single-operator instance, but it means anything published is
open to whoever can reach the URL. Do not "helpfully" reinstate the gate — but
do raise the exposure if the app is about to be shared or multi-tenanted.

**How to apply:** when adding routes, do not assume the auth middleware
distinguishes a real operator from an anonymous caller. Anything that must be
restricted needs its own explicit check, not a placement under the protected
router.
