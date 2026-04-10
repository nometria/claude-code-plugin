#!/usr/bin/env node
/**
 * Nometria MCP Server for Claude Code.
 * Exposes deployment tools as MCP tools.
 *
 * Install: claude mcp add nometria -- npx @nometria-ai/claude-code
 */
import { apiRequest, getApiKey } from './lib/api.js';
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

// ── Agnost AI analytics ──────────────────────────────────────────────────────
let trackMCP, checkpoint;
try {
  ({ trackMCP, checkpoint } = await import('agnost'));
} catch {
  // agnost not installed — analytics disabled
  trackMCP = null;
  checkpoint = () => {};
}

// MCP Protocol via stdio (raw Content-Length framing, no readline)

const TOOLS = [
  {
    name: 'nometria_login',
    description: 'Save your Nometria API key. If no key provided, instructs the user to run `nom login` for browser sign-in or visit https://nometria.com/settings/api-keys',
    inputSchema: {
      type: 'object',
      properties: {
        api_key: { type: 'string', description: 'Your Nometria API key (starts with nometria_sk_). If not provided, shows instructions.' },
      },
    },
  },
  {
    name: 'nometria_deploy',
    description: 'Deploy the current project to production. Builds, uploads, and deploys to your chosen cloud.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Project directory to deploy (default: current dir)' },
      },
    },
  },
  {
    name: 'nometria_preview',
    description: 'Create a temporary staging preview of the project. Free, expires in 2 hours.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Project directory (default: current dir)' },
      },
    },
  },
  {
    name: 'nometria_status',
    description: 'Check the deployment status of an app.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID or name to check' },
      },
    },
  },
  {
    name: 'nometria_logs',
    description: 'View deployment logs for an app.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID or name' },
      },
    },
  },
  {
    name: 'nometria_list_apps',
    description: 'List all your deployed apps.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nometria_init',
    description: 'Initialize a nometria.json config file in the project directory.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Project directory (default: current dir)' },
        name: { type: 'string', description: 'Project name' },
        platform: { type: 'string', description: 'Cloud platform: aws, gcp, azure, digitalocean, hetzner, vercel', default: 'aws' },
      },
    },
  },
  // GitHub
  {
    name: 'nometria_github_connect',
    description: 'Connect GitHub to your app for auto-deploy on push. Requires browser — instructs user to run nom github connect.',
    inputSchema: { type: 'object', properties: { app_id: { type: 'string' } } },
  },
  {
    name: 'nometria_github_status',
    description: 'Check if GitHub is connected for an app.',
    inputSchema: { type: 'object', properties: { app_id: { type: 'string' } } },
  },
  {
    name: 'nometria_github_repos',
    description: 'List GitHub repos connected to your account.',
    inputSchema: { type: 'object', properties: { app_id: { type: 'string' } } },
  },
  {
    name: 'nometria_github_push',
    description: 'Push local changes to connected GitHub repo.',
    inputSchema: { type: 'object', properties: { app_id: { type: 'string' }, commit_message: { type: 'string' } } },
  },
  // Instance management
  {
    name: 'nometria_start',
    description: 'Start a stopped instance.',
    inputSchema: { type: 'object', properties: { app_id: { type: 'string' } } },
  },
  {
    name: 'nometria_stop',
    description: 'Stop a running instance.',
    inputSchema: { type: 'object', properties: { app_id: { type: 'string' } } },
  },
  {
    name: 'nometria_terminate',
    description: 'Permanently terminate an instance. This is destructive.',
    inputSchema: { type: 'object', properties: { app_id: { type: 'string' } } },
  },
  {
    name: 'nometria_upgrade',
    description: 'Upgrade instance size (2gb, 4gb, 8gb, 16gb).',
    inputSchema: { type: 'object', properties: { app_id: { type: 'string' }, instance_type: { type: 'string', description: '2gb | 4gb | 8gb | 16gb' } }, required: ['instance_type'] },
  },
  // Domains, env, scan
  {
    name: 'nometria_domain_add',
    description: 'Add a custom domain to your app.',
    inputSchema: { type: 'object', properties: { app_id: { type: 'string' }, custom_domain: { type: 'string' } }, required: ['custom_domain'] },
  },
  {
    name: 'nometria_env_set',
    description: 'Set environment variables on your app.',
    inputSchema: { type: 'object', properties: { app_id: { type: 'string' }, vars: { type: 'object', description: 'Key-value pairs to set' } }, required: ['vars'] },
  },
  {
    name: 'nometria_env_list',
    description: 'List environment variable keys for your app.',
    inputSchema: { type: 'object', properties: { app_id: { type: 'string' } } },
  },
  {
    name: 'nometria_scan',
    description: 'Run an AI security and performance scan on your app.',
    inputSchema: { type: 'object', properties: { app_id: { type: 'string' } } },
  },
  {
    name: 'nometria_setup',
    description: 'Generate AI tool config files (.cursor/rules, .clinerules, .windsurfrules, CLAUDE.md, .github/copilot-instructions.md, GitHub Action, Continue.dev config) so every AI coding tool knows how to deploy this project.',
    inputSchema: { type: 'object', properties: { directory: { type: 'string', description: 'Project directory (default: current dir)' } } },
  },
  {
    name: 'nometria_rollback',
    description: 'Roll back to a previous deployment version.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID' },
        deployment_id: { type: 'string', description: 'Target deployment ID to roll back to (omit for previous)' },
      },
    },
  },
];

