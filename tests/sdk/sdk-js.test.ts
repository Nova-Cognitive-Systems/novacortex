/**
 * JS/TS SDK (integration) — exercises the published client against the live API.
 * Skipped automatically when no API_TOKEN is available (globalSetup provides one
 * when the dev stack is up).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// Import the built artifact (the thing users actually consume).
import { NovaCortexClient, NotFoundError } from '../../packages/sdk-js/dist/index.js';

const token = process.env['API_TOKEN'];
const SKIP = !token || !!process.env['CI_SKIP_LIVE'];

describe.skipIf(SKIP)('JS SDK (integration)', () => {
  let client: NovaCortexClient;
  const ns = 'sdk_js_test';
  let createdId: string | undefined;

  beforeAll(() => {
    client = new NovaCortexClient({
      baseUrl: process.env['API_URL'] ?? 'http://localhost:3001',
      token: token as string,
    });
  });

  afterAll(async () => {
    if (createdId) await client.memories.delete(ns, createdId).catch(() => {});
  });

  it('whoami returns scopes', async () => {
    const w = await client.whoami();
    expect(Array.isArray(w.scopes)).toBe(true);
  });

  it('create → get → list → delete round-trips', async () => {
    const created = await client.memories.create({
      content: `sdk-js round-trip ${Date.now()}`,
      memoryType: 'semantic',
      namespace: ns,
      tags: ['sdk-test'],
    });
    createdId = created.id.id;
    expect(created.id.namespace).toBe(ns);

    const got = await client.memories.get(ns, created.id.id);
    expect(got.content).toContain('sdk-js round-trip');

    const list = await client.memories.list({ namespace: ns, limit: 10 });
    expect(Array.isArray(list.data)).toBe(true);
    expect(list.data.some((m) => m.id.id === created.id.id)).toBe(true);

    await client.memories.delete(ns, created.id.id);
    createdId = undefined;
    await expect(client.memories.get(ns, created.id.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('search reports a mode', async () => {
    const r = await client.search({ query: 'round-trip', namespace: ns, limit: 3 });
    expect(['semantic', 'text', 'vector']).toContain(r.mode);
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('stats and namespaces are reachable', async () => {
    const stats = await client.stats();
    expect(typeof stats.total).toBe('number');
    const namespaces = await client.namespaces.list();
    expect(Array.isArray(namespaces.data)).toBe(true);
  });
});
