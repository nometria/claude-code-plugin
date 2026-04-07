---
allowed-tools: Bash(echo:*), Bash(cat:*), Bash(grep:*), Read, Write
description: Authenticate with the Nometria deployment platform
---

# Nometria Login

Help the user set up their Nometria API token for deployments.

## Step 1: Check existing token

```bash
# Check environment (API key or JWT)
echo "API_KEY: $([ -n "$NOMETRIA_API_KEY" ] && echo 'set' || echo 'not set')"
echo "TOKEN: $([ -n "$NOMETRIA_TOKEN" ] && echo 'set' || echo 'not set')"

# Check .env
grep -s 'NOMETRIA_API_KEY\|NOMETRIA_TOKEN' .env .env.local 2>/dev/null && echo "Found in .env" || echo ".env: not found"

# Check nom CLI credentials
cat ~/.nometria/credentials.json 2>/dev/null && echo "Found ~/.nometria/credentials.json" || echo "~/.nometria/credentials.json: not found"
```

If a token already exists, tell the user they're already authenticated and show which source it was found in. Ask if they want to update it.

## Step 2: Get the token

Tell the user:

> To get your Nometria API key:
>
> 1. Go to **https://nometria.com/settings/api-keys**
> 2. Sign in to your account
> 3. Click **Generate New Key**
> 4. Copy the key and paste it here
>
> Your key is stored locally and never sent anywhere except the Nometria API.
> Alternatively, you can use `nom login` from the CLI.

Wait for the user to provide the token. They will paste it in the chat.

## Step 3: Validate the token

Once the user provides a token, validate it by making a test API call:

```bash
curl -s -X POST https://app.nometria.com/listUserMigrations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <USER_TOKEN>" \
  -d '{}'
```

If the response contains `"success": true`, the token is valid.
If it returns 401 or an error, tell the user the token is invalid and ask them to try again.

## Step 4: Store the token

If the current directory has a `.env` file, append to it:

```
NOMETRIA_API_KEY=<key>
```

If no `.env` exists, create `.env` with the key.

Also check if `.gitignore` contains `.env`. If not, warn the user:

> ⚠️ Make sure `.env` is in your `.gitignore` to avoid committing your token.

## Step 5: Create workspace config

If no `nometria.json` exists and the user has migrations, ask if they want to link this workspace to one of their apps. If yes, create `nometria.json`:

```json
{
  "app_id": "<selected_app_id>",
  "migration_id": "<selected_migration_id>",
  "app_name": "<app_name>",
  "api_url": "https://app.nometria.com"
}
```

## Step 6: Confirm

Tell the user:

```
✅ Authenticated as <email>

   Key stored in: .env
   Linked app: <app_name> (or "none - run /deploy to link")

   You can now use:
     /deploy   - Deploy to production
     /preview  - Deploy staging preview
     /status   - Check deployment status
     nom deploy - Deploy from CLI
```
