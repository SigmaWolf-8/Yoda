---
name: Frontend WebGL fallback
description: WebGL/three.js pages must never crash or gate critical UI; how to verify them in this env.
---

# Frontend WebGL must never blank the app

**Rule:** In any React page that creates a three.js `WebGLRenderer` (or raw WebGL
context), wrap the context/renderer creation in try/catch. On failure, set a state
flag and render a non-WebGL fallback (e.g. CSS rings). Never put login or other
critical UI *only* inside the WebGL path.

**Why:** An uncaught throw inside the effect (`THREE.WebGLRenderer: Error creating
WebGL context`) propagates to react-router's default error boundary and replaces the
ENTIRE page with "Unexpected Application Error" — the login form disappears too,
locking users out. Seen on the `/login` Torus Gate.

**How to apply:** try/catch the renderer creation, set the fail flag + early-return
*before* attaching listeners (so no leak), and conditionally render the CSS fallback.
Keep the auth form outside the WebGL branch.

## Verifying WebGL pages in this environment
- The e2e test browser (`runTest`/Playwright) and the `external_url` screenshot
  service (Firecrawl) both have **NO WebGL** → the 3D scene won't render there; a
  plain-black Firecrawl frame is NOT proof of a crash, just no JS/WebGL.
- Use `runTest` for real verification (it executes JS, exercises the CSS fallback +
  auth wiring). Accept EITHER the 3D canvas OR the fallback in assertions.
- `app_preview` screenshot fails here (no artifact registered). The real user
  preview (Chrome) has WebGL and shows the 3D scene.
