/**
 * Vercel AI SDK memory middleware — retrieval (transformParams prepends a
 * system message, degrades silently on failure/empty) and capture
 * (wrapGenerate/wrapStream fire ingest fire-and-forget, never break generation).
 * Fully mocked NovaCortex client — no live server.
 */
import { describe, it, expect, vi } from 'vitest';
import { novacortexMemory } from '../../packages/vercel-ai/src/index.js';

function fakeClient() {
  return {
    search: vi.fn(),
    memories: { ingest: vi.fn() },
  };
}

function userPrompt(text: string, extra: Record<string, unknown> = {}) {
  return { prompt: [{ role: 'user', content: text }], ...extra };
}

describe('novacortexMemory — retrieval (transformParams)', () => {
  it('prepends a system message built from retrieved memories', async () => {
    const client = fakeClient();
    client.search.mockResolvedValue({
      data: [{ memory: { content: 'user prefers dark mode' } }, { memory: { content: 'user lives in Berlin' } }],
    });
    const mw = novacortexMemory({ client: client as never });

    const params = userPrompt('what theme should I use?');
    const out = await mw.transformParams!({ type: 'generate', params: params as never, model: {} });

    expect(client.search).toHaveBeenCalledWith({
      query: 'what theme should I use?',
      namespace: 'vercel-ai',
      limit: 5,
    });
    expect(out.prompt[0]).toEqual({
      role: 'system',
      content: 'Relevant memories from previous conversations:\n- user prefers dark mode\n- user lives in Berlin',
    });
    // Original messages are preserved after the injected system message.
    expect(out.prompt[1]).toEqual({ role: 'user', content: 'what theme should I use?' });
  });

  it('passes params through unchanged when search returns nothing', async () => {
    const client = fakeClient();
    client.search.mockResolvedValue({ data: [] });
    const mw = novacortexMemory({ client: client as never });

    const params = userPrompt('hi');
    const out = await mw.transformParams!({ type: 'generate', params: params as never, model: {} });
    expect(out.prompt).toHaveLength(1);
    expect(out.prompt[0]).toEqual({ role: 'user', content: 'hi' });
  });

  it('degrades silently (returns original params) when search throws', async () => {
    const client = fakeClient();
    client.search.mockRejectedValue(new Error('server 503'));
    const mw = novacortexMemory({ client: client as never });

    const params = userPrompt('hi');
    const out = await mw.transformParams!({ type: 'generate', params: params as never, model: {} });
    expect(out).toEqual(params);
  });

  it('reads the last user message from parts arrays and honors a per-request namespace', async () => {
    const client = fakeClient();
    client.search.mockResolvedValue({ data: [] });
    const mw = novacortexMemory({ client: client as never });

    const params = {
      prompt: [
        { role: 'system', content: 'be nice' },
        { role: 'user', content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }] },
      ],
      providerOptions: { novacortex: { namespace: 'user-42' } },
    };
    await mw.transformParams!({ type: 'generate', params: params as never, model: {} });
    expect(client.search).toHaveBeenCalledWith({ query: 'hello world', namespace: 'user-42', limit: 5 });
  });

  it('skips retrieval entirely when retrieve: false', async () => {
    const client = fakeClient();
    const mw = novacortexMemory({ client: client as never, retrieve: false });
    const params = userPrompt('hi');
    const out = await mw.transformParams!({ type: 'generate', params: params as never, model: {} });
    expect(client.search).not.toHaveBeenCalled();
    expect(out).toBe(params);
  });
});

describe('novacortexMemory — capture (wrapGenerate)', () => {
  it('fires ingest with the turn and returns the generate result untouched', async () => {
    const client = fakeClient();
    const mw = novacortexMemory({ client: client as never });

    const result = {
      content: [{ type: 'text', text: 'the answer is 42' }, { type: 'reasoning', text: 'hidden' }],
      finishReason: 'stop',
    };
    const params = userPrompt('what is the answer?');
    const out = await mw.wrapGenerate!({
      doGenerate: async () => result as never,
      doStream: async () => ({ stream: new ReadableStream() }) as never,
      params: params as never,
      model: {},
    });

    expect(out).toBe(result); // untouched
    expect(client.memories.ingest).toHaveBeenCalledTimes(1);
    expect(client.memories.ingest).toHaveBeenCalledWith({
      messages: [
        { role: 'user', content: 'what is the answer?' },
        { role: 'assistant', content: 'the answer is 42' },
      ],
      namespace: 'vercel-ai',
    });
  });

  it('swallows capture errors — a throwing ingest never breaks generation', async () => {
    const client = fakeClient();
    client.memories.ingest.mockImplementation(() => {
      throw new Error('ingest exploded');
    });
    const mw = novacortexMemory({ client: client as never });

    const result = { content: [{ type: 'text', text: 'ok' }] };
    const params = userPrompt('remember this');
    const out = await mw.wrapGenerate!({
      doGenerate: async () => result as never,
      doStream: async () => ({ stream: new ReadableStream() }) as never,
      params: params as never,
      model: {},
    });
    expect(out).toBe(result);
    expect(client.memories.ingest).toHaveBeenCalled();
  });

  it('does not capture when capture: false', async () => {
    const client = fakeClient();
    const mw = novacortexMemory({ client: client as never, capture: false });
    const result = { content: [{ type: 'text', text: 'ok' }] };
    await mw.wrapGenerate!({
      doGenerate: async () => result as never,
      doStream: async () => ({ stream: new ReadableStream() }) as never,
      params: userPrompt('x') as never,
      model: {},
    });
    expect(client.memories.ingest).not.toHaveBeenCalled();
  });
});

describe('novacortexMemory — capture (wrapStream)', () => {
  it('accumulates text-delta chunks and fires ingest on flush, passing the stream through', async () => {
    const client = fakeClient();
    const mw = novacortexMemory({ client: client as never });

    const parts = [
      { type: 'text-delta', delta: 'hel' },
      { type: 'text-delta', textDelta: 'lo ' }, // legacy field name
      { type: 'text-delta', delta: 'world' },
      { type: 'finish', finishReason: 'stop' },
    ];
    const source = new ReadableStream({
      start(controller) {
        for (const p of parts) controller.enqueue(p);
        controller.close();
      },
    });

    const params = userPrompt('say hi');
    const out = await mw.wrapStream!({
      doGenerate: async () => ({ content: [] }) as never,
      doStream: async () => ({ stream: source, rawResponse: { id: 'r1' } }) as never,
      params: params as never,
      model: {},
    });

    // `rest` (non-stream fields) is preserved.
    expect((out as { rawResponse?: { id: string } }).rawResponse).toEqual({ id: 'r1' });

    // Drain the wrapped stream so flush() runs.
    const seen: unknown[] = [];
    const reader = (out.stream as ReadableStream).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen.push(value);
    }
    expect(seen).toHaveLength(4); // all chunks passed through unchanged

    expect(client.memories.ingest).toHaveBeenCalledWith({
      messages: [
        { role: 'user', content: 'say hi' },
        { role: 'assistant', content: 'hello world' },
      ],
      namespace: 'vercel-ai',
    });
  });
});
