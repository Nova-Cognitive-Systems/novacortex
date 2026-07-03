/**
 * Hybrid retrieval (integration) — real Qdrant, mocked embedding endpoint.
 * Verifies: fresh collections get the sparse leg, searchByText runs in hybrid
 * mode, the lexical leg surfaces exact-token matches that dense similarity
 * alone would miss, and migrateToHybrid upgrades a pre-v1.3 collection.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QdrantClient } from '@qdrant/js-client-rest';
import { MemoryService, MemoryType, type Memory } from '@memory-stack/core';

const SKIP = !!process.env['CI_SKIP_LIVE'];
const QDRANT_URL = process.env['QDRANT_URL'] ?? 'http://localhost:6333';
const DIM = 8;

const origFetch = globalThis.fetch;

/** Mock ONLY the embedding endpoint; everything else (Qdrant REST) passes through. */
function mockEmbeddings(vectorFor: (text: string) => number[]) {
  globalThis.fetch = (async (url: unknown, init?: unknown) => {
    if (String(url).includes('/embeddings')) {
      const body = JSON.parse(String((init as RequestInit).body)) as { input: string[] };
      return {
        ok: true,
        json: async () => ({
          data: body.input.map((text, index) => ({ embedding: vectorFor(text), index })),
        }),
      } as unknown as Response;
    }
    return origFetch(url as any, init as any);
  }) as typeof fetch;
}

// Deterministic unit vectors along different axes.
const axis = (i: number): number[] => Array.from({ length: DIM }, (_, j) => (j === i ? 1 : 0));

function makeService(collectionName: string): MemoryService {
  return new MemoryService({
    surrealdb: {
      url: process.env['SURREALDB_URL'] ?? 'ws://localhost:8000/rpc',
      user: process.env['SURREALDB_USER'] ?? 'root',
      pass: process.env['SURREALDB_PASS'] ?? 'root',
      namespace: process.env['SURREALDB_NS'] ?? 'memory',
      database: process.env['SURREALDB_DB'] ?? 'stack',
    },
    qdrant: { url: QDRANT_URL, collectionName, vectorSize: DIM },
    embedding: { apiKey: 'test-key', baseUrl: 'http://embed.test/v1' },
  });
}

describe.skipIf(SKIP)('hybrid retrieval (integration)', () => {
  const collection = `hybrid_it_${Date.now()}`;
  const ns = `hybrid_it_${Date.now()}`;
  let svc: MemoryService;
  const created: Memory[] = [];
  const client = new QdrantClient({ url: QDRANT_URL, checkCompatibility: false });

  beforeAll(async () => {
    svc = makeService(collection);
    await svc.connect();
  });

  afterAll(async () => {
    globalThis.fetch = origFetch;
    for (const m of created) await svc.deleteMemory(m.id).catch(() => {});
    await svc.disconnect();
    await client.deleteCollection(collection).catch(() => {});
  });

  it('fresh collections support hybrid search', () => {
    expect(svc.isHybridEnabled()).toBe(true);
  });

  it('lexical leg surfaces exact-token matches that dense similarity misses', async () => {
    // Two memories on different dense axes; the query vector is orthogonal to
    // BOTH (equal dense similarity), so only the lexical leg can break the tie
    // via the unique token "zebrafish".
    const a = await svc.createMemory({
      content: `generic note about deployment pipelines ${ns}`,
      memoryType: MemoryType.SEMANTIC,
      namespace: ns,
      embedding: axis(0),
    });
    const b = await svc.createMemory({
      content: `research note on zebrafish embryos ${ns}`,
      memoryType: MemoryType.SEMANTIC,
      namespace: ns,
      embedding: axis(1),
    });
    created.push(a, b);

    mockEmbeddings(() => axis(3)); // query dense vector: orthogonal to both
    const { results, mode } = await svc.searchByText('zebrafish', { namespace: ns });

    expect(mode).toBe('hybrid');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.memory.id.id).toBe(b.id.id);
  });

  it('falls back to plain semantic search when the query has no indexable tokens', async () => {
    mockEmbeddings(() => axis(0));
    const { results, mode } = await svc.searchByText('the of and', { namespace: ns });
    expect(mode).toBe('semantic');
    // Dense axis(0) query matches memory a best.
    expect(results[0]!.memory.content).toContain('deployment');
  });
});

describe.skipIf(SKIP)('hybrid migration (integration)', () => {
  const collection = `hybrid_mig_${Date.now()}`;
  const ns = `hybrid_mig_${Date.now()}`;
  let svc: MemoryService;
  const created: Memory[] = [];
  const client = new QdrantClient({ url: QDRANT_URL, checkCompatibility: false });

  beforeAll(async () => {
    // Simulate a pre-v1.3 deployment: the collection exists WITHOUT sparse config.
    await client.createCollection(collection, {
      vectors: { size: DIM, distance: 'Cosine' },
    });
    svc = makeService(collection);
    await svc.connect();
  });

  afterAll(async () => {
    globalThis.fetch = origFetch;
    for (const m of created) await svc.deleteMemory(m.id).catch(() => {});
    await svc.disconnect();
    await client.deleteCollection(collection).catch(() => {});
    await client.deleteCollection(`${collection}_hybrid_migration`).catch(() => {});
  });

  it('detects a legacy collection, migrates it, and hybrid search works after', async () => {
    expect(svc.isHybridEnabled()).toBe(false);

    const m1 = await svc.createMemory({
      content: `legacy memory about kubernetes clusters ${ns}`,
      memoryType: MemoryType.SEMANTIC,
      namespace: ns,
      embedding: axis(0),
    });
    const m2 = await svc.createMemory({
      content: `legacy memory about axolotl regeneration ${ns}`,
      memoryType: MemoryType.SEMANTIC,
      namespace: ns,
      embedding: axis(1),
    });
    created.push(m1, m2);

    // Pre-migration, text search degrades to dense-only (mode semantic).
    mockEmbeddings(() => axis(3));
    const before = await svc.searchByText('axolotl', { namespace: ns });
    expect(before.mode).toBe('semantic');

    const migration = await svc.migrateToHybrid();
    expect(migration.alreadyHybrid).toBe(false);
    expect(migration.migrated).toBeGreaterThanOrEqual(2);
    expect(svc.isHybridEnabled()).toBe(true);

    // Post-migration: lexical leg resolves the exact token.
    const after = await svc.searchByText('axolotl', { namespace: ns });
    expect(after.mode).toBe('hybrid');
    expect(after.results[0]!.memory.id.id).toBe(m2.id.id);

    // Second run is a no-op.
    const again = await svc.migrateToHybrid();
    expect(again.alreadyHybrid).toBe(true);
  });
});
