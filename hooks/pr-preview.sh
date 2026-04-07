#!/usr/bin/env bash
# Nometria Hook: PR preview environments
# When a PR is created or a branch is pushed, auto-deploy a staging preview
# and output the preview URL.
#
# Install as a Claude Code PostToolUse hook for Bash commands matching
# "gh pr create" or "git push".

set -euo pipefail

TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"

# Only trigger on PR creation or branch push
IS_PR=false
echo "$TOOL_INPUT" | grep -q "gh pr create" && IS_PR=true
echo "$TOOL_INPUT" | grep -q "git push" && IS_PR=true
[ "$IS_PR" != "true" ] && exit 0

# Check for nometria.json
if [ ! -f "nometria.json" ]; then
  exit 0
fi

MIGRATION_ID=$(grep -o '"migration_id"[[:space:]]*:[[:space:]]*"[^"]*"' nometria.json 2>/dev/null | head -1 | cut -d'"' -f4)
[ -z "$MIGRATION_ID" ] && exit 0

# Resolve API key
TOKEN="${NOMETRIA_API_KEY:-${NOMETRIA_TOKEN:-}}"
[ -z "$TOKEN" ] && [ -f .env ] && TOKEN=$(grep -s 'NOMETRIA_API_KEY\|NOMETRIA_TOKEN' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d ' "'"'"'')
[ -z "$TOKEN" ] && [ -f "$HOME/.nometria/credentials.json" ] && TOKEN=$(grep -o '"api_key"[[:space:]]*:[[:space:]]*"[^"]*"' "$HOME/.nometria/credentials.json" 2>/dev/null | head -1 | cut -d'"' -f4)
[ -z "$TOKEN" ] && exit 0

echo "Nometria: deploying staging preview for PR..."

# Deploy staging preview
RESULT=$(curl -sf -X POST https://app.nometria.com/deployStagingPreview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"migration_id\": \"$MIGRATION_ID\", \"production\": false}" 2>/dev/null || echo '{}')

PREVIEW_URL=$(echo "$RESULT" | grep -o '"preview_url"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)

if [ -n "$PREVIEW_URL" ]; then
  echo ""
  echo "Preview ready: $PREVIEW_URL"
  echo "Expires in ~2 hours"
  echo ""
else
  echo "Nometria: preview deploy did not return a URL. Check /status for details."
fi
