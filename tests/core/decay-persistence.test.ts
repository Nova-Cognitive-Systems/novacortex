/**
 * Decay persistence (integration) — requires the live dev stack (SurrealDB + Qdrant).
 *
 * Regression test for the bug where the decay processor called
 * `updateMemory(id, {})` with an empty object, so decayed salience was never
 * persisted. The fix adds `effectiveSalience` / `lastDecayCalculation` to
 * UpdateMemoryInput and persists them WITHOUT resetting the base `salience`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryService, MemoryType } from '@memory-stack/core';

const SKIP = !!process.env['CI_SKIP_LIVE'];

describe.skipIf(SKIP)('decay persistence (integration)', () => {
  let svc: MemoryService;

  beforeAll(async () => {
    svc = new MemoryService({
      surrealdb: {
        url: process.env['SURREALDB_URL'] ?? 'ws://localhost:8000/rpc',
        user: process.env['SURREALDB_USER'] ?? 'root',
        pass: process.env['SURREALDB_PASS'] ?? 'root',
        namespace: process.env['SURREALDB_NS'] ?? 'memory',
        database: process.env['SURREALDB_DB'] ?? 'stack',
      },
      qdrant: {
        url: process.env['QDRANT_URL'] ?? 'http://localhost:6333',
      },
    });
    await svc.connect();
  });

  afterAll(async () => {
    await svc.disconnect();
  });

  it('persists effectiveSalience + lastDecayCalculation without resetting base salience', async () => {
    const created = await svc.createMemory({
      content: `decay-persistence-test-${Date.now()}`,
      memoryType: MemoryType.SEMANTIC,
      namespace: 'decay_test',
      salience: 8,
    });

    try {
      expect(created.metadata.salience).toBe(8);
      expect(created.metadata.effectiveSalience).toBe(8);

      const decayedAt = new Date();
      const updated = await svc.updateMemory(created.id, {
        effectiveSalience: 4.25,
        lastDecayCalculation: decayedAt,
      });

      expect(updated).toBeTruthy();
      // Decayed value is persisted...
      expect(updated!.metadata.effectiveSalience).toBeCloseTo(4.25, 2);
      // ...but the base salience is untouched.
      expect(updated!.metadata.salience).toBe(8);

      // And it survives a fresh read.
      const reread = await svc.getMemory(created.id);
      expect(reread!.metadata.effectiveSalience).toBeCloseTo(4.25, 2);
      expect(reread!.metadata.salience).toBe(8);
    } finally {
      await svc.deleteMemory(created.id);
    }
  });
});
