// pipeline.js — programmatic build and task execution.
//
// This package intentionally has no npm "scripts" block. Every task is invoked
// as `node pipeline.js <action>` so the task graph is readable code rather than
// a JSON string soup, and so the same entry point works from CI, from a shell,
// and from another script.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
// Where the built bundle is published for the app to serve.
const PUBLISH_DIR = path.resolve(ROOT, '..', '..', 'frontend', 'public', 'vendor', 'katex-render');

const run = (cmd) => {
  console.log(`\n[PIPELINE] ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT });
};

// Typecheck against the package tsconfig.
const TSC = 'npx tsc --noEmit -p .';

const assertArtifacts = () => {
  const required = [
    path.join(DIST, 'katex-render.min.js'),
    path.join(DIST, 'katex-render.css'),
  ];
  const missing = required.filter((f) => !fs.existsSync(f));
  if (!fs.existsSync(path.join(DIST, 'fonts'))) missing.push(path.join(DIST, 'fonts'));

  if (missing.length > 0) {
    console.error('\n[PIPELINE] Build produced no usable bundle. Missing:');
    for (const m of missing) console.error(`  - ${path.relative(ROOT, m)}`);
    process.exit(1);
  }
  console.log('\n[PIPELINE] Artifacts verified:');
  for (const f of required) {
    console.log(`  - ${path.relative(ROOT, f)} (${fs.statSync(f).size} bytes)`);
  }
  const fonts = fs.readdirSync(path.join(DIST, 'fonts'));
  console.log(`  - dist/fonts (${fonts.length} files)`);
};

const publish = () => {
  assertArtifacts();
  fs.rmSync(PUBLISH_DIR, { recursive: true, force: true });
  fs.mkdirSync(PUBLISH_DIR, { recursive: true });
  fs.cpSync(DIST, PUBLISH_DIR, { recursive: true });
  console.log(`\n[PIPELINE] Published to ${path.relative(path.resolve(ROOT, '..', '..'), PUBLISH_DIR)}`);
  console.log('[PIPELINE] Reminder: the dev server serves frontend/dist, so run the');
  console.log('           frontend build (or restart the app) for this to be visible.');
};

const action = process.argv[2] || 'ci';

switch (action) {
  case 'install':
    run('bash setup.sh');
    break;
  case 'typecheck':
    run(TSC);
    break;
  case 'test':
    run('npx jest --runInBand');
    break;
  case 'test:coverage':
    run('npx jest --coverage --runInBand');
    break;
  case 'build':
    run('npx webpack --mode production');
    assertArtifacts();
    break;
  case 'publish':
    publish();
    break;
  case 'ci':
    run(TSC);
    run('npx jest --coverage --runInBand');
    run('npx webpack --mode production');
    assertArtifacts();
    break;
  case 'deploy':
    run(TSC);
    run('npx jest --runInBand');
    run('npx webpack --mode production');
    publish();
    break;
  default:
    console.error(`Unknown action: ${action}`);
    console.error('Actions: install | typecheck | test | test:coverage | build | publish | ci | deploy');
    process.exit(1);
}
