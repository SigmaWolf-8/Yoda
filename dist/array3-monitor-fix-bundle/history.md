# Chronological history — what was tried before, and why each was wrong

This is a candid record of every suggestion that came up in the planning session **before** the actual root cause was identified. Kept here so the next person debugging Array3 Monitor doesn't repeat them.

## 1. "Swap the model server URL from `localhost` to your public IP"

Suggested replacing `http://localhost:11125` with `http://24.65.67.91:11488` in the **model server** config.

**Why wrong:** The model server config has nothing to do with the Array3 Monitor page. The monitor talks to daemon ports `11488 / 11515 / 11906` directly via JS `fetch` from the browser. The model server is a separate process.

## 2. "Set up port forwarding / open firewall / change bind address"

A lecture about NAT traversal, port forwarding, opening Windows Firewall, and binding daemons to `0.0.0.0` instead of `127.0.0.1`.

**Why wrong:** The user confirmed the page is loaded **from the same machine** the daemons run on. There is no NAT involved in a same-host fetch. NAT traversal for genuinely remote users is already handled by the outbound WSS relay in `crates/yoda-api/src/cube_relay.rs`. None of those things needed to change.

## 3. "Add a Node Host field to the UI so the user can type the hostname"

Proposed adding a free-text "Daemon Host" input next to the Token / Ports fields so the user could enter `24.65.67.91`.

**Why wrong:** `window.location.hostname` already carries that exact value. The page was simply refusing to use it because of the hard-coded `localhost` / `127.0.0.1` comparison. Adding a UI field papers over the bug instead of fixing it.

## 4. "Rewrite the page to route everything through the relay"

A proposal to remove local-mode entirely and always go through `plenumnet.replit.app`.

**Why wrong:** The relay-mode path requires either a server-side cookie gate (only available when the page is served by the relay itself) or a bearer token the user does not have. Forcing remote routing for a local-same-host setup adds latency, a single point of failure, and a registration requirement (CRS) that has nothing to do with the user's actual problem.

## 5. "Just whitelist `/monitoring` in `_isServerHosted`"

Partially correct — adding `/monitoring` to the `_isServerHosted` path check fixes the case where the page is loaded from `plenumnet.replit.app/monitoring`. **But** it does nothing for the user's actual case (page served from `http://24.65.67.91:<port>/monitoring`, which is not on the relay origin at all). The primary bug was `useRelay = !_isLocal` forcing relay mode for every non-`localhost` hostname.

The shipped fix keeps the `_isServerHosted` whitelist edit (cleanup, removes a latent failure mode) **plus** the `useRelay` default flip (the actual fix).

## 6. "Ask the user three diagnostic questions and wait"

Three rounds of clarifying questions about daemons, firewalls, and ports — instead of testing the relay live.

**Why wrong:** A single `curl https://plenumnet.replit.app/api/salvi/inter-cube/relay/status` from the workspace returned 200 and confirmed the relay was healthy. A single `curl .../monitor/slots` returned 403 with the exact "server-hosted monitor only" hint. Both probes took seconds and pointed straight at the client-side host-detection bug. The questions weren't needed.

## 7. The actual fix (this bundle)

Final root cause, in one sentence: **`useRelay = !_isLocal` should default to `useRelay = _isOnRelayOrigin`.** Everything else (status-line host name, categorized failure messages, `/monitoring` whitelist) is supporting UX so the next failure mode names itself instead of hiding behind "check token/ports".
