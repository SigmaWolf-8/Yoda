#!/usr/bin/env bash
# Sync upstream agency-agents repository.
#
# Pulls new agents and improvements from the original MIT-licensed repo
# while preserving Capomastro modifications.
#
# Usage: ./scripts/sync-upstream.sh

set -euo pipefail

UPSTREAM_REMOTE="upstream"
UPSTREAM_URL="https://github.com/msitarzewski/agency-agents.git"

echo "=== YODA Agent Sync ==="

# Add upstream remote if not present
if ! git remote get-url "$UPSTREAM_REMOTE" &>/dev/null; then
    echo "Adding upstream remote: $UPSTREAM_URL"
    git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
fi

# Fetch upstream
echo "Fetching upstream..."
git fetch "$UPSTREAM_REMOTE"

# Merge (no auto-commit — review changes first)
echo "Merging upstream/main (no auto-commit)..."
git merge "$UPSTREAM_REMOTE/main" --no-commit --no-ff || true

echo ""
echo "Review the merged changes, then:"
echo "  git commit -m 'Sync upstream agency-agents — $(date +%Y-%m-%d)'"
echo ""
echo "Then recompile agents:"
echo "  ./scripts/compile-agents.sh"