// ── Lightweight service detection (mirrors @nometria-ai/nom detect.js) ────────
const _FRONTEND_DEPS = new Set(['react','react-dom','vue','svelte','next','nuxt','@angular/core','vite','solid-js','astro']);
const _FRONTEND_FILES = ['vite.config.js','vite.config.ts','vite.config.mjs','next.config.js','next.config.mjs','next.config.ts'];
const _BACKEND_DEPS = new Set(['express','fastify','hono','koa','@nestjs/core','@hapi/hapi']);

function _detectServices(dir) {
  const result = { services: [], docker_compose: false };
  if (existsSync(join(dir, 'docker-compose.yml')) || existsSync(join(dir, 'docker-compose.yaml'))) {
    result.docker_compose = true;
  }
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return result; }
  const svcs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const sub = join(dir, entry.name);
    const pkgPath = join(sub, 'package.json');
    if (!existsSync(pkgPath)) continue;
    let pkg;
    try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { continue; }
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const hasFE = _FRONTEND_FILES.some(f => existsSync(join(sub, f))) || deps.some(d => _FRONTEND_DEPS.has(d));
    const hasBE = deps.some(d => _BACKEND_DEPS.has(d));
    let type = hasFE && !hasBE ? 'frontend' : (hasBE || pkg.scripts?.start) && !hasFE ? 'backend' : 'unknown';
    const pm = existsSync(join(sub, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm';
    const svc = { name: entry.name, path: entry.name, type };
    if (pkg.scripts?.build) svc.build = `${pm} run build`;
    if (pkg.scripts?.start) svc.start = `${pm} run start`;
    svcs.push(svc);
  }
  if (svcs.length > 0) {
    svcs.sort((a, b) => (a.type === 'frontend' ? 0 : 1) - (b.type === 'frontend' ? 0 : 1));
    result.services = svcs;
  }
  return result;
}

