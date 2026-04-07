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

| Tool | Description |
|------|-------------|
| `nometria_login` | Authenticate with your API key |
| `nometria_init` | Create nometria.json config |
| `nometria_deploy` | Deploy to production |
| `nometria_preview` | Create staging preview (free, 2hr) |
| `nometria_status` | Check deployment status |
| `nometria_logs` | View deployment logs |
| `nometria_list_apps` | List all your apps |

## Slash Commands

After running `setup`, these are available in Claude Code:

- `/deploy` — Deploy to production
- `/preview` — Create staging preview
- `/status` — Check deployment status
- `/nometria-login` — Authenticate

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

- **CLI**: `npx @nometria-ai/nom deploy` — [npm](https://npmjs.com/package/@nometria-ai/nom)
- **VS Code**: Search "Nometria" in extensions
- **Cursor**: Auto-rules via `.cursor/rules/`

## License

MIT
