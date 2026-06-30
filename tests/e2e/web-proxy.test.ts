/**
 * Web Proxy E2E Tests
 * Tests the Next.js proxy route that forwards /api/v1/* to the API
 *
 * Requires both Next.js web app (default: localhost:3000) and API running.
 * Tests are skipped automatically if the web server is not reachable.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const WEB_URL = process.env['WEB_URL'] ?? 'http://localhost:3000';
const API_TOKEN = process.env['API_TOKEN'];

let webAvailable = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${WEB_URL}/`, { signal: AbortSignal.timeout(3000) });
    webAvailable = res.ok || res.status < 500;
  } catch {
    webAvailable = false;
  }
  if (!webAvailable) {
    console.log(`[web-proxy] Web server not reachable at ${WEB_URL} — skipping E2E tests`);
  }
});

async function webApi<T = unknown>(path: string, options?: RequestInit): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options?.headers as Record<string, string>,
  };
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;
  const res = await fetch(`${WEB_URL}/api/v1${path}`, { ...options, headers });
  const data = res.status === 204 ? undefined : await res.json();
  return { status: res.status, data: data as T };
}

describe('Web Proxy Route', () => {
  it('proxies /api/v1/health to backend', async () => {
    if (!webAvailable) return;
    const { status, data } = await webApi<{ status: string }>('/health');
    expect(status).toBe(200);
    expect(data.status).toBe('healthy');
  });

  it('proxies /api/v1/stats to backend', async () => {
    if (!webAvailable) return;
    const { status, data } = await webApi<{ total: number }>('/stats');
    expect(status).toBe(200);
    expect(typeof data.total).toBe('number');
  });

  it('proxies /api/v1/memories GET to backend', async () => {
    if (!webAvailable) return;
    const { status, data } = await webApi<{ data: unknown[]; count: number }>('/memories');
    expect(status).toBe(200);
    expect(Array.isArray(data.data)).toBe(true);
  });

  it('proxies /api/v1/memories POST to backend', async () => {
    if (!webAvailable) return;
    const { status, data } = await webApi<{ id: { id: string } }>('/memories', {
      method: 'POST',
      body: JSON.stringify({
        content: 'E2E proxy test memory',
        memoryType: 'working',
        namespace: 'test_e2e_proxy',
        salience: 3,
      }),
    });
    expect(status).toBe(201);
    expect(data.id.id).toBeTruthy();
  });

  it('proxies /api/v1/namespaces to backend', async () => {
    if (!webAvailable) return;
    const { status, data } = await webApi<{ data: string[] }>('/namespaces');
    expect(status).toBe(200);
    expect(Array.isArray(data.data)).toBe(true);
  });
});

describe('Web Pages', () => {
  const pages = ['/', '/memories', '/graph', '/knowledge', '/namespaces', '/settings', '/agents', '/processor'];

  for (const page of pages) {
    it(`GET ${page} returns 200`, async () => {
      if (!webAvailable) return;
      const res = await fetch(`${WEB_URL}${page}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<!DOCTYPE html');
    });
  }
});
