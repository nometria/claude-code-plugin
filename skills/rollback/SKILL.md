---
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(grep:*), Bash(echo:*), Read
description: List past deploys and roll back to a previous version
argument-hint: Optional app name to filter
---

# Roll Back to a Previous Deploy

Show the user their deploy history (from `/home/ubuntu/deploy_history.jsonl` on the EC2 box), let them pick a past version, and re-dispatch the standard sync flow against that historical tarball. Env vars, certificates, and the database stay intact - only the application code reverts.

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

## Step 3: Fetch deploy history

```bash
curl -s -X POST https://app.nometria.com/getDeployHistory \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\"}"
```

Response shape:

```json
{
  "deploys": [
    { "ts": "2026-05-18T20:00:00Z", "s3_path": "s3://...", "health": "passed", "kind": "resync" },
    { "ts": "2026-05-18T15:30:00Z", "s3_path": "s3://...", "health": "passed", "kind": "sync"   }
  ],
  "status": "ok"
}
```

If `status === "no_history"` - tell the user no history has been recorded yet on this app and suggest deploying first so future deploys can be rolled back. Stop.

## Step 4: Present the history and pick a target

Display the deploys (newest first, the topmost is the current one). Format:

```
 #  Timestamp                 Health   Kind     Path
 0  2026-05-18T20:00:00Z      ✅ pass  resync   s3://own-my-app/myapp/.../code.tar.gz  ← CURRENT
 1  2026-05-18T15:30:00Z      ✅ pass  sync     s3://own-my-app/myapp/.../code.tar.gz
 2  2026-05-17T09:12:00Z      ❌ fail  resync   s3://own-my-app/myapp/.../code.tar.gz
```

- If the user gave a specific timestamp / version in `$ARGUMENTS`, find the match.
- Otherwise ask: "Which deploy do you want to roll back to? Pick the number above."
- Recommend picking the most recent `health: passed` deploy unless the user has reason to go further back.

Store: `ROLLBACK_S3="<chosen s3_path>"`.

## Step 5: Confirm and dispatch

Tell the user clearly:

> Rolling back to <timestamp> (<s3_path>). Your env vars and database stay intact;
> only the application code reverts. The app will be briefly unavailable during the redeploy.

Dispatch:

```bash
curl -s -X POST https://app.nometria.com/getDeployHistory \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\", \"rollback_to\": \"$ROLLBACK_S3\"}"
```

Response:

```json
{ "status": "dispatched", "command_id": "<ssm-id>", "rollback_to": "s3://..." }
```

## Step 6: Confirm completion

Tell the user the rollback is dispatched and suggest:

- Use `/logs` to watch progress
- Use `/status` to see when the instance is back to `running`
- Rollback typically completes in 1-2 minutes (sync runs the full build + health check)

Do all of the above. Execute the curl calls and report results to the user.
