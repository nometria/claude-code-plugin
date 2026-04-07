#!/usr/bin/env node
/**
 * Setup script: copies slash commands to .claude/commands/
 * and auto-configures the MCP server in Claude Code.
 *
 * Usage: npx @nometria-ai/claude-code setup
 */
import { mkdirSync, cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const commandsDir = join(__dirname, '..', 'commands');
const targetDir = join(process.cwd(), '.claude', 'commands');

console.log('\n  Nometria Claude Code Plugin Setup\n');

// Copy slash commands
if (existsSync(commandsDir)) {
  mkdirSync(targetDir, { recursive: true });
  const files = readdirSync(commandsDir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    cpSync(join(commandsDir, file), join(targetDir, file));
    console.log(`  Copied: .claude/commands/${file}`);
  }
  console.log();
}

// Auto-configure MCP server in Claude Code
const claudeJsonPath = join(homedir(), '.claude.json');
try {
  let config = {};
  if (existsSync(claudeJsonPath)) {
    config = JSON.parse(readFileSync(claudeJsonPath, 'utf8'));
  }

  // Build the MCP server entry — use shell wrapper to handle nvm/fnm/volta
  const mcpEntry = {
    type: 'stdio',
    command: '/bin/sh',
    args: [
      '-c',
      '. "${NVM_DIR:-$HOME/.nvm}/nvm.sh" 2>/dev/null; [ -d "$HOME/.volta" ] && export PATH="$HOME/.volta/bin:$PATH"; command -v fnm >/dev/null && eval "$(fnm env)" 2>/dev/null; exec npx -y @nometria-ai/claude-code',
    ],
    env: {},
  };

  // Set at top-level mcpServers (global)
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers.nometria = mcpEntry;

  writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2) + '\n');
  console.log('  MCP server registered in ~/.claude.json');
  console.log('  Restart Claude Code and type /mcp to verify.\n');
} catch (err) {
  // Fall back to manual instructions if auto-config fails
  console.log(`  Could not auto-configure MCP. Add manually:\n`);
  console.log(`    claude mcp add nometria -- /bin/sh -c '. "\${NVM_DIR:-\\$HOME/.nvm}/nvm.sh" 2>/dev/null; exec npx -y @nometria-ai/claude-code'\n`);
}

console.log(`  Available tools:
    nometria_deploy      Deploy to production
    nometria_preview     Create staging preview
    nometria_status      Check deployment status
    nometria_logs        View deployment logs
    nometria_list_apps   List all apps
    nometria_init        Set up nometria.json
    nometria_login       Authenticate with API key

  Slash commands:
    /deploy              Deploy to production
    /preview             Create staging preview
    /status              Check deployment status
    /nometria-login      Authenticate
`);