// Tool handlers
async function handleTool(name, args) {
  const apiKey = args.api_key || getApiKey();

  switch (name) {
    case 'nometria_login': {
      if (!args.api_key) {
        // Check if already authenticated
        const existing = getApiKey();
        if (existing) {
          try {
            const check = await apiRequest('/cli/auth', { body: { api_key: existing } });
            if (check.success) return `Already authenticated as ${check.email}.\n\nTo re-authenticate, run \`nom login\` in the terminal (opens browser) or provide an api_key argument.`;
          } catch { /* not valid, show instructions */ }
        }
        return 'Not authenticated.\n\nTo sign in:\n  1. Run `nom login` in your terminal (opens browser — easiest)\n  2. Or get an API key at https://nometria.com/settings/api-keys and call this tool with the api_key argument\n  3. Or set NOMETRIA_API_KEY environment variable';
      }
      const result = await apiRequest('/cli/auth', { body: { api_key: args.api_key } });
      if (result.success) {
        const dir = join(homedir(), '.nometria');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ apiKey: args.api_key }, null, 2), { mode: 0o600 });
        return `Authenticated as ${result.email}. Credentials saved to ~/.nometria/credentials.json`;
      }
      return 'Invalid API key. Run `nom login` in your terminal for browser sign-in, or get a key at https://nometria.com/settings/api-keys';
    }

    case 'nometria_deploy': {
      if (!apiKey) return 'Not authenticated. Use nometria_login first, or set NOMETRIA_API_KEY env var.';
      const dir = args.directory || process.cwd();
      const configPath = join(dir, 'nometria.json');
      if (!existsSync(configPath)) return `No nometria.json found in ${dir}. Use nometria_init first.`;
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      const appName = config.name || config.app_id;

      // Auto-detect services if not in config
      if (!config.services) {
        const { services, docker_compose } = _detectServices(dir);
        if (services.length > 0) config.services = services;
        if (docker_compose) config.docker_compose = true;
        if (services.length > 0 || docker_compose) {
          try { writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n'); } catch { /* non-fatal */ }
        }
      }

      // Build
      let buildOutput = '';
      if (config.build?.command) {
        try {
          buildOutput = execSync(config.build.command, { cwd: dir, stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } }).toString();
        } catch (err) {
          return `Build failed: ${err.stderr?.toString() || err.message}`;
        }
      }

      // Create tarball
      const tmpDir = execSync('mktemp -d', { encoding: 'utf8' }).trim();
      const tarPath = join(tmpDir, 'code.tar.gz');
      execSync(`tar czf "${tarPath}" --exclude='node_modules' --exclude='.git' --exclude='.env' --exclude='.env.*' -C "${dir}" .`, { stdio: 'pipe' });
      const fileBuffer = readFileSync(tarPath);

      // Upload via Deno function
      const { FormData, Blob } = globalThis;
      const formData = new FormData();
      formData.append('api_key', apiKey);
      formData.append('file', new Blob([fileBuffer], { type: 'application/gzip' }), `${appName}.tar.gz`);

      const uploadRes = await fetch(`${(await import('./lib/api.js')).getBaseUrl()}/cli/upload`, {
        method: 'POST',
        body: formData,
      });
      const uploadRaw = await uploadRes.json();
      const uploadResult = uploadRaw?.data || uploadRaw;
      if (!uploadResult.success) return `Upload failed: ${uploadResult.error || uploadRes.statusText}`;

      // Deploy via Deno function
      const deployResult = await apiRequest('/cli/deploy', {
        apiKey,
        body: {
          app_name: appName,
          upload_url: uploadResult.upload_url,
          platform: config.platform || 'aws',
          region: config.region || 'us-east-1',
          instance_type: config.instanceType || '4gb',
          framework: config.framework,
          ...(config.app_id ? { app_id: config.app_id } : {}),
        },
      });

      // Write back app_id
      if (!config.app_id && deployResult.deploy_id) {
        config.app_id = deployResult.deploy_id;
        writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      }

      return `Deployment started for ${appName}.\nStatus: ${deployResult.status}\nURL: ${deployResult.url || `https://${appName}.nometria.com`}\n\nUse nometria_status to check progress.`;
    }

    case 'nometria_preview': {
      if (!apiKey) return 'Not authenticated. Use nometria_login first.';
      const dir = args.directory || process.cwd();
      const configPath = join(dir, 'nometria.json');
      if (!existsSync(configPath)) return `No nometria.json found. Use nometria_init first.`;
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      const appName = config.name || config.app_id;

      // Build + tar + upload (same as deploy)
      if (config.build?.command) {
        try { execSync(config.build.command, { cwd: dir, stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } }); }
        catch (err) { return `Build failed: ${err.stderr?.toString() || err.message}`; }
      }
      const tmpDir = execSync('mktemp -d', { encoding: 'utf8' }).trim();
      const tarPath = join(tmpDir, 'code.tar.gz');
      execSync(`tar czf "${tarPath}" --exclude='node_modules' --exclude='.git' --exclude='.env' -C "${dir}" .`, { stdio: 'pipe' });
      const fileBuffer = readFileSync(tarPath);
      const formData = new FormData();
      formData.append('api_key', apiKey);
      formData.append('file', new Blob([fileBuffer], { type: 'application/gzip' }), `${appName}-preview.tar.gz`);
      const uploadRes = await fetch(`${(await import('./lib/api.js')).getBaseUrl()}/cli/upload`, { method: 'POST', body: formData });
      const uploadRaw = await uploadRes.json();
      const uploadResult = uploadRaw?.data || uploadRaw;
      if (!uploadResult.success) return `Upload failed: ${uploadResult.error || uploadRes.statusText}`;

      const result = await apiRequest('/cli/preview', { apiKey, body: { app_name: appName, upload_url: uploadResult.upload_url } });
      return `Preview ready!\nURL: ${result.preview_url}\nExpires: ${result.expires_in || '2 hours'}`;
    }

    case 'nometria_status': {
      if (!apiKey) return 'Not authenticated. Use nometria_login to sign in, or set NOMETRIA_API_KEY env var.\nGet a key: https://nometria.com/settings/api-keys';
      let appId = args.app_id;
      if (!appId) {
        const configPath = join(process.cwd(), 'nometria.json');
        if (existsSync(configPath)) {
          const config = JSON.parse(readFileSync(configPath, 'utf8'));
          appId = config.app_id || config.name;
        }
      }
      if (!appId) return 'No app_id specified and no nometria.json found.';
      const result = await apiRequest('/checkAwsStatus', { apiKey, body: { app_id: appId } });
      return `App: ${appId}\nStatus: ${result.status}\nURL: ${result.url || '—'}\nInstance: ${result.instance_type || '—'}\nIP: ${result.ip_address || '—'}`;
    }

    case 'nometria_logs': {
      if (!apiKey) return 'Not authenticated. Use nometria_login to sign in, or set NOMETRIA_API_KEY env var.\nGet a key: https://nometria.com/settings/api-keys';
      let appId = args.app_id;
      if (!appId) {
        const configPath = join(process.cwd(), 'nometria.json');
        if (existsSync(configPath)) {
          const config = JSON.parse(readFileSync(configPath, 'utf8'));
          appId = config.app_id || config.name;
        }
      }
      if (!appId) return 'No app_id specified.';
      const result = await apiRequest('/cli/logs', { apiKey, body: { app_id: appId } });
      return result.lines?.join('\n') || 'No logs available.';
    }

    case 'nometria_list_apps': {
      if (!apiKey) return 'Not authenticated. Use nometria_login to sign in, or set NOMETRIA_API_KEY env var.\nGet a key: https://nometria.com/settings/api-keys';
      const result = await apiRequest('/listUserMigrations', { apiKey, body: {} });
      if (!result.apps?.length) return 'No apps found.';
      return result.apps.map(a =>
        `${a.app_name || a.app_id} (${a.platform}) — ${a.delivery_type}, ${a.payment_status}`
      ).join('\n');
    }

    case 'nometria_init': {
      const dir = args.directory || process.cwd();
      const configPath = join(dir, 'nometria.json');
      // Auto-detect framework via config files and dependencies
      let framework = 'static';
      let buildCmd = null;
      let buildOutput = '.';
      const detectors = [
        { fw: 'nextjs', files: ['next.config.js', 'next.config.mjs', 'next.config.ts'], deps: ['next'], out: '.next' },
        { fw: 'remix', files: ['remix.config.js', 'remix.config.ts'], deps: ['@remix-run/node'], out: 'build' },
        { fw: 'astro', files: ['astro.config.mjs', 'astro.config.ts'], deps: ['astro'], out: 'dist' },
        { fw: 'sveltekit', files: ['svelte.config.js', 'svelte.config.ts'], deps: ['@sveltejs/kit'], out: 'build' },
        { fw: 'nuxt', files: ['nuxt.config.ts', 'nuxt.config.js'], deps: ['nuxt'], out: '.output' },
        { fw: 'vite', files: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'], deps: ['vite'], out: 'dist' },
      ];
      // Check config files first, then deps
      let pkgDeps = {};
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        pkgDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      } catch { /* no package.json */ }
      for (const d of detectors) {
        if (d.files.some(f => existsSync(join(dir, f))) || d.deps.some(dep => pkgDeps[dep])) {
          framework = d.fw;
          buildCmd = 'npm run build';
          buildOutput = d.out;
          break;
        }
      }
      // Check for plain Node.js
      if (framework === 'static' && Object.keys(pkgDeps).length > 0) {
        try {
          const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
          if (pkg.main || pkg.scripts?.start) {
            framework = 'node';
          }
        } catch { /* ignore */ }
      }

      const name = args.name || basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const config = {
        name,
        framework,
        platform: args.platform || 'aws',
        region: 'us-east-1',
        instanceType: '4gb',
        build: buildCmd ? { command: buildCmd, output: buildOutput } : {},
        env: {},
        ignore: [],
      };

      // Detect services
      const svcInfo = _detectServices(dir);
      if (svcInfo.services.length > 0) config.services = svcInfo.services;
      if (svcInfo.docker_compose) config.docker_compose = true;

      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      let msg = `Created nometria.json\nFramework: ${framework}\nPlatform: ${config.platform}`;
      if (svcInfo.services.length > 0) msg += `\nServices: ${svcInfo.services.map(s => `${s.name} (${s.type})`).join(', ')}`;
      if (framework === 'static' && !buildCmd) msg += `\n\nNote: No framework detected. If this isn't a static site, set "framework" in nometria.json manually.`;
      msg += `\n\nNext: use nometria_deploy to deploy.`;
      return msg;
    }

    // GitHub
    case 'nometria_github_connect': {
      if (!apiKey) return 'Not authenticated. Use nometria_login to sign in, or set NOMETRIA_API_KEY env var.\nGet a key: https://nometria.com/settings/api-keys\nOr run `nom login` in your terminal for browser sign-in.';
      return 'GitHub connection requires a browser.\n\nRun this in your terminal:\n  nom github connect\n\nThis opens your browser for GitHub OAuth authorization.';
    }
    case 'nometria_github_status': {
      if (!apiKey) return 'Not authenticated. Use nometria_login to sign in, or set NOMETRIA_API_KEY env var.\nGet a key: https://nometria.com/settings/api-keys';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id. Use nometria_init first.';
      const ghStatus = await apiRequest('/getUserGithubConnection', { apiKey, body: { app_id: appId } });
      return ghStatus.connected ? `GitHub connected as ${ghStatus.github_user}` : 'GitHub not connected. Run `nom github connect` in your terminal.';
    }
    case 'nometria_github_repos': {
      if (!apiKey) return 'Not authenticated. Use nometria_login to sign in, or set NOMETRIA_API_KEY env var.\nGet a key: https://nometria.com/settings/api-keys';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found. Use nometria_init first, or pass app_id as an argument.\nDocs: https://docs.nometria.com/cli/commands';
      const migrationId = readMigrationId();
      if (!migrationId) return 'No migration_id in nometria.json. Run nometria_deploy first.';
      const repos = await apiRequest('/getGithubRepos', { apiKey, body: { migration_id: migrationId } });
      if (!repos.repos?.length) return 'No repos found.';
      return repos.repos.map(r => `${r.full_name} (${r.language || '?'}) ${r.private ? '[private]' : ''}`).join('\n');
    }
    case 'nometria_github_push': {
      if (!apiKey) return 'Not authenticated. Use nometria_login to sign in, or set NOMETRIA_API_KEY env var.\nGet a key: https://nometria.com/settings/api-keys';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found. Use nometria_init first, or pass app_id as an argument.\nDocs: https://docs.nometria.com/cli/commands';
      const migrationId = readMigrationId();
      const push = await apiRequest('/pushGithubChanges', { apiKey, body: { migration_id: migrationId, app_id: appId, commit_message: args.commit_message || 'Update via Claude Code' } });
      return push.success ? 'Pushed to GitHub successfully.' : `Push failed: ${push.error}`;
    }

    // Instance management
    case 'nometria_start': {
      if (!apiKey) return 'Not authenticated. Use nometria_login to sign in, or set NOMETRIA_API_KEY env var.\nGet a key: https://nometria.com/settings/api-keys';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found. Use nometria_init first, or pass app_id as an argument.\nDocs: https://docs.nometria.com/cli/commands';
      const r = await apiRequest('/updateInstanceState', { apiKey, body: { app_id: appId, instance_state: 'start' } });
      return r.success ? 'Instance starting.' : `Failed: ${r.error}`;
    }
    case 'nometria_stop': {
      if (!apiKey) return 'Not authenticated. Use nometria_login to sign in, or set NOMETRIA_API_KEY env var.\nGet a key: https://nometria.com/settings/api-keys';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found. Use nometria_init first, or pass app_id as an argument.\nDocs: https://docs.nometria.com/cli/commands';
      const r = await apiRequest('/updateInstanceState', { apiKey, body: { app_id: appId, instance_state: 'stop' } });
      return r.success ? 'Instance stopped.' : `Failed: ${r.error}`;
    }
    case 'nometria_terminate': {
      if (!apiKey) return 'Not authenticated. Use nometria_login to sign in, or set NOMETRIA_API_KEY env var.\nGet a key: https://nometria.com/settings/api-keys';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found. Use nometria_init first, or pass app_id as an argument.\nDocs: https://docs.nometria.com/cli/commands';
      const r = await apiRequest('/updateInstanceState', { apiKey, body: { app_id: appId, instance_state: 'terminate' } });
      return r.success ? 'Instance terminated.' : `Failed: ${r.error}`;
    }
    case 'nometria_upgrade': {
      if (!apiKey) return 'Not authenticated. Use nometria_login to sign in, or set NOMETRIA_API_KEY env var.\nGet a key: https://nometria.com/settings/api-keys';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found. Use nometria_init first, or pass app_id as an argument.\nDocs: https://docs.nometria.com/cli/commands';
      const r = await apiRequest('/upgradeInstance', { apiKey, body: { app_id: appId, instance_type: args.instance_type } });
      return r.success ? `Upgraded to ${args.instance_type}.` : `Failed: ${r.error}`;
    }

    // Domain, env, scan
    case 'nometria_domain_add': {
      if (!apiKey) return 'Not authenticated. Use nometria_login to sign in, or set NOMETRIA_API_KEY env var.\nGet a key: https://nometria.com/settings/api-keys';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found. Use nometria_init first, or pass app_id as an argument.\nDocs: https://docs.nometria.com/cli/commands';
      const r = await apiRequest('/addCustomDomain', { apiKey, body: { app_id: appId, custom_domain: args.custom_domain } });
      return r.success ? `Domain ${args.custom_domain} added.` : `Failed: ${r.error}`;
    }
    case 'nometria_env_set': {
      if (!apiKey) return 'Not authenticated. Use nometria_login to sign in, or set NOMETRIA_API_KEY env var.\nGet a key: https://nometria.com/settings/api-keys';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found. Use nometria_init first, or pass app_id as an argument.\nDocs: https://docs.nometria.com/cli/commands';
      const r = await apiRequest('/cli/env', { apiKey, body: { app_id: appId, action: 'set', vars: args.vars } });
      return r.success ? `Environment variables updated.` : `Failed: ${r.error}`;
    }
    case 'nometria_env_list': {
      if (!apiKey) return 'Not authenticated. Use nometria_login to sign in, or set NOMETRIA_API_KEY env var.\nGet a key: https://nometria.com/settings/api-keys';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found. Use nometria_init first, or pass app_id as an argument.\nDocs: https://docs.nometria.com/cli/commands';
      const r = await apiRequest('/cli/env', { apiKey, body: { app_id: appId, action: 'list' } });
      if (!r.keys?.length) return 'No environment variables set.';
      return r.keys.join('\n');
    }
    case 'nometria_scan': {
      if (!apiKey) return 'Not authenticated. Use nometria_login to sign in, or set NOMETRIA_API_KEY env var.\nGet a key: https://nometria.com/settings/api-keys';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found. Use nometria_init first, or pass app_id as an argument.\nDocs: https://docs.nometria.com/cli/commands';
      const migrationId = readMigrationId();
      const r = await apiRequest('/runAiScan', { apiKey, body: { app_id: appId, migration_id: migrationId } });
      if (r.error) return `Scan failed: ${r.error}`;
      let out = `Security: ${r.securityScore || '?'}/100\nPerformance: ${r.performanceScore || '?'}/100\nCode Quality: ${r.codeQuality || '?'}/100`;
      if (r.issues?.length) out += `\n\nIssues:\n${r.issues.map(i => `- [${i.severity}] ${i.title}: ${i.description}`).join('\n')}`;
      return out;
    }

    case 'nometria_rollback': {
      if (!apiKey) return 'Not authenticated. Use nometria_login to sign in, or set NOMETRIA_API_KEY env var.\nGet a key: https://nometria.com/settings/api-keys';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found. Use nometria_init first, or pass app_id as an argument.\nDocs: https://docs.nometria.com/cli/commands';
      // List deployments to find target
      let targetId = args.deployment_id;
      if (!targetId) {
        try {
          const depList = await apiRequest('/v1/deployments', { apiKey, body: { app_id: appId } });
          const deployments = depList.deployments || depList.data?.deployments || [];
          if (deployments.length < 2) return 'No previous deployments to roll back to.';
          targetId = deployments[1].id; // previous deployment
        } catch (err) {
          return `Could not fetch deployment history: ${err.message}\nThis app may not support rollback yet.`;
        }
      }
      try {
        const result = await apiRequest(`/v1/deployments/${targetId}/rollback`, { apiKey, body: { app_id: appId } });
        return `Rollback complete.\nRolled back to: ${targetId}\nURL: ${result.url || '—'}\nDashboard: https://nometria.com/AppDetails?app_id=${appId}`;
      } catch (err) {
        return `Rollback failed: ${err.message}\nDashboard: https://nometria.com/AppDetails?app_id=${appId}`;
      }
    }

    case 'nometria_setup': {
      const dir = args.directory || process.cwd();
      try {
        // Generate all AI tool config files
        const files = [];
        const configPath = join(dir, 'nometria.json');
        let config = { name: 'my-app', platform: 'aws' };
        if (existsSync(configPath)) config = { ...config, ...JSON.parse(readFileSync(configPath, 'utf8')) };
        const appName = config.name || 'my-app';
        const platform = config.platform || 'aws';
        const instructions = `This project (${appName}) deploys to ${platform} via Nometria.\nCommands: nom deploy, nom preview, nom status, nom logs, nom github connect\nConfig: nometria.json\nDocs: https://docs.nometria.com`;

        // Write each config file
        const { mkdirSync: mkdir } = await import('node:fs');
        mkdir(join(dir, '.cursor', 'rules'), { recursive: true });
        writeFileSync(join(dir, '.cursor', 'rules', 'nometria.mdc'), `---\ndescription: Nometria deployment\nalwaysApply: true\n---\n\n${instructions}\n`);
        files.push('.cursor/rules/nometria.mdc');

        writeFileSync(join(dir, '.clinerules'), instructions + '\n');
        files.push('.clinerules');

        writeFileSync(join(dir, '.windsurfrules'), instructions + '\n');
        files.push('.windsurfrules');

        mkdir(join(dir, '.github'), { recursive: true });
        writeFileSync(join(dir, '.github', 'copilot-instructions.md'), `# Nometria Deployment\n\n${instructions}\n`);
        files.push('.github/copilot-instructions.md');

        writeFileSync(join(dir, 'CLAUDE.md'), `# ${appName}\n\n${instructions}\n`);
        files.push('CLAUDE.md');

        return `Generated AI tool configs:\n${files.map(f => `  ${f}`).join('\n')}\n\nAll AI tools now know how to deploy with Nometria.`;
      } catch (err) {
        return `Setup failed: ${err.message}. Run \`nom setup\` in the terminal for the full version.`;
      }
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

function readAppId() {
  try {
    const configPath = join(process.cwd(), 'nometria.json');
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      return config.app_id || config.name;
    }
  } catch { /* ignore */ }
  return null;
}

