---
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(grep:*), Bash(echo:*), Read
description: Fetch the latest deploy-time security scan results from your Nometria app
argument-hint: Optional app name to filter
---

# Security Scan Results

Show the user the latest output of `ai-security-scan`, which runs automatically on every deploy and writes its JSON to `/home/ubuntu/security_scan.json`. Renders a score, per-severity counts, and top findings.

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

## Step 3: Fetch the scan

```bash
curl -s -X POST https://app.nometria.com/getSecurityScan \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"app_id\": \"$APP_ID\"}"
```

Response shape:

```json
{
  "scan": {
    "passed": false,
    "scanned_files": 142,
    "summary": { "critical": 1, "high": 3, "medium": 5, "low": 2, "total": 11 },
    "findings": [
      { "rule_id": "SEC-001", "severity": "CRITICAL", "file": "src/api.js", "line": 42,
        "message": "Hardcoded API key", "snippet": "...", "fix": "..." }
    ]
  },
  "status": "ok"
}
```

If `status === "no_scan_yet"` - tell the user no scan has run yet on this app and suggest triggering a deploy. Stop.

## Step 4: Compute and display the score

Score (0-100) = 100 − (critical × 25) − (high × 10) − (medium × 3) − (low × 1), clamped to [0,100].

Display:

```
Security Score: 72/100
  CRITICAL: 1   HIGH: 3   MEDIUM: 5   LOW: 2
  Total findings: 11   Scanned files: 142
```

## Step 5: Show top findings

List the top 5 findings (sorted by severity, then file). For each:

```
  [CRITICAL] SEC-001 - Hardcoded API key
    src/api.js:42
    Fix: Move the key to .env and reference via process.env.API_KEY
```

## Step 6: Offer next steps

- For each CRITICAL/HIGH finding, point the user at the exact file:line so they can open it
- If the customer asks "how do I fix this", read the file and propose the fix as a diff
- Mention they can run a full local scan with: `pip install ai-security-scan && security-scan .`

Do all of the above. Execute the curl call and report results to the user.
