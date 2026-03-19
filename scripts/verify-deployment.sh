#!/usr/bin/env bash
# YODA — End-to-End Deployment Verification
#
# B7.7: Runs after deployment to verify the complete stack is operational.
# Tests: health → register → login → create project → submit query →
#        list tasks → check KB → check engines → export audit
#
# Usage: ./scripts/verify-deployment.sh [BASE_URL]
# Default BASE_URL: http://localhost:3000

set -euo pipefail

BASE="${1:-http://localhost:3000}"
PASS=0
FAIL=0
EMAIL="verify_$(date +%s)@test.com"
PASSWORD="VerifyTest123!"

pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ $1: $2"; FAIL=$((FAIL + 1)); }
check() {
    local name="$1" expected="$2" actual="$3"
    if echo "$actual" | grep -q "$expected"; then
        pass "$name"
    else
        fail "$name" "expected '$expected', got '$(echo "$actual" | head -c 100)'"
    fi
}

echo "=== YODA Deployment Verification ==="
echo "Target: $BASE"
echo ""

# ── 1. Health Check ───────────────────────────────────────────────────
echo "1. Health Check"
HEALTH=$(curl -sf "$BASE/health" 2>/dev/null || echo "FAIL")
check "GET /health" '"status":"ok"' "$HEALTH"
check "Service name" '"service":"yoda-api"' "$HEALTH"

# ── 2. Register ───────────────────────────────────────────────────────
echo "2. Registration"
REG=$(curl -sf -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Verify User\"}" \
    2>/dev/null || echo "FAIL")