function readMigrationId() {
  try {
    const configPath = join(process.cwd(), 'nometria.json');
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      return config.migration_id || null;
    }
  } catch { /* ignore */ }
  return null;
}

// ── Agnost shim: create a minimal server-like object for trackMCP ────────────
// trackMCP expects an SDK Server with _requestHandlers Map, connect(), etc.
// We create a shim that exposes those, then wire the wrapped handlers into our
// raw JSON-RPC message loop.
const _agnostServer = {
  _requestHandlers: new Map(),
  _transport: null,
  connect(transport) { this._transport = transport; },
  registerTool() {},
};

// Register handlers that agnost can wrap
_agnostServer._requestHandlers.set('initialize', async (params) => params);
_agnostServer._requestHandlers.set('tools/call', async (request) => {
  const result = await handleTool(request.params.name, request.params.arguments || {});
  return { content: [{ type: 'text', text: result }] };
});

if (trackMCP) {
  trackMCP(_agnostServer, 'e1f84d89-0faf-40f1-8d44-809c484f8372');
}

// MCP Protocol implementation (JSON-RPC over stdio)
// Supports both newline-delimited JSON (MCP 2025-11-25, Claude Code v2+)
// and Content-Length framing (MCP 2024-11-05, older clients).
let useContentLength = false; // auto-detect from first message

