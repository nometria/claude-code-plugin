# @nometria-ai/claude-code

Deploy any project to any cloud directly from Claude Code.

## Install

### Option 1: Plugin (recommended)

```bash
# Install as a Claude Code plugin (includes MCP server + skills)
/plugin marketplace add nometria/claude-code-plugin
/plugin install nometria
```

### Option 2: MCP server

```bash
# Add MCP server to Claude Code
claude mcp add nometria -- npx -y @nometria-ai/claude-code

# If you use nvm/fnm/volta and the above fails, use:
claude mcp add nometria -- /bin/sh -c '. "${NVM_DIR:-$HOME/.nvm}/nvm.sh" 2>/dev/null; exec npx -y @nometria-ai/claude-code'
```

### Option 3: Slash commands only

```bash
# Generate slash commands + AI tool configs in your project
npx @nometria-ai/nom setup
```

## MCP Tools

The MCP server exposes **34 tools**, grouped by area:

**Auth & config:** `nometria_login`, `nometria_init`, `nometria_setup`, `nometria_info`

**Deploy:** `nometria_deploy`, `nometria_preview`, `nometria_rollback`

**Monitoring:** `nometria_status`, `nometria_logs`, `nometria_list_apps`, `nometria_scan`

**Instance lifecycle:** `nometria_start`, `nometria_stop`, `nometria_terminate`, `nometria_upgrade`

**Domains & env:** `nometria_domain_add`, `nometria_env_set`, `nometria_env_list`

**GitHub:** `nometria_github_connect`, `nometria_github_status`, `nometria_github_repos`, `nometria_github_push`

**Backend services:** `nometria_services_add`, `nometria_services_list`, `nometria_services_remove`

**Database:** `nometria_db_query`, `nometria_db_tables`, `nometria_db_describe`, `nometria_db_create_table`

**Webhooks:** `nometria_webhook_add`, `nometria_webhook_list`, `nometria_webhook_delete`

**Docs:** `nometria_help`

## Slash Commands

After running `setup` (or installing the plugin), these are available in Claude Code:

- `/deploy` - Deploy to production
- `/preview` - Create staging preview
- `/status` - Check deployment status
- `/logs` - View deployment logs
- `/rollback` - Roll back to a previous deployment
- `/env` - Manage environment variables
- `/domain` - Add or check custom domains
- `/nometria-login` - Authenticate

## Skills

The plugin ships agentic skills Claude invokes automatically: `deploy`, `preview`,
`status`, `logs`, `login`, `scan`, `rollback`, `resync-schema`, `backups`.

## Automation Hooks

Wired via `hooks/hooks.json`, opt-in deployment automation:

- **security-gate** (PreToolUse) - blocks deploys when the security score is below 70
- **auto-deploy-on-commit** (PostToolUse) - resyncs on `git commit`
- **pr-preview** (PostToolUse) - spins up a preview URL on PR/branch push
- **post-deploy-healthcheck** (PostToolUse) - HTTP 200 check with auto-rollback
- **live-preview-on-edit** (PostToolUse) - keeps a live preview fresh on edits
- **cost-guardian** (SessionStart) - warns about idle running instances

## Quick Start

```
> Use nometria_login with key nometria_sk_...
> Use nometria_init to set up this project
> Use nometria_deploy to ship it
```

## Authentication

Get an API key at [nometria.com/settings/api-keys](https://nometria.com/settings/api-keys).

```bash
# Option 1: Set env var
export NOMETRIA_API_KEY=nometria_sk_...

# Option 2: Use the login tool
# Claude Code will call nometria_login for you
```

## Supported Platforms

AWS, Google Cloud, Azure, DigitalOcean, Hetzner, Vercel

## Also Available

- **CLI**: `npx @nometria-ai/nom deploy` - [npm](https://npmjs.com/package/@nometria-ai/nom)
- **VS Code**: Search "Nometria" in extensions
- **Cursor**: Auto-rules via `.cursor/rules/`

## License

MIT
