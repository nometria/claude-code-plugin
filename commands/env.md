---
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(grep:*), Bash(echo:*), Read
description: Manage environment variables for your Nometria app
argument-hint: "set KEY=VALUE" or "list" or "delete KEY"
---

# Manage Environment Variables

Set, list, or delete environment variables on a deployed Nometria app.

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

## Step 3: Parse the action from `$ARGUMENTS`

Determine what the user wants:

- **No arguments or "list"** → List env vars
- **"set KEY=VALUE"** or **"KEY=VALUE"** → Set env var(s)
- **"delete KEY"** or **"remove KEY"** → Delete env var

### List env vars

```bash
curl -s -X POST https://app.nometria.com/getEnvVars \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\"}"
```

Display as a table:

```
Environment Variables for <app_name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KEY                     VALUE
DATABASE_URL            postgres://...
STRIPE_SECRET_KEY       sk_live_...****
NODE_ENV                production
```

Mask sensitive values (show first 10 chars + `****`).

### Set env vars

Parse KEY=VALUE pairs from `$ARGUMENTS`. Support multiple: `KEY1=val1 KEY2=val2`.

**Security check**: If a value looks like an API key or secret, warn the user:
> This looks like a secret. Make sure it's not committed to git or nometria.json.

```bash
curl -s -X POST https://app.nometria.com/setEnvVars \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\", \"env_vars\": {\"KEY\": \"VALUE\"}}"
```

On success: "Environment variable(s) set. Run `/deploy` to apply changes to your running instance."

### Delete env vars

```bash
curl -s -X POST https://app.nometria.com/deleteEnvVars \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\", \"keys\": [\"KEY\"]}"
```

On success: "Environment variable deleted. Run `/deploy` to apply changes."

## Error handling

If any API call fails, show the error and suggest:

> Need help? Visit https://docs.nometria.com/deploy/environment
> Or check your app status with `/status`.

Execute all curl commands and display the results.
