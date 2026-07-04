/**
 * LLMService unit tests — mocked fetch. Pins the graceful-degradation contract
 * (disabled without model/key), OpenAI-compatible request shape, strict-JSON
 * parsing with code-fence stripping, and the single repair retry.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { LLMService } from '@memory-stack/core';

const origFetch = globalThis.fetch;
const savedEnv = {
  llmKey: process.env['LLM_API_KEY'],
  llmModel: process.env['LLM_MODEL'],
  llmBase: process.env['LLM_BASE_URL'],
  oaiKey: process.env['OPENAI_API_KEY'],
  oaiBase: process.env['OPENAI_BASE_URL'],
};

beforeEach(() => {
  delete process.env['LLM_API_KEY'];
  delete process.env['LLM_MODEL'];
  delete process.env['LLM_BASE_URL'];
  delete process.env['OPENAI_API_KEY'];
  delete process.env['OPENAI_BASE_URL'];
});

afterEach(() => {
  globalThis.fetch = origFetch;
  for (const [k, v] of Object.entries({
    LLM_API_KEY: savedEnv.llmKey,
    LLM_MODEL: savedEnv.llmModel,
    LLM_BASE_URL: savedEnv.llmBase,
    OPENAI_API_KEY: savedEnv.oaiKey,
    OPENAI_BASE_URL: savedEnv.oaiBase,
  })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function mockCompletion(responses: string[]): { calls: Array<{ url: string; body: any }> } {
  const calls: Array<{ url: string; body: any }> = [];
  let i = 0;
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    const body = JSON.parse(String((init as RequestInit).body));
    calls.push({ url: String(url), body });
    const content = responses[Math.min(i++, responses.length - 1)]!;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls };
}

describe('LLMService', () => {
  it('is disabled without a model even when a key exists (conscious opt-in)', async () => {
    const svc = new LLMService({ apiKey: 'sk-x' });
    expect(svc.isEnabled()).toBe(false);
    expect(await svc.complete([{ role: 'user', content: 'hi' }])).toBeNull();
  });

  it('is disabled without a key even when a model is set', () => {
    expect(new LLMService({ model: 'gpt-4o-mini' }).isEnabled()).toBe(false);
  });

  it('falls back to OPENAI_* env when LLM_* is unset', () => {
    process.env['OPENAI_API_KEY'] = 'sk-oai';
    process.env['LLM_MODEL'] = 'qwen3:8b';
    expect(new LLMService().isEnabled()).toBe(true);
  });

  it('sends an OpenAI-compatible chat request with temperature 0 and json mode', async () => {
    const { calls } = mockCompletion(['{"ok":true}']);
    const svc = new LLMService({ apiKey: 'sk-x', model: 'test-model', baseUrl: 'http://llm.local/v1' });
    const out = await svc.complete([{ role: 'user', content: 'hi' }], { json: true });
    expect(out).toBe('{"ok":true}');
    expect(calls[0]!.url).toBe('http://llm.local/v1/chat/completions');
    expect(calls[0]!.body.model).toBe('test-model');
    expect(calls[0]!.body.temperature).toBe(0);
    expect(calls[0]!.body.response_format).toEqual({ type: 'json_object' });
  });

  it('completeJSON parses fenced JSON and validates', async () => {
    mockCompletion(['```json\n{"facts": []}\n```']);
    const svc = new LLMService({ apiKey: 'sk-x', model: 'm' });
    const out = await svc.completeJSON<{ facts: unknown[] }>(
      'sys',
      'user',
      (p): p is { facts: unknown[] } => Array.isArray((p as any)?.facts)
    );
    expect(out).toEqual({ facts: [] });
  });

  it('completeJSON retries once with a repair instruction on malformed output', async () => {
    const { calls } = mockCompletion(['not json at all', '{"decision":"none"}']);
    const svc = new LLMService({ apiKey: 'sk-x', model: 'm' });
    const out = await svc.completeJSON<{ decision: string }>('sys', 'user');
    expect(out).toEqual({ decision: 'none' });
    expect(calls.length).toBe(2);
    expect(calls[1]!.body.messages[1].content).toContain('not valid JSON');
  });

  it('completeJSON returns null when both attempts fail', async () => {
    mockCompletion(['garbage', 'still garbage']);
    const svc = new LLMService({ apiKey: 'sk-x', model: 'm' });
    expect(await svc.completeJSON('sys', 'user')).toBeNull();
  });

  it('returns null on persistent endpoint errors after retries, without throwing', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const svc = new LLMService({ apiKey: 'sk-x', model: 'm', retryBaseMs: 1 });
    expect(await svc.complete([{ role: 'user', content: 'x' }])).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4); // exhausted retries
  });

  it('retries transient 429s with backoff and succeeds', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls < 3) {
        return { ok: false, status: 429, json: async () => ({ error: { code: 'rate_limit_exceeded' } }) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'recovered' } }] }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const svc = new LLMService({ apiKey: 'sk-x', model: 'm', retryBaseMs: 1 });
    expect(await svc.complete([{ role: 'user', content: 'x' }])).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('fails fast on insufficient_quota (no retries — an empty account stays empty)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const svc = new LLMService({ apiKey: 'sk-x', model: 'm', retryBaseMs: 1 });
    expect(await svc.complete([{ role: 'user', content: 'x' }])).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
