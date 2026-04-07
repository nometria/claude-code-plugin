---
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(sleep:*), Bash(echo:*), Bash(grep:*), Read, Write
description: Deploy your app to production via Nometria
argument-hint: Optional app name or migration ID
---

# Deploy to Production

You are deploying the user's app to production via the Nometria platform. Execute this workflow precisely.

## Step 1: Resolve API token

Find the Nometria API token. Check in this order:

```bash
# 1. Environment variables (API key or JWT token)
echo "$NOMETRIA_API_KEY"
echo "$NOMETRIA_TOKEN"

# 2. .env file in current project
grep -s 'NOMETRIA_API_KEY\|NOMETRIA_TOKEN' .env .env.local 2>/dev/null

# 3. Stored credentials from `nom login`
cat ~/.nometria/credentials.json 2>/dev/null

# 4. Home directory config (legacy)
cat ~/.nometria 2>/dev/null
```

If no token is found, tell the user:

> No Nometria API token found. Run `nom login` or `/nometria-login` to authenticate.
> Get your API key at https://nometria.com/settings/api-keys

**Stop here if no token.** Do not proceed without a valid token.

Store the token: `TOKEN="<the token>"`

## Step 2: Identify the app

Check if there's a `nometria.json` in the workspace root:
```bash
cat nometria.json 2>/dev/null
```

If it exists, extract `app_id` and `migration_id` from it.

If not, or if the user specified an app name as `$ARGUMENTS`, list all migrations:

```bash
curl -s -X POST https://app.nometria.com/listUserMigrations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
```

From the response, find the matching migration. If multiple apps exist and the user didn't specify which one, show a numbered list and ask them to pick:

```
1. MyApp (Base44) - hosting, paid
2. OtherApp (Lovable) - hosting, paid
3. TestApp (Manus) - download, pending
```

Only proceed with migrations that have `delivery_type: "hosting"` and `payment_status: "paid"`.

Store: `APP_ID="<app_id>"` and `MIGRATION_ID="<migration_id>"`

## Step 3: Check current deployment status

```bash
curl -s -X POST https://app.nometria.com/checkAwsStatus \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\"}"
```

Parse the response to determine the instance state.

## Step 4: Deploy or resync

**If instance is running** (`data.instanceState === "running"`):

Tell the user: "App is already running. Resyncing code to production..."

```bash
curl -s -X POST https://app.nometria.com/resyncHosting \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\"}"
```

**If instance is stopped** (`data.instanceState === "stopped"`):

Tell the user: "Instance is stopped. Starting and resyncing..."

```bash
curl -s -X POST https://app.nometria.com/updateInstanceState \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\", \"instance_state\": \"start\"}"
```

Then resync once it's running.

**If not deployed** (`status === "not_deployed"`):

Tell the user: "Deploying new production instance..."

```bash
curl -s -X POST https://app.nometria.com/deployToAws \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"migration_id\": \"$MIGRATION_ID\"}"
```

## Step 5: Poll for completion

Poll every 5 seconds until the deployment reaches a terminal state:

```bash
curl -s -X POST https://app.nometria.com/checkAwsStatus \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\"}"
```

Terminal states:
- `instanceState: "running"` → **Success**
- `deploymentStatus: "failed"` → **Failure** (report `errorMessage`)
- `instanceState: "terminated"` → **Failure**

Poll up to 60 times (5 minutes). Report progress every 3 polls.

## Step 6: Report result

**On success**, display:

```
✅ Deployed successfully!

   App:  <app_name>
   URL:  <deployUrl or hosted_url>
   IP:   <ipAddress>
   Type: <instanceType>
```

**On failure**, display the error and suggest checking the Nometria dashboard.

## Step 7: Save workspace config

If `nometria.json` doesn't exist, create it so future deploys are faster:

```json
{
  "app_id": "<APP_ID>",
  "migration_id": "<MIGRATION_ID>",
  "app_name": "<app_name>",
  "api_url": "https://app.nometria.com"
}
```

Do all of the above. Execute every curl call and report results to the user.
