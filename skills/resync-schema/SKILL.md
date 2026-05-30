---
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(grep:*), Bash(echo:*), Read
description: Apply new database schema migrations without a full redeploy
argument-hint: Optional app name to filter
---

# Re-sync Schema Only

When the user's source platform (Base44 / Lovable / Manus) added a new column or table and they want to apply the new ALTER migration without running a full redeploy, use this skill. It runs ONLY the migration pass against the currently-deployed code - no tarball download, no build, no PM2 restart.

A pre-resync database snapshot is taken automatically.

## Step 1: Resolve API token

```bash
echo "$NOMETRIA_API_KEY"
echo "$NOMETRIA_TOKEN"
grep -s 'NOMETRIA_API_KEY\|NOMETRIA_TOKEN' .env .env.local 2>/dev/null
cat ~/.nometria/credentials.json 2>/dev/null
```

If no token: tell the user to run `/login`. Stop.

Store: `TOKEN="<the token>"`

## Step 2: Identify the app

```bash
cat nometria.json 2>/dev/null
```

If absent, use `$ARGUMENTS` or list migrations:

```bash
curl -s -X POST https://app.nometria.com/listUserMigrations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
```

Store: `APP_ID="<app_id>"`.

## Step 3: Confirm with the user

Before dispatching, explain what's about to happen:

> Re-syncing the database schema for `<APP_NAME>`. This applies any new ALTER
> migrations from your source platform to the live database. It does NOT
> rebuild the app or restart services. A safety snapshot is taken first.
> Already-applied migrations are skipped automatically (idempotent).

Confirm: "Proceed?"

## Step 4: Dispatch

```bash
curl -s -X POST https://app.nometria.com/resyncSchema \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\"}"
```

Response:

```json
{ "dispatched": true, "command_id": "<ssm-id>" }
```

If `dispatched === false` and `error === "instance_not_running"` - tell the user they need to deploy the app first.

## Step 5: Watch progress

Tell the user:

> Schema resync dispatched. Run `/logs` to watch the migration log, or `/status`
> to see when the instance is back to `running`. Migrations usually complete
> in 5-30 seconds depending on data size.

If they want, use `/logs` right now to tail the migration output.

Do all of the above. Execute the curl call and report results to the user.
