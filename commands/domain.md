---
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(grep:*), Bash(echo:*), Read
description: Add or check custom domains for your Nometria app
argument-hint: "add yourdomain.com" or "check"
---

# Manage Custom Domains

Add a custom domain to your deployed Nometria app and get DNS configuration instructions.

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

## Step 3: Get current status (for IP address)

```bash
curl -s -X POST https://app.nometria.com/checkAwsStatus \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\"}"
```

Extract `ipAddress` from the response for DNS instructions.

## Step 4: Parse action from `$ARGUMENTS`

- **"add yourdomain.com"** or just **"yourdomain.com"** → Add domain
- **No arguments** or **"check"** → Show current domain + DNS instructions

### Add a custom domain

Validate the domain format (must contain a dot, no protocol prefix).

```bash
curl -s -X POST https://app.nometria.com/addCustomDomain \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\", \"custom_domain\": \"$DOMAIN\"}"
```

On success, display:

```
Custom domain added: yourdomain.com

DNS Configuration Required:
━━━━━━━━━━━━━━━━━━━━━━━━━━
Add an A record pointing to your app's IP address:

   Type: A
   Name: @ (or subdomain)
   Value: <ipAddress>
   TTL: 300

If using a subdomain (e.g., app.yourdomain.com):
   Type: CNAME
   Name: app
   Value: <deployUrl>

SSL will be provisioned automatically once DNS propagates (usually 5-30 minutes).
```

### Check current domain

Show the current `deployUrl` and `custom_domain` from the status response, plus DNS instructions if a custom domain is set.

## Error handling

If the API returns an error, show it and suggest:

> Need help with DNS setup? Visit https://docs.nometria.com/deploy/domains
> Common issues: DNS propagation can take up to 48 hours. Use `dig yourdomain.com` to check.

Execute all curl commands and display the results.
