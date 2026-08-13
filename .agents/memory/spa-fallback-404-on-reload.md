---
name: SPA fallback returns 404 on browser reload
description: Why client-side routes worked on first navigation but 404'd on refresh, and the two non-obvious tower-http behaviours behind it.
---

# SPA fallback and the reload-only 404

Symptom: every client-side route worked when reached by in-app navigation, and
every one of them except `/` returned a bare 404 when the user pressed refresh.
curl could not reproduce it, which made it look like a browser or proxy problem.
It was neither.

## Two behaviours combine to cause it

**1. `ServeDir` overwrites the status of whatever its `not_found_service`
returns with 404.** Returning `StatusCode::OK` from the fallback handler does
not survive; the response reaches the middleware stack as a 404 carrying the
correct body and content type. Any "SPA fallback returns 200" scheme therefore
depends on a response-layer fixup, and deleting that fixup as redundant breaks
every route in the app.

**2. `ServeFile` honours conditional requests.** A browser reload sends
`If-Modified-Since` (or `If-None-Match`) for the URL being reloaded. Used as a
`not_found_service`, `ServeFile` matches the condition against `index.html` and
produces a response with **no body and no `Content-Type`**. A fixup keyed on
`content-type: text/html` then does not fire, and the raw 404 reaches the
browser. First navigation sends no conditional header, so it works — which is
exactly what makes this look intermittent or environment-specific.

**Why:** both were found the slow way, including one wrong turn where the fixup
was removed as dead code and every route started 404ing again.

**How to apply:**
- Reproduce reload bugs with `curl -H "If-Modified-Since: <date>"`, not a plain
  `curl`. A plain GET will report 200 for a route that is broken on refresh.
- Serve the SPA shell from a plain handler that reads `index.html` and returns
  it whole. Do not use `ServeFile` for the fallback — the shell is tiny and must
  not be cached or conditionally skipped.
- Key the 404-to-200 fixup on a private marker header the shell handler sets and
  the middleware strips, not on the content type. Keying on "any HTML 404"
  launders genuine not-found responses into 200s.
- The fixup is load-bearing, not redundant. Anything that removes it must first
  prove a client-side route still returns 200.
