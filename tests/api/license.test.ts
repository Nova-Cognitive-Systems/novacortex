/**
 * ed25519 license signing/verification. Self-contained: generates an ephemeral
 * keypair and configures it via env, so no committed secret is needed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { LicenseService } from '../../packages/api/src/services/license.js';

let svc: LicenseService;
const saved = {
  pub: process.env['NOVACORTEX_LICENSE_PUBKEY'],
  sign: process.env['LICENSE_SIGNING_KEY'],
  key: process.env['LICENSE_KEY'],
};

describe('License (ed25519)', () => {
  beforeAll(() => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    process.env['NOVACORTEX_LICENSE_PUBKEY'] = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    process.env['LICENSE_SIGNING_KEY'] = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    delete process.env['LICENSE_KEY'];
    svc = new LicenseService(path.join(os.tmpdir(), `nclic-test-${Date.now()}`));
  });

  afterAll(() => {
    if (saved.pub === undefined) delete process.env['NOVACORTEX_LICENSE_PUBKEY']; else process.env['NOVACORTEX_LICENSE_PUBKEY'] = saved.pub;
    if (saved.sign === undefined) delete process.env['LICENSE_SIGNING_KEY']; else process.env['LICENSE_SIGNING_KEY'] = saved.sign;
    if (saved.key !== undefined) process.env['LICENSE_KEY'] = saved.key;
  });

  it('issues and validates a pro key', () => {
    const lic = svc.generateKey('a@b.com', 'pro');
    expect(lic.key.startsWith('nclic.')).toBe(true);
    const v = svc.validateKey(lic.key);
    expect(v.valid).toBe(true);
    expect(v.tier).toBe('pro');
    expect(v.maxNamespaces).toBe(10);
  });

  it('treats no key as unregistered (not an error)', () => {
    const v = svc.validateKey('');
    expect(v.valid).toBe(true);
    expect(v.tier).toBe('unregistered');
  });

  it('rejects garbage and legacy HMAC keys', () => {
    expect(svc.validateKey('nclic.AAAA.BBBB').valid).toBe(false);
    expect(svc.validateKey('MS-PRO-aaa-bbb-ccc-DEADBEEF').valid).toBe(false);
  });

  it('rejects a forged/tampered payload (sig does not cover the swapped tier)', () => {
    const lic = svc.generateKey('a@b.com', 'pro');
    const sig = lic.key.split('.')[2]!;
    const forged = Buffer.from(JSON.stringify({ v: 1, tier: 'enterprise', email: 'x', iat: 1 }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const v = svc.validateKey(`nclic.${forged}.${sig}`);
    expect(v.valid).toBe(false);
    expect(v.tier).toBe('unregistered');
  });

  it('rejects an expired key', () => {
    const lic = svc.generateKey('a@b.com', 'pro', { expiresAt: new Date(Date.now() - 1000) });
    expect(svc.validateKey(lic.key).valid).toBe(false);
  });

  it('exposes licensee email and expiry from the signed payload', () => {
    // The payload stores exp in unix SECONDS, so sub-second precision is dropped.
    const exp = new Date(Math.floor((Date.now() + 7 * 24 * 3600 * 1000) / 1000) * 1000);
    const lic = svc.generateKey('Owner@Example.com', 'pro', { expiresAt: exp });
    const v = svc.validateKey(lic.key);
    expect(v.valid).toBe(true);
    expect(v.email).toBe('owner@example.com');
    expect(v.expiresAt).toBe(exp.toISOString());
  });

  it('activateKey persists a valid key with payload email and tier features', () => {
    const lic = svc.generateKey('buyer@example.com', 'pro');
    const result = svc.activateKey(lic.key);
    expect(result.success).toBe(true);
    expect(result.license?.tier).toBe('pro');
    expect(result.license?.email).toBe('buyer@example.com');
    expect(result.license?.features.federation).toBe(true);
    expect(result.license?.features.api_rate_limit).toBe(1000);
    expect(svc.getCurrentTier().tier).toBe('pro');
    expect(svc.getApiRateLimit()).toBe(1000);
  });

  it('activateKey rejects an invalid key without changing state', () => {
    const before = svc.getCurrentTier().tier;
    const result = svc.activateKey('nclic.AAAA.BBBB');
    expect(result.success).toBe(false);
    expect(svc.getCurrentTier().tier).toBe(before);
  });

  it('keys do not validate under a different public key', () => {
    const lic = svc.generateKey('a@b.com', 'pro');
    const other = crypto.generateKeyPairSync('ed25519');
    const prev = process.env['NOVACORTEX_LICENSE_PUBKEY'];
    process.env['NOVACORTEX_LICENSE_PUBKEY'] = other.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    expect(svc.validateKey(lic.key).valid).toBe(false);
    process.env['NOVACORTEX_LICENSE_PUBKEY'] = prev;
  });
});
