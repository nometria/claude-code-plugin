---
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(grep:*), Bash(echo:*), Read
description: List S3 database backups and (optionally) restore one
argument-hint: Optional app name to filter
---

# Database Backups

List the customer's daily Postgres backups (and other DB engines if present) stored in S3 by the daily backup cron. Optionally restore Postgres/Supabase backups via `pg_restore --clean --if-exists` - with a safety snapshot of the current state taken first.

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

## Step 3: List backups

```bash
curl -s -X POST https://app.nometria.com/getBackups \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\"}"
```

Response shape:

```json
{
  "backups": [
    { "s3_path": "s3://nometria-deploy-backups/myapp/2026/05/18/supabase_2026-05-18T02:00:00Z.dump.gz",
      "kind": "supabase", "ts": "2026-05-18T02:00:00Z", "size_bytes": 1450000, "day": "2026/05/18",
      "filename": "supabase_2026-05-18T02:00:00Z.dump.gz" }
  ],
  "status": "ok",
  "bucket": "nometria-deploy-backups"
}
```

If `status === "no_backups"` - tell the user no backups exist yet (daily cron runs at 02:00 UTC) and suggest deploying + waiting until tomorrow morning.

## Step 4: Render the list

Display backups newest-first, grouped by date:

```
2026-05-18
  ✓ supabase   02:00 UTC   1.4 MB   ← latest
  ✓ safety     09:15 UTC   1.4 MB   (pre-restore snapshot)
2026-05-17
  ✓ supabase   02:00 UTC   1.3 MB
2026-05-16
  ✓ supabase   02:00 UTC   1.2 MB
```

Mark restorable kinds (supabase / postgres / safety) with a tick.
Mark non-restorable kinds (appwrite / mysql / mongodb / redis) with "(manual download via S3)".

## Step 5 (optional): Restore

If the user asks to restore a specific backup:

**Confirm explicitly:**

> Restore <KIND> backup from <TIMESTAMP>?
>
> This will OVERWRITE your current database. A safety snapshot of the current
> data is taken FIRST (uploaded to .../safety/<ts>.dump.gz) so it's reversible.
> Your app may be briefly unavailable while the restore runs.

After explicit confirmation:

```bash
curl -s -X POST https://app.nometria.com/getBackups \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\", \"restore_from\": \"<s3_path from list>\"}"
```

Response:

```json
{ "dispatched": true, "command_id": "<ssm-id>", "restore_from": "s3://..." }
```

Tell the user:

> Restore dispatched. Run `/logs` to watch the restore output. If something
> went wrong, the safety snapshot at .../safety/<ts>.dump.gz can be restored
> back to undo this.

## Step 6: Notes for the user

- Backups have **30-day retention** in S3
- Restores use `pg_restore --clean --if-exists` - so they drop existing
  objects before recreating them (safe and idempotent)
- Only Postgres/Supabase backups are restorable from this skill; for other
  DB engines, point the user at the AWS Console with the listed s3_path

Do all of the above. Execute the curl call(s) and report results to the user.
