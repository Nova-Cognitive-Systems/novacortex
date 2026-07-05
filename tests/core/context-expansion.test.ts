/**
 * v1.3.1 accuracy features (integration): neighbor-turn context expansion
 * (expandTurns), supersedes-chain resolution in search results
 * (resolveToCurrent), and the temporalReference for parseTemporal.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QdrantClient } from '@qdrant/js-client-rest';
import { MemoryService, MemoryType, RelationType, type Memory } from '@memory-stack/core';

const SKIP = !!process.env['CI_SKIP_LIVE'];
const QDRANT_URL = process.env['QDRANT_URL'] ?? 'http://localhost:6333';
const DIM = 8;
const origFetch = globalThis.fetch;

function mockEmbeddings(vectorFor: (text: string) => number[]) {
  globalThis.fetch = (async (url: unknown, init?: unknown) => {
    if (String(url).includes('/embeddings')) {
      const body = JSON.parse(String((init as RequestInit).body)) as { input: string[] };
      return {
        ok: true,
        json: async () => ({ data: body.input.map((text, index) => ({ embedding: vectorFor(text), index })) }),
      } as unknown as Response;
    }
    return origFetch(url as any, init as any);
  }) as typeof fetch;
}

const axis = (i: number): number[] => Array.from({ length: DIM }, (_, j) => (j === i ? 1 : 0));

describe.skipIf(SKIP)('v1.3.1 search accuracy features (integration)', () => {
  const collection = `accuracy_it_${Date.now()}`;
  const ns = `accuracy_it_${Date.now()}`;
  let svc: MemoryService;
  const created: Memory[] = [];
  const client = new QdrantClient({ url: QDRANT_URL, checkCompatibility: false });

  beforeAll(async () => {
    svc = new MemoryService({
      surrealdb: {
        url: process.env['SURREALDB_URL'] ?? 'ws://localhost:8000/rpc',
        user: process.env['SURREALDB_USER'] ?? 'root',
        pass: process.env['SURREALDB_PASS'] ?? 'root',
        namespace: process.env['SURREALDB_NS'] ?? 'memory',
        database: process.env['SURREALDB_DB'] ?? 'stack',
      },
      qdrant: { url: QDRANT_URL, collectionName: collection, vectorSize: DIM },
      embedding: { apiKey: 'test-key', baseUrl: 'http://embed.test/v1' },
    });
    await svc.connect();
  });

  afterAll(async () => {
    globalThis.fetch = origFetch;
    for (const m of created) await svc.deleteMemory(m.id).catch(() => {});
    await svc.disconnect();
    await client.deleteCollection(collection).catch(() => {});
  });

  it('expandTurns pulls neighbor turns of the hit session into the results', async () => {
    // 5-turn session; only turn 3 is semantically close to the query.
    const turns: Memory[] = [];
    for (let i = 1; i <= 5; i++) {
      const m = await svc.createMemory({
        content: `session turn ${i}: ${i === 3 ? 'the yoga studio is called Serenity' : 'unrelated filler chatter ' + i}`,
        memoryType: MemoryType.EPISODIC,
        namespace: ns,
        source: { type: 'conversation', sessionId: 'sess-exp', timestamp: new Date() },
        embedding: i === 3 ? axis(0) : axis(5),
      });
      turns.push(m);
      created.push(m);
    }

    mockEmbeddings(() => axis(0)); // query matches only turn 3
    const plain = await svc.searchByText('yoga studio name', { namespace: ns, limit: 1 });
    expect(plain.results.length).toBe(1);

    const expanded = await svc.searchByText('yoga studio name', {
      namespace: ns,
      limit: 1,
      expandTurns: 2,
      explain: true,
    });
    const contents = expanded.results.map((r) => r.memory.content);
    expect(contents[0]).toContain('Serenity'); // ranked hit stays first
    expect(expanded.results.length).toBe(5); // hit + turns 1,2,4,5
    expect(expanded.results.some((r) => r.trace?.some((t) => t.includes('neighbor turn')))).toBe(true);
  });

  it('resolveToCurrent replaces superseded hits with the chain tip and dedupes', async () => {
    const v1 = await svc.createMemory({
      content: `budget fact v1 ${ns}: pre-approval is $350,000`,
      memoryType: MemoryType.SEMANTIC,
      namespace: ns,
      embedding: axis(1),
    });
    const v2 = await svc.createMemory({
      content: `budget fact v2 ${ns}: approved amount is $400,000`,
      memoryType: MemoryType.SEMANTIC,
      namespace: ns,
      embedding: axis(2),
    });
    created.push(v1, v2);
    // Edge exists but v1 was NOT invalidated — exactly the gap this fix covers.
    await svc.createRelation(v2.id, v1.id, RelationType.SUPERSEDES, 0.9, false, { test: true });

    mockEmbeddings(() => axis(1)); // query lands on the OLD version
    const stale = await svc.searchByText('budget', { namespace: ns, limit: 1 });
    expect(stale.results[0]!.memory.content).toContain('$350,000');

    const current = await svc.searchByText('budget', {
      namespace: ns,
      limit: 1,
      resolveToCurrent: true,
      explain: true,
    });
    expect(current.results[0]!.memory.content).toContain('$400,000');
    expect(current.results[0]!.trace?.some((t) => t.includes('resolved to current'))).toBe(true);

    // Both versions retrieved → tip appears once.
    mockEmbeddings((text) => (text.includes('v1') ? axis(1) : text.includes('v2') ? axis(2) : axis(1)));
    const both = await svc.searchByText('budget fact', { namespace: ns, limit: 5, resolveToCurrent: true });
    const ids = both.results.map((r) => r.memory.id.id);
    expect(ids.filter((id) => id === v2.id.id).length).toBe(1);
  });

  it('temporalReference anchors parseTemporal for replayed history', async () => {
    const m = await svc.createMemory({
      content: `temporal anchor probe ${ns}`,
      memoryType: MemoryType.SEMANTIC,
      namespace: ns,
    });
    created.push(m);

    // Substring path (no embedding for this query text needed): reference far
    // in the future → "yesterday" window excludes the just-created memory.
    globalThis.fetch = origFetch;
    const svcNoEmbed = new MemoryService({
      surrealdb: {
        url: process.env['SURREALDB_URL'] ?? 'ws://localhost:8000/rpc',
        user: process.env['SURREALDB_URL'] ? 'root' : 'root',
        pass: process.env['SURREALDB_PASS'] ?? 'root',
        namespace: process.env['SURREALDB_NS'] ?? 'memory',
        database: process.env['SURREALDB_DB'] ?? 'stack',
      },
      qdrant: { url: QDRANT_URL, collectionName: collection, vectorSize: DIM },
    });
    await svcNoEmbed.connect();
    try {
      const farFuture = new Date(Date.now() + 30 * 24 * 3600 * 1000);
      const excluded = await svcNoEmbed.searchByText(`yesterday temporal anchor probe ${ns}`, {
        namespace: ns,
        parseTemporal: true,
        temporalReference: farFuture,
      });
      expect(excluded.results.length).toBe(0);

      const nearNow = new Date(Date.now() + 60_000);
      const included = await svcNoEmbed.searchByText(`yesterday temporal anchor probe ${ns}`, {
        namespace: ns,
        parseTemporal: true,
        temporalReference: nearNow,
      });
      expect(included.results.length).toBe(1);
    } finally {
      await svcNoEmbed.disconnect();
    }
  });
});
