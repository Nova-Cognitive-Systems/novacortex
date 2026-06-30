import { describe, it, expect, vi } from 'vitest';
import { HttpClient } from '../../packages/cli/src/client/http.js';
import {
  InvalidTokenError,
  InsufficientScopeError,
  ServerUnreachableError,
} from '../../packages/cli/src/lib/errors.js';

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('HttpClient', () => {
  it('attaches Authorization: Bearer header from the client token', async () => {
    const fetchMock = mockFetch(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const client = new HttpClient({ url: 'http://localhost:3001', token: 'nc_pat_abc' });
    await client.get('/stats');
    const calledWith = fetchMock.mock.calls[0]![1]!;
    const headers = calledWith.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer nc_pat_abc');
  });

  it('attaches a User-Agent header with CLI version', async () => {
    const fetchMock = mockFetch(async () =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    const client = new HttpClient({ url: 'http://localhost:3001', token: 't', userAgent: 'novacortex/1.0.0' });
    await client.get('/stats');
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('novacortex/1.0.0');
  });

  it('translates 401 to InvalidTokenError', async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: 'invalid_token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const client = new HttpClient({ url: 'http://x', token: 't' });
    await expect(client.get('/stats')).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('translates 403 to InsufficientScopeError with required/granted fields', async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          error: 'insufficient_scope',
          required: ['namespaces:write'],
          granted: ['memories:read'],
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const client = new HttpClient({ url: 'http://x', token: 't' });
    try {
      await client.get('/namespaces');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientScopeError);
      const err = e as InsufficientScopeError;
      expect(err.required).toEqual(['namespaces:write']);
      expect(err.granted).toEqual(['memories:read']);
    }
  });

  it('translates fetch TypeError to ServerUnreachableError', async () => {
    mockFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const client = new HttpClient({ url: 'http://x', token: 't' });
    await expect(client.get('/stats')).rejects.toBeInstanceOf(ServerUnreachableError);
  });
});
