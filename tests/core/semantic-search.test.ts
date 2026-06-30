/**
 * searchByText (integration) — requires the live dev stack.
 *
 * Regression test for the headline-feature gap where no first-party interface
 * embedded a search *query*, so semantic search was unreachable. `searchByText`
 * now embeds the query (when enabled) and otherwise transparently falls back to
 * substring search. This test pins the deterministic fallback path; the live
 * semantic path is exercised end-to-end against the API.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryService, MemoryType, type Memory } from '@memory-stack/core';

const SKIP = !!process.env['CI_SKIP_LIVE'];

describe.skipIf(SKIP)('searchByText (integration)', () => {
  let svc: MemoryService;
  let savedKey: string | undefined;
  const ns = 'semsearch_unit';
  const created: Memory[] = [];

  beforeAll(async () => {
    // Force embeddings OFF for a deterministic substring-fallback assertion.
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
      // No embedding config + no key → embeddings disabled.
    });
    await svc.connect();
  });

  afterAll(async () => {
    for (const m of created) await svc.deleteMemory(m.id).catch(() => {});
    await svc.disconnect();
    if (savedKey !== undefined) process.env['OPENAI_API_KEY'] = savedKey;
  });

  it('reports embeddings disabled when no key is configured', () => {
    expect(svc.getEmbeddingService().isEnabled()).toBe(false);
  });

  it('falls back to substring text search when embeddings are disabled', async () => {
    const marker = `zzxq-${Date.now()}`;
    const m = await svc.createMemory({
      content: `unique marker phrase ${marker} for fallback search`,
      memoryType: MemoryType.SEMANTIC,
      namespace: ns,
    });
    created.push(m);

    const { results, mode } = await svc.searchByText(marker, { namespace: ns });
    expect(mode).toBe('text');
    expect(results.some((r) => r.memory.content.includes(marker))).toBe(true);
  });
});
