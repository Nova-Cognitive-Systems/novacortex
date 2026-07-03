/**
 * POST /memories/ingest route — scope enforcement, disabled-LLM 503, dryRun,
 * sync (wait) mode, and the async job lifecycle. IntelligenceService is
 * stubbed; auth runs through the real token middleware (FakeSurreal-backed).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Express } from 'express';
import type { IntelligenceService, IngestResult } from '@memory-stack/core';
import { MemoryType } from '@memory-stack/core';
import { installIngestRoutes, clearIngestJobs } from '../../packages/api/src/routes/ingest.js';
import { buildTestApp, jsonRequest } from '../helpers/test-server.js';

function stubIntelligence(overrides: Partial<Record<'enabled', boolean>> & {
  ingestImpl?: () => Promise<IngestResult>;
} = {}) {
  const facts = [
    {
      content: 'The user prefers dark mode',
      memoryType: MemoryType.SEMANTIC,
      tags: ['ui'],
      entities: [],
      salience: 7,
      confidence: 0.9,
    },
  ];
  const result: IngestResult = {
    facts,
    created: [],
    duplicates: 0,
    resolutions: [],
  };
  return {
    isEnabled: () => overrides.enabled ?? true,
    getModel: () => 'stub-model',
    extractFacts: async () => facts,
    ingest: overrides.ingestImpl ?? (async () => result),
  } as unknown as IntelligenceService;
}

async function appWithIngest(intel: IntelligenceService): Promise<{ app: Express; token: string }> {
  const { app, svc } = await buildTestApp([(a) => installIngestRoutes(a, intel)]);
  const { token } = await svc.create({ template: 'admin-full', name: 'ingest-test' });
  return { app, token };
}

const messages = [{ role: 'user', content: 'I always use dark mode' }];

beforeEach(() => clearIngestJobs());

describe('POST /memories/ingest', () => {
  it('requires authentication', async () => {
    const { app } = await appWithIngest(stubIntelligence());
    const res = await jsonRequest(app, 'POST', '/memories/ingest', { messages });
    expect(res.status).toBe(401);
  });

  it('returns 503 with guidance when no LLM is configured', async () => {
    const { app, token } = await appWithIngest(stubIntelligence({ enabled: false }));
    const res = await jsonRequest(app, 'POST', '/memories/ingest', { messages }, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(503);
    expect((res.body as any).error).toBe('intelligence_disabled');
  });

  it('validates the body', async () => {
    const { app, token } = await appWithIngest(stubIntelligence());
    const res = await jsonRequest(app, 'POST', '/memories/ingest', { messages: [] }, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(400);
  });

  it('dryRun extracts facts without storing', async () => {
    const { app, token } = await appWithIngest(stubIntelligence());
    const res = await jsonRequest(
      app, 'POST', '/memories/ingest',
      { messages, dryRun: true },
      { Authorization: `Bearer ${token}` }
    );
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.dryRun).toBe(true);
    expect(body.count).toBe(1);
    expect(body.facts[0].content).toContain('dark mode');
  });

  it('wait=true runs synchronously and returns counts', async () => {
    const { app, token } = await appWithIngest(stubIntelligence());
    const res = await jsonRequest(
      app, 'POST', '/memories/ingest',
      { messages, wait: true },
      { Authorization: `Bearer ${token}` }
    );
    expect(res.status).toBe(200);
    expect((res.body as any).counts).toEqual({ facts: 1, created: 0, duplicates: 0, resolutions: 0 });
  });

  it('async default returns 202 and the job becomes queryable and finishes', async () => {
    const { app, token } = await appWithIngest(stubIntelligence());
    const auth = { Authorization: `Bearer ${token}` };

    const res = await jsonRequest(app, 'POST', '/memories/ingest', { messages }, auth);
    expect(res.status).toBe(202);
    const { jobId, statusUrl } = res.body as any;
    expect(statusUrl).toBe(`/memories/ingest/${jobId}`);

    // Poll until the in-process job completes.
    let status = '';
    for (let i = 0; i < 20 && status !== 'done'; i++) {
      const poll = await jsonRequest(app, 'GET', statusUrl, undefined, auth);
      expect(poll.status).toBe(200);
      status = (poll.body as any).status;
      if (status !== 'done') await new Promise((r) => setTimeout(r, 25));
    }
    expect(status).toBe('done');
  });

  it('records job errors instead of crashing', async () => {
    const { app, token } = await appWithIngest(
      stubIntelligence({ ingestImpl: async () => { throw new Error('llm exploded'); } })
    );
    const auth = { Authorization: `Bearer ${token}` };
    const res = await jsonRequest(app, 'POST', '/memories/ingest', { messages }, auth);
    const { jobId } = res.body as any;

    let body: any;
    for (let i = 0; i < 20; i++) {
      body = (await jsonRequest(app, 'GET', `/memories/ingest/${jobId}`, undefined, auth)).body;
      if (body.status === 'error') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(body.status).toBe('error');
    expect(body.error).toContain('llm exploded');
  });

  it('unknown job ids 404', async () => {
    const { app, token } = await appWithIngest(stubIntelligence());
    const res = await jsonRequest(app, 'GET', '/memories/ingest/nope', undefined, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(404);
  });
});
