/**
 * License-tier data-plane rate limiter: per-token buckets (per-IP fallback),
 * dynamic per-minute budget from the active license, API_RATE_LIMIT override.
 * Buckets are module-global, so every test uses unique tokens.
 */
import { describe, it, expect, afterEach } from 'vitest';
import express, { type Express } from 'express';
import { tierRateLimit } from '../../packages/api/src/middleware/auth.js';
import { jsonRequest } from '../helpers/test-server.js';

function appWithLimit(getPerMinute: () => number): Express {
  const app = express();
  app.get('/data', tierRateLimit(getPerMinute), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

const savedOverride = process.env['API_RATE_LIMIT'];
afterEach(() => {
  if (savedOverride === undefined) delete process.env['API_RATE_LIMIT'];
  else process.env['API_RATE_LIMIT'] = savedOverride;
});

describe('tierRateLimit', () => {
  it('limits requests per token per minute and returns 429 with Retry-After', async () => {
    delete process.env['API_RATE_LIMIT'];
    const app = appWithLimit(() => 2);
    const headers = { Authorization: `Bearer tok-${Math.random()}` };

    expect((await jsonRequest(app, 'GET', '/data', undefined, headers)).status).toBe(200);
    expect((await jsonRequest(app, 'GET', '/data', undefined, headers)).status).toBe(200);
    const third = await jsonRequest(app, 'GET', '/data', undefined, headers);
    expect(third.status).toBe(429);
    expect((third.body as { error: string }).error).toBe('rate_limited');
  });

  it('keeps separate buckets per token', async () => {
    delete process.env['API_RATE_LIMIT'];
    const app = appWithLimit(() => 1);
    const a = { Authorization: `Bearer tok-a-${Math.random()}` };
    const b = { Authorization: `Bearer tok-b-${Math.random()}` };

    expect((await jsonRequest(app, 'GET', '/data', undefined, a)).status).toBe(200);
    expect((await jsonRequest(app, 'GET', '/data', undefined, b)).status).toBe(200);
    expect((await jsonRequest(app, 'GET', '/data', undefined, a)).status).toBe(429);
  });

  it('reads the per-minute budget at request time (license upgrades apply live)', async () => {
    delete process.env['API_RATE_LIMIT'];
    let limit = 1;
    const app = appWithLimit(() => limit);
    const headers = { Authorization: `Bearer tok-${Math.random()}` };

    expect((await jsonRequest(app, 'GET', '/data', undefined, headers)).status).toBe(200);
    expect((await jsonRequest(app, 'GET', '/data', undefined, headers)).status).toBe(429);
    limit = 10; // simulate activating a higher-tier license
    expect((await jsonRequest(app, 'GET', '/data', undefined, headers)).status).toBe(200);
  });

  it('API_RATE_LIMIT=off and =0 disable the limiter', async () => {
    const app = appWithLimit(() => 1);
    for (const value of ['off', '0']) {
      process.env['API_RATE_LIMIT'] = value;
      const headers = { Authorization: `Bearer tok-${Math.random()}` };
      expect((await jsonRequest(app, 'GET', '/data', undefined, headers)).status).toBe(200);
      expect((await jsonRequest(app, 'GET', '/data', undefined, headers)).status).toBe(200);
      expect((await jsonRequest(app, 'GET', '/data', undefined, headers)).status).toBe(200);
    }
  });

  it('API_RATE_LIMIT as a number overrides the tier budget', async () => {
    process.env['API_RATE_LIMIT'] = '1';
    const app = appWithLimit(() => 1000);
    const headers = { Authorization: `Bearer tok-${Math.random()}` };
    expect((await jsonRequest(app, 'GET', '/data', undefined, headers)).status).toBe(200);
    expect((await jsonRequest(app, 'GET', '/data', undefined, headers)).status).toBe(429);
  });
});
