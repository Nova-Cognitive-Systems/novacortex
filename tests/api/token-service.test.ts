import { describe, it, expect } from 'vitest';
import { TokenService, type TokenRecord } from '../../packages/api/src/services/token-service.js';
import { expandTemplate } from '../../packages/api/src/services/token-service.js';
import { FakeSurreal } from '../helpers/fake-surreal.js';
import { sha256Hex } from '../../packages/api/src/services/token-service.js';

const base: TokenRecord = {
  id: 'tokens:abc',
  tokenHash: 'hash',
  prefix: 'nc_pat',
  name: 'test',
  scopes: [],
  createdAt: new Date(),
};

describe('TokenService.hasScope', () => {
  const svc = new TokenService();

  it('matches literal scopes', () => {
    const rec = { ...base, scopes: ['memories:read'] };
    expect(svc.hasScope(rec, 'memories:read')).toBe(true);
    expect(svc.hasScope(rec, 'memories:write')).toBe(false);
  });

  it('admin:* matches every non-agent scope', () => {
    const rec = { ...base, scopes: ['admin:*'] };
    expect(svc.hasScope(rec, 'memories:read')).toBe(true);
    expect(svc.hasScope(rec, 'namespaces:write')).toBe(true);
    expect(svc.hasScope(rec, 'knowledge:read')).toBe(true);
    expect(svc.hasScope(rec, 'tokens:write')).toBe(true);
    expect(svc.hasScope(rec, 'federation:*')).toBe(true);
  });

  it('admin:* does NOT match agent:x scopes', () => {
    const rec = { ...base, scopes: ['admin:*'] };
    expect(svc.hasScope(rec, 'agent:alpha')).toBe(false);
  });

  it('agent:{id} matches only its own id', () => {
    const rec = { ...base, scopes: ['agent:alpha', 'memories:read'] };
    expect(svc.hasScope(rec, 'agent:alpha')).toBe(true);
    expect(svc.hasScope(rec, 'agent:beta')).toBe(false);
  });

  it('returns false for empty scopes', () => {
    expect(svc.hasScope(base, 'memories:read')).toBe(false);
  });
});

describe('expandTemplate', () => {
  it('admin-full → admin:*, tokens:read, tokens:write', () => {
    expect(expandTemplate('admin-full')).toEqual([
      'admin:*',
      'tokens:read',
      'tokens:write',
    ]);
  });

  it('admin-readonly → read scopes only', () => {
    expect(expandTemplate('admin-readonly')).toEqual([
      'memories:read',
      'namespaces:read',
      'knowledge:read',
      'buckets:read',
      'processor:read',
    ]);
  });

  it('agent requires agentId and injects agent:{id} scope', () => {
    expect(expandTemplate('agent', { agentId: 'alpha' })).toEqual([
      'memories:read',
      'memories:write',
      'knowledge:read',
      'agent:alpha',
    ]);
  });

  it('agent without agentId throws', () => {
    expect(() => expandTemplate('agent')).toThrow('agentId required for agent template');
  });

  it('knowledge-ingest → knowledge read + write', () => {
    expect(expandTemplate('knowledge-ingest')).toEqual([
      'knowledge:write',
      'knowledge:read',
    ]);
  });
});

describe('TokenService.create', () => {
  it('returns cleartext exactly once and stores only the hash', async () => {
    const fake = new FakeSurreal();
    const svc = new TokenService(fake);
    await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });

    const { token, record } = await svc.create({ template: 'admin-full', name: 'Root Admin' });

    expect(token).toMatch(/^nc_pat_[A-Za-z0-9_-]+$/);
    expect(record.tokenHash).toBe(sha256Hex(token));
    expect(record.scopes).toContain('admin:*');
    expect(record.name).toBe('Root Admin');

    const stored = fake._getTable('tokens');
    expect(stored).toHaveLength(1);
    expect(stored[0]!['tokenHash']).toBe(sha256Hex(token));
    // The cleartext is never stored in any row
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('agent template stores namespaceClaim and agentId', async () => {
    const fake = new FakeSurreal();
    const svc = new TokenService(fake);
    await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });

    const { record } = await svc.create({
      template: 'agent',
      name: 'Alpha agent',
      agentId: 'alpha',
      namespaceClaim: 'alpha-workspace',
    });

    expect(record.agentId).toBe('alpha');
    expect(record.namespaceClaim).toBe('alpha-workspace');
    expect(record.scopes).toContain('agent:alpha');
    expect(record.prefix).toBe('nc_agt');
  });
});

describe('TokenService.validate', () => {
  async function setup() {
    const fake = new FakeSurreal();
    const svc = new TokenService(fake);
    await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });
    return { fake, svc };
  }

  it('returns record on valid cleartext (cache hit)', async () => {
    const { svc } = await setup();
    const { token } = await svc.create({ template: 'admin-full', name: 'root' });
    const rec = await svc.validate(token);
    expect(rec?.scopes).toContain('admin:*');
  });

  it('returns null on unknown token', async () => {
    const { svc } = await setup();
    const rec = await svc.validate('nc_pat_bogus');
    expect(rec).toBeNull();
  });

  it('returns null on revoked token', async () => {
    const { svc } = await setup();
    const { token, record } = await svc.create({ template: 'admin-full', name: 'root' });
    await svc.revoke(record.id);
    const rec = await svc.validate(token);
    expect(rec).toBeNull();
  });

  it('returns null on expired token', async () => {
    const { svc } = await setup();
    const { token } = await svc.create({
      template: 'admin-full',
      name: 'root',
      expiresAt: new Date(Date.now() - 1000),
    });
    const rec = await svc.validate(token);
    expect(rec).toBeNull();
  });

  it('returns null for empty or non-string input', async () => {
    const { svc } = await setup();
    expect(await svc.validate('')).toBeNull();
  });
});

