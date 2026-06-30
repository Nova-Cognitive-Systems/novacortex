import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { buildTestApp } from '../helpers/test-server.js';
import { installSetupRoute } from '../../packages/api/src/routes/setup.js';
import { installAuthRoute } from '../../packages/api/src/routes/auth.js';
import { installTokensRoute } from '../../packages/api/src/routes/tokens.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { Express } from 'express';

async function listen(app: Express): Promise<{ server: Server; url: string }> {
  return await new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function runCli(
  args: string[],
  env: Record<string, string>
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('node', ['packages/cli/dist/index.js', ...args], {
      env: { ...process.env, ...env },
      cwd: process.cwd(),
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => { stdout += String(c); });
    proc.stderr.on('data', (c: Buffer) => { stderr += String(c); });
    proc.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

describe('CLI e2e: setup flow', () => {
  let tmpHome: string;
  let server: Server | null = null;
  let url = '';

  beforeEach(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-e2e-'));
    const { app, svc } = await buildTestApp([installSetupRoute, installAuthRoute, installTokensRoute]);
    const listened = await listen(app);
    server = listened.server;
    url = listened.url;
    (globalThis as unknown as { __bootCode: string }).__bootCode = await svc.generateBootstrapCode();
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('setup command writes a profile and exits 0', async () => {
    const code = (globalThis as unknown as { __bootCode: string }).__bootCode;
    const env = { HOME: tmpHome, XDG_CONFIG_HOME: path.join(tmpHome, '.config') };
    const result = await runCli(['setup', '--url', url, '--code', code, '--profile', 'test'], env);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Setup complete');

    const configPath = path.join(tmpHome, '.config', 'novacortex', 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(cfg.activeProfile).toBe('test');
    expect(cfg.profiles.test.url).toBe(url);
  });

  it('setup with wrong code exits non-zero', async () => {
    const env = { HOME: tmpHome, XDG_CONFIG_HOME: path.join(tmpHome, '.config') };
    const result = await runCli(['setup', '--url', url, '--code', 'nc_boot_wrong'], env);
    expect(result.code).not.toBe(0);
  });
});

describe('CLI e2e: auth whoami', () => {
  let tmpHome2: string;
  let server2: Server | null = null;
  let url2 = '';
  let token = '';

  beforeEach(async () => {
    tmpHome2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-e2e-who-'));
    const { app, svc } = await buildTestApp([installAuthRoute, installSetupRoute, installTokensRoute]);
    const minted = await svc.create({ template: 'admin-full', name: 'TestRoot' });
    token = minted.token;
    const listened = await listen(app);
    server2 = listened.server;
    url2 = listened.url;
  });

  afterEach(async () => {
    if (server2) {
      await new Promise<void>((r) => server2!.close(() => r()));
      server2 = null;
    }
    fs.rmSync(tmpHome2, { recursive: true, force: true });
  });

  it('auth login → auth whoami returns identity', async () => {
    const env = { HOME: tmpHome2, XDG_CONFIG_HOME: path.join(tmpHome2, '.config') };
    const login = await runCli(['auth', 'login', '--url', url2, '--token', token], env);
    expect(login.code).toBe(0);
    const who = await runCli(['auth', 'whoami', '--json'], env);
    expect(who.code).toBe(0);
    const payload = JSON.parse(who.stdout);
    expect(payload.data.scopes).toContain('admin:*');
  });

  it('whoami with NOVACORTEX_URL + NOVACORTEX_TOKEN env bypasses config', async () => {
    const env = {
      HOME: tmpHome2,
      XDG_CONFIG_HOME: path.join(tmpHome2, '.config'),
      NOVACORTEX_URL: url2,
      NOVACORTEX_TOKEN: token,
    };
    const who = await runCli(['auth', 'whoami', '--json'], env);
    expect(who.code).toBe(0);
  });
});

describe('CLI e2e: admin tokens lifecycle', () => {
  let tmpHome3: string;
  let server3: Server | null = null;
  let url3 = '';
  let rootToken = '';

  beforeEach(async () => {
    tmpHome3 = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-e2e-adm-'));
    const { app, svc } = await buildTestApp([installAuthRoute, installTokensRoute]);
    const minted = await svc.create({ template: 'admin-full', name: 'Root' });
    rootToken = minted.token;
    const listened = await listen(app);
    server3 = listened.server;
    url3 = listened.url;
  });

  afterEach(async () => {
    if (server3) {
      await new Promise<void>((r) => server3!.close(() => r()));
      server3 = null;
    }
    fs.rmSync(tmpHome3, { recursive: true, force: true });
  });

  it('admin tokens list → create → revoke', async () => {
    const env = {
      HOME: tmpHome3,
      XDG_CONFIG_HOME: path.join(tmpHome3, '.config'),
      NOVACORTEX_URL: url3,
      NOVACORTEX_TOKEN: rootToken,
    };

    const list1 = await runCli(['admin', 'tokens', 'list', '--json'], env);
    expect(list1.code).toBe(0);

    const create = await runCli(
      ['admin', 'tokens', 'create', '--template', 'knowledge-ingest', '--name', 'ci', '--json'],
      env
    );
    expect(create.code).toBe(0);
    const createBody = JSON.parse(create.stdout);
    expect(createBody.data.token).toMatch(/^nc_pat_/);
    const createdId = createBody.data.record.id as string;

    const revoke = await runCli(['admin', 'tokens', 'revoke', createdId, '--json'], env);
    expect(revoke.code).toBe(0);
  });
});
