#!/usr/bin/env bash
# Nometria Hook: Cost guardian — detect idle instances
# Runs on session start. Lists running instances and warns about idle ones.
#
# Install as a Claude Code SessionStart hook.
# See: https://docs.nometria.com/cli/slash-commands

set -euo pipefail

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

# List all migrations
MIGRATIONS=$(curl -sf -X POST https://app.nometria.com/listUserMigrations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}' 2>/dev/null || echo '{}')

# Extract app IDs for hosting apps
APP_IDS=$(echo "$MIGRATIONS" | grep -o '"app_id"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)

if [ -z "$APP_IDS" ]; then
  exit 0
fi

RUNNING_COUNT=0
RUNNING_APPS=""

for APP_ID in $APP_IDS; do
  STATUS=$(curl -sf -X POST https://app.nometria.com/checkAwsStatus \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"app_id\": \"$APP_ID\"}" 2>/dev/null || echo '{}')

  STATE=$(echo "$STATUS" | grep -o '"instanceState"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)

  if [ "$STATE" = "running" ]; then
    RUNNING_COUNT=$((RUNNING_COUNT + 1))
    INSTANCE_TYPE=$(echo "$STATUS" | grep -o '"instanceType"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
    RUNNING_APPS="$RUNNING_APPS\n  - $APP_ID ($INSTANCE_TYPE)"
  fi
done

if [ "$RUNNING_COUNT" -gt 0 ]; then
  echo "Nometria: $RUNNING_COUNT running instance(s):"
  echo -e "$RUNNING_APPS"
  echo ""
  echo "Tip: Stop idle instances to save costs: nom stop <app_id>"
fi
