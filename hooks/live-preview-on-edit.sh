#!/usr/bin/env bash
# Nometria Hook: Live preview on file edit
# After code edits, resyncs the staging preview so the user always has a live URL.
# Debounces by checking a timestamp file to avoid rapid-fire resyncs.
#
# Install as a Claude Code PostToolUse hook for Edit/Write tools.

set -euo pipefail

# Only trigger on Edit or Write tool calls
TOOL_NAME="${CLAUDE_TOOL_NAME:-}"
if [ "$TOOL_NAME" != "Edit" ] && [ "$TOOL_NAME" != "Write" ]; then
  exit 0
fi

# Check for nometria.json
if [ ! -f "nometria.json" ]; then
  exit 0
fi

APP_ID=$(grep -o '"app_id"[[:space:]]*:[[:space:]]*"[^"]*"' nometria.json 2>/dev/null | head -1 | cut -d'"' -f4)
[ -z "$APP_ID" ] && exit 0

# Debounce: skip if last resync was less than 10 seconds ago
DEBOUNCE_FILE="/tmp/.nometria_preview_debounce_${APP_ID}"
if [ -f "$DEBOUNCE_FILE" ]; then
  LAST=$(cat "$DEBOUNCE_FILE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  DIFF=$((NOW - LAST))
  if [ "$DIFF" -lt 10 ]; then
    exit 0
  fi
fi

# Resolve API key
TOKEN="${NOMETRIA_API_KEY:-${NOMETRIA_TOKEN:-}}"
[ -z "$TOKEN" ] && [ -f .env ] && TOKEN=$(grep -s 'NOMETRIA_API_KEY\|NOMETRIA_TOKEN' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d ' "'"'"'')
[ -z "$TOKEN" ] && [ -f "$HOME/.nometria/credentials.json" ] && TOKEN=$(grep -o '"api_key"[[:space:]]*:[[:space:]]*"[^"]*"' "$HOME/.nometria/credentials.json" 2>/dev/null | head -1 | cut -d'"' -f4)
[ -z "$TOKEN" ] && exit 0

# Record timestamp
date +%s > "$DEBOUNCE_FILE"

# Trigger resync in background
curl -sf -X POST https://app.nometria.com/resyncHosting \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\"}" > /dev/null 2>&1 &

echo "Nometria: preview resync triggered for $APP_ID"
