import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { MemoryService } from '@memory-stack/core';
import {
  MemoryType,
  RelationType,
  encodePmfBinary,
  decodePmfBinary,
  encryptPmf,
  decryptPmf,
  isEncryptedPmf,
} from '@memory-stack/core';
import { importChat } from '../services/chat-importer.js';
import { requireScopes } from '../middleware/auth.js';
import { getWebhookService } from '../services/webhooks.js';

// Validation schemas
const EntitySchema = z.object({
  name: z.string(),
  type: z.enum(['person', 'organization', 'location', 'concept', 'event']),
  confidence: z.number().min(0).max(1),
});

const SignalSchema = z.object({
  keyword: z.string(),
  weight: z.number(),
  extractedAt: z.string().transform((s) => new Date(s)),
});

const SourceSchema = z.object({
  type: z.enum(['conversation', 'document', 'api', 'extraction']).optional(),
  sessionId: z.string().optional(),
  documentId: z.string().optional(),
  agentId: z.string().optional(),
  timestamp: z.string().transform((s) => new Date(s)).optional(),
});

const CreateMemorySchema = z.object({
  content: z.string().min(1),
  memoryType: z.nativeEnum(MemoryType),
  namespace: z.string().optional(),
  tags: z.array(z.string()).optional(),
  entities: z.array(EntitySchema).optional(),
  signals: z.array(SignalSchema).optional(),
  source: SourceSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  salience: z.number().min(0).max(10).optional(),
  decayRate: z.number().positive().optional(),
  embedding: z.array(z.number()).optional(),
});

const UpdateMemorySchema = z.object({
  content: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  entities: z.array(EntitySchema).optional(),
  signals: z.array(SignalSchema).optional(),
  salience: z.number().min(0).max(10).optional(),
});

// Coerce single string or array to array (Express sends single query param as string)
const coerceArray = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((val) => (typeof val === 'string' ? [val] : val), z.array(schema).optional());

const SearchQuerySchema = z.object({
  namespace: z.string().optional(),
  memoryTypes: coerceArray(z.nativeEnum(MemoryType)),
  tags: coerceArray(z.string()),
  // Substring filter on content (applied by the storage adapter).
  query: z.string().optional(),
  // Clamp to a sane maximum instead of rejecting large values.
  limit: z.coerce.number().int().positive().transform((n) => Math.min(n, 1000)).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  minSalience: z.coerce.number().min(0).max(10).optional(),
  // Explicit string check: z.coerce.boolean() treats ANY non-empty string
  // (incl. "false"/"0") as true, so ?includeRelations=false would force it on.
  includeRelations: z.string().optional().transform((v) => v === 'true'),
  // Temporal read-path controls: surface superseded facts / point-in-time view.
  includeInvalidated: z.string().optional().transform((v) => v === 'true'),
  asOf: z.coerce.date().optional(),
});

const VectorSearchSchema = z.object({
  vector: z.array(z.number()),
  namespace: z.string().optional(),
  memoryTypes: z.array(z.nativeEnum(MemoryType)).optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().min(0).optional(),
  minSalience: z.number().min(0).max(10).optional(),
  scoreThreshold: z.number().min(0).max(1).optional(),
  includeInvalidated: z.boolean().optional(),
  asOf: z.coerce.date().optional(),
  rerank: z.boolean().optional(),
  graphBoost: z.boolean().optional(),
  explain: z.boolean().optional(),
});

