#!/usr/bin/env bash
# Nometria Hook: Security gate before deploy
# Runs AI security scan before production deploys. Blocks if score < 70.
#
# Install as a Claude Code PreToolUse hook matching the /deploy skill.
# See: https://docs.nometria.com/cli/slash-commands

set -euo pipefail

# Only trigger on deploy-related tool calls
TOOL_NAME="${CLAUDE_TOOL_NAME:-}"
TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"

# Check if this is a deploy action (skill invocation or curl to deployToAws/resyncHosting)
IS_DEPLOY=false
if [ "$TOOL_NAME" = "Skill" ] && echo "$TOOL_INPUT" | grep -q '"deploy"'; then
  IS_DEPLOY=true
fi
if [ "$TOOL_NAME" = "Bash" ] && echo "$TOOL_INPUT" | grep -qE "deployToAws|resyncHosting|nom deploy"; then
  IS_DEPLOY=true
fi

if [ "$IS_DEPLOY" != "true" ]; then
  exit 0
fi

# Check for nometria.json
if [ ! -f "nometria.json" ]; then
  exit 0
fi

APP_ID=$(grep -o '"app_id"[[:space:]]*:[[:space:]]*"[^"]*"' nometria.json 2>/dev/null | head -1 | cut -d'"' -f4)
MIGRATION_ID=$(grep -o '"migration_id"[[:space:]]*:[[:space:]]*"[^"]*"' nometria.json 2>/dev/null | head -1 | cut -d'"' -f4)

if [ -z "$APP_ID" ] || [ -z "$MIGRATION_ID" ]; then
  exit 0
fi

# Resolve API key
TOKEN="${NOMETRIA_API_KEY:-${NOMETRIA_TOKEN:-}}"
if [ -z "$TOKEN" ] && [ -f .env ]; then
  TOKEN=$(grep -s 'NOMETRIA_API_KEY\|NOMETRIA_TOKEN' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d ' "'"'"'')
fi
if [ -z "$TOKEN" ] && [ -f "$HOME/.nometria/credentials.json" ]; then
  TOKEN=$(grep -o '"api_key"[[:space:]]*:[[:space:]]*"[^"]*"' "$HOME/.nometria/credentials.json" 2>/dev/null | head -1 | cut -d'"' -f4)
fi

if [ -z "$TOKEN" ]; then
  echo "Nometria security gate: no API token found, skipping scan."
  exit 0
fi

# Run security scan
echo "Nometria: running security scan before deploy..."
SCAN_RESULT=$(curl -sf -X POST https://app.nometria.com/runAiScan \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\", \"migration_id\": \"$MIGRATION_ID\"}" 2>/dev/null || echo '{}')

SCORE=$(echo "$SCAN_RESULT" | grep -o '"securityScore"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*$')

if [ -n "$SCORE" ] && [ "$SCORE" -lt 70 ]; then
  echo ""
  echo "BLOCKED: Security score is $SCORE/100 (minimum: 70)"
  echo ""
  echo "Fix the issues below before deploying to production:"
  echo "$SCAN_RESULT" | grep -o '"title":"[^"]*"' | cut -d'"' -f4 | while read -r issue; do
    echo "  - $issue"
  done
  echo ""
  echo "Run 'nom scan' for full details, or deploy a preview with '/preview' to test."
  exit 2
fi

if [ -n "$SCORE" ]; then
  echo "Nometria: security score $SCORE/100 — passed. Proceeding with deploy."
fi
