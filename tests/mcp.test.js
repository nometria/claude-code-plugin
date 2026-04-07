import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER = join(__dirname, '..', 'src', 'mcp-server.js');

function sendMcpMessage(child, msg) {
  const json = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
  child.stdin.write(header + json);
}

function parseMcpResponses(output) {
  const results = [];
  const parts = output.split('Content-Length:').filter(Boolean);
  for (const part of parts) {
    const bodyStart = part.indexOf('\r\n\r\n');
    if (bodyStart !== -1) {
      try { results.push(JSON.parse(part.slice(bodyStart + 4))); } catch {}
    }
  }
  return results;
}

describe('MCP Server', () => {
  it('responds to initialize', async () => {
    const result = await new Promise((resolve, reject) => {
      const child = spawn('node', [MCP_SERVER], {
        env: { ...process.env, NOMETRIA_API_KEY: 'test' },
      });

      let output = '';
      child.stdout.on('data', (c) => { output += c.toString(); });

      sendMcpMessage(child, {
        jsonrpc: '2.0', method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1' } },
        id: 1,
      });

      setTimeout(() => {
        child.kill();
        const msgs = parseMcpResponses(output);
        resolve(msgs[0]);
      }, 1000);
    });

    assert.ok(result);
    assert.equal(result.result.serverInfo.name, 'nometria');
    assert.equal(result.result.protocolVersion, '2024-11-05');
  });

  it('lists 20 tools', async () => {
    const result = await new Promise((resolve) => {
      const child = spawn('node', [MCP_SERVER], {
        env: { ...process.env, NOMETRIA_API_KEY: 'test' },
      });

      let output = '';
      child.stdout.on('data', (c) => { output += c.toString(); });

      sendMcpMessage(child, {
        jsonrpc: '2.0', method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1' } },
        id: 1,
      });

      setTimeout(() => {
        sendMcpMessage(child, { jsonrpc: '2.0', method: 'tools/list', params: {}, id: 2 });
      }, 300);

      setTimeout(() => {
        child.kill();
        const msgs = parseMcpResponses(output);
        resolve(msgs.find(m => m.id === 2));
      }, 1000);
    });

    assert.ok(result);
    assert.equal(result.result.tools.length, 20);
    const names = result.result.tools.map(t => t.name);
    assert.ok(names.includes('nometria_deploy'));
    assert.ok(names.includes('nometria_login'));
    assert.ok(names.includes('nometria_setup'));
  });
});

describe('API module', () => {
  it('exports required functions', async () => {
    const api = await import('../src/lib/api.js');
    assert.ok(typeof api.getBaseUrl === 'function');
    assert.ok(typeof api.getApiKey === 'function');
    assert.ok(typeof api.apiRequest === 'function');
  });

  it('respects NOMETRIA_API_URL env var', async () => {
    process.env.NOMETRIA_API_URL = 'http://test:1234';
    const { getBaseUrl } = await import('../src/lib/api.js');
    assert.equal(getBaseUrl(), 'http://test:1234');
    delete process.env.NOMETRIA_API_URL;
  });
});
