/**
 * RerankService unit tests — mocked fetch. Pins: disabled-without-URL, the TEI
 * and Cohere/Jina response shapes, index-aligned scores, graceful failure.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { RerankService } from '@memory-stack/core';

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
});

describe('RerankService', () => {
  it('is disabled without RERANK_URL', async () => {
    const prev = process.env['RERANK_URL'];
    delete process.env['RERANK_URL'];
    try {
      const svc = new RerankService({});
      expect(svc.isEnabled()).toBe(false);
      expect(await svc.rerank('q', ['a'])).toBeNull();
    } finally {
      if (prev !== undefined) process.env['RERANK_URL'] = prev;
    }
  });

  it('parses the TEI array shape and aligns scores by index', async () => {
    let calledUrl = '';
    globalThis.fetch = vi.fn(async (url: unknown) => {
      calledUrl = String(url);
      return {
        ok: true,
        json: async () => [
          { index: 1, score: 0.9 },
          { index: 0, score: 0.2 },
        ],
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const svc = new RerankService({ url: 'http://reranker:8080' });
    const scores = await svc.rerank('query', ['docA', 'docB']);
    expect(calledUrl).toBe('http://reranker:8080/rerank');
    expect(scores).toEqual([0.2, 0.9]);
  });

  it('parses the Cohere/Jina results shape', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: [{ index: 0, relevance_score: 0.7 }, { index: 1, relevance_score: 0.1 }] }),
    })) as unknown as typeof fetch;

    const svc = new RerankService({ url: 'http://reranker:8080/rerank' });
    expect(await svc.rerank('query', ['a', 'b'])).toEqual([0.7, 0.1]);
  });

  it('returns null on endpoint failure (search keeps original order)', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const svc = new RerankService({ url: 'http://reranker:8080' });
    expect(await svc.rerank('query', ['a', 'b'])).toBeNull();
  });
});
