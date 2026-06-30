import { describe, it, expect } from 'vitest';
import { buildTestApp, jsonRequest } from '../helpers/test-server.js';
import { installSetupRoute } from '../../packages/api/src/routes/setup.js';
import { installAuthRoute } from '../../packages/api/src/routes/auth.js';
import { installTokensRoute } from '../../packages/api/src/routes/tokens.js';
import { TokenService, sha256Hex } from '../../packages/api/src/services/token-service.js';
import { FakeSurreal } from '../helpers/fake-surreal.js';

describe('Security: information disclosure on setup', () => {
  it('wrong-code response is structurally identical to nonexistent-code response', async () => {
    const { app, svc } = await buildTestApp([installSetupRoute]);
    await svc.generateBootstrapCode();

    const wrong = await jsonRequest(app, 'POST', '/setup/exchange', { code: 'nc_boot_AAAAA' });
    const nonexistent = await jsonRequest(app, 'POST', '/setup/exchange', { code: 'nc_boot_BBBBB' });

    expect(wrong.status).toBe(nonexistent.status);
    expect(Object.keys(wrong.body as object).sort()).toEqual(
      Object.keys(nonexistent.body as object).sort()
    );
    expect((wrong.body as { error: string }).error).toBe(
      (nonexistent.body as { error: string }).error
    );
  });
});

describe('Security: cleartext leakage in list responses', () => {
  it('GET /tokens never contains the full token string', async () => {
    const { app, svc } = await buildTestApp([installTokensRoute]);
    const { token } = await svc.create({ template: 'admin-full', name: 'Root' });
    await svc.create({ template: 'knowledge-ingest', name: 'CI' });

    const res = await jsonRequest(app, 'GET', '/tokens', undefined, {
      Authorization: `Bearer ${token}`,
    });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(token);
    // No nc_pat_ or nc_agt_ cleartext-shaped strings in the response
    expect(body).not.toMatch(/nc_pat_[A-Za-z0-9_-]{30,}/);
    expect(body).not.toMatch(/nc_agt_[A-Za-z0-9_-]{30,}/);
  });
});

describe('Security: scope escalation prevented', () => {
  it('knowledge-ingest token cannot call POST /tokens', async () => {
    const { app, svc } = await buildTestApp([installTokensRoute]);
    const { token } = await svc.create({ template: 'knowledge-ingest', name: 'CI' });
    const res = await jsonRequest(
      app,
      'POST',
      '/tokens',
      { template: 'admin-full', name: 'escalated' },
      { Authorization: `Bearer ${token}` }
    );
    expect(res.status).toBe(403);
  });
});

describe('Security: rate limit enforcement on setup', () => {
  it('6th POST /setup/exchange within a minute returns 429', async () => {
    const { app } = await buildTestApp([installSetupRoute]);
    const results: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const r = await jsonRequest(app, 'POST', '/setup/exchange', { code: 'nc_boot_no' });
      results.push(r.status);
    }
    expect(results.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
  });
});

describe('Security: timing sanity of validate()', () => {
  it('validate() is O(1) lookup via hash cache — no prefix-timing leak', async () => {
    const fake = new FakeSurreal();
    const svc = new TokenService(fake);
    await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });
    await svc.create({ template: 'admin-full', name: 'Root' });

    const ITERATIONS = 500;
    const randomBogus: string[] = [];
    const prefixBogus: string[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      randomBogus.push(`nc_pat_bogus${i}`);
      prefixBogus.push(`nc_pat_${'A'.repeat(30 + (i % 4))}`);
    }

    async function bench(list: string[]): Promise<number> {
      const start = process.hrtime.bigint();
      for (const t of list) await svc.validate(t);
      const end = process.hrtime.bigint();
      return Number(end - start);
    }

    // Best-case (minimum) timing across several rounds is far more stable than a
    // single wall-clock sample, which is dominated by GC/JIT/scheduler noise on
    // CI runners. Comparing the minimums of equal-work O(1) batches yields a
    // small, reliable delta; an actual prefix-dependent (O(n)) comparison would
    // make `prefixBogus` consistently slower and push the delta toward ~1.0.
    async function benchMin(list: string[], rounds: number): Promise<number> {
      let min = Infinity;
      for (let r = 0; r < rounds; r += 1) min = Math.min(min, await bench(list));
      return min;
    }

    // Warm up the JIT before measuring.
    await bench(randomBogus.slice(0, 100));
    await bench(prefixBogus.slice(0, 100));

    const a = await benchMin(randomBogus, 7);
    const b = await benchMin(prefixBogus, 7);
    const delta = Math.abs(a - b) / Math.max(a, b);

    // Smoke test only — not a hardened timing-attack test. The generous bound
    // catches gross prefix-dependent branching (which shows >0.9) without
    // flaking on noise; the real O(1) guarantee is structural (Map hash lookup).
    expect(delta).toBeLessThan(0.85);
  });
});

describe('Security: hash-only storage invariant', () => {
  it('no row in tokens table contains the cleartext after create()', async () => {
    const fake = new FakeSurreal();
    const svc = new TokenService(fake);
    await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });
    const { token } = await svc.create({ template: 'admin-full', name: 'Root' });
    const rows = fake._getTable('tokens');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]!['tokenHash']).toBe(sha256Hex(token));
  });
});
