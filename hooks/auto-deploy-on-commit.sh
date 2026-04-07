#!/usr/bin/env bash
# Nometria Hook: Auto-deploy on git commit
# Triggers resync when a git commit is made in a Nometria project.
#
# Install as a Claude Code PostToolUse hook for Bash commands matching "git commit".
# See: https://docs.nometria.com/cli/slash-commands

set -euo pipefail

# Only trigger on git commit commands
TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"
if ! echo "$TOOL_INPUT" | grep -q "git commit"; then
  exit 0
fi

# Check for nometria.json
if [ ! -f "nometria.json" ]; then
  exit 0
fi

APP_ID=$(grep -o '"app_id"[[:space:]]*:[[:space:]]*"[^"]*"' nometria.json 2>/dev/null | head -1 | cut -d'"' -f4)
if [ -z "$APP_ID" ]; then
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
  exit 0
fi

# Trigger resync in background (don't block the commit)
curl -sf -X POST https://app.nometria.com/resyncHosting \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\"}" > /dev/null 2>&1 &

echo "Nometria: resyncing $APP_ID in background..."
