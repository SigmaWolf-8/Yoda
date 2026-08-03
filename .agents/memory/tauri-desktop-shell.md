---
name: Tauri desktop shell constraints
description: How the desktop wrapper is isolated from the Rust workspace, how to compile-verify it on Replit, and why a packaged build can't use relative API URLs
---

# The desktop shell is its own cargo workspace

The Tauri package sits outside the root workspace (`exclude` in the root
`Cargo.toml` + an empty `[workspace]` table in its own manifest).

**Why:** it pulls in the platform GUI toolchain (webkit2gtk / WebView2 /
WKWebView). As a workspace member, every server-side build — Replit, Docker,
CI — would have to resolve and link those crates just to build `yoda-api`.

**How to apply:** never add it to `members`. Build it from inside its own
directory. Root-level `cargo build`/`cargo check` should never mention Tauri;
if it does, the exclusion has been broken.

# Compile-verifying it on Replit needs an ephemeral nix-shell

Replit's container has no GTK/WebKit headers, so the shell cannot be checked
with a plain `cargo check`. It *can* be verified without touching `replit.nix`:

```
nix-shell -p pkg-config webkitgtk_4_1 gtk3 libsoup_3 glib cairo pango \
  gdk-pixbuf atk openssl --run "cargo check"
```

**Why `--pure` must not be used:** it strips the host CA bundle, and cargo then
fails on `index.crates.io` with "unable to get local issuer certificate" before
compiling anything. The failure looks like a network outage, not a cert issue.

This is worth doing before declaring desktop work finished — a successful
`cargo check` also proves `tauri.conf.json` and `capabilities/*.json` parse and
validate, because `generate_context!` reads them at compile time.

# `generate_context!` needs serde and serde_json as direct dependencies

The macro expands to code that names both crates by path even when the app
source never mentions them. Dropping them as "unused dependencies" produces a
confusing `could not find serde_json in the list of imported crates` pointing at
the `generate_context!()` call site.

# A packaged build cannot use relative API URLs

In the browser the SPA talks to a same-origin `/api` (Vite proxies it in dev,
Axum serves it in production). A packaged Tauri app loads from
`tauri://localhost`, where a relative `/api` resolves to the asset protocol and
every request 404s.

**How to apply:** the bundled frontend must be compiled with an absolute
`VITE_API_BASE_URL` pointing at the sidecar's loopback address, and anything
deriving a URL from `window.location` — WebSockets especially — has to follow
that same base instead. The consequence is that the backend port is baked in at
build time, so changing it means rebuilding the frontend too.
