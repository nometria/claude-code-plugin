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
  // agnost not installed - analytics disabled
  trackMCP = null;
  checkpoint = () => {};
}

// MCP Protocol via stdio (raw Content-Length framing, no readline)

const TOOLS = [
  // ── Authentication ──────────────────────────────────────────────────────────
  {
    name: 'nometria_login',
    description: 'Authenticate with Nometria. Provide an API key (starts with nometria_sk_) or omit to get sign-in instructions. Must be called before any other tool if not already authenticated. Keys are available at https://nometria.com/settings/api-keys.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        api_key: { type: 'string', description: 'Your Nometria API key (starts with nometria_sk_). If not provided, shows instructions.' },
      },
    },
  },
  // ── Deployment ──────────────────────────────────────────────────────────────
  {
    name: 'nometria_deploy',
    description: 'Deploy the current project to production. Builds locally, uploads the archive, and triggers cloud deployment. For testing changes first, use nometria_preview instead. Requires nometria.json (use nometria_init to create). Supports AWS, GCP, Azure, DigitalOcean, Hetzner, and Vercel.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Project directory to deploy (default: current dir)' },
      },
    },
  },
  {
    name: 'nometria_preview',
    description: 'Create a free temporary staging preview. Deploys to an isolated sandbox that expires in 2 hours. Use this to test before deploying to production with nometria_deploy. No billing - previews are always free.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Project directory (default: current dir)' },
      },
    },
  },
  {
    name: 'nometria_rollback',
    description: 'Roll back to a previous deployment version. If no deployment_id is specified, rolls back to the immediately previous version. Use nometria_status to check current state after rollback.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' },
        deployment_id: { type: 'string', description: 'Target deployment ID to roll back to (omit for previous)' },
      },
    },
  },
  // ── Monitoring ──────────────────────────────────────────────────────────────
  {
    name: 'nometria_status',
    description: 'Check deployment status, instance state, URL, and IP address for an app. Use this to verify a deploy completed successfully or to check if an instance is running.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID or name (reads from nometria.json if omitted)' },
      },
    },
  },
  {
    name: 'nometria_logs',
    description: 'View recent deployment and application logs. Use this to debug deploy failures, check runtime errors, or monitor app behavior.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID or name (reads from nometria.json if omitted)' },
      },
    },
  },
  {
    name: 'nometria_list_apps',
    description: 'List all deployed apps with their status, platform, and payment info. Use this to find app IDs or get an overview of all deployments.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nometria_info',
    description: 'Get comprehensive project context in a single call: app name, framework, platform, status, URL, instance type, services, env var keys, GitHub connection, and estimated cost. Use this first to understand the current state before taking any action.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' },
      },
    },
  },
  // ── Configuration ───────────────────────────────────────────────────────────
  {
    name: 'nometria_init',
    description: 'Initialize a nometria.json config file. Auto-detects framework (Next.js, Vite, Remix, Astro, SvelteKit, Nuxt, Node.js, Python, Deno), build commands, and multi-service architecture. Run this before first deploy.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Project directory (default: current dir)' },
        name: { type: 'string', description: 'Project name' },
        platform: { type: 'string', description: 'Cloud platform: aws, gcp, azure, digitalocean, hetzner, vercel', default: 'aws' },
      },
    },
  },
  {
    name: 'nometria_setup',
    description: 'Generate AI tool config files so every IDE and agent knows how to deploy this project. Creates: .cursor/rules, .clinerules, .windsurfrules, CLAUDE.md, .github/copilot-instructions.md, GitHub Action workflow, and Continue.dev config.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: { directory: { type: 'string', description: 'Project directory (default: current dir)' } } },
  },
  // ── GitHub Integration ──────────────────────────────────────────────────────
  {
    name: 'nometria_github_connect',
    description: 'Connect GitHub for auto-deploy on push. Requires browser - instructs the user to run `nom github connect` in their terminal for OAuth authorization.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: { app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' } } },
  },
  {
    name: 'nometria_github_status',
    description: 'Check if GitHub auto-deploy is connected for this app and which GitHub user is linked.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: { app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' } } },
  },
  {
    name: 'nometria_github_repos',
    description: 'List GitHub repos connected to your Nometria account. Useful for verifying which repo is linked to an app.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: { app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' } } },
  },
  {
    name: 'nometria_github_push',
    description: 'Push local code changes to the connected GitHub repo. Triggers auto-deploy if GitHub integration is active.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: { type: 'object', properties: { app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' }, commit_message: { type: 'string', description: 'Git commit message' } } },
  },
  // ── Instance Management ─────────────────────────────────────────────────────
  {
    name: 'nometria_start',
    description: 'Start a stopped instance. Use this after nometria_stop to resume the app. Instance retains all data and configuration.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: { app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' } } },
  },
  {
    name: 'nometria_stop',
    description: 'Stop a running instance to save costs. The instance is paused - data is preserved. Use nometria_start to resume. Billing pauses while stopped.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: { app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' } } },
  },
  {
    name: 'nometria_terminate',
    description: 'PERMANENTLY delete an instance and all its data. This is irreversible - the app, database, and files are destroyed. Use nometria_stop instead if you want to pause temporarily.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: { type: 'object', properties: { app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' } } },
  },
  {
    name: 'nometria_upgrade',
    description: 'Resize an instance. Available sizes: 2gb ($39/mo), 4gb ($49/mo), 8gb ($79/mo), 16gb ($129/mo). The instance restarts during upgrade. No data loss.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: { app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' }, instance_type: { type: 'string', description: '2gb | 4gb | 8gb | 16gb' } }, required: ['instance_type'] },
  },
  // ── Domains & Environment ───────────────────────────────────────────────────
  {
    name: 'nometria_domain_add',
    description: 'Add a custom domain to your app with automatic SSL/TLS certificate provisioning via Let\'s Encrypt. Point your domain\'s DNS to the instance IP first, then add it here.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: { app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' }, custom_domain: { type: 'string', description: 'Domain name (e.g., app.example.com)' } }, required: ['custom_domain'] },
  },
  {
    name: 'nometria_env_set',
    description: 'Set environment variables on the deployed instance. Variables are injected into the app process and persisted across resyncs. Use for API keys, database URLs, feature flags.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: { app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' }, vars: { type: 'object', description: 'Key-value pairs to set, e.g. {"DATABASE_URL": "postgres://...", "API_KEY": "sk-..."}' } }, required: ['vars'] },
  },
  {
    name: 'nometria_env_list',
    description: 'List all environment variable keys set on the deployed instance. Returns key names only (not values) for security.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: { app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' } } },
  },
  // ── Security & Scanning ─────────────────────────────────────────────────────
  {
    name: 'nometria_scan',
    description: 'Run an AI-powered security and performance audit. Returns scores (0-100) for security, performance, and code quality, plus actionable issues with severity levels and fix suggestions.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: { app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' } } },
  },
  // ── Backend Services (Database, Cache, Storage) ─────────────────────────────
  {
    name: 'nometria_services_add',
    description: 'Add a backend service (database, cache, or storage) to your deployed instance. Provisions a Docker container with auto-generated credentials and injects the connection string as an environment variable. Available: postgres, mysql, mongodb, redis, minio.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' },
        service: { type: 'string', enum: ['postgres', 'mysql', 'mongodb', 'redis', 'minio'], description: 'Service type to provision' },
      },
      required: ['service'],
    },
  },
  {
    name: 'nometria_services_list',
    description: 'List all backend services running on the instance with their type, version, port, and connection string. Use this to check what databases and caches are available.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' },
      },
    },
  },
  {
    name: 'nometria_services_remove',
    description: 'Remove a backend service from the instance. WARNING: This deletes the service container and its data. Create a backup first with nom db backup.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' },
        service: { type: 'string', description: 'Service name to remove (e.g., postgres, mysql, redis)' },
      },
      required: ['service'],
    },
  },
  // ── Database Operations ─────────────────────────────────────────────────────
  {
    name: 'nometria_db_query',
    description: 'Execute a read-only SQL query against a PostgreSQL or MySQL database on the instance. Returns results as JSON. Queries are wrapped in a read-only transaction - DDL and writes are blocked. For schema changes, use nometria_db_create_table.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' },
        query: { type: 'string', description: 'SQL query to execute (SELECT only)' },
        database: { type: 'string', enum: ['postgres', 'mysql'], description: 'Database engine (default: postgres)', default: 'postgres' },
        target: { type: 'string', enum: ['standalone', 'supabase'], description: 'Which DB to query: "standalone" = the postgres/mysql container provisioned by `nom services add`; "supabase" = the self-hosted Supabase Postgres (default: standalone)', default: 'standalone' },
      },
      required: ['query'],
    },
  },
  {
    name: 'nometria_db_tables',
    description: 'List all tables in the database with row counts and column info. Use this to understand the database schema before writing queries.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' },
        database: { type: 'string', enum: ['postgres', 'mysql'], description: 'Database engine (default: postgres)', default: 'postgres' },
        target: { type: 'string', enum: ['standalone', 'supabase'], description: 'Which DB: standalone (nom services add) or supabase (default: standalone)', default: 'standalone' },
      },
    },
  },
  {
    name: 'nometria_db_describe',
    description: 'Describe a table\'s schema: columns, data types, constraints, indexes, and foreign keys. Use this before writing queries or creating related tables.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' },
        table_name: { type: 'string', description: 'Table name to describe' },
        database: { type: 'string', enum: ['postgres', 'mysql'], description: 'Database engine (default: postgres)', default: 'postgres' },
        target: { type: 'string', enum: ['standalone', 'supabase'], description: 'Which DB: standalone or supabase (default: standalone)', default: 'standalone' },
      },
      required: ['table_name'],
    },
  },
  {
    name: 'nometria_db_create_table',
    description: 'Create a new database table. Generates and executes CREATE TABLE SQL with the specified columns. Automatically adds id (UUID), created_at, and updated_at columns.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' },
        table_name: { type: 'string', description: 'Table name (lowercase, underscores)' },
        columns: {
          type: 'array',
          description: 'Column definitions',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Column name' },
              type: { type: 'string', description: 'SQL type (text, integer, boolean, timestamp, jsonb, uuid, varchar(255), etc.)' },
              nullable: { type: 'boolean', description: 'Allow NULL values (default: true)', default: true },
              default_value: { type: 'string', description: 'Default value expression' },
            },
            required: ['name', 'type'],
          },
        },
        database: { type: 'string', enum: ['postgres', 'mysql'], description: 'Database engine (default: postgres)', default: 'postgres' },
        target: { type: 'string', enum: ['standalone', 'supabase'], description: 'Which DB: standalone or supabase (default: standalone)', default: 'standalone' },
      },
      required: ['table_name', 'columns'],
    },
  },
  // ── Webhook Management ──────────────────────────────────────────────────────
  {
    name: 'nometria_webhook_add',
    description: 'Add a webhook URL to receive notifications for deployment events. Supports: deploy.started, deploy.success, deploy.failed, preview.created, instance.started, instance.stopped, backup.completed.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' },
        url: { type: 'string', description: 'Webhook URL to receive POST notifications' },
        events: {
          type: 'array',
          items: { type: 'string', enum: ['deploy.started', 'deploy.success', 'deploy.failed', 'preview.created', 'instance.started', 'instance.stopped', 'backup.completed'] },
          description: 'Events to subscribe to (default: all events)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'nometria_webhook_list',
    description: 'List all configured webhooks for an app with their URLs and subscribed events.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' },
      },
    },
  },
  {
    name: 'nometria_webhook_delete',
    description: 'Remove a webhook subscription.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID (reads from nometria.json if omitted)' },
        webhook_id: { type: 'string', description: 'Webhook ID to delete' },
      },
      required: ['webhook_id'],
    },
  },
  // ── Documentation ───────────────────────────────────────────────────────────
  {
    name: 'nometria_help',
    description: 'Get documentation about Nometria features. Use this when you need to understand how a feature works before using it. Covers deployment, databases, services, auth, domains, and troubleshooting.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: ['overview', 'deploy', 'preview', 'services', 'database', 'env', 'domains', 'github', 'auth', 'storage', 'webhooks', 'troubleshooting'],
          description: 'Documentation topic',
        },
      },
      required: ['topic'],
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

