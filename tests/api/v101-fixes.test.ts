/**
 * Integration tests for the v1.0.1 deep-test bug fixes. Requires the live stack
 * (uses API_TOKEN from globalSetup). Skips gracefully when no token is present.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = process.env['API_URL'] ?? 'http://localhost:3001';
const TOKEN = process.env['API_TOKEN'];
const SKIP = !TOKEN || !!process.env['CI_SKIP_LIVE'];

function auth(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...extra };
}
const ns = (n: string) => `dt101_${n}_${Date.now()}`;

async function createMemory(namespace: string, content: string, salience = 5) {
  const r = await fetch(`${BASE}/memories`, {
    method: 'POST', headers: auth(),
    body: JSON.stringify({ content, memoryType: 'semantic', namespace, salience }),
  });
  if (r.status !== 201) throw new Error(`create failed ${r.status}`);
  return (await r.json()) as { id: { id: string; namespace: string } };
}

describe.skipIf(SKIP)('v1.0.1 fixes (integration)', () => {
  beforeAll(() => {
    if (!TOKEN) console.warn('[v101] no API_TOKEN — skipping');
  });

  it('malformed JSON body returns 400 (not 500)', async () => {
    const r = await fetch(`${BASE}/memories`, { method: 'POST', headers: auth(), body: '{bad json,,' });
    expect(r.status).toBe(400);
  });

  it('POST /memories/relations rejects nonexistent endpoints (404) and empty ids (400)', async () => {
    const n = ns('rel');
    const a = await createMemory(n, 'relation endpoint A');
    const bad = await fetch(`${BASE}/memories/relations`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ fromMemoryId: a.id.id, fromNamespace: n, toMemoryId: 'NOPE_NOT_REAL', toNamespace: n, relationType: 'related_to' }),
    });
    expect(bad.status).toBe(404);
    const empty = await fetch(`${BASE}/memories/relations`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ fromMemoryId: '', fromNamespace: n, toMemoryId: a.id.id, toNamespace: n, relationType: 'related_to' }),
    });
    expect(empty.status).toBe(400);
  });

  it('GET /memories?query= actually filters by content substring', async () => {
    const n = ns('query');
    await createMemory(n, 'the unique token zphqx appears here');
    await createMemory(n, 'a completely unrelated sentence');
    const r = await fetch(`${BASE}/memories?namespace=${n}&query=zphqx&limit=50`, { headers: auth() });
    const body = (await r.json()) as { data: { content: string }[]; total: number };
    expect(body.data.length).toBe(1);
    expect(body.data[0]!.content).toContain('zphqx');
  });

  it('GET /memories returns an accurate total field', async () => {
    const n = ns('total');
    for (let i = 0; i < 7; i++) await createMemory(n, `total-test item ${i}`);
    const r = await fetch(`${BASE}/memories?namespace=${n}&limit=3`, { headers: auth() });
    const body = (await r.json()) as { data: unknown[]; count: number; total: number };
    expect(body.count).toBe(3);
    expect(body.total).toBe(7);
  });

  it('GET /memories?limit>100 is clamped, not rejected', async () => {
    const n = ns('limit');
    await createMemory(n, 'limit clamp test');
    const r = await fetch(`${BASE}/memories?namespace=${n}&limit=250`, { headers: auth() });
    expect(r.status).toBe(200);
  });

  it('pagination is stable across pages (no dup/drop with equal salience)', async () => {
    const n = ns('page');
    const N = 120;
    // identical salience -> would drift without a unique sort tiebreaker.
    // Create in modest batches to avoid inducing SurrealDB write-conflicts in the
    // shared test DB while still producing equal-salience rows.
    for (let i = 0; i < N; i += 20) {
      await Promise.all(Array.from({ length: Math.min(20, N - i) }, (_, j) => createMemory(n, `page item ${i + j}`, 5)));
    }
    const ids = new Set<string>();
    for (let offset = 0; offset < N; offset += 50) {
      const r = await fetch(`${BASE}/memories?namespace=${n}&limit=50&offset=${offset}`, { headers: auth() });
      const body = (await r.json()) as { data: { id: { id: string } }[] };
      for (const m of body.data) ids.add(m.id.id);
    }
    expect(ids.size).toBe(N);
  });

  it('PMF export/import round-trip preserves relations into a target namespace', async () => {
    const src = ns('pmfsrc');
    const dst = ns('pmfdst');
    const a = await createMemory(src, 'pmf node alpha');
    const b = await createMemory(src, 'pmf node beta');
    const rel = await fetch(`${BASE}/memories/relations`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ fromMemoryId: a.id.id, fromNamespace: src, toMemoryId: b.id.id, toNamespace: src, relationType: 'related_to', strength: 0.9 }),
    });
    expect(rel.status).toBe(201);

    const exp = await fetch(`${BASE}/memories/export/${src}/pmf`, { headers: auth() });
    expect(exp.status).toBe(200);
    const pmf = await exp.json();

    const imp = await fetch(`${BASE}/memories/import/pmf`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ pmf, targetNamespace: dst }),
    });
    expect(imp.status).toBe(200);
    const result = (await imp.json()) as { imported: number; relationsImported: number };
    expect(result.imported).toBe(2);
    expect(result.relationsImported).toBeGreaterThanOrEqual(1);
  });

  it('malformed PMF import body returns 400 (not 500)', async () => {
    const r = await fetch(`${BASE}/memories/import/pmf`, {
      method: 'POST', headers: auth(), body: JSON.stringify({ not: 'a pmf' }),
    });
    expect(r.status).toBe(400);
  });
});