describe('TokenService.migrateFromApiKeys', () => {
  async function setup() {
    const fake = new FakeSurreal();
    const svc = new TokenService(fake);
    await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });
    return { fake, svc };
  }

  it('empty api_keys table → zero migrated, no error', async () => {
    const { svc } = await setup();
    const result = await svc.migrateFromApiKeys();
    expect(result).toEqual({ migrated: 0, skipped: 0 });
  });

  it('migrates active api_keys rows into tokens with hashed key', async () => {
    const { fake, svc } = await setup();
    fake._seed('api_keys', {
      id: 'api_keys:alpha',
      agentId: 'alpha',
      key: 'sk_alpha_xyz',
      primaryNamespace: 'alpha-ns',
      readableNamespaces: ['alpha-ns', 'shared-ns'],
      createdAt: new Date().toISOString(),
      active: true,
    });

    const result = await svc.migrateFromApiKeys();
    expect(result.migrated).toBe(1);

    const tokens = fake._getTable('tokens');
    expect(tokens).toHaveLength(1);
    const row = tokens[0]!;
    expect(row['prefix']).toBe('nc_agt_migrated');
    expect(row['agentId']).toBe('alpha');
    expect(row['namespaceClaim']).toBe('alpha-ns');
    expect(row['scopes']).toEqual(
      expect.arrayContaining(['memories:read', 'memories:write', 'knowledge:read', 'agent:alpha'])
    );
    expect(row['tokenHash']).toBe(sha256Hex('sk_alpha_xyz'));

    // Cleartext of sk_alpha_xyz must never appear in the row
    expect(JSON.stringify(row)).not.toContain('sk_alpha_xyz');
  });

  it('is idempotent — running twice does not duplicate rows', async () => {
    const { fake, svc } = await setup();
    fake._seed('api_keys', {
      id: 'api_keys:alpha',
      agentId: 'alpha',
      key: 'sk_alpha_xyz',
      primaryNamespace: 'alpha-ns',
      readableNamespaces: ['alpha-ns'],
      createdAt: new Date().toISOString(),
      active: true,
    });

    const first = await svc.migrateFromApiKeys();
    const second = await svc.migrateFromApiKeys();

    expect(first.migrated).toBe(1);
    expect(second).toEqual({ migrated: 0, skipped: 1 });
    expect(fake._getTable('tokens')).toHaveLength(1);
  });

  it('migrated agent key validates through TokenService.validate', async () => {
    const { fake, svc } = await setup();
    fake._seed('api_keys', {
      id: 'api_keys:alpha',
      agentId: 'alpha',
      key: 'sk_alpha_xyz',
      primaryNamespace: 'alpha-ns',
      readableNamespaces: ['alpha-ns'],
      createdAt: new Date().toISOString(),
      active: true,
    });
    await svc.migrateFromApiKeys();

    const rec = await svc.validate('sk_alpha_xyz');
    expect(rec).not.toBeNull();
    expect(rec?.scopes).toContain('agent:alpha');
  });
});

describe('TokenService bootstrap flow', () => {
  async function setup() {
    const fake = new FakeSurreal();
    const svc = new TokenService(fake);
    await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });
    return { fake, svc };
  }

  it('needsBootstrap is true on empty tokens table', async () => {
    const { svc } = await setup();
    expect(await svc.needsBootstrap()).toBe(true);
  });

  it('needsBootstrap is false once any non-boot token exists', async () => {
    const { svc } = await setup();
    await svc.create({ template: 'admin-full', name: 'root' });
    expect(await svc.needsBootstrap()).toBe(false);
  });

  it('generateBootstrapCode returns nc_boot_* and is idempotent within a session', async () => {
    const { svc } = await setup();
    const a = await svc.generateBootstrapCode();
    const b = await svc.generateBootstrapCode();
    expect(a).toMatch(/^nc_boot_[A-Za-z0-9_-]+$/);
    expect(a).toBe(b);
  });

  it('exchangeBootstrapCode succeeds once, burns the code, mints admin-full token', async () => {
    const { svc } = await setup();
    const code = await svc.generateBootstrapCode();
    const result = await svc.exchangeBootstrapCode(code);
    expect(result.token).toMatch(/^nc_pat_/);
    expect(result.record.scopes).toContain('admin:*');

    // Second exchange with the same code must fail
    await expect(svc.exchangeBootstrapCode(code)).rejects.toThrow(/invalid_setup_code/);
  });

  it('exchangeBootstrapCode rejects unknown code with invalid_setup_code', async () => {
    const { svc } = await setup();
    await svc.generateBootstrapCode();
    await expect(svc.exchangeBootstrapCode('nc_boot_nope')).rejects.toThrow(/invalid_setup_code/);
  });
});
