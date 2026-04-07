---
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(grep:*), Bash(echo:*), Read
description: Deploy a staging preview of your app via Nometria
argument-hint: Optional app name
---

# Deploy Staging Preview

You are creating a temporary staging preview of the user's app. This is free and creates a short-lived URL.

## Step 1: Resolve token

```bash
TOKEN="${NOMETRIA_API_KEY:-${NOMETRIA_TOKEN:-$(grep -s 'NOMETRIA_API_KEY\|NOMETRIA_TOKEN' .env .env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d ' "'"'"'')}}"
echo "Token found: $([ -n "$TOKEN" ] && echo 'yes' || echo 'no')"
```

If no token: tell the user to run `nom login` or `/nometria-login` and stop.

## Step 2: Identify the app

```bash
# Try workspace config first
cat nometria.json 2>/dev/null
```

If no `nometria.json`, list migrations:

```bash
curl -s -X POST https://app.nometria.com/listUserMigrations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
```

Pick the correct migration. If `$ARGUMENTS` was provided, match by app name. Otherwise, if multiple exist, ask the user. Store `MIGRATION_ID`.

## Step 3: Deploy preview

```bash
curl -s -X POST https://app.nometria.com/deployStagingPreview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"migration_id\": \"$MIGRATION_ID\", \"production\": false}"
```

## Step 4: Report result

Parse the response. On success, display:

```
🔗 Preview deployed!

   URL: <preview_url>
   Expires: ~2 hours

   This is a temporary preview. Use /deploy for production.
```

On failure, show the error message and suggest checking the dashboard.

Execute all curl commands and report the results.
