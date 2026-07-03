/**
 * hybridSearch (integration) — requires the live dev stack.
 *
 * Regression test for the latent bug where hybridSearch never forwarded the
 * query to the SurrealDB text leg: the "text" contribution silently degenerated
 * into a top-effective-salience browse, so unrelated memories were fused into
 * the results. With embeddings disabled and no stored vectors, hybridSearch
 * results are exactly the text leg — which must be query-filtered.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryService, MemoryType, type Memory } from '@memory-stack/core';

const SKIP = !!process.env['CI_SKIP_LIVE'];

describe.skipIf(SKIP)('hybridSearch (integration)', () => {
  let svc: MemoryService;
  let savedKey: string | undefined;
  const ns = 'hybridsearch_unit';
  const created: Memory[] = [];

  beforeAll(async () => {
    savedKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];

    svc = new MemoryService({
      surrealdb: {
        url: process.env['SURREALDB_URL'] ?? 'ws://localhost:8000/rpc',
        user: process.env['SURREALDB_USER'] ?? 'root',
        pass: process.env['SURREALDB_PASS'] ?? 'root',
        namespace: process.env['SURREALDB_NS'] ?? 'memory',
        database: process.env['SURREALDB_DB'] ?? 'stack',
      },
      qdrant: { url: process.env['QDRANT_URL'] ?? 'http://localhost:6333' },
    });
    await svc.connect();
  });

  afterAll(async () => {
    for (const m of created) await svc.deleteMemory(m.id).catch(() => {});
    await svc.disconnect();
    if (savedKey !== undefined) process.env['OPENAI_API_KEY'] = savedKey;
  });

  it('forwards the query to the text leg (no unrelated salience-browse results)', async () => {
    const marker = `qfwd-${Date.now()}`;
    const match = await svc.createMemory({
      content: `hybrid marker phrase ${marker} that should match`,
      memoryType: MemoryType.SEMANTIC,
      namespace: ns,
    });
    const decoy = await svc.createMemory({
      content: `completely unrelated decoy content ${Date.now()}`,
      memoryType: MemoryType.SEMANTIC,
      namespace: ns,
      salience: 10, // pre-fix, the query-less text leg surfaced this by salience
    });
    created.push(match, decoy);

    // Non-zero dummy vector (cosine rejects zero vectors); no memories in this
    // namespace have stored embeddings, so the vector leg contributes nothing.
    const dim = parseInt(process.env['QDRANT_VECTOR_SIZE'] ?? '1536', 10);
    const vector = Array.from({ length: dim }, (_, i) => Math.sin(i + 1));

    const results = await svc.hybridSearch(marker, vector, { namespace: ns });

    expect(results.some((r) => r.memory.content.includes(marker))).toBe(true);
    expect(results.some((r) => r.memory.id.id === decoy.id.id)).toBe(false);
  });
});