// ── Database command builder ──────────────────────────────────────────────────
// Resolves the right shell command for the given (database, target) combo.
//   target='standalone' → query the docker container provisioned by `nom services add`
//                          (reads password from /home/ubuntu/services/state.json)
//   target='supabase'   → query the self-hosted Supabase Postgres
//                          (reads POSTGRES_PASSWORD from /home/ubuntu/supabase${APP_ID}/.env)
function _buildDbCommand(database, target, op, params) {
  const sql = (params.sql || params.query || '').replace(/"/g, '\\"');
  const table = params.table || '';

  if (database === 'postgres' && target === 'supabase') {
    // Self-hosted Supabase: read POSTGRES_PASSWORD from supabase .env, exec inside container
    const pgCmd = (q) =>
      `SUPA_DIR=$(ls -d /home/ubuntu/supabase* 2>/dev/null | head -1); ` +
      `PG_PASS=$(grep -E '^POSTGRES_PASSWORD=' "$SUPA_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\\"'); ` +
      `PG_CTR=$(docker ps --filter name=supabase-db --format '{{.Names}}' | head -1); ` +
      `docker exec -e PGPASSWORD="$PG_PASS" -e PGSSLMODE=disable "$PG_CTR" ` +
      `psql -U postgres -d postgres -c "${q}" --csv`;

    if (op === 'query') return pgCmd(sql);
    if (op === 'tables') return pgCmd(`SELECT tablename, pg_total_relation_size('public.'||tablename) AS size_bytes FROM pg_tables WHERE schemaname='public' ORDER BY tablename;`);
    if (op === 'describe') return pgCmd(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' ORDER BY ordinal_position;`);
    if (op === 'exec') return pgCmd(sql);
  }

  if (database === 'postgres') {
    // Standalone postgres (nom services add postgres): nometria-postgres container
    const pgCmd = (q) =>
      `PG_PASS=$(python3 -c "import json; s=json.load(open('/home/ubuntu/services/state.json')); ` +
      `[print(x['password']) for x in s.get('services',[]) if x['type']=='postgres']" 2>/dev/null); ` +
      `docker exec -e PGPASSWORD="$PG_PASS" nometria-postgres ` +
      `psql -U nometria -d app -c "${q}" --csv`;

    if (op === 'query') return pgCmd(sql);
    if (op === 'tables') return pgCmd(`SELECT tablename, pg_total_relation_size('public.'||tablename) AS size_bytes FROM pg_tables WHERE schemaname='public' ORDER BY tablename;`);
    if (op === 'describe') return pgCmd(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' ORDER BY ordinal_position;`);
    if (op === 'exec') return pgCmd(sql);
  }

  if (database === 'mysql') {
    // Standalone mysql: nometria-mysql container, password from state.json
    const mysqlCmd = (q) =>
      `MY_PASS=$(python3 -c "import json; s=json.load(open('/home/ubuntu/services/state.json')); ` +
      `[print(x['password']) for x in s.get('services',[]) if x['type']=='mysql']" 2>/dev/null); ` +
      `docker exec nometria-mysql mysql -u nometria -p"$MY_PASS" app -e "${q}" --batch 2>&1 | grep -v 'Using a password'`;

    if (op === 'query') return mysqlCmd(sql);
    if (op === 'tables') return mysqlCmd('SHOW TABLES;');
    if (op === 'describe') return mysqlCmd(`DESCRIBE ${table};`);
    if (op === 'exec') return mysqlCmd(sql);
  }

  throw new Error(`Unsupported database='${database}' target='${target}' op='${op}'`);
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
        return 'Not authenticated.\n\nTo sign in:\n  1. Run `nom login` in your terminal (opens browser - easiest)\n  2. Or get an API key at https://nometria.com/settings/api-keys and call this tool with the api_key argument\n  3. Or set NOMETRIA_API_KEY environment variable';
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
      return `App: ${appId}\nStatus: ${result.status}\nURL: ${result.url || '-'}\nInstance: ${result.instance_type || '-'}\nIP: ${result.ip_address || '-'}`;
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
        `${a.app_name || a.app_id} (${a.platform}) - ${a.delivery_type}, ${a.payment_status}`
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
        return `Rollback complete.\nRolled back to: ${targetId}\nURL: ${result.url || '-'}\nDashboard: https://nometria.com/AppDetails?app_id=${appId}`;
      } catch (err) {
        return `Rollback failed: ${err.message}\nDashboard: https://nometria.com/AppDetails?app_id=${appId}`;
      }
    }

    // ── nometria_info - comprehensive project context ──────────────────────
    case 'nometria_info': {
      if (!apiKey) return 'Not authenticated. Use nometria_login first.';
      const appId = args.app_id || readAppId();
      const dir = process.cwd();
      const configPath = join(dir, 'nometria.json');
      let config = {};
      if (existsSync(configPath)) {
        try { config = JSON.parse(readFileSync(configPath, 'utf8')); } catch { /* ignore */ }
      }
      const PRICING = { '2gb': 39, '4gb': 49, '8gb': 79, '16gb': 129 };
      const instanceSize = config.instanceType || '4gb';
      const info = {
        app_name: config.name || appId || '(not configured)',
        framework: config.framework || 'unknown',
        platform: config.platform || 'aws',
        region: config.region || 'us-east-1',
        instance_type: instanceSize,
        estimated_cost: `$${PRICING[instanceSize] || '??'}/month`,
        app_id: config.app_id || null,
        services_infra: config.services_infra || [],
        services: config.services || [],
        docker_compose: config.docker_compose || false,
      };
      // Fetch live status if deployed
      if (appId) {
        try {
          const status = await apiRequest('/checkAwsStatus', { apiKey, body: { app_id: appId } });
          const d = status.data || status;
          info.status = d.deploymentStatus || d.instanceState || status.status || 'unknown';
          info.url = d.deployUrl || d.url || `https://${appId}.ownmy.app`;
          info.ip_address = d.ipAddress || null;
        } catch { info.status = 'unknown'; }
        // Check GitHub
        try {
          const gh = await apiRequest('/getUserGithubConnection', { apiKey, body: { app_id: appId } });
          info.github_connected = !!gh.connected;
          if (gh.github_user) info.github_user = gh.github_user;
        } catch { info.github_connected = false; }
        // Check env vars
        try {
          const env = await apiRequest('/cli/env', { apiKey, body: { app_id: appId, action: 'list' } });
          info.env_vars = env.keys || [];
        } catch { info.env_vars = []; }
      }
      return JSON.stringify(info, null, 2);
    }

    // ── nometria_help - embedded documentation ───────────────────────────────
    case 'nometria_help': {
      const HELP_TOPICS = {
        overview: `# Nometria Overview
Nometria deploys any project to any cloud (AWS, GCP, Azure, DigitalOcean, Hetzner, Vercel).

Quick start:
1. nometria_init - Create config (auto-detects framework)
2. nometria_deploy - Deploy to production
3. nometria_status - Check deployment

Supported frameworks: Next.js, Vite, Remix, Astro, SvelteKit, Nuxt, Node.js, Python, Deno, static sites.
Instance sizes: 2gb ($39/mo), 4gb ($49/mo), 8gb ($79/mo), 16gb ($129/mo).

Backend services: Add databases (PostgreSQL, MySQL, MongoDB), caches (Redis), and storage (MinIO) with nometria_services_add.`,

        deploy: `# Deployment
First deploy (~2-5 min): Creates instance, provisions infrastructure, deploys code.
Subsequent deploys (~1 min): Resyncs code only (faster).

Flow: Build locally → Upload archive → Trigger cloud deploy → Poll for completion.

Commands:
- nometria_deploy - Production deploy
- nometria_preview - Free 2-hour staging preview
- nometria_rollback - Roll back to previous version
- nometria_status - Check deploy status

Config: nometria.json controls framework, platform, region, instance size, build command.
Dry run: Use --dry-run flag with CLI to validate without deploying.`,

        preview: `# Staging Previews
Free temporary deployments for testing before production.
- Expire after 2 hours
- No billing
- Isolated from production
- Full build + deploy pipeline

Use nometria_preview to create one. Share the URL for review.`,

        services: `# Backend Services
Add databases, caches, and storage to your deployed instance.

Available services:
- postgres - PostgreSQL 16 (port 5432)
- mysql - MySQL 8.4 (port 3306)
- mongodb - MongoDB 7 (port 27017)
- redis - Redis 7 (port 6379)
- minio - MinIO S3-compatible storage (port 9000/9001)

Commands:
- nometria_services_add - Provision a new service
- nometria_services_list - List running services
- nometria_services_remove - Remove a service

Each service runs as a Docker container with auto-generated credentials.
Connection strings are automatically injected as environment variables.`,

        database: `# Database Management
Nometria provides full database lifecycle management.

Query: nometria_db_query - Run read-only SQL queries
Schema: nometria_db_tables - List all tables
Schema: nometria_db_describe - Describe table columns
Create: nometria_db_create_table - Create tables with auto id/timestamps

Backups: Daily automated backups to S3 + on-demand via CLI (nom db backup).
Restore: nom db restore <backup_id>
Migrations: Auto-detects Drizzle, Prisma, or custom migration scripts.
Shell: nom db shell - Shows connection instructions (SSH tunnel or SSM).`,

        env: `# Environment Variables
Manage app configuration securely.

- nometria_env_set - Set key-value pairs
- nometria_env_list - List keys (values hidden for security)

Variables persist across resyncs.
Use @env: prefix in nometria.json to read from local env at deploy time.
Sensitive patterns (API keys, tokens) trigger warnings in CLI.`,

        domains: `# Custom Domains
Add your own domain with automatic SSL.

Steps:
1. Point your domain's DNS A record to your instance IP (use nometria_status to get IP)
2. Run nometria_domain_add with your domain
3. SSL certificate auto-provisions via Let's Encrypt

Subdomains: *.ownmy.app auto-assigned. Custom domains require DNS setup.`,

        github: `# GitHub Integration
Connect for auto-deploy on every push.

- nometria_github_connect - Set up OAuth (requires browser)
- nometria_github_status - Check connection
- nometria_github_push - Push code changes

After connecting, every git push triggers an automatic resync.`,

        auth: `# Authentication
Nometria apps include built-in auth via Supabase Auth (when Supabase is provisioned).

Features:
- Email/password registration and login
- OAuth providers: Google, GitHub, Microsoft, Discord, LinkedIn, X, Apple
- Magic links and email verification
- JWT-based sessions with Row Level Security (RLS)
- Password reset flow

Auth is auto-provisioned with Supabase. For standalone databases, implement auth in your app code.`,

        storage: `# Object Storage
Two options for file storage:

1. Supabase Storage (auto-provisioned with Supabase)
   - S3-compatible API
   - Bucket management with public/private visibility
   - Direct uploads and presigned URLs

2. MinIO (via nometria_services_add minio)
   - S3-compatible API on port 9000
   - Web console on port 9001
   - Use any S3 SDK to interact

Connection details injected as env vars after provisioning.`,

        webhooks: `# Webhooks
Receive HTTP POST notifications for deployment events.

Events: deploy.started, deploy.success, deploy.failed, preview.created,
        instance.started, instance.stopped, backup.completed

Commands:
- nometria_webhook_add - Subscribe a URL to events
- nometria_webhook_list - List all webhooks
- nometria_webhook_delete - Remove a webhook

Payload includes: event type, app_id, timestamp, and event-specific data.`,

        troubleshooting: `# Troubleshooting

Build fails:
- Check nometria.json build.command
- Run the build command locally first
- Ensure Node.js version compatibility

Deploy stuck:
- Use nometria_status to check state
- Use nometria_logs to view errors
- Dashboard: https://nometria.com/dashboard

Auth errors:
- Run nom login for browser sign-in
- Or get API key at https://nometria.com/settings/api-keys
- Set NOMETRIA_API_KEY env var

Database connection issues:
- Use nometria_services_list to verify service is running
- Check env vars with nometria_env_list
- Use nom db shell for direct connection instructions

Instance won't start:
- Check billing: https://nometria.com/dashboard
- Try nometria_start
- If persistent, contact support

Docs: https://docs.nometria.com`,
      };
      return HELP_TOPICS[args.topic] || `Unknown topic: ${args.topic}. Available: ${Object.keys(HELP_TOPICS).join(', ')}`;
    }

    // ── Backend Services Management ──────────────────────────────────────────
    case 'nometria_services_add': {
      if (!apiKey) return 'Not authenticated. Use nometria_login first.';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found. Deploy first with nometria_deploy, or pass app_id.';
      const service = args.service;
      const validServices = ['postgres', 'mysql', 'mongodb', 'redis', 'minio'];
      if (!validServices.includes(service)) return `Invalid service: ${service}. Available: ${validServices.join(', ')}`;
      try {
        const result = await apiRequest('/cli/services', { apiKey, body: { app_id: appId, action: 'add', service } });
        let msg = `${service} provisioned successfully.`;
        if (result.connection_string) msg += `\nConnection: ${result.connection_string}`;
        if (result.env_var) msg += `\nEnv var set: ${result.env_var}`;
        if (result.port) msg += `\nPort: ${result.port}`;
        msg += '\n\nThe connection string has been auto-injected as an environment variable.';
        return msg;
      } catch (err) {
        return `Failed to add ${service}: ${err.message}\nMake sure the instance is running (use nometria_status to check).`;
      }
    }
    case 'nometria_services_list': {
      if (!apiKey) return 'Not authenticated. Use nometria_login first.';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found. Deploy first with nometria_deploy, or pass app_id.';
      try {
        const result = await apiRequest('/cli/services', { apiKey, body: { app_id: appId, action: 'list' } });
        const services = result.services || [];
        if (!services.length) return 'No backend services running.\n\nAdd one with nometria_services_add (postgres, mysql, mongodb, redis, minio).';
        return services.map(s =>
          `${s.name || s.type} (${s.type}:${s.version || 'latest'})\n  Port: ${s.port}\n  Status: ${s.status || 'running'}\n  Connection: ${s.connection_string || '-'}`
        ).join('\n\n');
      } catch (err) {
        return `Failed to list services: ${err.message}`;
      }
    }
    case 'nometria_services_remove': {
      if (!apiKey) return 'Not authenticated. Use nometria_login first.';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found.';
      try {
        const result = await apiRequest('/cli/services', { apiKey, body: { app_id: appId, action: 'remove', service: args.service } });
        return result.success ? `${args.service} removed.` : `Failed: ${result.error}`;
      } catch (err) {
        return `Failed to remove ${args.service}: ${err.message}`;
      }
    }

    // ── Database Operations ──────────────────────────────────────────────────
    case 'nometria_db_query': {
      if (!apiKey) return 'Not authenticated. Use nometria_login first.';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found.';
      const query = args.query?.trim();
      if (!query) return 'No query provided.';
      // Block write operations
      const upperQ = query.toUpperCase().replace(/\s+/g, ' ');
      const blocked = ['INSERT ', 'UPDATE ', 'DELETE ', 'DROP ', 'ALTER ', 'CREATE ', 'TRUNCATE ', 'GRANT ', 'REVOKE '];
      if (blocked.some(kw => upperQ.startsWith(kw) || upperQ.includes(` ${kw}`))) {
        return 'Write operations are not allowed via nometria_db_query. Use nometria_db_create_table for schema changes.';
      }
      try {
        const db = args.database || 'postgres';
        const target = args.target || 'standalone'; // 'standalone' | 'supabase'
        const cmd = _buildDbCommand(db, target, 'query', { query });
        const result = await apiRequest('/cli/exec', {
          apiKey,
          body: { app_id: appId, command: cmd },
        });
        return result.output || result.stdout || '(no results)';
      } catch (err) {
        return `Query failed: ${err.message}`;
      }
    }
    case 'nometria_db_tables': {
      if (!apiKey) return 'Not authenticated. Use nometria_login first.';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found.';
      try {
        const db = args.database || 'postgres';
        const target = args.target || 'standalone';
        const cmd = _buildDbCommand(db, target, 'tables', {});
        const result = await apiRequest('/cli/exec', { apiKey, body: { app_id: appId, command: cmd } });
        return result.output || result.stdout || 'No tables found.';
      } catch (err) {
        return `Failed to list tables: ${err.message}`;
      }
    }
    case 'nometria_db_describe': {
      if (!apiKey) return 'Not authenticated. Use nometria_login first.';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found.';
      const table = args.table_name;
      if (!table) return 'No table_name provided.';
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) return 'Invalid table name.';
      try {
        const db = args.database || 'postgres';
        const target = args.target || 'standalone';
        const cmd = _buildDbCommand(db, target, 'describe', { table });
        const result = await apiRequest('/cli/exec', { apiKey, body: { app_id: appId, command: cmd } });
        return result.output || result.stdout || `Table '${table}' not found.`;
      } catch (err) {
        return `Failed to describe table: ${err.message}`;
      }
    }
    case 'nometria_db_create_table': {
      if (!apiKey) return 'Not authenticated. Use nometria_login first.';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found.';
      const tableName = args.table_name;
      if (!tableName || !/^[a-z_][a-z0-9_]*$/.test(tableName)) return 'Invalid table_name. Use lowercase letters, numbers, and underscores.';
      const columns = args.columns;
      if (!columns?.length) return 'No columns provided.';
      try {
        const db = args.database || 'postgres';
        const target = args.target || 'standalone';
        // Build CREATE TABLE SQL
        const colDefs = columns.map(c => {
          if (!/^[a-z_][a-z0-9_]*$/.test(c.name)) throw new Error(`Invalid column name: ${c.name}`);
          let def = `${c.name} ${c.type}`;
          if (c.nullable === false) def += ' NOT NULL';
          if (c.default_value) def += ` DEFAULT ${c.default_value}`;
          return def;
        });
        // Auto-add id, created_at, updated_at
        const autoColumns = db === 'postgres'
          ? ['id UUID PRIMARY KEY DEFAULT gen_random_uuid()', 'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()', 'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()']
          : ['id CHAR(36) PRIMARY KEY DEFAULT (UUID())', 'created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP', 'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'];
        const allCols = [...autoColumns, ...colDefs];
        const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (${allCols.join(', ')});`;
        const cmd = _buildDbCommand(db, target, 'exec', { sql });
        const result = await apiRequest('/cli/exec', { apiKey, body: { app_id: appId, command: cmd } });
        return `Table '${tableName}' created successfully.\nColumns: id, created_at, updated_at, ${columns.map(c => c.name).join(', ')}\n\n${result.output || result.stdout || ''}`;
      } catch (err) {
        return `Failed to create table: ${err.message}`;
      }
    }

    // ── Webhook Management ───────────────────────────────────────────────────
    case 'nometria_webhook_add': {
      if (!apiKey) return 'Not authenticated. Use nometria_login first.';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found.';
      try {
        const result = await apiRequest('/cli/webhooks', {
          apiKey,
          body: { app_id: appId, action: 'add', url: args.url, events: args.events || [] },
        });
        return `Webhook added.\nID: ${result.webhook_id || '-'}\nURL: ${args.url}\nEvents: ${(args.events || ['all']).join(', ')}`;
      } catch (err) {
        return `Failed to add webhook: ${err.message}`;
      }
    }
    case 'nometria_webhook_list': {
      if (!apiKey) return 'Not authenticated. Use nometria_login first.';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found.';
      try {
        const result = await apiRequest('/cli/webhooks', { apiKey, body: { app_id: appId, action: 'list' } });
        const hooks = result.webhooks || [];
        if (!hooks.length) return 'No webhooks configured.\n\nAdd one with nometria_webhook_add.';
        return hooks.map(h => `${h.id}: ${h.url}\n  Events: ${(h.events || ['all']).join(', ')}\n  Created: ${h.created_at || '-'}`).join('\n\n');
      } catch (err) {
        return `Failed to list webhooks: ${err.message}`;
      }
    }
    case 'nometria_webhook_delete': {
      if (!apiKey) return 'Not authenticated. Use nometria_login first.';
      const appId = args.app_id || readAppId();
      if (!appId) return 'No app_id found.';
      try {
        const result = await apiRequest('/cli/webhooks', { apiKey, body: { app_id: appId, action: 'delete', webhook_id: args.webhook_id } });
        return result.success ? 'Webhook deleted.' : `Failed: ${result.error}`;
      } catch (err) {
        return `Failed to delete webhook: ${err.message}`;
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
        serverInfo: { name: 'nometria', version: '0.3.2' },
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
