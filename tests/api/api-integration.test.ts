/**
 * API Integration Tests
 * Tests all memory API endpoints against real SurrealDB + Qdrant
 *
 * Requires a running API. Set env vars:
 *   API_URL           (default: http://localhost:3001)
 *   API_TOKEN         pre-created token, OR
 *   API_BOOTSTRAP_CODE one-time bootstrap code to exchange for a token
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { TOKEN_FILE } from '../globalSetup.js';

const API_URL = process.env['API_URL'] ?? 'http://localhost:3001';

let authToken: string | undefined;

// Obtain a token before any tests run
beforeAll(async () => {
  if (process.env['API_TOKEN']) {
    authToken = process.env['API_TOKEN'];
    return;
  }

  // Try the temp file written by globalSetup
  try {
    authToken = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (authToken) return;
  } catch {
    // file not present — continue to other strategies
  }

  if (process.env['API_BOOTSTRAP_CODE']) {
    const res = await fetch(`${API_URL}/auth/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bootstrapCode: process.env['API_BOOTSTRAP_CODE'] }),
    }).catch(() => null);

    if (res?.ok) {
      const body = await res.json() as { token?: string };
      authToken = body.token;
    }
  }
});

async function api<T = unknown>(path: string, options?: RequestInit): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = res.status === 204 ? undefined : await res.json();
  return { status: res.status, data: data as T };
}

describe('Health & Stats', () => {
  it('GET /health returns healthy', async () => {
    const { status, data } = await api<{ status: string; stats: { totalMemories: number } }>('/health');
    expect(status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.stats).toHaveProperty('totalMemories');
  });

  it('GET /stats returns memory statistics', async () => {
    const { status, data } = await api<{ total: number; byNamespace: Record<string, number> }>('/stats');
    expect(status).toBe(200);
    expect(typeof data.total).toBe('number');
    expect(data).toHaveProperty('byNamespace');
    expect(data).toHaveProperty('byType');
  });
});

describe('Memory CRUD', () => {
  let createdId: string;
  const namespace = 'test_integration';

  it('POST /memories creates a memory', async () => {
    const { status, data } = await api<{
      id: { id: string; namespace: string };
      content: string;
      memoryType: string;
      version: number;
    }>('/memories', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Integration test memory for API validation',
        memoryType: 'semantic',
        namespace,
        tags: ['test', 'integration'],
        salience: 7,
        confidence: 0.9,
      }),
    });

    expect(status).toBe(201);
    expect(data.id.namespace).toBe(namespace);
    expect(data.content).toContain('Integration test');
    expect(data.memoryType).toBe('semantic');
    expect(data.version).toBe(1);
    createdId = data.id.id;
  });

  it('GET /memories lists memories', async () => {
    const { status, data } = await api<{ data: unknown[]; count: number }>(
      `/memories?namespace=${namespace}`
    );
    expect(status).toBe(200);
    expect(data.count).toBeGreaterThanOrEqual(1);
    expect(data.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /memories/:namespace/:id retrieves a memory', async () => {
    const { status, data } = await api<{ id: { id: string }; content: string }>(
      `/memories/${namespace}/${createdId}`
    );
    expect(status).toBe(200);
    expect(data.id.id).toBe(createdId);
    expect(data.content).toContain('Integration test');
  });

  it('PATCH /memories/:namespace/:id updates a memory', async () => {
    const { status, data } = await api<{ version: number; content: string }>(
      `/memories/${namespace}/${createdId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ content: 'Updated integration test memory' }),
      }
    );
    expect(status).toBe(200);
    expect(data.version).toBe(2);
    expect(data.content).toBe('Updated integration test memory');
  });

  it('GET /memories returns 404 for non-existent memory', async () => {
    const { status } = await api('/memories/nonexistent/nonexistent-id');
    expect(status).toBe(404);
  });

  it('DELETE /memories/:namespace/:id deletes a memory', async () => {
    const { status } = await api(`/memories/${namespace}/${createdId}`, {
      method: 'DELETE',
    });
    expect(status).toBe(204);
  });

  it('GET returns 404 after deletion', async () => {
    const { status } = await api(`/memories/${namespace}/${createdId}`);
    expect(status).toBe(404);
  });
});

describe('Relations', () => {
  let memoryA: string;
  let memoryB: string;
  let relationId: string;
  const namespace = 'test_relations';

  beforeAll(async () => {
    const resA = await api<{ id: { id: string } }>('/memories', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Relation test memory A',
        memoryType: 'semantic',
        namespace,
        salience: 5,
      }),
    });
    memoryA = resA.data.id.id;

    const resB = await api<{ id: { id: string } }>('/memories', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Relation test memory B',
        memoryType: 'semantic',
        namespace,
        salience: 5,
      }),
    });
    memoryB = resB.data.id.id;
  });

  it('POST /memories/relations creates a relation', async () => {
    const { status, data } = await api<{
      id: string;
      relationType: string;
      strength: number;
      bidirectional: boolean;
    }>('/memories/relations', {
      method: 'POST',
      body: JSON.stringify({
        fromMemoryId: memoryA,
        fromNamespace: namespace,
        toMemoryId: memoryB,
        toNamespace: namespace,
        relationType: 'related_to',
        strength: 0.8,
        bidirectional: true,
      }),
    });

    expect(status).toBe(201);
    expect(data.relationType).toBe('related_to');
    expect(data.strength).toBe(0.8);
    expect(data.bidirectional).toBe(true);
    relationId = data.id;
  });

  it('GET /:namespace/:id/relations returns relations', async () => {
    const { status, data } = await api<{ data: unknown[]; count: number }>(
      `/memories/${namespace}/${memoryA}/relations`
    );
    expect(status).toBe(200);
    expect(data.count).toBeGreaterThanOrEqual(1);
  });

  it('GET /:namespace/:id?includeRelations=true includes relations', async () => {
    const { status, data } = await api<{ relations: unknown[] }>(
      `/memories/${namespace}/${memoryA}?includeRelations=true`
    );
    expect(status).toBe(200);
    expect(data.relations.length).toBeGreaterThanOrEqual(1);
  });

  it('DELETE /relations/:id deletes a relation', async () => {
    const { status } = await api(`/memories/relations/${relationId}`, {
      method: 'DELETE',
    });
    expect(status).toBe(204);
  });

  afterAll(async () => {
    await api(`/memories/${namespace}/${memoryA}`, { method: 'DELETE' });
    await api(`/memories/${namespace}/${memoryB}`, { method: 'DELETE' });
  });
});

describe('Export/Import', () => {
  const namespace = 'test_export';

  beforeAll(async () => {
    await api('/memories', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Export test memory 1',
        memoryType: 'semantic',
        namespace,
        salience: 5,
      }),
    });
    await api('/memories', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Export test memory 2',
        memoryType: 'episodic',
        namespace,
        salience: 4,
      }),
    });
  });

  it('GET /export/:namespace exports memories as JSON', async () => {
    const { status, data } = await api<{
      formatVersion: string;
      memories: unknown[];
      relations: unknown[];
      checksum: string;
    }>(`/memories/export/${namespace}`);
    expect(status).toBe(200);
    expect(data.formatVersion).toBe('1.0');
    expect(data.memories.length).toBeGreaterThanOrEqual(2);
    expect(data.checksum).toBeTruthy();
  });

  it('GET /export/:namespace/pmf exports in PMF format', async () => {
    const { status, data } = await api<{
      header: { magic: string; version: string; integrity: { memoryCount: number } };
      graph: { nodes: number };
    }>(`/memories/export/${namespace}/pmf`);
    expect(status).toBe(200);
    expect(data.header.magic).toBe('NCPMF');
    // PMF v1.1 since the append-only supersession work (invalidation history
    // is integrity-covered); 1.0 was the pre-v1.3 header.
    expect(data.header.version).toBe('1.1');
    expect(data.header.integrity.memoryCount).toBeGreaterThanOrEqual(2);
    expect(data.graph.nodes).toBeGreaterThanOrEqual(2);
  });
});

describe('Validation', () => {
  it('rejects empty content', async () => {
    const { status } = await api('/memories', {
      method: 'POST',
      body: JSON.stringify({ content: '', memoryType: 'semantic' }),
    });
    expect(status).toBe(400);
  });

  it('rejects invalid memoryType', async () => {
    const { status } = await api('/memories', {
      method: 'POST',
      body: JSON.stringify({ content: 'test', memoryType: 'invalid_type' }),
    });
    expect(status).toBe(400);
  });

  it('rejects salience > 10', async () => {
    const { status } = await api('/memories', {
      method: 'POST',
      body: JSON.stringify({ content: 'test', memoryType: 'semantic', salience: 15 }),
    });
    expect(status).toBe(400);
  });
});

describe('Namespaces', () => {
  it('GET /namespaces returns namespace list', async () => {
    const { status, data } = await api<{ data: string[]; count: number }>('/namespaces');
    expect(status).toBe(200);
    expect(Array.isArray(data.data)).toBe(true);
  });
});

describe('Duplicate Detection', () => {
  const namespace = 'test_dedup';

  it('returns existing memory for duplicate content', async () => {
    const content = `Unique content for dedup test ${Date.now()}`;
    const res1 = await api<{ id: { id: string }; contentHash: string }>('/memories', {
      method: 'POST',
      body: JSON.stringify({ content, memoryType: 'semantic', namespace }),
    });

    const res2 = await api<{ id: { id: string }; contentHash: string }>('/memories', {
      method: 'POST',
      body: JSON.stringify({ content, memoryType: 'semantic', namespace }),
    });

    // SurrealDB adapter deduplicates by contentHash
    expect(res1.data.contentHash).toBe(res2.data.contentHash);
    expect(res1.data.id.id).toBe(res2.data.id.id);
  });
});

describe('Vector Embeddings', () => {
  it('POST /memories/embeddings/generate responds correctly', async () => {
    const { status, data } = await api<{ status?: string; error?: string }>('/memories/embeddings/generate', {
      method: 'POST',
    });
    // Either started (key configured) or 400 (no key) — both are valid API behaviour
    expect([200, 400]).toContain(status);
    if (status === 200) {
      expect((data as { status: string }).status).toBe('started');
    } else {
      expect((data as { error: string }).error).toMatch(/OPENAI_API_KEY/);
    }
  });
});
