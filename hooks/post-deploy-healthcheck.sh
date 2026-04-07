#!/usr/bin/env bash
# Nometria Hook: Post-deploy health check with auto-rollback
# After a deploy completes, verifies the app is serving HTTP 200.
# If health check fails 3x, triggers rollback to previous deployment.
#
# Install as a Claude Code PostToolUse hook for Bash commands matching
# "nom deploy" or "resyncHosting".

set -euo pipefail

TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"
TOOL_NAME="${CLAUDE_TOOL_NAME:-}"

# Only trigger after deploy-related commands
IS_DEPLOY=false
[ "$TOOL_NAME" = "Bash" ] && echo "$TOOL_INPUT" | grep -qE "nom deploy|resyncHosting|deployToAws" && IS_DEPLOY=true
[ "$TOOL_NAME" = "Skill" ] && echo "$TOOL_INPUT" | grep -q '"deploy"' && IS_DEPLOY=true
[ "$IS_DEPLOY" != "true" ] && exit 0

# Check for nometria.json
[ ! -f "nometria.json" ] && exit 0

APP_ID=$(grep -o '"app_id"[[:space:]]*:[[:space:]]*"[^"]*"' nometria.json 2>/dev/null | head -1 | cut -d'"' -f4)
[ -z "$APP_ID" ] && exit 0

# Resolve API key
TOKEN="${NOMETRIA_API_KEY:-${NOMETRIA_TOKEN:-}}"
[ -z "$TOKEN" ] && [ -f .env ] && TOKEN=$(grep -s 'NOMETRIA_API_KEY\|NOMETRIA_TOKEN' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d ' "'"'"'')
[ -z "$TOKEN" ] && [ -f "$HOME/.nometria/credentials.json" ] && TOKEN=$(grep -o '"api_key"[[:space:]]*:[[:space:]]*"[^"]*"' "$HOME/.nometria/credentials.json" 2>/dev/null | head -1 | cut -d'"' -f4)
[ -z "$TOKEN" ] && exit 0

# Get deploy URL
STATUS=$(curl -sf -X POST https://app.nometria.com/checkAwsStatus \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\"}" 2>/dev/null || echo '{}')

DEPLOY_URL=$(echo "$STATUS" | grep -o '"deployUrl"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
[ -z "$DEPLOY_URL" ] && DEPLOY_URL="https://${APP_ID}.ownmy.app"

# Wait a moment for deploy to propagate
sleep 5

# Health check: 3 attempts, 10s apart
echo "Nometria: running post-deploy health check on $DEPLOY_URL..."
HEALTHY=false
for i in 1 2 3; do
  HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "$DEPLOY_URL" 2>/dev/null || echo "000")
  if echo "$HTTP_CODE" | grep -q "^[23]"; then
    echo "Nometria: health check passed (HTTP $HTTP_CODE)"
    HEALTHY=true
    break
  fi
  echo "Nometria: health check attempt $i/3 failed (HTTP $HTTP_CODE)"
  [ "$i" -lt 3 ] && sleep 10
done

if [ "$HEALTHY" = "true" ]; then
  exit 0
fi

# Health check failed — attempt auto-rollback
echo ""
echo "WARNING: Health check failed after 3 attempts."
echo "Attempting auto-rollback to previous deployment..."

ROLLBACK_RESULT=$(curl -sf -X POST "https://app.nometria.com/v1/deployments/previous/rollback" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\"}" 2>/dev/null || echo '{"error": "rollback API unavailable"}')

if echo "$ROLLBACK_RESULT" | grep -q '"error"'; then
  ERROR=$(echo "$ROLLBACK_RESULT" | grep -o '"error"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
  echo "Auto-rollback failed: $ERROR"
  echo "Manual rollback: nom rollback"
  echo "Dashboard: https://nometria.com/AppDetails?app_id=$APP_ID"
else
  echo "Auto-rollback complete. Previous deployment restored."
  echo "Check status: nom status"
fi
