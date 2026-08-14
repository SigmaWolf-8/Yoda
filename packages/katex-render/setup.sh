#!/usr/bin/env bash
# setup.sh — dependency installation for the portable KaTeX render bundle.
#
# Deliberately shell-driven: this package carries no npm "scripts" block. Task
# execution lives in pipeline.js, so the only thing package.json is used for is
# recording installed dependencies (npm needs somewhere to write them).
#
# Run from packages/katex-render:
#   bash setup.sh

set -euo pipefail

cd "$(dirname "$0")"

# A committed lockfile means the install is reproducible — CI must get the same
# bytes this package was built and tested against, or the artifact check is
# checking nothing.
if [ -f package-lock.json ] && [ -f package.json ]; then
  echo "package-lock.json found — installing exactly what it pins."
  npm ci --no-fund --no-audit
  echo
  echo "Dependencies installed from the lockfile. Next:"
  echo "  node pipeline.js ci        # typecheck + tests + production bundle"
  echo "  node pipeline.js deploy    # copy the bundle into frontend/public"
  exit 0
fi

# First run only: npm needs a manifest to install into; it is generated, not
# hand-maintained. The resulting package.json and package-lock.json are
# committed, after which the branch above takes over.
if [ ! -f package.json ]; then
  npm init -y > /dev/null 2>&1
fi

npm install --no-fund --no-audit \
  katex@0.16.11 \
  dompurify@3.1.6

npm install --no-fund --no-audit --save-dev \
  webpack@5.93.0 \
  webpack-cli@5.1.4 \
  typescript@5.5.4 \
  ts-loader@9.5.1 \
  css-loader@7.1.2 \
  mini-css-extract-plugin@2.9.0 \
  terser-webpack-plugin@5.3.10 \
  jest@29.7.0 \
  jest-environment-jsdom@29.7.0 \
  ts-jest@29.2.5 \
  identity-obj-proxy@3.0.0 \
  @types/dompurify@3.0.5 \
  @types/katex@0.16.7 \
  @types/jest@29.5.12 \
  @types/node@20.14.10

echo
echo "Dependencies installed. Next:"
echo "  node pipeline.js ci        # typecheck + tests + production bundle"
echo "  node pipeline.js deploy    # copy the bundle into frontend/public"
