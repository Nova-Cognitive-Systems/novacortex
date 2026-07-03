/**
 * Temporal read path (integration) — the payoff of append-only resolution:
 * superseded facts vanish from default search but stay queryable via
 * includeInvalidated / asOf / getCurrentFact, and survive PMF round-trips.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryService, MemoryType, RelationType, type Memory } from '@memory-stack/core';

const SKIP = !!process.env['CI_SKIP_LIVE'];

describe.skipIf(SKIP)('temporal read path (integration)', () => {
  let svc: MemoryService;
  let savedKey: string | undefined;
  const ns = `temporal_unit_${Date.now()}`;
  const importNs = `${ns}_import`;
  const created: Memory[] = [];

  let v1: Memory; // oldest fact, superseded by v2
  let v2: Memory; // superseded by v3
  let v3: Memory; // current tip
  const t0 = new Date();

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

    // Build a supersedes chain: v1 <- v2 <- v3 (as the resolution engine would).
    v1 = await svc.createMemory({
      content: `favorite editor fact v1 ${ns}: VS Code`,
      memoryType: MemoryType.SEMANTIC,
      namespace: ns,
    });
    v2 = await svc.createMemory({
      content: `favorite editor fact v2 ${ns}: Neovim`,
      memoryType: MemoryType.SEMANTIC,
      namespace: ns,
    });
    v3 = await svc.createMemory({
      content: `favorite editor fact v3 ${ns}: Zed`,
      memoryType: MemoryType.SEMANTIC,
      namespace: ns,
    });
    created.push(v1, v2, v3);

    await svc.createRelation(v2.id, v1.id, RelationType.SUPERSEDES, 0.9, false, { test: true });
    await svc.updateMemory(v1.id, { invalidatedAt: new Date() });
    await svc.createRelation(v3.id, v2.id, RelationType.SUPERSEDES, 0.9, false, { test: true });
    await svc.updateMemory(v2.id, { invalidatedAt: new Date() });
  });

  afterAll(async () => {
    for (const m of created) await svc.deleteMemory(m.id).catch(() => {});
    const imported = await svc.searchMemories({ namespace: importNs, limit: 100, includeInvalidated: true });
    for (const m of imported) await svc.deleteMemory(m.id).catch(() => {});
    await svc.disconnect();
    if (savedKey !== undefined) process.env['OPENAI_API_KEY'] = savedKey;
  });

  it('default search returns only the CURRENT fact', async () => {
    const results = await svc.searchMemories({ namespace: ns, query: 'favorite editor fact' });
    expect(results.map((m) => m.id.id)).toEqual([v3.id.id]);
  });

  it('includeInvalidated surfaces the full history', async () => {
    const results = await svc.searchMemories({
      namespace: ns,
      query: 'favorite editor fact',
      includeInvalidated: true,
    });
    expect(results.length).toBe(3);
  });

  it('asOf reconstructs the point-in-time belief', async () => {
    // At t0 (before any invalidation) all three exist? No: at t0 none were
    // created yet — use a time between creation and invalidation is impossible
    // here (same-ms operations), so query asOf = now, which must return only
    // the current fact, and asOf before creation returns nothing.
    const beforeCreation = new Date(t0.getTime() - 60_000);
    const nothing = await svc.searchMemories({ namespace: ns, query: 'favorite editor fact', asOf: beforeCreation });
    expect(nothing.length).toBe(0);

    const now = await svc.searchMemories({ namespace: ns, query: 'favorite editor fact', asOf: new Date() });
    expect(now.map((m) => m.id.id)).toEqual([v3.id.id]);
  });

  it('getCurrentFact walks the supersedes chain to the tip', async () => {
    const result = await svc.getCurrentFact(v1.id);
    expect(result).not.toBeNull();
    expect(result!.superseded).toBe(true);
    expect(result!.current.id.id).toBe(v3.id.id);
    expect(result!.chain.map((m) => m.id.id)).toEqual([v1.id.id, v2.id.id, v3.id.id]);
  });

  it('getCurrentFact on the tip reports not superseded', async () => {
    const result = await svc.getCurrentFact(v3.id);
    expect(result!.superseded).toBe(false);
    expect(result!.current.id.id).toBe(v3.id.id);
    expect(result!.chain.length).toBe(1);
  });

  it('PMF v1.1 export carries invalidated and import restores it', async () => {
    const pmf = await svc.exportNamespacePMF(ns);
    expect(pmf.header.version).toBe('1.1');

    const v1Entry = pmf.memories.find((m) => m.id === v1.id.id);
    const v3Entry = pmf.memories.find((m) => m.id === v3.id.id);
    expect(v1Entry?.invalidated).toBeDefined();
    expect(v3Entry?.invalidated).toBeUndefined();

    const result = await svc.importFromPMF(pmf, { targetNamespace: importNs });
    expect(result.imported).toBe(3);
    expect(result.errors).toEqual([]);

    const imported = await svc.searchMemories({ namespace: importNs, limit: 100, includeInvalidated: true });
    const invalidatedCount = imported.filter((m) => m.invalidatedAt).length;
    expect(invalidatedCount).toBe(2);

    // And default search in the imported namespace also hides history.
    const current = await svc.searchMemories({ namespace: importNs, query: 'favorite editor fact' });
    expect(current.length).toBe(1);
  });
});
