/**
 * IntelligenceService — extraction sanitation (unit, mocked LLM), the
 * append-only resolution contract (unit, stubbed store), and the end-to-end
 * ingest flow against the live dev stack (LLM mocked, embeddings off).
 */
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import {
  IntelligenceService,
  LLMService,
  MemoryService,
  MemoryType,
  RelationType,
  type Memory,
} from '@memory-stack/core';

const SKIP = !!process.env['CI_SKIP_LIVE'];
const origFetch = globalThis.fetch;

/** Mock ONLY chat-completion calls; pass everything else (Qdrant etc.) through. */
function mockLLM(responder: (body: any) => string) {
  globalThis.fetch = (async (url: unknown, init?: unknown) => {
    if (String(url).includes('/chat/completions')) {
      const body = JSON.parse(String((init as RequestInit).body));
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: responder(body) } }] }),
      } as unknown as Response;
    }
    return origFetch(url as any, init as any);
  }) as typeof fetch;
}

function testLLM(): LLMService {
  return new LLMService({ apiKey: 'test', model: 'test-model', baseUrl: 'http://llm.test/v1' });
}

afterEach(() => {
  globalThis.fetch = origFetch;
});

describe('IntelligenceService extraction (unit)', () => {
  it('is a no-op without a configured LLM', async () => {
    const prev = { k: process.env['LLM_API_KEY'], m: process.env['LLM_MODEL'], ok: process.env['OPENAI_API_KEY'] };
    delete process.env['LLM_API_KEY'];
    delete process.env['LLM_MODEL'];
    delete process.env['OPENAI_API_KEY'];
    try {
      const svc = new IntelligenceService({} as unknown as MemoryService, new LLMService({}));
      expect(svc.isEnabled()).toBe(false);
      expect(await svc.extractFacts([{ role: 'user', content: 'hello' }])).toEqual([]);
    } finally {
      if (prev.k !== undefined) process.env['LLM_API_KEY'] = prev.k;
      if (prev.m !== undefined) process.env['LLM_MODEL'] = prev.m;
      if (prev.ok !== undefined) process.env['OPENAI_API_KEY'] = prev.ok;
    }
  });

  it('sanitizes LLM output: clamps salience, drops invalid entities, dedupes', async () => {
    mockLLM(() =>
      JSON.stringify({
        facts: [
          {
            content: 'The user prefers dark mode in all editors',
            memoryType: 'semantic',
            tags: ['Preferences', ' ui '],
            entities: [
              { name: 'dark mode', type: 'concept' },
              { name: 'bogus', type: 'not-a-type' },
            ],
            salience: 42,
            confidence: 1.7,
          },
          {
            content: 'The user prefers dark mode in all editors',
            memoryType: 'semantic',
            tags: [],
            entities: [],
            salience: 5,
            confidence: 0.9,
          },
          { content: 'x', memoryType: 'semantic', tags: [], entities: [], salience: 5, confidence: 1 },
          { content: 'A fact with a bogus type falls back to semantic', memoryType: 'wat', tags: [], entities: [], salience: 3, confidence: 0.8 },
        ],
      })
    );

    const svc = new IntelligenceService({} as unknown as MemoryService, testLLM());
    const facts = await svc.extractFacts([{ role: 'user', content: 'I always use dark mode' }]);

    expect(facts.length).toBe(2); // dedupe + too-short dropped
    const first = facts[0]!;
    expect(first.salience).toBe(10); // clamped
    expect(first.confidence).toBe(1); // clamped
    expect(first.tags).toEqual(['preferences', 'ui']); // normalized
    expect(first.entities.length).toBe(1); // invalid entity type dropped
    expect(facts[1]!.memoryType).toBe(MemoryType.SEMANTIC); // bogus type falls back
  });

  it('chunks long conversations into multiple extraction calls', async () => {
    let calls = 0;
    mockLLM(() => {
      calls++;
      return JSON.stringify({ facts: [] });
    });
    const svc = new IntelligenceService({} as unknown as MemoryService, testLLM());
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: 'user' as const,
      content: `msg ${i}: ${'x'.repeat(1500)}`,
    }));
    await svc.extractFacts(messages);
    expect(calls).toBeGreaterThan(1);
  });
});

