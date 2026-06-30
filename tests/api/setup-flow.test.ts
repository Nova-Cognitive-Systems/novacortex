import { describe, it, expect } from 'vitest';
import { buildTestApp, jsonRequest } from '../helpers/test-server.js';
import { installSetupRoute } from '../../packages/api/src/routes/setup.js';

describe('POST /setup/exchange', () => {
  it('exchanges a valid bootstrap code for an admin token, burns the code', async () => {
    const { app, svc } = await buildTestApp([installSetupRoute]);
    const code = await svc.generateBootstrapCode();

    const first = await jsonRequest(app, 'POST', '/setup/exchange', { code });
    expect(first.status).toBe(200);
    expect((first.body as { token: string }).token).toMatch(/^nc_pat_/);

    const second = await jsonRequest(app, 'POST', '/setup/exchange', { code });
    expect(second.status).toBe(401);
    expect((second.body as { error: string }).error).toBe('invalid_setup_code');
  });

  it('rejects an unknown code with invalid_setup_code', async () => {
    const { app, svc } = await buildTestApp([installSetupRoute]);
    await svc.generateBootstrapCode();
    const res = await jsonRequest(app, 'POST', '/setup/exchange', { code: 'nc_boot_wrong' });
    expect(res.status).toBe(401);
  });

  it('rejects missing code with 400', async () => {
    const { app } = await buildTestApp([installSetupRoute]);
    const res = await jsonRequest(app, 'POST', '/setup/exchange', {});
    expect(res.status).toBe(400);
  });
});