function send(msg) {
  const json = JSON.stringify(msg);
  if (useContentLength) {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  } else {
    process.stdout.write(json + '\n');
  }
}

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();

  // Auto-detect transport from first bytes
  if (buffer.startsWith('Content-Length:')) {
    useContentLength = true;
  }

  if (useContentLength) {
    // Content-Length framing (legacy)
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }
      const contentLength = parseInt(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + contentLength) break;
      const body = buffer.slice(bodyStart, bodyStart + contentLength);
      buffer = buffer.slice(bodyStart + contentLength);
      try { handleMessage(JSON.parse(body)); } catch { /* skip */ }
    }
  } else {
    // Newline-delimited JSON (MCP 2025-11-25)
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      try { handleMessage(JSON.parse(line)); } catch { /* skip */ }
    }
  }
});

async function handleMessage(msg) {
  if (msg.method === 'initialize') {
    // Echo back the client's protocol version for compatibility
    const clientVersion = msg.params?.protocolVersion || '2024-11-05';
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: clientVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'nometria', version: '0.2.8' },
      },
    });
  } else if (msg.method === 'notifications/initialized') {
    // No response needed
  } else if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { tools: TOOLS },
    });
  } else if (msg.method === 'tools/call') {
    try {
      // Route through agnost-wrapped handler if available
      const wrappedHandler = _agnostServer._requestHandlers.get('tools/call');
      let result;
      if (wrappedHandler && trackMCP) {
        result = await wrappedHandler(msg);
      } else {
        const text = await handleTool(msg.params.name, msg.params.arguments || {});
        result = { content: [{ type: 'text', text }] };
      }
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result,
      });
    } catch (err) {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        },
      });
    }
  } else if (msg.id) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
  }
}

process.stdin.resume();

// ─── Exports for programmatic use ───────────────────────────────────────────
export { TOOLS };
