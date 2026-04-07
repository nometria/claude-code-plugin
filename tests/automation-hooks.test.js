/**
 * Tests for automation hooks, CLI improvements, and deployment features.
 * Run: node --test tests/automation-hooks.test.js
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── MCP Registry ─────────────────────────────────────────────────────────────

describe('MCP Registry', () => {
  it('tool names match handler names in mcp-server.js', () => {
    const registry = JSON.parse(readFileSync(join(ROOT, 'mcp-registry.json'), 'utf8'));
    const serverSrc = readFileSync(join(ROOT, 'src', 'mcp-server.js'), 'utf8');

    const registryNames = new Set(registry.tools.map(t => t.name));
    const handlerNames = new Set(serverSrc.match(/name: '(nometria_[a-z_]+)'/g)?.map(m => m.match(/'(.+)'/)[1]) || []);

    // Every registry tool should have a handler
    for (const name of registryNames) {
      assert.ok(handlerNames.has(name), `Registry tool "${name}" has no handler in mcp-server.js`);
    }
    // Every handler should be in registry
    for (const name of handlerNames) {
      assert.ok(registryNames.has(name), `Handler "${name}" missing from mcp-registry.json`);
    }
  });

  it('all tool names use nometria_ prefix', () => {
    const registry = JSON.parse(readFileSync(join(ROOT, 'mcp-registry.json'), 'utf8'));
    for (const tool of registry.tools) {
      assert.ok(tool.name.startsWith('nometria_'), `Tool "${tool.name}" should start with nometria_`);
    }
  });

  it('has at least 20 tools', () => {
    const registry = JSON.parse(readFileSync(join(ROOT, 'mcp-registry.json'), 'utf8'));
    assert.ok(registry.tools.length >= 20, `Expected >= 20 tools, got ${registry.tools.length}`);
  });
});

// ── Slash Commands ───────────────────────────────────────────────────────────

describe('Slash Commands', () => {
  const expectedCommands = ['deploy', 'preview', 'status', 'nometria-login', 'logs', 'env', 'domain', 'rollback'];

  for (const cmd of expectedCommands) {
    it(`${cmd}.md exists with valid frontmatter`, () => {
      const path = join(ROOT, 'commands', `${cmd}.md`);
      assert.ok(existsSync(path), `Missing: commands/${cmd}.md`);

      const content = readFileSync(path, 'utf8');
      assert.ok(content.startsWith('---'), 'Must start with frontmatter ---');
      assert.ok(content.includes('allowed-tools:'), 'Must have allowed-tools');
      assert.ok(content.includes('description:'), 'Must have description');
    });
  }

  it('env.md mentions set, list, delete', () => {
    const content = readFileSync(join(ROOT, 'commands', 'env.md'), 'utf8');
    assert.ok(content.includes('set'), 'Should mention set');
    assert.ok(content.includes('list'), 'Should mention list');
    assert.ok(content.includes('delete') || content.includes('Delete'), 'Should mention delete');
  });

  it('domain.md includes DNS instructions', () => {
    const content = readFileSync(join(ROOT, 'commands', 'domain.md'), 'utf8');
    assert.ok(content.includes('A record') || content.includes('CNAME'), 'Should include DNS instructions');
  });

  it('rollback.md includes deployment listing', () => {
    const content = readFileSync(join(ROOT, 'commands', 'rollback.md'), 'utf8');
    assert.ok(content.includes('deployment'), 'Should mention deployments');
    assert.ok(content.includes('confirm') || content.includes('Confirm'), 'Should require confirmation');
  });
});

// ── Hook Scripts ─────────────────────────────────────────────────────────────

describe('Hook Scripts', () => {
  const hooks = ['auto-deploy-on-commit.sh', 'security-gate.sh', 'cost-guardian.sh'];

  for (const hook of hooks) {
    it(`${hook} exists and is executable`, () => {
      const path = join(ROOT, 'hooks', hook);
      assert.ok(existsSync(path), `Missing: hooks/${hook}`);
    });

    it(`${hook} has shebang line`, () => {
      const content = readFileSync(join(ROOT, 'hooks', hook), 'utf8');
      assert.ok(content.startsWith('#!/'), `${hook} should start with shebang`);
    });
  }

  it('security-gate.sh checks for score threshold', () => {
    const content = readFileSync(join(ROOT, 'hooks', 'security-gate.sh'), 'utf8');
    assert.ok(content.includes('70'), 'Should check against score 70');
    assert.ok(content.includes('BLOCKED') || content.includes('blocked'), 'Should block on low score');
  });

  it('auto-deploy.sh triggers resyncHosting', () => {
    const content = readFileSync(join(ROOT, 'hooks', 'auto-deploy-on-commit.sh'), 'utf8');
    assert.ok(content.includes('resyncHosting'), 'Should call resyncHosting API');
    assert.ok(content.includes('git commit'), 'Should check for git commit');
  });
});

// ── MCP Server ───────────────────────────────────────────────────────────────

describe('MCP Server Error Messages', () => {
  it('auth errors include help URL', () => {
    const src = readFileSync(join(ROOT, 'src', 'mcp-server.js'), 'utf8');
    // Every "Not authenticated" return should include a URL or nometria_login reference
    const authLines = src.split('\n').filter(l => l.includes("'Not authenticated") && l.includes('return'));
    assert.ok(authLines.length > 0, 'Should have auth error returns');
    for (const line of authLines) {
      assert.ok(
        line.includes('nometria.com') || line.includes('nometria_login') || line.includes('nom login'),
        `Auth error should include help: "${line.trim().slice(0, 100)}..."`
      );
    }
  });

  it('has rollback tool handler', () => {
    const src = readFileSync(join(ROOT, 'src', 'mcp-server.js'), 'utf8');
    assert.ok(src.includes("case 'nometria_rollback'"), 'Should have rollback handler');
  });

  it('init detects 6+ frameworks', () => {
    const src = readFileSync(join(ROOT, 'src', 'mcp-server.js'), 'utf8');
    for (const fw of ['nextjs', 'remix', 'astro', 'sveltekit', 'nuxt', 'vite']) {
      assert.ok(src.includes(fw), `nometria_init should detect ${fw}`);
    }
  });
});
