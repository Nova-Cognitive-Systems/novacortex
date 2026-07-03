/**
 * Conversation ingestion — the `add(messages)`-style entry point.
 *
 * POST /memories/ingest  {messages[], namespace?, sessionId?, agentId?, dryRun?, wait?}
 *   - default: enqueue and return 202 {jobId} — the LLM work happens off the
 *     request path (zero-LLM-tax hot path; jobs are in-process, not persisted
 *     across restarts).
 *   - wait=true: run synchronously and return the full result.
 *   - dryRun=true: extract only — preview the facts, store nothing.
 * GET /memories/ingest/:jobId — job status/result.
 *
 * MUST be installed BEFORE the memories router so /memories/ingest/:jobId
 * doesn't get captured by broader /memories patterns.
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { IntelligenceService, IngestResult } from '@memory-stack/core';
import { requireScopes } from '../middleware/auth.js';

const IngestMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().min(1).max(100_000),
  name: z.string().max(200).optional(),
  timestamp: z.string().max(64).optional(),
});

const IngestSchema = z.object({
  messages: z.array(IngestMessageSchema).min(1).max(1000),
  namespace: z.string().min(1).max(200).default('default'),
  sessionId: z.string().max(200).optional(),
  agentId: z.string().max(200).optional(),
  dryRun: z.boolean().optional(),
  wait: z.boolean().optional(),
  resolve: z.boolean().optional(),
});

interface IngestJob {
  id: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  namespace: string;
  createdAt: Date;
  finishedAt?: Date;
  result?: IngestResult;
  error?: string;
}

const jobs = new Map<string, IngestJob>();
const JOB_TTL_MS = 60 * 60 * 1000; // keep finished jobs for an hour

setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt.getTime() < cutoff) jobs.delete(id);
  }
}, 60_000).unref?.();

/** Test hook: clear the in-process job registry. */
export function clearIngestJobs(): void {
  jobs.clear();
}

export function installIngestRoutes(app: Express, intelligence: IntelligenceService): void {
  app.post(
    '/memories/ingest',
    requireScopes('memories:write'),
    async (req: Request, res: Response) => {
      const parsed = IngestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation error', details: parsed.error.issues });
        return;
      }
      if (!intelligence.isEnabled()) {
        res.status(503).json({
          error: 'intelligence_disabled',
          message:
            'Conversation ingestion needs a configured LLM. Set LLM_MODEL (plus LLM_API_KEY / LLM_BASE_URL for a local or hosted OpenAI-compatible endpoint).',
        });
        return;
      }

      const { messages, namespace, sessionId, agentId, dryRun, wait, resolve } = parsed.data;
      const opts = {
        namespace,
        ...(sessionId ? { sessionId } : {}),
        ...(agentId ? { agentId } : {}),
        ...(resolve !== undefined ? { resolve } : {}),
      };

      try {
        if (dryRun) {
          const facts = await intelligence.extractFacts(messages);
          res.json({ dryRun: true, facts, count: facts.length });
          return;
        }

        if (wait) {
          const result = await intelligence.ingest(messages, opts);
          res.json(summarize(result));
          return;
        }

        // Async default: respond immediately, distill in the background.
        const job: IngestJob = {
          id: randomUUID(),
          status: 'pending',
          namespace,
          createdAt: new Date(),
        };
        jobs.set(job.id, job);

        void (async () => {
          job.status = 'processing';
          try {
            job.result = await intelligence.ingest(messages, opts);
            job.status = 'done';
          } catch (e) {
            job.status = 'error';
            job.error = e instanceof Error ? e.message : String(e);
          } finally {
            job.finishedAt = new Date();
          }
        })();

        res.status(202).json({
          jobId: job.id,
          status: job.status,
          statusUrl: `/memories/ingest/${job.id}`,
          note: 'Jobs are processed in-process and not persisted across restarts.',
        });
      } catch (e) {
        res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
      }
    }
  );

  app.get(
    '/memories/ingest/:jobId',
    requireScopes('memories:read'),
    (req: Request, res: Response) => {
      const job = jobs.get(req.params['jobId']!);
      if (!job) {
        res.status(404).json({ error: 'Job not found (jobs expire after 1 hour and do not survive restarts)' });
        return;
      }
      res.json({
        jobId: job.id,
        status: job.status,
        namespace: job.namespace,
        createdAt: job.createdAt.toISOString(),
        ...(job.finishedAt ? { finishedAt: job.finishedAt.toISOString() } : {}),
        ...(job.result ? { result: summarize(job.result) } : {}),
        ...(job.error ? { error: job.error } : {}),
      });
    }
  );
}

/** Response shape: full facts + created ids, but never raw embeddings. */
function summarize(result: IngestResult) {
  return {
    facts: result.facts,
    created: result.created.map((m) => ({
      id: m.id,
      content: m.content,
      memoryType: m.memoryType,
      salience: m.metadata.salience,
      tags: m.metadata.tags,
    })),
    duplicates: result.duplicates,
    resolutions: result.resolutions,
    counts: {
      facts: result.facts.length,
      created: result.created.length,
      duplicates: result.duplicates,
      resolutions: result.resolutions.length,
    },
  };
}
