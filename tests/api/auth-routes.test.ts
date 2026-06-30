import { describe, it, expect } from 'vitest';
import { buildTestApp, jsonRequest } from '../helpers/test-server.js';
import { installAuthRoute } from '../../packages/api/src/routes/auth.js';
import { installTokensRoute } from '../../packages/api/src/routes/tokens.js';

describe('GET /auth/whoami', () => {
  it('401 without token', async () => {
    const { app } = await buildTestApp([installAuthRoute]);
    const res = await jsonRequest(app, 'GET', '/auth/whoami');
    expect(res.status).toBe(401);
  });

  it('200 with valid admin token, returns scopes and server info', async () => {
    const { app, svc } = await buildTestApp([installAuthRoute]);
    const { token } = await svc.create({ template: 'admin-full', name: 'Root' });

    const res = await jsonRequest(app, 'GET', '/auth/whoami', undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      kind: string;
      name: string;
      scopes: string[];
      server: { mode: string };
    };
    expect(body.kind).toBe('selfhosted');
    expect(body.name).toBe('Root');
    expect(body.scopes).toContain('admin:*');
    expect(body.server.mode).toBe('selfhosted');
  });
});

describe('Tokens CRUD', () => {
  async function setup() {
    const { app, svc } = await buildTestApp([installAuthRoute, installTokensRoute]);
    const { token } = await svc.create({ template: 'admin-full', name: 'Root' });
    return { app, svc, token };
  }

  it('POST /tokens requires tokens:write scope', async () => {
    const { app, svc } = await buildTestApp([installTokensRoute]);
    const { token } = await svc.create({ template: 'admin-readonly', name: 'Reader' });
    const res = await jsonRequest(
      app,
      'POST',
      '/tokens',
      { template: 'knowledge-ingest', name: 'CI' },
      { Authorization: `Bearer ${token}` }
    );
    expect(res.status).toBe(403);
  });

  it('POST /tokens creates a token and returns the cleartext exactly once', async () => {
    const { app, token } = await setup();
    const res = await jsonRequest(
      app,
      'POST',
      '/tokens',
      { template: 'knowledge-ingest', name: 'CI' },
      { Authorization: `Bearer ${token}` }
    );
    expect(res.status).toBe(201);
    const body = res.body as { token: string; record: { name: string; scopes: string[] } };
    expect(body.token).toMatch(/^nc_pat_/);
    expect(body.record.name).toBe('CI');
    expect(body.record.scopes).toEqual(
      expect.arrayContaining(['knowledge:write', 'knowledge:read'])
    );
  });

  it('GET /tokens lists tokens without cleartext', async () => {
    const { app, token } = await setup();
    const res = await jsonRequest(app, 'GET', '/tokens', undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    const list = res.body as Array<{ name: string; tokenHash?: string }>;
    expect(list.length).toBeGreaterThanOrEqual(1);
    for (const entry of list) {
      expect(entry.tokenHash).toBeUndefined();
    }
  });

  it('DELETE /tokens/:id revokes a token', async () => {
    const { app, svc, token } = await setup();
    const { record } = await svc.create({ template: 'knowledge-ingest', name: 'doomed' });
    const res = await jsonRequest(app, 'DELETE', `/tokens/${encodeURIComponent(record.id)}`, undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(204);
  });
});