describe('IntelligenceService resolution (unit, stubbed store)', () => {
  function makeMemory(id: string, content: string, createdAt: Date): Memory {
    return {
      id: { id, namespace: 'ns' },
      content,
      contentHash: `hash-${id}`,
      memoryType: MemoryType.SEMANTIC,
      createdAt,
      accessedAt: createdAt,
      version: 1,
      metadata: {
        source: { type: 'extraction', timestamp: createdAt },
        confidence: 1,
        salience: 5,
        decayRate: 30,
        lastDecayCalculation: createdAt,
        effectiveSalience: 5,
        tags: [],
        entities: [],
        signals: [],
      },
      relations: [],
    };
  }

  function makeStore(newMem: Memory, candidate: Memory) {
    const createRelation = vi.fn(async () => ({}) as never);
    const updateMemory = vi.fn(async () => candidate);
    const store = {
      getMemory: async () => newMem,
      findSimilar: async () => [{ memory: candidate, score: 0.8 }],
      getRelations: async () => [],
      createRelation,
      updateMemory,
    } as unknown as MemoryService;
    return { store, createRelation, updateMemory };
  }

  it('supersedes: writes the typed edge AND stamps invalidatedAt — never deletes', async () => {
    const newMem = makeMemory('new', 'The user prefers spaces now', new Date());
    const candidate = makeMemory('old', 'The user prefers tabs', new Date(Date.now() - 86400000));
    const { store, createRelation, updateMemory } = makeStore(newMem, candidate);

    mockLLM(() => JSON.stringify({ decision: 'supersedes', reason: 'preference changed' }));
    const svc = new IntelligenceService(store, testLLM());
    const outcomes = await svc.resolveMemory(newMem.id);

    expect(outcomes).toEqual([
      { memory: newMem.id, candidate: candidate.id, decision: 'supersedes', reason: 'preference changed' },
    ]);
    expect(createRelation).toHaveBeenCalledWith(
      newMem.id,
      candidate.id,
      RelationType.SUPERSEDES,
      0.8,
      false,
      expect.objectContaining({ resolvedBy: 'llm', reason: 'preference changed' })
    );
    expect(updateMemory).toHaveBeenCalledWith(candidate.id, {
      invalidatedAt: expect.any(Date),
    });
  });

  it('contradicts: bidirectional edge, NO invalidation (keep both flagged)', async () => {
    const newMem = makeMemory('new', 'Rate limit is 100/min', new Date());
    const candidate = makeMemory('old', 'Rate limit is 1000/min', new Date());
    const { store, createRelation, updateMemory } = makeStore(newMem, candidate);

    mockLLM(() => JSON.stringify({ decision: 'contradicts', reason: 'conflicting values' }));
    const svc = new IntelligenceService(store, testLLM());
    const outcomes = await svc.resolveMemory(newMem.id);

    expect(outcomes[0]!.decision).toBe('contradicts');
    expect(createRelation).toHaveBeenCalledWith(
      newMem.id, candidate.id, RelationType.CONTRADICTS, 0.8, true, expect.anything()
    );
    expect(updateMemory).not.toHaveBeenCalled();
  });

  it('never re-judges an already-invalidated candidate', async () => {
    const newMem = makeMemory('new', 'current fact', new Date());
    const candidate = {
      ...makeMemory('old', 'ancient fact', new Date(0)),
      invalidatedAt: new Date(),
    };
    const { store, createRelation } = makeStore(newMem, candidate as Memory);

    mockLLM(() => JSON.stringify({ decision: 'supersedes', reason: 'should never be asked' }));
    const svc = new IntelligenceService(store, testLLM());
    const outcomes = await svc.resolveMemory(newMem.id);

    expect(outcomes).toEqual([]);
    expect(createRelation).not.toHaveBeenCalled();
  });

  it('an unknown decision degrades to none (no edge writes)', async () => {
    const newMem = makeMemory('new', 'a', new Date());
    const candidate = makeMemory('old', 'b', new Date());
    const { store, createRelation, updateMemory } = makeStore(newMem, candidate);

    mockLLM(() => JSON.stringify({ decision: 'obliterate', reason: 'hallucinated op' }));
    const svc = new IntelligenceService(store, testLLM());
    const outcomes = await svc.resolveMemory(newMem.id);

    expect(outcomes[0]!.decision).toBe('none');
    expect(createRelation).not.toHaveBeenCalled();
    expect(updateMemory).not.toHaveBeenCalled();
  });
});

describe.skipIf(SKIP)('IntelligenceService ingest (integration)', () => {
  let svc: MemoryService;
  let savedKey: string | undefined;
  const ns = `intel_unit_${Date.now()}`;
  const created: Memory[] = [];

  beforeAll(async () => {
    savedKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY']; // embeddings off — pure store path

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

  it('stores extracted facts with populated metadata and reports duplicates on re-ingest', async () => {
    const marker = `intelfact-${Date.now()}`;
    mockLLM(() =>
      JSON.stringify({
        facts: [
          {
            content: `The user's project codename is ${marker}`,
            memoryType: 'semantic',
            tags: ['project'],
            entities: [{ name: marker, type: 'concept' }],
            salience: 8,
            confidence: 0.95,
          },
        ],
      })
    );

    const intel = new IntelligenceService(svc, testLLM());
    const messages = [{ role: 'user' as const, content: `our codename is ${marker}` }];

    const first = await intel.ingest(messages, { namespace: ns, sessionId: 'sess-1' });
    created.push(...first.created);

    expect(first.created.length).toBe(1);
    expect(first.duplicates).toBe(0);
    const stored = first.created[0]!;
    expect(stored.memoryType).toBe(MemoryType.SEMANTIC);
    expect(stored.metadata.tags).toContain('project');
    expect(stored.metadata.entities.some((e) => e.name === marker)).toBe(true);
    expect(stored.metadata.salience).toBe(8);
    expect(stored.metadata.source.type).toBe('extraction');
    expect(stored.metadata.source.sessionId).toBe('sess-1');
    // Embeddings are off → resolution has nothing to judge, must not throw.
    expect(first.resolutions).toEqual([]);

    const second = await intel.ingest(messages, { namespace: ns });
    expect(second.created.length).toBe(0);
    expect(second.duplicates).toBe(1);
  });

  it('invalidatedAt round-trips through update and read', async () => {
    const m = await svc.createMemory({
      content: `invalidation roundtrip ${Date.now()}`,
      memoryType: MemoryType.SEMANTIC,
      namespace: ns,
    });
    created.push(m);
    expect(m.invalidatedAt).toBeUndefined();

    const stamp = new Date();
    await svc.updateMemory(m.id, { invalidatedAt: stamp });
    const read = await svc.getMemory(m.id);
    expect(read?.invalidatedAt).toBeInstanceOf(Date);
    expect(Math.abs(read!.invalidatedAt!.getTime() - stamp.getTime())).toBeLessThan(2000);

    await svc.updateMemory(m.id, { invalidatedAt: null });
    const cleared = await svc.getMemory(m.id);
    expect(cleared?.invalidatedAt).toBeUndefined();
  });
});
