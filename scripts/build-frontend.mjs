#!/usr/bin/env node
/**
 * build-frontend.mjs — frontend entry point for the Tauri hooks.
 *
 * Why this exists instead of `cd frontend && npm run ...` inline in
 * tauri.conf.json:
 *
 *   1. Working directory. Tauri resolves a hook's cwd itself; this script
 *      locates the repo from its own path, so it behaves the same however the
 *      CLI was invoked.
 *   2. API base URL. In the browser the SPA talks to a same-origin `/api`,
 *      proxied by Vite in dev and served by Axum in production. A packaged
 *      Tauri app loads from `tauri://localhost`, where `/api` resolves to the
 *      asset protocol and every request 404s. The bundled build therefore has
 *      to be compiled with an absolute base URL pointing at the sidecar.
 *
 * The port must match `BIND_PORT` in the sidecar's environment. Both default to
 * 3000; override with BIND_PORT here *and* in `.env.local` if you change it.
 *
 * Usage:
 *   node scripts/build-frontend.mjs          # production build (tauri build)
 *   node scripts/build-frontend.mjs --dev    # Vite dev server (tauri dev)
 *
 * Copyright (c) 2026 Capomastro Holdings Ltd. — Applied Physics Division
 */

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = join(REPO_ROOT, 'frontend');

const dev = process.argv.slice(2).includes('--dev');
const port = process.env.BIND_PORT || '3000';

// Dev needs no override: Vite proxies /api to the backend, so the SPA's
// same-origin default is already correct and hot reload keeps working.
const env = { ...process.env };
if (!dev) {
  env.VITE_API_BASE_URL = process.env.VITE_API_BASE_URL || `http://127.0.0.1:${port}/api`;
  console.log(`[build-frontend] VITE_API_BASE_URL=${env.VITE_API_BASE_URL}`);
}

const result = spawnSync('npm', ['run', dev ? 'dev' : 'build'], {
  cwd: FRONTEND,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});

if (result.error) {
  console.error(`[build-frontend] ERROR: could not run npm: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
