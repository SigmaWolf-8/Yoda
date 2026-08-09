---
name: Frontend apiClient base URL
description: The shared axios client already carries the /api prefix, and the SPA fallback hides the resulting 404.
---

The frontend's shared axios client is created with `baseURL = '/api'`. Call it
with the path **after** that prefix (`apiClient.get('/capomastro/revenue')`),
never with the full path (`'/api/capomastro/revenue'`).

**Why:** a doubled prefix produces `/api/api/...`, which no API route matches.
Instead of a 404, the request falls through to the SPA static fallback, which
answers `200 text/html` with `index.html`. Axios sees a successful 200 and
resolves, so the page receives an HTML *string* where it expected JSON. The
failure then surfaces far from its cause — typically a `TypeError: Cannot read
properties of undefined` inside a `useMemo` or render, which reads like a
component bug rather than a wrong URL.

**How to apply:** when a new page's data call "succeeds" but the component
crashes reading a nested field, check the request path for a doubled `/api`
before debugging the component. Verify endpoints with `curl -w '%{content_type}'`
— content-type, not status, is what distinguishes a real API response from the
SPA fallback.

Worth pairing with a shape guard on any fetched payload: validate the response
is an object with the fields you rely on, and raise a clear error if not, so a
half-started backend or a stale cache reports itself instead of throwing deep
in a render.
