#!/usr/bin/env node
/**
 * build-sidecar.mjs — prepare the payload the Tauri bundler expects.
 *
 *   1. Compile the `yoda-api` binary.
 *   2. Copy it to `tauri/binaries/yoda-api-<target-triple>` — the naming
 *      convention Tauri requires for a `bundle.externalBin` entry.
 *   3. Compile the agent roster (if missing) and stage it, plus
 *      `model_lineages.json`, under `tauri/resources/`.
 *
 * Node rather than bash: this runs from `tauri.conf.json` hooks on macOS,
 * Linux *and* Windows, where bash is not a given.
 *
 * Usage:
 *   node scripts/build-sidecar.mjs [--release] [--agents]
 *
 * Flags:
 *   --release  Build the backend with optimisations (used by `tauri build`).
 *   --agents   Force recompilation of the agent roster even if it exists.
 *
 * Copyright (c) 2026 Capomastro Holdings Ltd. — Applied Physics Division
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAURI_DIR = join(REPO_ROOT, 'tauri');
const BINARIES_DIR = join(TAURI_DIR, 'binaries');
const RESOURCES_DIR = join(TAURI_DIR, 'resources');

const args = process.argv.slice(2);
const release = args.includes('--release');
const forceAgents = args.includes('--agents');

const log = (msg) => console.log(`[build-sidecar] ${msg}`);

function run(cmd, cmdArgs, opts = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (result.error) {
    fail(`could not run \`${cmd}\`: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`\`${cmd} ${cmdArgs.join(' ')}\` exited with code ${result.status}`);
  }
}

function fail(msg) {
  console.error(`\n[build-sidecar] ERROR: ${msg}\n`);
  process.exit(1);
}

/** Host triple, e.g. `x86_64-unknown-linux-gnu`. Tauri matches the suffix exactly. */
function hostTriple() {
  const out = spawnSync('rustc', ['-vV'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (out.status !== 0) {
    fail('`rustc -vV` failed — is the Rust toolchain installed and on PATH?');
  }
  const match = /^host:\s*(\S+)$/m.exec(out.stdout);
  if (!match) fail('could not read the host target triple from `rustc -vV`');
  return match[1];
}

// ── 1. Agent roster ──────────────────────────────────────────────────
const compiledAgents = join(REPO_ROOT, 'agents', 'compiled');
const hasAgents =
  existsSync(compiledAgents) &&
  readdirSync(compiledAgents).some((f) => f.endsWith('.json'));

if (!hasAgents || forceAgents) {
  log('compiling agent roster...');
  run('cargo', [
    'run',
    '--release',
    '--manifest-path',
    join('tools', 'yoda-agent-compiler', 'Cargo.toml'),
    '--',
    '--upstream',
    join('agents', 'upstream'),
    '--custom',
    join('agents', 'capomastro'),
    '--output',
    join('agents', 'compiled'),
  ]);
} else {
  log('agent roster present — skipping (pass --agents to force)');
}

// ── 2. Backend binary ────────────────────────────────────────────────
log(`building yoda-api (${release ? 'release' : 'debug'})...`);
run('cargo', ['build', '--bin', 'yoda-api', ...(release ? ['--release'] : [])]);

const exeSuffix = process.platform === 'win32' ? '.exe' : '';
const built = join(REPO_ROOT, 'target', release ? 'release' : 'debug', `yoda-api${exeSuffix}`);
if (!existsSync(built)) {
  fail(`expected the compiled backend at ${built}, but it is not there`);
}

const triple = hostTriple();
const sidecar = join(BINARIES_DIR, `yoda-api-${triple}${exeSuffix}`);
mkdirSync(BINARIES_DIR, { recursive: true });
rmSync(sidecar, { force: true });
cpSync(built, sidecar);
log(`sidecar staged → tauri/binaries/yoda-api-${triple}${exeSuffix}`);

// ── 3. Bundled resources ─────────────────────────────────────────────
// Staged inside tauri/ because bundler resource paths are resolved relative to
// tauri.conf.json; copying here keeps the bundle self-contained.
rmSync(RESOURCES_DIR, { recursive: true, force: true });
mkdirSync(join(RESOURCES_DIR, 'agents'), { recursive: true });
cpSync(compiledAgents, join(RESOURCES_DIR, 'agents', 'compiled'), { recursive: true });

const lineages = join(REPO_ROOT, 'model_lineages.json');
if (existsSync(lineages)) {
  cpSync(lineages, join(RESOURCES_DIR, 'model_lineages.json'));
} else {
  fail('model_lineages.json is missing from the repo root — the bundler needs it');
}
log('resources staged → tauri/resources/');
