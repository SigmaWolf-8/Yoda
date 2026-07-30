---
name: Torus Gate auth is opaque handles, never JWT
description: The /login gate must not issue JWTs or JSON; it mints an opaque server-side session handle. Why, and what to keep consistent.
---

# The Gate does not issue JWTs

The Torus Gate login flow (`/login`, `/api/gate/*`) authenticates with a
**32-byte opaque handle**, hex on the wire. Only the SHA-256 digest is stored
server-side; identity is re-read from that row on every request. The classic
`/api/auth/login` still issues JWTs — the two credential forms coexist and are
told apart by shape (a handle is exactly 64 hex chars; a JWT always has `.`).

**Why:** the owner's requirement for this flow is "JSON-free, `no_std` spirit,
painted to canvas, null borrow." A JWT is base64-encoded JSON carrying
client-readable claims that the server re-parses on every request — it violates
that requirement directly, no matter that it is conventional. This was gotten
wrong once by shipping JWT minting at the end of an otherwise JSON-free gate;
do not reintroduce it.

Secondary benefits that make the choice defensible on its own terms: a handle
can be revoked instantly (a JWT cannot), the client holds no readable claims,
and no part of the caller's identity is parsed out of attacker-supplied bytes.

**How to apply:**
- Anything touching the gate flow stays on the line wire (`key value` per line,
  `text/plain`) and fixed-size stack types. No `serde`, no JSON, no allocation
  on the hot path.
- There is deliberately **no refresh token** for gate sessions. Client code
  must tolerate a bearer credential with no refresh partner — the 401 path
  should clear and return to the gate, not try to renew.
- If the rest of the app is ever moved off JWTs, the handle path is the
  intended replacement; do not invent a third scheme.

**Owner communication note:** this owner is terse, uses blunt/abrasive
language, and specifies requirements in compressed jargon
("no_std", "null borrow", "painted to canvas"). Take the requirement
literally and check proposed designs against it before building — conventional
defaults (JWT, JSON, REST idioms) are frequently the wrong answer here.
