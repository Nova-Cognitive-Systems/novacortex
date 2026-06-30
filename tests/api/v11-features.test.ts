/**
 * Integration tests for v1.1 features (binary/encrypted/differential PMF,
 * reconcile, same_as). Requires the live stack (API_TOKEN from globalSetup).
 */
import { describe, it, expect } from 'vitest';

const BASE = process.env['API_URL'] ?? 'http://localhost:3001';
const TOKEN = process.env['API_TOKEN'];
const SKIP = !TOKEN || !!process.env['CI_SKIP_LIVE'];

const auth = (extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  ...extra,
});
const ns = (n: string) => `dt11_${n}_${Date.now()}`;

async function createMemory(namespace: string, content: string) {
  const r = await fetch(`${BASE}/memories`, {
    method: 'POST', headers: auth(),
    body: JSON.stringify({ content, memoryType: 'semantic', namespace }),
  });
  if (r.status !== 201) throw new Error(`create failed ${r.status}`);
  return (await r.json()) as { id: { id: string; namespace: string } };
}

describe.skipIf(SKIP)('v1.1 features (integration)', () => {
  it('binary (MessagePack) PMF export → import round-trip', async () => {
    const src = ns('binsrc');
    const dst = ns('bindst');
    await createMemory(src, 'binary pmf node one');
    await createMemory(src, 'binary pmf node two');

    const exp = await fetch(`${BASE}/memories/export/${src}/pmf?format=binary`, { headers: auth() });
    expect(exp.status).toBe(200);
    expect(exp.headers.get('content-type')).toContain('msgpack');
    const bytes = Buffer.from(await exp.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);

    const imp = await fetch(`${BASE}/memories/import/pmf`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/x-msgpack', 'X-PMF-Target-Namespace': dst },
      body: bytes,
    });
    expect(imp.status).toBe(200);
    const result = (await imp.json()) as { imported: number };
    expect(result.imported).toBe(2);
  });

  it('encrypted PMF export → import round-trip; wrong password fails', async () => {
    const src = ns('encsrc');
    const dst = ns('encdst');
    await createMemory(src, 'secret memory alpha');

    const exp = await fetch(`${BASE}/memories/export/${src}/pmf?format=binary&encrypt=true`, {
      headers: auth({ 'X-PMF-Password': 'hunter2' }),
    });
    expect(exp.status).toBe(200);
    const enc = Buffer.from(await exp.arrayBuffer());
    // NCENC1 magic
    expect(enc.subarray(0, 6).toString()).toBe('NCENC1');

    // wrong password -> 400
    const bad = await fetch(`${BASE}/memories/import/pmf`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream', 'X-PMF-Password': 'wrong', 'X-PMF-Target-Namespace': dst },
      body: enc,
    });
    expect(bad.status).toBe(400);

    // correct password -> imported
    const ok = await fetch(`${BASE}/memories/import/pmf`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream', 'X-PMF-Password': 'hunter2', 'X-PMF-Target-Namespace': dst },
      body: enc,
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { imported: number }).imported).toBe(1);
  });

  it('differential export returns memories since a timestamp', async () => {
    const n = ns('diff');
    const before = new Date(Date.now() - 60_000).toISOString();
    await createMemory(n, 'diff item one');
    await createMemory(n, 'diff item two');

    const since = await fetch(`${BASE}/memories/export/${n}/diff?since=${encodeURIComponent(before)}`, { headers: auth() });
    expect(since.status).toBe(200);
    expect(((await since.json()) as { count: number }).count).toBe(2);

    const future = new Date(Date.now() + 3_600_000).toISOString();
    const none = await fetch(`${BASE}/memories/export/${n}/diff?since=${encodeURIComponent(future)}`, { headers: auth() });
    expect(((await none.json()) as { count: number }).count).toBe(0);
  });

  it('same_as relation type is accepted', async () => {
    const n = ns('sameas');
    const a = await createMemory(n, 'product Nexus');
    const b = await createMemory(n, 'codename Project Falcon');
    const r = await fetch(`${BASE}/memories/relations`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ fromMemoryId: a.id.id, fromNamespace: n, toMemoryId: b.id.id, toNamespace: n, relationType: 'same_as', strength: 1 }),
    });
    expect(r.status).toBe(201);
  });

  it('processor reconcile task can run in the background (202)', async () => {
    const r = await fetch(`${BASE}/processor/run`, {
      method: 'POST', headers: auth(), body: JSON.stringify({ task: 'reconcile', background: true }),
    });
    expect(r.status).toBe(202);
    const body = (await r.json()) as { task: string; status: string };
    expect(body.task).toBe('reconcile');
    expect(body.status).toBe('started');
  });
});
