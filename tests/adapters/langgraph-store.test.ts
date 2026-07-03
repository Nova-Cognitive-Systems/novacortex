/**
 * LangGraph NovaCortexStore — namespace mapping, put(create/overwrite),
 * get(reconstruct Item), search(query→client.search / list fallback),
 * listNamespaces(prefix filter + maxDepth dedupe), and batch() discriminating
 * all four operation shapes (incl. PutOperation{value:null} → delete).
 * Fully mocked NovaCortex client — no live server.
 */
import { describe, it, expect, vi } from 'vitest';
import { NovaCortexStore } from '../../packages/langgraph/src/index.js';

function fakeClient() {
  return {
    search: vi.fn(),
    namespaces: { list: vi.fn() },
    memories: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

function memory(over: Record<string, unknown> = {}) {
  return {
    id: { id: 'mem-1', namespace: 'langgraph__users__1' },
    content: 'Alice',
    metadata: { tags: ['lgkey:profile'] },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

describe('NovaCortexStore — put', () => {
  it('creates on first put and updates on a second put with the same key', async () => {
    const client = fakeClient();
    const store = new NovaCortexStore({ client: client as never });

    // First put: findByKey finds nothing → create.
    client.memories.list.mockResolvedValueOnce({ data: [] });
    await store.put(['users', '1'], 'profile', { content: 'Alice' });

    expect(client.memories.list).toHaveBeenCalledWith({
      namespace: 'langgraph__users__1',
      tags: ['lgkey:profile'],
      limit: 1,
    });
    expect(client.memories.create).toHaveBeenCalledWith({
      content: 'Alice',
      memoryType: 'semantic',
      namespace: 'langgraph__users__1',
      tags: ['lgkey:profile'],
    });

    // Second put: findByKey finds the existing memory → update, no second create.
    client.memories.list.mockResolvedValueOnce({ data: [memory()] });
    await store.put(['users', '1'], 'profile', { content: 'Alice v2' });

    expect(client.memories.update).toHaveBeenCalledWith('langgraph__users__1', 'mem-1', {
      content: 'Alice v2',
    });
    expect(client.memories.create).toHaveBeenCalledTimes(1);
  });

  it('serializes non-text values as JSON content', async () => {
    const client = fakeClient();
    const store = new NovaCortexStore({ client: client as never });
    client.memories.list.mockResolvedValueOnce({ data: [] });

    await store.put(['docs'], 'd1', { title: 'Report', pages: 3 });
    expect(client.memories.create).toHaveBeenCalledWith({
      content: JSON.stringify({ title: 'Report', pages: 3 }),
      memoryType: 'semantic',
      namespace: 'langgraph__docs',
      tags: ['lgkey:d1'],
    });
  });
});

describe('NovaCortexStore — get', () => {
  it('reconstructs an Item (JSON value, key from tag, Date timestamps)', async () => {
    const client = fakeClient();
    const store = new NovaCortexStore({ client: client as never });
    client.memories.list.mockResolvedValueOnce({
      data: [memory({ content: '{"content":"Alice","age":30}' })],
    });

    const item = await store.get(['users', '1'], 'profile');
    expect(item).not.toBeNull();
    expect(item!.value).toEqual({ content: 'Alice', age: 30 });
    expect(item!.key).toBe('profile');
    expect(item!.namespace).toEqual(['users', '1']);
    expect(item!.createdAt).toBeInstanceOf(Date);
    expect(item!.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(item!.updatedAt.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('wraps non-JSON content as { content } and returns null when absent', async () => {
    const client = fakeClient();
    const store = new NovaCortexStore({ client: client as never });

    client.memories.list.mockResolvedValueOnce({ data: [memory({ content: 'just text' })] });
    const item = await store.get(['users', '1'], 'profile');
    expect(item!.value).toEqual({ content: 'just text' });

    client.memories.list.mockResolvedValueOnce({ data: [] });
    expect(await store.get(['users', '1'], 'missing')).toBeNull();
  });
});

describe('NovaCortexStore — delete', () => {
  it('finds the memory by key tag and deletes it by id', async () => {
    const client = fakeClient();
    const store = new NovaCortexStore({ client: client as never });
    client.memories.list.mockResolvedValueOnce({ data: [memory()] });

    await store.delete(['users', '1'], 'profile');
    expect(client.memories.delete).toHaveBeenCalledWith('langgraph__users__1', 'mem-1');
  });
});

describe('NovaCortexStore — search', () => {
  it('maps a query to client.search and carries the score through', async () => {
    const client = fakeClient();
    const store = new NovaCortexStore({ client: client as never });
    client.search.mockResolvedValue({
      data: [{ memory: memory({ content: 'Alice likes coffee', metadata: { tags: ['lgkey:k1'] } }), score: 0.9 }],
    });

    const items = await store.search(['users'], { query: 'coffee', limit: 3 });
    expect(client.search).toHaveBeenCalledWith({ query: 'coffee', namespace: 'langgraph__users', limit: 3 });
    expect(items).toHaveLength(1);
    expect(items[0]!.value).toEqual({ content: 'Alice likes coffee' });
    expect(items[0]!.key).toBe('k1');
    expect(items[0]!.namespace).toEqual(['users']);
    expect(items[0]!.score).toBe(0.9);
  });

  it('falls back to memories.list (no query) and applies exact-match filters', async () => {
    const client = fakeClient();
    const store = new NovaCortexStore({ client: client as never });
    client.memories.list.mockResolvedValue({
      data: [
        memory({ content: '{"status":"active"}', metadata: { tags: ['lgkey:a'] } }),
        memory({ content: '{"status":"archived"}', metadata: { tags: ['lgkey:b'] } }),
      ],
    });

    const items = await store.search(['users'], { limit: 10, offset: 0, filter: { status: 'active' } });
    expect(client.memories.list).toHaveBeenCalledWith({ namespace: 'langgraph__users', limit: 10, offset: 0 });
    expect(items).toHaveLength(1);
    expect(items[0]!.value).toEqual({ status: 'active' });
    expect(items[0]!.score).toBeUndefined();
  });
});

describe('NovaCortexStore — listNamespaces', () => {
  it('filters by prefix, reconstructs paths, and truncates + dedupes with maxDepth', async () => {
    const client = fakeClient();
    const store = new NovaCortexStore({ client: client as never });
    client.namespaces.list.mockResolvedValue({
      data: ['langgraph', 'langgraph__users__1', 'langgraph__users__2', 'other__x'],
    });

    expect(await store.listNamespaces()).toEqual([[], ['users', '1'], ['users', '2']]);
    expect(await store.listNamespaces({ maxDepth: 1 })).toEqual([[], ['users']]);
  });
});

describe('NovaCortexStore — batch', () => {
  it('discriminates put / get / search / listNamespaces and treats value:null as delete', async () => {
    const client = fakeClient();
    const store = new NovaCortexStore({ client: client as never });

    const putSpy = vi.spyOn(store, 'put').mockResolvedValue(undefined);
    const getSpy = vi.spyOn(store, 'get').mockResolvedValue({
      value: { content: 'x' },
      key: 'k',
      namespace: ['a'],
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    const searchSpy = vi.spyOn(store, 'search').mockResolvedValue([]);
    const deleteSpy = vi.spyOn(store, 'delete').mockResolvedValue(undefined);
    const listSpy = vi.spyOn(store, 'listNamespaces').mockResolvedValue([['a']]);

    const ops = [
      { namespace: ['a'], key: 'k', value: { content: 'v' } }, // Put
      { namespace: ['a'], key: 'k' }, // Get
      { namespacePrefix: ['a'], query: 'q' }, // Search
      { matchConditions: [], maxDepth: 1, limit: 10, offset: 0 }, // ListNamespaces
      { namespace: ['a'], key: 'k', value: null }, // Put(null) → delete
    ];
    const results = await store.batch(ops as never);

    expect(putSpy).toHaveBeenCalledWith(['a'], 'k', { content: 'v' }, undefined);
    expect(getSpy).toHaveBeenCalledWith(['a'], 'k');
    expect(searchSpy).toHaveBeenCalledWith(['a'], {
      query: 'q',
      filter: undefined,
      limit: undefined,
      offset: undefined,
    });
    expect(deleteSpy).toHaveBeenCalledWith(['a'], 'k');
    expect(listSpy).toHaveBeenCalledTimes(1);

    expect(results).toHaveLength(5);
    expect(results[0]).toBeUndefined(); // put → void
    expect(results[1]).toMatchObject({ key: 'k' }); // get → item
    expect(results[2]).toEqual([]); // search → []
    expect(results[3]).toEqual([['a']]); // listNamespaces
    expect(results[4]).toBeUndefined(); // delete → void
  });
});