const CreateRelationSchema = z.object({
  fromMemoryId: z.string().min(1),
  fromNamespace: z.string().min(1),
  toMemoryId: z.string().min(1),
  toNamespace: z.string().min(1),
  relationType: z.nativeEnum(RelationType),
  strength: z.number().min(0).max(1).optional(),
  bidirectional: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export function createMemoriesRouter(memoryService: MemoryService): Router {
  const router = Router();

  // All memory routes require a valid token AND the appropriate scope. Reads
  // (GET, plus POST /search) require memories:read; everything else mutates or
  // can delete/exfiltrate data and requires memories:write. (A blanket
  // requireScopes() would authenticate but never authorize — broken access
  // control letting read-only/narrow tokens import/delete/export everything.)
  router.use((req: Request, res: Response, next: NextFunction) => {
    const isRead = req.method === 'GET' || (req.method === 'POST' && req.path === '/search');
    return requireScopes(isRead ? 'memories:read' : 'memories:write')(req, res, next);
  });

  // Async handler wrapper
  const asyncHandler = (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ) => {
    return (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  };

  // POST /memories - Create a new memory
  router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = CreateMemorySchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation error',
          details: parsed.error.issues,
        });
        return;
      }

      const memory = await memoryService.createMemory(parsed.data);
      res.status(201).json(memory);

      // Notify webhook subscribers (fire-and-forget).
      void getWebhookService()?.emit('memory.created', memory);

      // Auto-embed if processor scheduler has onNewMemory enabled
      // Import dynamically to avoid circular dependency
      try {
        const { getProcessor } = await import('../services/processor.js');
        const processor = getProcessor();
        if (processor) {
          processor.embedSingleMemory(memory.id).catch(() => {});
        }
      } catch {
        // Processor not available
      }
    })
  );

  // GET /memories - Search memories
  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = SearchQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation error',
          details: parsed.error.issues,
        });
        return;
      }

      // Parse array params from query string
      const options = {
        ...parsed.data,
        memoryTypes: req.query['memoryTypes']
          ? Array.isArray(req.query['memoryTypes'])
            ? (req.query['memoryTypes'] as string[]).map((t) => t as MemoryType)
            : [req.query['memoryTypes'] as MemoryType]
          : undefined,
        tags: req.query['tags']
          ? Array.isArray(req.query['tags'])
            ? (req.query['tags'] as string[])
            : [req.query['tags'] as string]
          : undefined,
      };

      const [memories, total] = await Promise.all([
        memoryService.searchMemories(options),
        memoryService.countMemories(options),
      ]);
      res.json({
        data: memories,
        count: memories.length,
        total,
        limit: options.limit ?? 100,
        offset: options.offset ?? 0,
      });
    })
  );

  // ============ EXPORT/IMPORT ROUTES (must be before /:namespace/:id) ============

  // GET /export/:namespace - Export namespace (JSON format)
  router.get(
    '/export/:namespace',
    asyncHandler(async (req: Request, res: Response) => {
      const { namespace } = req.params;

      const portable = await memoryService.exportNamespace(namespace!);

      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${namespace}-export.json"`
      );
      res.json(portable);
    })
  );

  // GET /export/:namespace/pmf - Export in PMF; ?format=binary (MessagePack),
  // ?encrypt=true (AES-256-GCM, password via X-PMF-Password header).
  router.get(
    '/export/:namespace/pmf',
    asyncHandler(async (req: Request, res: Response) => {
      const { namespace } = req.params;
      const includeEmbeddings = req.query['embeddings'] === 'true';
      const nodeId = req.query['nodeId'] as string | undefined;
      const exportedBy = req.query['exportedBy'] as string | undefined;
      const binary = req.query['format'] === 'binary';
      const encrypt = req.query['encrypt'] === 'true';
      // Header only — never accept the password via query string (it would be
      // captured in access/request logs).
      const password = req.header('x-pmf-password');

      const pmf = await memoryService.exportNamespacePMF(namespace!, { includeEmbeddings, nodeId, exportedBy });

      let payload: Buffer | object = pmf;
      let contentType = 'application/vnd.novacortex.pmf+json';
      let ext = 'pmf.json';
      if (binary) {
        payload = Buffer.from(encodePmfBinary(pmf));
        contentType = 'application/x-msgpack';
        ext = 'pmf.msgpack';
      }
      if (encrypt) {
        if (!password) {
          res.status(400).json({ error: 'bad_request', message: 'encrypt=true requires the X-PMF-Password header' });
          return;
        }
        const plaintext = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(pmf));
        payload = await encryptPmf(plaintext, password);
        contentType = 'application/octet-stream';
        ext = `${ext}.enc`;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${namespace}-export.${ext}"`);
      if (Buffer.isBuffer(payload)) res.send(payload);
      else res.json(payload);
    })
  );

  // GET /export/:namespace/diff?since=ISO - incremental export (new memories since)
  router.get(
    '/export/:namespace/diff',
    asyncHandler(async (req: Request, res: Response) => {
      const { namespace } = req.params;
      const sinceRaw = req.query['since'] as string | undefined;
      const since = sinceRaw ? new Date(sinceRaw) : new Date(0);
      if (Number.isNaN(since.getTime())) {
        res.status(400).json({ error: 'bad_request', message: 'invalid `since` timestamp (use ISO 8601)' });
        return;
      }
      res.json(await memoryService.exportNamespaceDiff(namespace!, since));
    })
  );

  // GET /export/:namespace/stream - NDJSON streaming export (constant memory, large namespaces)
  router.get(
    '/export/:namespace/stream',
    asyncHandler(async (req: Request, res: Response) => {
      const { namespace } = req.params;
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Content-Disposition', `attachment; filename="${namespace}-export.ndjson"`);

      // Stop streaming if the client disconnects.
      let aborted = false;
      res.on('close', () => { aborted = true; });

      const pageSize = 200;
      let offset = 0;
      try {
        for (;;) {
          if (aborted) return;
          const batch = await memoryService.searchMemories({ namespace: namespace!, limit: pageSize, offset });
          for (const m of batch) {
            if (aborted) return;
            // Honor backpressure so a slow client cannot make us buffer the whole namespace.
            if (!res.write(JSON.stringify(m) + '\n')) {
              await new Promise<void>((resolve) => res.once('drain', () => resolve()));
            }
          }
          if (batch.length < pageSize) break;
          offset += pageSize;
        }
        res.end();
      } catch (err) {
        // Headers are already flushed by the first write — we cannot send a JSON
        // error. Destroy the socket so the client sees a truncated (not silently
        // complete) stream rather than triggering ERR_HTTP_HEADERS_SENT.
        if (res.headersSent) {
          res.destroy(err as Error);
          return;
        }
        throw err;
      }
    })
  );

  // POST /import - Import memories (JSON format)
  router.post(
    '/import',
    asyncHandler(async (req: Request, res: Response) => {
      const result = await memoryService.importMemories(req.body);
      res.json(result);
    })
  );

  // POST /import/pmf - Import from PMF format
  router.post(
    '/import/pmf',
    asyncHandler(async (req: Request, res: Response) => {
      // Accepts: JSON PMF ({ pmf|data, targetNamespace } or raw PMF object), OR a
      // binary body (MessagePack and/or AES-256-GCM-encrypted, content-type
      // application/x-msgpack or application/octet-stream). For binary, set the
      // target namespace via the X-PMF-Target-Namespace header and the decryption
      // password via X-PMF-Password.
      let pmf: { header?: unknown };
      let targetNamespace = req.header('x-pmf-target-namespace') || undefined;

      if (Buffer.isBuffer(req.body)) {
        let bytes: Uint8Array = req.body;
        if (isEncryptedPmf(bytes)) {
          const pw = req.header('x-pmf-password');
          if (!pw) {
            res.status(400).json({ error: 'bad_request', message: 'encrypted PMF requires the X-PMF-Password header' });
            return;
          }
          try {
            bytes = await decryptPmf(bytes, pw);
          } catch {
            res.status(400).json({ error: 'bad_request', message: 'PMF decryption failed (wrong password or corrupt data)' });
            return;
          }
        }
        try {
          pmf = decodePmfBinary(bytes) as { header?: unknown };
        } catch {
          try {
            pmf = JSON.parse(Buffer.from(bytes).toString('utf8'));
          } catch {
            res.status(400).json({ error: 'bad_request', message: 'could not decode PMF body (expected MessagePack or JSON)' });
            return;
          }
        }
      } else {
        const body = (req.body ?? {}) as Record<string, unknown>;
        pmf = (body['pmf'] ?? body['data'] ?? body) as { header?: unknown };
        if (typeof body['targetNamespace'] === 'string') targetNamespace = body['targetNamespace'] as string;
      }

      if (!pmf || typeof pmf !== 'object' || !(pmf as { header?: unknown }).header) {
        res.status(400).json({
          error: 'bad_request',
          message: 'Body must be a PMF document (with a header), or { pmf | data, targetNamespace }, or a binary/encrypted PMF.',
        });
        return;
      }

      const result = await memoryService.importFromPMF(
        pmf as Parameters<typeof memoryService.importFromPMF>[0],
        targetNamespace ? { targetNamespace } : {}
      );
      res.json(result);

      // Embed exactly the imported memories (targeted — a global rescan would miss
      // them on large stores due to the salience-window cap).
      try {
        const { getProcessor } = await import('../services/processor.js');
        const processor = getProcessor();
        if (processor && result.importedIds.length > 0) {
          processor.embedByIds(result.importedIds).catch(() => {});
        }
      } catch {
        // Processor not available
      }
    })
  );

  // POST /import/chat - Import from Claude.ai JSON, Claude Code JSONL, or ChatGPT JSON
  router.post(
    '/import/chat',
    asyncHandler(async (req: Request, res: Response) => {
      const { data, format = 'auto', namespace = 'imported', dryRun = false } = req.body;

      if (!data || typeof data !== 'string') {
        res.status(400).json({ error: 'data field (string) is required' });
        return;
      }

      const result = importChat(data, format, namespace);

      if (dryRun) {
        res.json({
          dryRun: true,
          wouldImport: result.imported,
          skipped: result.skipped,
          errors: result.errors,
          preview: result.memories.slice(0, 3),
        });
        return;
      }

      // Bulk insert memories
      const stored: string[] = [];
      const storeErrors: string[] = [];

      // Process in batches of 50
      const batchSize = 50;
      for (let i = 0; i < result.memories.length; i += batchSize) {
        const batch = result.memories.slice(i, i + batchSize);
        await Promise.allSettled(
          batch.map(async (input) => {
            try {
              const memory = await memoryService.createMemory({
                ...input,
                source: input.source ? { ...input.source, timestamp: input.source.timestamp ?? new Date() } : undefined,
              });
              stored.push(memory.id.id);
            } catch (err) {
              storeErrors.push(err instanceof Error ? err.message : String(err));
            }
          })
        );
      }

      res.json({
        imported: stored.length,
        skipped: result.skipped,
        parseErrors: result.errors,
        storeErrors: storeErrors.slice(0, 10),
        memoryIds: stored,
      });

      // Embed exactly the imported chat memories (targeted — a global rescan would
      // miss them on large stores due to the salience-window cap).
      try {
        const { getProcessor } = await import('../services/processor.js');
        const processor = getProcessor();
        if (processor && stored.length > 0) {
          processor.embedByIds(stored.map((id) => ({ id, namespace }))).catch(() => {});
        }
      } catch {
        // Processor not available
      }
    })
  );

  // POST /embeddings/generate - Trigger embedding generation for memories without vectors
  router.post(
    '/embeddings/generate',
    asyncHandler(async (req: Request, res: Response) => {
      const { getProcessor } = await import('../services/processor.js');
      const processor = getProcessor();

      if (!process.env['OPENAI_API_KEY']) {
        res.status(400).json({ error: 'OPENAI_API_KEY not configured' });
        return;
      }

      if (!processor) {
        res.status(503).json({ error: 'Processor not available' });
        return;
      }

      // Fire off in background, return immediately
      const startedAt = new Date().toISOString();
      processor.runEmbeddingGeneration().catch(() => {});

      res.json({ status: 'started', startedAt, message: 'Embedding generation running in background' });
    })
  );

  // POST /deduplicate - Find and remove near-duplicate memories in a namespace
  router.post(
    '/deduplicate',
    asyncHandler(async (req: Request, res: Response) => {
      const { namespace = 'default', threshold = 0.92, dryRun = false, limit = 1000 } = req.body;

      // Fetch all memories in namespace
      const memories = await memoryService.searchMemories({
        namespace,
        limit: Math.min(limit, 5000),
      });

      if (memories.length < 2) {
        res.json({ duplicatesFound: 0, duplicatesRemoved: 0, memoriesChecked: memories.length });
        return;
      }

      // Find duplicates via content hash (exact) and content similarity (fuzzy)
      const seen = new Map<string, string>(); // contentHash -> memoryId
      const duplicates: Array<{ keepId: string; removeId: string; reason: string }> = [];

      for (const memory of memories) {
        // Exact duplicate check via hash
        const existing = seen.get(memory.contentHash);
        if (existing) {
          duplicates.push({ keepId: existing, removeId: memory.id.id, reason: 'exact_hash' });
          continue;
        }
        seen.set(memory.contentHash, memory.id.id);
      }

      // Fuzzy duplicate detection using Jaccard similarity on content tokens
      const processed = memories.filter(m => !duplicates.some(d => d.removeId === m.id.id));
      for (let i = 0; i < processed.length; i++) {
        const a = processed[i];
        if (!a) continue;
        const aTokens = new Set(a.content.toLowerCase().split(/\s+/).filter(t => t.length > 3));

        for (let j = i + 1; j < processed.length; j++) {
          const b = processed[j];
          if (!b) continue;
          const bTokens = new Set(b.content.toLowerCase().split(/\s+/).filter(t => t.length > 3));

          if (aTokens.size === 0 || bTokens.size === 0) continue;

          // Jaccard similarity
          const intersection = new Set([...aTokens].filter(t => bTokens.has(t)));
          const union = new Set([...aTokens, ...bTokens]);
          const similarity = intersection.size / union.size;

          if (similarity >= threshold) {
            // Keep the one with higher salience
            const keepId = a.metadata.effectiveSalience >= b.metadata.effectiveSalience ? a.id.id : b.id.id;
            const removeId = keepId === a.id.id ? b.id.id : a.id.id;
            duplicates.push({ keepId, removeId, reason: `fuzzy_similarity_${similarity.toFixed(2)}` });
            break; // Don't compare b against later items if already marked
          }
        }
      }

      if (dryRun) {
        res.json({
          dryRun: true,
          memoriesChecked: memories.length,
          duplicatesFound: duplicates.length,
          duplicates: duplicates.slice(0, 20),
        });
        return;
      }

      // Remove duplicates
      const removed: string[] = [];
      for (const dup of duplicates) {
        try {
          await memoryService.deleteMemory({ id: dup.removeId, namespace });
          removed.push(dup.removeId);
        } catch {
          // Skip if already deleted
        }
      }

      res.json({
        memoriesChecked: memories.length,
        duplicatesFound: duplicates.length,
        duplicatesRemoved: removed.length,
        removedIds: removed,
      });
    })
  );

  // ============ END EXPORT/IMPORT ROUTES ============

  // ============ RELATION ROUTES (must be before /:namespace/:id) ============

  // POST /relations - Create a relation
  router.post(
    '/relations',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = CreateRelationSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation error',
          details: parsed.error.issues,
        });
        return;
      }

      // Referential integrity: both endpoints must exist (no dangling edges).
      const fromId = { id: parsed.data.fromMemoryId, namespace: parsed.data.fromNamespace };
      const toId = { id: parsed.data.toMemoryId, namespace: parsed.data.toNamespace };
      const [fromMem, toMem] = await Promise.all([
        memoryService.getMemory(fromId),
        memoryService.getMemory(toId),
      ]);
      if (!fromMem || !toMem) {
        const missing = [!fromMem && 'fromMemoryId', !toMem && 'toMemoryId'].filter(Boolean);
        res.status(404).json({
          error: 'Relation endpoint not found',
          message: `Memory not found for: ${missing.join(', ')}`,
        });
        return;
      }

      const relation = await memoryService.createRelation(
        fromId,
        toId,
        parsed.data.relationType,
        parsed.data.strength,
        parsed.data.bidirectional,
        parsed.data.metadata
      );

      res.status(201).json(relation);
    })
  );

  // DELETE /relations/:id - Delete a relation
  router.delete(
    '/relations/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;

      const deleted = await memoryService.deleteRelation(id!);

      if (!deleted) {
        res.status(404).json({ error: 'Relation not found' });
        return;
      }

      res.status(204).send();
    })
  );

  // ============ END RELATION ROUTES ============

  // GET /memories/:namespace/:id - Get a specific memory
  router.get(
    '/:namespace/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const { namespace, id } = req.params;
      const includeRelations = req.query['includeRelations'] === 'true';

      const memory = await memoryService.getMemory(
        { id: id!, namespace: namespace! },
        includeRelations
      );

      if (!memory) {
        res.status(404).json({ error: 'Memory not found' });
        return;
      }

      res.json(memory);
    })
  );

  // PATCH /memories/:namespace/:id - Update a memory
  router.patch(
    '/:namespace/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const { namespace, id } = req.params;
      const parsed = UpdateMemorySchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation error',
          details: parsed.error.issues,
        });
        return;
      }

      const memory = await memoryService.updateMemory(
        { id: id!, namespace: namespace! },
        parsed.data
      );

      if (!memory) {
        res.status(404).json({ error: 'Memory not found' });
        return;
      }

      res.json(memory);
      void getWebhookService()?.emit('memory.updated', memory);
    })
  );

  // DELETE /memories/:namespace/:id - Delete a memory
  router.delete(
    '/:namespace/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const { namespace, id } = req.params;

      const deleted = await memoryService.deleteMemory({
        id: id!,
        namespace: namespace!,
      });

      if (!deleted) {
        res.status(404).json({ error: 'Memory not found' });
        return;
      }

      res.status(204).send();
      void getWebhookService()?.emit('memory.deleted', { id: id!, namespace: namespace! });
    })
  );

  // POST /search - Vector search
  router.post(
    '/search',
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = VectorSearchSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation error',
          details: parsed.error.issues,
        });
        return;
      }

      const results = await memoryService.vectorSearch(parsed.data);
      res.json({
        data: results,
        count: results.length,
      });
    })
  );

  // GET /memories/:namespace/:id/current - Walk the supersedes chain to the
  // CURRENT version of this fact (deterministic, zero LLM at read time).
  router.get(
    '/:namespace/:id/current',
    asyncHandler(async (req: Request, res: Response) => {
      const { namespace, id } = req.params;

      const result = await memoryService.getCurrentFact({ id: id!, namespace: namespace! });
      if (!result) {
        res.status(404).json({ error: 'Memory not found' });
        return;
      }

      res.json({
        current: result.current,
        superseded: result.superseded,
        hops: result.chain.length - 1,
        chain: result.chain.map((m) => ({
          id: m.id,
          content: m.content,
          createdAt: m.createdAt,
          invalidatedAt: m.invalidatedAt ?? null,
        })),
      });
    })
  );

  // GET /memories/:namespace/:id/similar - Find similar memories
  router.get(
    '/:namespace/:id/similar',
    asyncHandler(async (req: Request, res: Response) => {
      const { namespace, id } = req.params;
      const limit = parseInt(req.query['limit'] as string) || 10;
      const targetNamespace = req.query['targetNamespace'] as string | undefined;

      const results = await memoryService.findSimilar(
        { id: id!, namespace: namespace! },
        limit,
        targetNamespace
      );

      res.json({
        data: results,
        count: results.length,
      });
    })
  );

  // GET /memories/:namespace/:id/relations - Get memory relations
  router.get(
    '/:namespace/:id/relations',
    asyncHandler(async (req: Request, res: Response) => {
      const { namespace, id } = req.params;

      const relations = await memoryService.getRelations({
        id: id!,
        namespace: namespace!,
      });

      res.json({
        data: relations,
        count: relations.length,
      });
    })
  );

  return router;
}