check "POST /api/auth/register" '"token"' "$REG"
TOKEN=$(echo "$REG" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
REFRESH=$(echo "$REG" | grep -o '"refresh_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
    echo "  ✗ Cannot continue without auth token. Aborting."
    echo ""
    echo "Results: $PASS passed, $FAIL failed"
    exit 1
fi

AUTH="Authorization: Bearer $TOKEN"

# ── 3. Login ──────────────────────────────────────────────────────────
echo "3. Login"
LOGIN=$(curl -sf -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
    2>/dev/null || echo "FAIL")
check "POST /api/auth/login" '"token"' "$LOGIN"

# ── 4. Token Refresh ──────────────────────────────────────────────────
echo "4. Token Refresh"
if [ -n "$REFRESH" ]; then
    REFRESHED=$(curl -sf -X POST "$BASE/api/auth/refresh" \
        -H "Content-Type: application/json" \
        -d "{\"refresh_token\":\"$REFRESH\"}" \
        2>/dev/null || echo "FAIL")
    check "POST /api/auth/refresh" '"token"' "$REFRESHED"
    # Use new token
    NEW_TOKEN=$(echo "$REFRESHED" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
    [ -n "$NEW_TOKEN" ] && AUTH="Authorization: Bearer $NEW_TOKEN"
else
    fail "Token refresh" "No refresh token from registration"
fi

# ── 5. List Organizations ─────────────────────────────────────────────
echo "5. Organizations"
ORGS=$(curl -sf "$BASE/api/orgs" -H "$AUTH" 2>/dev/null || echo "FAIL")
check "GET /api/orgs" '"name"' "$ORGS"

# ── 6. Create Project ────────────────────────────────────────────────
echo "6. Project CRUD"
PROJECT=$(curl -sf -X POST "$BASE/api/projects" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"name":"Verify Project","mode":"ronin"}' \
    2>/dev/null || echo "FAIL")
check "POST /api/projects" '"id"' "$PROJECT"
PROJECT_ID=$(echo "$PROJECT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

PROJECTS=$(curl -sf "$BASE/api/projects" -H "$AUTH" 2>/dev/null || echo "FAIL")
check "GET /api/projects" '"Verify Project"' "$PROJECTS"

if [ -n "$PROJECT_ID" ]; then
    PROJ_GET=$(curl -sf "$BASE/api/projects/$PROJECT_ID" -H "$AUTH" 2>/dev/null || echo "FAIL")
    check "GET /api/projects/:id" '"ronin"' "$PROJ_GET"
fi

# ── 7. Submit Query ───────────────────────────────────────────────────
echo "7. Query Submission"
if [ -n "$PROJECT_ID" ]; then
    QUERY=$(curl -sf -X POST "$BASE/api/projects/$PROJECT_ID/query" \
        -H "$AUTH" -H "Content-Type: application/json" \
        -d '{"text":"Build a health check endpoint in Rust"}' \
        2>/dev/null || echo "FAIL")
    # Should return either a decomposition or a task_id
    if echo "$QUERY" | grep -q '"task_id"\|"decomposition"'; then
        pass "POST /api/projects/:id/query"
    else
        fail "POST /api/projects/:id/query" "No task_id or decomposition: $(echo "$QUERY" | head -c 100)"
    fi
fi

# ── 8. List Tasks ─────────────────────────────────────────────────────
echo "8. Tasks"
if [ -n "$PROJECT_ID" ]; then
    TASKS=$(curl -sf "$BASE/api/projects/$PROJECT_ID/tasks" -H "$AUTH" 2>/dev/null || echo "FAIL")
    check "GET /api/projects/:id/tasks" '[' "$TASKS"
fi

# ── 9. Engine Configuration ──────────────────────────────────────────
echo "9. Engine Configuration"
ENGINES=$(curl -sf "$BASE/api/settings/engines" -H "$AUTH" 2>/dev/null || echo "FAIL")
check "GET /api/settings/engines" '[' "$ENGINES"

# ── 10. Model Lineages ───────────────────────────────────────────────
echo "10. Model Lineages"
LINEAGES=$(curl -sf "$BASE/api/lineages" 2>/dev/null || echo "FAIL")
check "GET /api/lineages (public)" '"qwen"' "$LINEAGES"
check "Lineage families" '"deepseek"' "$LINEAGES"

# ── 11. Knowledge Base ────────────────────────────────────────────────
echo "11. Knowledge Base"
if [ -n "$PROJECT_ID" ]; then
    KB=$(curl -sf "$BASE/api/projects/$PROJECT_ID/kb" -H "$AUTH" 2>/dev/null || echo "FAIL")
    check "GET /api/projects/:id/kb" '"results"' "$KB"
fi

# ── 12. Project Settings ─────────────────────────────────────────────
echo "12. Settings"
if [ -n "$PROJECT_ID" ]; then
    SETTINGS=$(curl -sf "$BASE/api/settings/project/$PROJECT_ID" -H "$AUTH" 2>/dev/null || echo "FAIL")
    check "GET /api/settings/project/:id" '"review_intensity"' "$SETTINGS"
fi

# ── 13. GitHub PAT (not configured = expected) ───────────────────────
echo "13. GitHub PAT"
GH=$(curl -sf "$BASE/api/settings/github-pat" -H "$AUTH" 2>/dev/null || echo "FAIL")
check "GET /api/settings/github-pat" '"configured"' "$GH"

# ── 14. API Keys ──────────────────────────────────────────────────────
echo "14. API Keys"
KEY=$(curl -sf -X POST "$BASE/api/keys" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"name":"Verify Key"}' \
    2>/dev/null || echo "FAIL")
check "POST /api/keys" '"key"' "$KEY"

KEYS=$(curl -sf "$BASE/api/keys" -H "$AUTH" 2>/dev/null || echo "FAIL")
check "GET /api/keys" '"Verify Key"' "$KEYS"

# ── 15. Cleanup ───────────────────────────────────────────────────────
echo "15. Cleanup"
if [ -n "$PROJECT_ID" ]; then
    DEL=$(curl -sf -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/projects/$PROJECT_ID" -H "$AUTH" 2>/dev/null || echo "000")
    if [ "$DEL" = "204" ]; then
        pass "DELETE /api/projects/:id"
    else
        fail "DELETE /api/projects/:id" "HTTP $DEL"
    fi
fi

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "⚠ Some checks failed. Review the output above."
    exit 1
else
    echo ""
    echo "✓ All checks passed. YODA is operational."
    exit 0
fi
