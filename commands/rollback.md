---
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(grep:*), Bash(echo:*), Read
description: Roll back to a previous deployment
argument-hint: Optional deployment ID
---

# Rollback Deployment

Roll back your Nometria app to a previous deployment version.

## Step 1: Resolve token

```bash
TOKEN="${NOMETRIA_API_KEY:-${NOMETRIA_TOKEN:-$(grep -s 'NOMETRIA_API_KEY\|NOMETRIA_TOKEN' .env .env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d ' "'"'"'')}}"
echo "Token found: $([ -n "$TOKEN" ] && echo 'yes' || echo 'no')"
```

If no token: tell the user to run `/nometria-login` and stop.

## Step 2: Identify the app

```bash
cat nometria.json 2>/dev/null
```

Use `app_id` from `nometria.json`. If not found, list migrations and ask.

## Step 3: List recent deployments

```bash
curl -s -X POST https://app.nometria.com/v1/deployments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\"}"
```

Display as a numbered list:

```
Recent deployments for <app_name>:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1. dep_abc123  live      2026-04-06 12:00  (current)
  2. dep_xyz789  live      2026-04-05 18:30
  3. dep_def456  rolled_back  2026-04-04 09:15
```

## Step 4: Select target

If `$ARGUMENTS` was provided, use it as the deployment ID.

Otherwise, ask the user which deployment to roll back to (default: #2, the previous deployment).

## Step 5: Execute rollback

**Always confirm with the user before rolling back.**

```bash
curl -s -X POST https://app.nometria.com/v1/deployments/$TARGET_ID/rollback \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\"}"
```

## Step 6: Report result

On success:

```
Rolled back successfully.

  From: dep_abc123 (2026-04-06 12:00)
  To:   dep_xyz789 (2026-04-05 18:30)
  URL:  <deploy_url>
```

On failure, show the error and suggest:

> Rollback failed. Check the dashboard: https://nometria.com/dashboard
> Or view logs with `/logs`.

Execute all curl commands and display the results.
