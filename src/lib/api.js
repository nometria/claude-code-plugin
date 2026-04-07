/**
 * Shared API client for Deno functions at app.nometria.com.
 * Used by both MCP tools and slash commands.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_API_URL = 'https://app.nometria.com';

export function getBaseUrl() {
  return process.env.NOMETRIA_API_URL || DEFAULT_API_URL;
}

export function getApiKey() {
  if (process.env.NOMETRIA_API_KEY) return process.env.NOMETRIA_API_KEY;
  if (process.env.NOMETRIA_TOKEN) return process.env.NOMETRIA_TOKEN;
  const credFile = join(homedir(), '.nometria', 'credentials.json');
  if (existsSync(credFile)) {
    try {
      const creds = JSON.parse(readFileSync(credFile, 'utf8'));
      if (creds.apiKey) return creds.apiKey;
    } catch { /* ignore */ }
  }
  return null;
}

export async function apiRequest(path, { body = {}, apiKey } = {}) {
  const url = `${getBaseUrl()}${path}`;
  const payload = apiKey ? { ...body, api_key: apiKey } : body;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'nometria-claude-code',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let message = `API error: ${res.status}`;
    try {
      const raw = await res.json();
      const data = raw?.data || raw;
      message = data.error || data.detail || message;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  // server.js wraps all JSON responses in { data: ... } — unwrap
  const raw = await res.json();
  return raw?.data !== undefined ? raw.data : raw;
}
