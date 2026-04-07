---
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(grep:*), Bash(echo:*), Read
description: Check deployment status of your Nometria apps
argument-hint: Optional app name to filter
---

# Check Deployment Status

Show the user the current state of their Nometria deployments.

## Step 1: Resolve token

```bash
TOKEN="${NOMETRIA_API_KEY:-${NOMETRIA_TOKEN:-$(grep -s 'NOMETRIA_API_KEY\|NOMETRIA_TOKEN' .env .env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d ' "'"'"'')}}"
```

If no token: tell the user to run `/nometria-login` and stop.

## Step 2: List all migrations

```bash
curl -s -X POST https://app.nometria.com/listUserMigrations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
```

## Step 3: Check AWS status for hosting apps

For each migration with `delivery_type: "hosting"`, check its status:

```bash
curl -s -X POST https://app.nometria.com/checkAwsStatus \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"<APP_ID>\"}"
```

## Step 4: Display formatted table

Present results as a clear table:

```
╔══════════════════╦══════════╦═══════════╦════════════════════════════════╦═════════════════╗
║ App              ║ Platform ║ Status    ║ URL                            ║ Instance        ║
╠══════════════════╬══════════╬═══════════╬════════════════════════════════╬═════════════════╣
║ MyApp            ║ Base44   ║ ● running ║ https://myapp.nometria.com        ║ 4gb (t4g.med)   ║
║ OtherApp         ║ Lovable  ║ ○ stopped ║ https://otherapp.nometria.com     ║ 2gb (t4g.small) ║
║ TestProject      ║ Manus    ║ — none    ║ —                              ║ —               ║
╚══════════════════╩══════════╩═══════════╩════════════════════════════════╩═════════════════╝
```

Use these status indicators:
- `● running` — app is live
- `◐ deploying` / `◐ launching` — deployment in progress
- `○ stopped` — instance exists but is off
- `✕ failed` — deployment failed (show error if available)
- `— none` — not deployed to hosting

If `$ARGUMENTS` was provided, filter the results to match that app name.

Also show:
- Total apps: X
- Running: X
- Stopped: X

If there's a `nometria.json` in the workspace, highlight the linked app with `← linked`.

Execute all the curl calls and display the results.
