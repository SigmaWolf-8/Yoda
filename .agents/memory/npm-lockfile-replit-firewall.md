---
name: npm lockfiles written in the workspace break external CI
description: package-lock.json generated here pins an internal registry host that GitHub runners cannot resolve.
---

# npm lockfiles pin an internal registry

Every `package-lock.json` produced by `npm install` inside a Replit workspace
records `"resolved"` URLs pointing at `http://package-firewall.replit.local/npm/...`.

**Why:** the workspace installs through a local proxy registry, and npm writes
whatever host it actually fetched from into the lock.

**How to apply:** the lockfile works here and fails everywhere else — a GitHub
Actions runner cannot resolve that host, so `npm ci` dies at install with a DNS
error while the same command passes locally. Before committing a lockfile that
CI will consume, rewrite the host:

```bash
sed -i 's|http://package-firewall\.replit\.local/npm/|https://registry.npmjs.org/|g' package-lock.json
```

`integrity` hashes are content hashes, so they stay valid across the rewrite.
Check this whenever adding a JS package that has its own CI job — the failure
looks like a network flake, not a lockfile problem.
