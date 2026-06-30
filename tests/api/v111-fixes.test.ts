/**
 * Regression tests for the v1.1.1 bug-hunt fixes: scope-based access control on
 * /memories, and PMF content-hash tamper rejection. Requires the live stack.
 */
import { describe, it, expect } from 'vitest';

const BASE = process.env['API_URL'] ?? 'http://localhost:3001';
const TOKEN = process.env['API_TOKEN'];
const SKIP = !TOKEN || !!process.env['CI_SKIP_LIVE'];

const auth = (tok = TOKEN, extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${tok}`,
  'Content-Type': 'application/json',
  ...extra,
});
const ns = (n: string) => `dt111_${n}_${Date.now()}`;

async function mintToken(template: string, name: string): Promise<string> {
  const r = await fetch(`${BASE}/tokens`, {
    method: 'POST', headers: auth(),
    body: JSON.stringify({ template, name }),
  });
  if (r.status !== 201) throw new Error(`mint ${template} failed ${r.status}`);
  return ((await r.json()) as { token: string }).token;
}

describe.skipIf(SKIP)('v1.1.1 fixes (integration)', () => {
  it('scope enforcement: read-only token can read but not write/delete', async () => {
    const n = ns('ac');
    await fetch(`${BASE}/memories`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ content: 'ac seed', memoryType: 'semantic', namespace: n }),
    });
    const ro = await mintToken('admin-readonly', 'ro-regression');

    const get = await fetch(`${BASE}/memories?namespace=${n}&limit=2`, { headers: auth(ro) });
    expect(get.status).toBe(200);

    const post = await fetch(`${BASE}/memories`, {
      method: 'POST', headers: auth(ro),
      body: JSON.stringify({ content: 'nope', memoryType: 'semantic', namespace: n }),
    });
    expect(post.status).toBe(403);

    const del = await fetch(`${BASE}/memories/${n}/fakeid`, { method: 'DELETE', headers: auth(ro) });
    expect(del.status).toBe(403);
  });

  it('scope enforcement: knowledge-ingest token cannot export (exfiltrate) memories', async () => {
    const n = ns('ki');
    const ki = await mintToken('knowledge-ingest', 'ki-regression');
    const exp = await fetch(`${BASE}/memories/export/${n}`, { headers: auth(ki) });
    expect(exp.status).toBe(403);
  });

  it('PMF import rejects tampered content (content hash binding)', async () => {
    const n = ns('tamper');
    await fetch(`${BASE}/memories`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ content: 'original trustworthy fact', memoryType: 'semantic', namespace: n }),
    });
    const exp = await fetch(`${BASE}/memories/export/${n}/pmf`, { headers: auth() });
    const pmf = (await exp.json()) as { memories: { content: string }[] };
    // Tamper the content but leave contentHash untouched.
    pmf.memories[0]!.content = 'TAMPERED malicious fact';

    const imp = await fetch(`${BASE}/memories/import/pmf`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ pmf, targetNamespace: `${n}_t` }),
    });
    expect(imp.status).toBe(200);
    const result = (await imp.json()) as { imported: number; errors: string[] };
    expect(result.imported).toBe(0);
    expect(result.errors.join(' ')).toMatch(/content hash mismatch|checksum/i);
  });

  it('PMF import returns importedIds for the created memories', async () => {
    const n = ns('ids');
    await fetch(`${BASE}/memories`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ content: 'ids node', memoryType: 'semantic', namespace: n }),
    });
    const exp = await fetch(`${BASE}/memories/export/${n}/pmf`, { headers: auth() });
    const pmf = await exp.json();
    const imp = await fetch(`${BASE}/memories/import/pmf`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ pmf, targetNamespace: `${n}_dst` }),
    });
    const result = (await imp.json()) as { imported: number; importedIds: unknown[] };
    expect(result.imported).toBe(1);
    expect(Array.isArray(result.importedIds)).toBe(true);
    expect(result.importedIds.length).toBe(1);
  });
});
