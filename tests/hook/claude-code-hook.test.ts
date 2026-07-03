/**
 * Claude Code hook — transcript parsing (defensive across shapes) and the
 * ingest call (mocked fetch): payload shape, env config, graceful failure.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseTranscript, runHook } from '../../packages/claude-code-hook/src/index.js';

const TRANSCRIPT = [
  JSON.stringify({ type: 'summary', summary: 'meta line — skipped' }),
  JSON.stringify({ type: 'user', message: { role: 'user', content: 'We decided to use SurrealDB for the memory store' }, timestamp: '2026-07-03T10:00:00Z' }),
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Noted — SurrealDB it is.' },
        { type: 'tool_use', name: 'Bash', input: { command: 'echo skipped' } },
      ],
    },
  }),
  JSON.stringify({ type: 'user', message: { role: 'user', content: '<command-name>/model</command-name>' } }),
  '{ broken json',
  JSON.stringify({ type: 'user', message: { role: 'user', content: '' } }),
].join('\n');

describe('parseTranscript', () => {
  it('extracts conversational turns, skips meta/tool/broken/empty lines', () => {
    const messages = parseTranscript(TRANSCRIPT);
    expect(messages).toEqual([
      {
        role: 'user',
        content: 'We decided to use SurrealDB for the memory store',
        timestamp: '2026-07-03T10:00:00Z',
      },
      { role: 'assistant', content: 'Noted — SurrealDB it is.' },
    ]);
  });

  it('keeps only the most recent maxTurns', () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ type: 'user', message: { role: 'user', content: `turn ${i}` } })
    ).join('\n');
    const messages = parseTranscript(lines, 3);
    expect(messages.map((m) => m.content)).toEqual(['turn 7', 'turn 8', 'turn 9']);
  });
});

describe('runHook', () => {
  function writeTranscript(): string {
    const file = path.join(os.tmpdir(), `nc-hook-test-${Date.now()}.jsonl`);
    fs.writeFileSync(file, TRANSCRIPT);
    return file;
  }

  it('ships parsed turns to /memories/ingest with token + namespace', async () => {
    const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
    const fetchMock = vi.fn(async (url: unknown, init: unknown) => {
      const req = init as RequestInit;
      calls.push({ url: String(url), body: JSON.parse(String(req.body)), headers: req.headers as Record<string, string> });
      return { ok: true, json: async () => ({ jobId: 'job-1' }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await runHook(
      { transcript_path: writeTranscript(), session_id: 'sess-42' },
      { NOVACORTEX_TOKEN: 'tok', NOVACORTEX_URL: 'http://nc.local:3001/', NOVACORTEX_NAMESPACE: 'coding' },
      fetchMock
    );

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('captured 2 turns');
    expect(calls[0]!.url).toBe('http://nc.local:3001/memories/ingest');
    expect(calls[0]!.headers['Authorization']).toBe('Bearer tok');
    expect(calls[0]!.body.namespace).toBe('coding');
    expect(calls[0]!.body.sessionId).toBe('sess-42');
    expect(calls[0]!.body.agentId).toBe('claude-code');
    expect(calls[0]!.body.messages.length).toBe(2);
  });

  it('skips silently without a token and never throws on server errors', async () => {
    const noToken = await runHook({ transcript_path: writeTranscript() }, {});
    expect(noToken.ok).toBe(false);
    expect(noToken.detail).toContain('NOVACORTEX_TOKEN');

    const failingFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ message: 'intelligence disabled' }),
    })) as unknown as typeof fetch;
    const serverError = await runHook(
      { transcript_path: writeTranscript() },
      { NOVACORTEX_TOKEN: 'tok' },
      failingFetch
    );
    expect(serverError.ok).toBe(false);
    expect(serverError.detail).toContain('503');
  });
});
