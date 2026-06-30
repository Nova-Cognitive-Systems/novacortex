import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { extractToken, resolveClientIp, requireScopes, rateLimit } from '../../packages/api/src/middleware/auth.js';
import { tokenService } from '../../packages/api/src/services/token-service.js';
import type { TokenRecord } from '../../packages/api/src/services/token-service.js';

function fakeReq(headers: Record<string, string | string[] | undefined>, socketAddr = '127.0.0.1'): Request {
  return {
    headers,
    socket: { remoteAddress: socketAddr },
    path: '/test',
  } as unknown as Request;
}

function mockRes() {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const setHeader = vi.fn().mockReturnThis();
  return { status, json, setHeader } as unknown as Response;
}

const record = (scopes: string[], overrides: Partial<TokenRecord> = {}): TokenRecord => ({
  id: 'tokens:test',
  tokenHash: 'hash',
  prefix: 'nc_pat',
  name: 'test',
  scopes,
  createdAt: new Date(),
  ...overrides,
});

describe('extractToken', () => {
  it('returns the token after "Bearer "', () => {
    expect(extractToken(fakeReq({ authorization: 'Bearer nc_pat_abc' }))).toBe('nc_pat_abc');
  });

  it('returns the X-API-Key header when Authorization is missing', () => {
    expect(extractToken(fakeReq({ 'x-api-key': 'sk_foo_bar' }))).toBe('sk_foo_bar');
  });

  it('returns null when both headers are missing', () => {
    expect(extractToken(fakeReq({}))).toBeNull();
  });

  it('returns null when Authorization is present but empty', () => {
    expect(extractToken(fakeReq({ authorization: 'Bearer ' }))).toBeNull();
  });
});

describe('resolveClientIp', () => {
  it('uses socket.remoteAddress by default', () => {
    delete process.env['TRUST_PROXY'];
    expect(resolveClientIp(fakeReq({}, '203.0.113.1'))).toBe('203.0.113.1');
  });

  it('uses first X-Forwarded-For entry when TRUST_PROXY=true', () => {
    process.env['TRUST_PROXY'] = 'true';
    expect(resolveClientIp(fakeReq({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' }))).toBe(
      '198.51.100.2'
    );
    delete process.env['TRUST_PROXY'];
  });
});

describe('requireScopes', () => {
  it('returns 401 missing_token when no auth header', async () => {
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await requireScopes('memories:read')(
      { headers: {}, socket: { remoteAddress: '1.1.1.1' }, path: '/test' } as never,
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'missing_token' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 invalid_token when validate returns null', async () => {
    vi.spyOn(tokenService, 'validate').mockResolvedValueOnce(null);
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await requireScopes('memories:read')(
      { headers: { authorization: 'Bearer bogus' }, socket: { remoteAddress: '1.1.1.1' }, path: '/test' } as never,
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_token' })
    );
  });

  it('returns 403 insufficient_scope when scopes missing', async () => {
    vi.spyOn(tokenService, 'validate').mockResolvedValueOnce(record(['memories:read']));
    vi.spyOn(tokenService, 'hasScope').mockImplementation((r, s) => r.scopes.includes(s));
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await requireScopes('namespaces:write')(
      { headers: { authorization: 'Bearer any' }, socket: { remoteAddress: '1.1.1.1' }, path: '/test' } as never,
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'insufficient_scope',
        required: ['namespaces:write'],
        granted: ['memories:read'],
      })
    );
  });

  it('calls next() and attaches req.auth on success', async () => {
    vi.spyOn(tokenService, 'validate').mockResolvedValueOnce(
      record(['admin:*'], { agentId: undefined })
    );
    vi.spyOn(tokenService, 'hasScope').mockReturnValueOnce(true);
    const next = vi.fn() as unknown as NextFunction;
    const req = {
      headers: { authorization: 'Bearer any' },
      socket: { remoteAddress: '1.1.1.1' },
      path: '/test',
    } as Record<string, unknown> & { auth?: unknown };
    await requireScopes('memories:read')(req as never, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth).toEqual(
      expect.objectContaining({ tokenId: 'tokens:test', scopes: ['admin:*'] })
    );
  });
});

describe('rateLimit', () => {
  it('allows requests under the limit and rejects over it', async () => {
    const limiter = rateLimit({ perMinute: 3 });
    const req = { headers: {}, socket: { remoteAddress: '9.9.9.9' } } as never;

    for (let i = 0; i < 3; i += 1) {
      const res = mockRes();
      const next = vi.fn() as unknown as NextFunction;
      limiter(req, res, next);
      expect(next).toHaveBeenCalled();
    }

    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    limiter(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'rate_limited' })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
