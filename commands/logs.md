---
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(grep:*), Bash(echo:*), Read
description: View deployment logs for your Nometria app
argument-hint: Optional app name
---

# View Deployment Logs

Show the user recent deployment and runtime logs for their Nometria app.

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

If `nometria.json` exists, use `app_id` from it.

If not, or if `$ARGUMENTS` was provided, list migrations:

```bash
curl -s -X POST https://app.nometria.com/listUserMigrations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
```

Match by app name if `$ARGUMENTS` provided. If multiple apps and no argument, ask the user to pick.

## Step 3: Fetch logs

```bash
curl -s -X POST https://app.nometria.com/getLogs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\"}"
```

## Step 4: Display logs

Format the response clearly:

```
📋 Logs for <app_name> (<app_id>)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[2026-04-06 12:00:00] npm install completed
[2026-04-06 12:00:05] Build successful
[2026-04-06 12:00:10] PM2 started frontend on port 5173
...
```

If the response contains no logs, tell the user:

> No logs available yet. The app may not be deployed, or logs haven't been generated.
> Check status with `/status` or deploy with `/deploy`.

If the API returns an error, show the error and suggest:

> Having trouble? Check your app status at https://nometria.com/dashboard
> Or run `/status` to verify the app is running.

Execute all curl commands and display the results.
