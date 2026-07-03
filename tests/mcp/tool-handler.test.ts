/**
 * MCP ToolHandler (integration) — first direct coverage of the MCP surface:
 * memory_store → wakeup index mode (progressive disclosure), memory_update
 * (incl. version bump), memory_current, and tool listing sanity.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryService } from '@memory-stack/core';
import { ToolHandler } from '../../packages/mcp-server/src/tools.js';

const SKIP = !!process.env['CI_SKIP_LIVE'];

function parse(result: { content: Array<{ text: string }>; isError?: boolean }): any {
  return JSON.parse(result.content[0]!.text);
}

describe.skipIf(SKIP)('MCP ToolHandler (integration)', () => {
  let svc: MemoryService;
  let handler: ToolHandler;
  const ns = `mcp_unit_${Date.now()}`;
  const createdIds: string[] = [];
  let savedKey: string | undefined;

  beforeAll(async () => {
    savedKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY']; // deterministic substring paths

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
    handler = new ToolHandler(svc);
  });

  afterAll(async () => {
    for (const id of createdIds) await svc.deleteMemory({ id, namespace: ns }).catch(() => {});
    await svc.disconnect();
    if (savedKey !== undefined) process.env['OPENAI_API_KEY'] = savedKey;
  });

  it('exposes the full v1.3 tool surface', () => {
    const names = handler.getToolDefinitions().map((t) => t.name);
    for (const tool of ['memory_store', 'memory_search', 'memory_ingest', 'memory_current', 'memory_update', 'memory_wakeup']) {
      expect(names).toContain(tool);
    }
  });

  it('memory_wakeup depth=index returns a compact one-line-per-memory index', async () => {
    const store = await handler.handleTool('memory_store', {
      content: `wakeup index probe: the project deploys via docker compose on unraid ${ns}`,
      memoryType: 'semantic',
      namespace: ns,
      salience: 9,
    });
    createdIds.push(parse(store).id);

    const result = await handler.handleTool('memory_wakeup', { namespace: ns, depth: 'index' });
    const body = parse(result);
    expect(body.depth).toBe('index');
    expect(body.indexed).toBeGreaterThan(0);
    expect(body.index[0]).toMatch(/^[a-zA-Z0-9]{8} \[s9\] /); // <id-suffix> [<type><salience>] <gist>
    // Budget: the whole index stays tiny (~150 tokens).
    expect((body.index as string[]).join('\n').length).toBeLessThanOrEqual(700);
  });

  it('memory_update patches content and bumps the version', async () => {
    const store = await handler.handleTool('memory_store', {
      content: `update probe original ${ns}`,
      memoryType: 'semantic',
      namespace: ns,
    });
    const id = parse(store).id;
    createdIds.push(id);

    const update = await handler.handleTool('memory_update', {
      id,
      namespace: ns,
      content: `update probe corrected ${ns}`,
      salience: 8,
    });
    const body = parse(update);
    expect(body.updated).toBe(true);
    expect(body.version).toBe(2);
    expect(body.reEmbedded).toBe(false); // embeddings disabled in this test

    const recall = await handler.handleTool('memory_recall', { id, namespace: ns });
    expect(parse(recall).content ?? JSON.stringify(parse(recall))).toContain('corrected');
  });

  it('memory_update errors cleanly on unknown ids', async () => {
    const result = await handler.handleTool('memory_update', {
      id: 'does-not-exist',
      namespace: ns,
      salience: 1,
    });
    expect(result.isError).toBe(true);
  });
});
