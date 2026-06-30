import { describe, it, expect } from 'vitest';
import { buildTestApp, jsonRequest } from '../helpers/test-server.js';
import { installAdminRoute } from '../../packages/api/src/routes/admin.js';

describe('POST /admin/migrate', () => {
  it('requires admin:* scope', async () => {
    const { app, svc } = await buildTestApp([installAdminRoute]);
    const { token } = await svc.create({ template: 'admin-readonly', name: 'Reader' });
    const res = await jsonRequest(app, 'POST', '/admin/migrate', undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(403);
  });

  it('runs migrateFromApiKeys with admin token', async () => {
    const { app, fake, svc } = await buildTestApp([installAdminRoute]);
    const { token } = await svc.create({ template: 'admin-full', name: 'Root' });
    fake._seed('api_keys', {
      id: 'api_keys:new',
      agentId: 'new',
      key: 'sk_new_abc',
      primaryNamespace: 'new-ns',
      readableNamespaces: ['new-ns'],
      createdAt: new Date().toISOString(),
      active: true,
    });

    const res = await jsonRequest(app, 'POST', '/admin/migrate', undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    expect((res.body as { migrated: number }).migrated).toBe(1);
  });
});
