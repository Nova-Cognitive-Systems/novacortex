/**
 * WebhookService unit tests — FakeSurreal-backed storage + an injected fetch so
 * delivery (signing, event matching, retries) is fully deterministic.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { WebhookService, signPayload } from '../../packages/api/src/services/webhooks.js';
import { FakeSurreal } from '../helpers/fake-surreal.js';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function makeFetch(responder: (call: Call, attempt: number) => { ok: boolean }) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const call: Call = { url, headers, body: String(init.body) };
    calls.push(call);
    const { ok } = responder(call, calls.length);
    return { ok, status: ok ? 200 : 500 } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

async function newService(fetchImpl: typeof fetch, opts = {}) {
  const svc = new WebhookService(new FakeSurreal(), { fetch: fetchImpl, backoffMs: 1, ...opts });
  await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });
  return svc;
}

describe('WebhookService', () => {
  let fetchMock: ReturnType<typeof makeFetch>;

  beforeEach(() => {
    fetchMock = makeFetch(() => ({ ok: true }));
  });

  it('rejects invalid URLs and empty/unknown events', async () => {
    const svc = await newService(fetchMock.fn);
    await expect(svc.register({ url: 'not-a-url', events: ['memory.created'] })).rejects.toThrow();
    await expect(svc.register({ url: 'https://x.test/hook', events: [] })).rejects.toThrow();
    await expect(
      svc.register({ url: 'https://x.test/hook', events: ['bogus' as never] })
    ).rejects.toThrow();
  });

  it('registers, lists (without secret), gets and removes', async () => {
    const svc = await newService(fetchMock.fn);
    const wh = await svc.register({ url: 'https://x.test/hook', events: ['memory.created'] });
    expect(wh.webhookId).toMatch(/^wh_/);
    expect(wh.secret).toBeTruthy();

    const list = await svc.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.secret).toBeUndefined(); // never leaked

    const got = await svc.get(wh.webhookId);
    expect(got?.url).toBe('https://x.test/hook');

    expect(await svc.remove(wh.webhookId)).toBe(true);
    expect(await svc.remove(wh.webhookId)).toBe(false);
    expect(await svc.list()).toHaveLength(0);
  });

  it('delivers only to active, subscribed webhooks with a valid HMAC signature', async () => {
    const svc = await newService(fetchMock.fn);
    const secret = 'whsec_test';
    await svc.register({ url: 'https://a.test/hook', events: ['memory.created'], secret });
    await svc.register({ url: 'https://b.test/hook', events: ['memory.deleted'], secret }); // wrong event
    await svc.register({ url: 'https://c.test/hook', events: ['memory.created'], secret, active: false }); // inactive

    await svc.emit('memory.created', { id: { id: 'm1', namespace: 'n' } });
    await svc.drain();

    expect(fetchMock.calls).toHaveLength(1);
    const call = fetchMock.calls[0]!;
    expect(call.url).toBe('https://a.test/hook');
    expect(call.headers['X-NovaCortex-Event']).toBe('memory.created');
    expect(call.headers['X-NovaCortex-Signature']).toBe(`sha256=${signPayload(secret, call.body)}`);
    const payload = JSON.parse(call.body);
    expect(payload.event).toBe('memory.created');
    expect(payload.data.id.id).toBe('m1');
  });

  it('retries failed deliveries up to maxAttempts', async () => {
    const failing = makeFetch(() => ({ ok: false }));
    const svc = await newService(failing.fn, { maxAttempts: 3 });
    await svc.register({ url: 'https://flaky.test/hook', events: ['memory.created'] });

    await svc.emit('memory.created', { hello: 'world' });
    await svc.drain();

    expect(failing.calls).toHaveLength(3);
  });

  it('stops retrying once a delivery succeeds', async () => {
    const flaky = makeFetch((_c, attempt) => ({ ok: attempt >= 2 })); // fail once, then succeed
    const svc = await newService(flaky.fn, { maxAttempts: 5 });
    await svc.register({ url: 'https://flaky.test/hook', events: ['memory.created'] });

    await svc.emit('memory.created', {});
    await svc.drain();

    expect(flaky.calls).toHaveLength(2);
  });
});
