/**
 * EmbeddingService base-URL resolution — regression test.
 *
 * Compose ships `OPENAI_BASE_URL=${OPENAI_BASE_URL:-}` (empty string when unset).
 * With `??` an empty string is NOT replaced by the default, producing an invalid
 * "/embeddings" URL and breaking semantic search in every default deployment.
 * This pins the empty-string -> default behavior.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EmbeddingService } from '@memory-stack/core';

describe('EmbeddingService base URL resolution', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('uses the default OpenAI base URL when baseUrl is an empty string', async () => {
    let calledUrl = '';
    globalThis.fetch = vi.fn(async (url: unknown) => {
      calledUrl = String(url);
      return {
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2], index: 0 }] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const svc = new EmbeddingService({ apiKey: 'sk-test', baseUrl: '' });
    const vec = await svc.embed('hello');

    expect(vec).toEqual([0.1, 0.2]);
    expect(calledUrl).toBe('https://api.openai.com/v1/embeddings');
  });

  it('is disabled when the api key is an empty string and no env key is set', () => {
    // Hermetic: the constructor falls back to OPENAI_API_KEY, so clear any ambient
    // value (the dev/test shell may export one for the live API) for this assertion.
    const prev = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    try {
      const svc = new EmbeddingService({ apiKey: '' });
      expect(svc.isEnabled()).toBe(false);
    } finally {
      if (prev !== undefined) process.env['OPENAI_API_KEY'] = prev;
    }
  });
});
