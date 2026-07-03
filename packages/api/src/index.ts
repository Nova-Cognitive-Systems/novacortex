// MUST be first: opt-in OpenTelemetry auto-instrumentation patches http/express
// at load time (no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set).
import { shutdownTelemetry } from './telemetry.js';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { generateOpenApiSpec } from './openapi/spec.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Busboy from 'busboy';
import { MemoryService, MemoryType, resolveSurrealConfig, resolveQdrantConfig, resolveEmbeddingConfig } from '@memory-stack/core';
import { createMemoriesRouter } from './routes/memories.js';
import { MemoryProcessor, DEFAULT_PROCESSOR_CONFIG, type ProcessorConfig, setProcessorInstance } from './services/processor.js';
import { getLicenseService, type LicenseTier, type FederationRule } from './services/license.js';
import { knowledgeService } from './services/knowledge.js';
import { apiKeyService, type ApiKeyConfig } from './services/legacy-api-keys.js';
import { tokenService } from './services/token-service.js';
import { requireScopes, tierRateLimit } from './middleware/auth.js';
import { installSetupRoute } from './routes/setup.js';
import { WebhookService, setWebhookService } from './services/webhooks.js';
import { installWebhookRoutes } from './routes/webhooks.js';
import { installAuthRoute } from './routes/auth.js';
import { installTokensRoute } from './routes/tokens.js';
import { installAdminRoute } from './routes/admin.js';
import { bucketService } from './services/buckets.js';
import {
  errorHandler,
  notFoundHandler,
  requestLogger,
  timeoutMiddleware,
} from './middleware/error-handler.js';
import { logger } from './lib/logger.js';
import { checkBodySize } from './lib/validation.js';

// Extend Express Request to include agent context
declare global {
  namespace Express {
    interface Request {
      agentContext?: ApiKeyConfig;
    }
  }
}

// Allowed upload types
const ALLOWED_UPLOAD_TYPES = ['text/plain', 'text/markdown', 'text/csv', 'application/pdf', 'application/json'];
const ALLOWED_UPLOAD_EXTS = ['txt', 'md', 'csv', 'pdf', 'json'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

interface ParsedUpload {
  buffer: Buffer;
  name: string;
  mimetype: string;
  size: number;
  fields: Record<string, string>;
}

/** Parse multipart upload: stream file to disk, then read back */
function parseMultipartUpload(req: Request): Promise<ParsedUpload | null> {
  return new Promise((resolve, reject) => {
    if (!req.headers['content-type']?.includes('multipart/form-data')) {
      return resolve(null);
    }

    const bb = Busboy({ headers: req.headers as Record<string, string>, limits: { fileSize: MAX_FILE_SIZE, files: 1 } });
    {
      const fields: Record<string, string> = {};
      let tmpPath: string | null = null;
      let fileMeta: { name: string; mimetype: string } | null = null;
      let writeStream: fs.WriteStream | null = null;
      let fileSize = 0;

      bb.on('field', (name: string, val: string) => {
        fields[name] = val;
      });

      bb.on('file', (_fieldname: string, stream: NodeJS.ReadableStream, info: { filename: string; mimeType: string }) => {
        const ext = info.filename.split('.').pop()?.toLowerCase();
        if (!ALLOWED_UPLOAD_TYPES.includes(info.mimeType) && !(ext && ALLOWED_UPLOAD_EXTS.includes(ext))) {
          (stream as any).resume();
          return;
        }

        fileMeta = { name: info.filename, mimetype: info.mimeType };
        tmpPath = path.join(os.tmpdir(), `nc_upload_${Date.now()}_${Math.random().toString(36).slice(2)}`);
        writeStream = fs.createWriteStream(tmpPath);
        stream.on('data', (chunk: Buffer) => { fileSize += chunk.length; });
        stream.pipe(writeStream);
      });

      bb.on('close', () => {
        if (!fileMeta || !tmpPath) {
          return resolve(null);
        }

        // Wait for writeStream to finish
        const finalize = () => {
          const buffer = fs.readFileSync(tmpPath!);
          fs.unlink(tmpPath!, () => {});
          resolve({ buffer, name: fileMeta!.name, mimetype: fileMeta!.mimetype, size: buffer.length, fields });
        };

        if (writeStream && !writeStream.writableFinished) {
          writeStream.on('close', finalize);
        } else {
          finalize();
        }
      });

      bb.on('error', (err: Error) => reject(err));
      req.pipe(bb);
    }
  });
}

// Configuration from environment. SurrealDB/Qdrant config is resolved via the
// shared core helper so the API, MCP server and tests stay perfectly in sync
// (honors both SURREALDB_NAMESPACE/DATABASE and SURREALDB_NS/DB names).
const config = {
  port: parseInt(process.env['PORT'] || '8080'),
  surrealdb: resolveSurrealConfig(),
  qdrant: resolveQdrantConfig(),
  embedding: resolveEmbeddingConfig(),
};

// Initialize memory service
const memoryService = new MemoryService({
  surrealdb: config.surrealdb,
  qdrant: config.qdrant,
  embedding: config.embedding,
});

// Initialize memory processor
const memoryProcessor = new MemoryProcessor(memoryService, {
  relationDiscovery: {
    enabled: process.env['PROCESSOR_RELATION_DISCOVERY'] === 'true', // Disabled by default (requires embeddings)
    similarityThreshold: parseFloat(process.env['PROCESSOR_SIMILARITY_THRESHOLD'] || '0.6'),
    maxRelationsPerMemory: parseInt(process.env['PROCESSOR_MAX_RELATIONS'] || '5'),
    runIntervalMinutes: parseInt(process.env['PROCESSOR_RELATION_INTERVAL'] || '60'),
  },
  decayProcessing: {
    enabled: process.env['PROCESSOR_DECAY'] !== 'false',
    runIntervalMinutes: parseInt(process.env['PROCESSOR_DECAY_INTERVAL'] || '360'),
  },
  consolidation: {
    enabled: process.env['PROCESSOR_CONSOLIDATION'] === 'true',
    similarityThreshold: parseFloat(process.env['PROCESSOR_CONSOLIDATION_THRESHOLD'] || '0.95'),
    minMemoriesForConsolidation: parseInt(process.env['PROCESSOR_CONSOLIDATION_MIN'] || '3'),
    runIntervalMinutes: parseInt(process.env['PROCESSOR_CONSOLIDATION_INTERVAL'] || '1440'),
  },
});
setProcessorInstance(memoryProcessor);

// Webhooks: emit memory/processor events to registered subscribers (v1.1).
const webhookService = new WebhookService();
setWebhookService(webhookService);

// Create Express app
const app = express();

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'https:', 'data:'],
    },
  },
}));
// Honor CORS_ORIGINS as an allowlist when set; otherwise fall back to permissive
// (convenient for same-origin self-host where the Web UI proxies via /api/v1).
// Production deployments exposing the API cross-origin should set CORS_ORIGINS.
const corsOrigins = (process.env['CORS_ORIGINS'] || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors(corsOrigins.length > 0 ? { origin: corsOrigins } : {}));
app.use(requestLogger);
app.use((req, res, next) => {
  // Large imports and file uploads need extended timeouts
  const longPaths = ['/knowledge/upload', '/memories/import/chat', '/memories/import', '/memories/import/pmf'];
  const ms = longPaths.some(p => req.path.startsWith(p)) ? 300000 : 60000;
  timeoutMiddleware(ms)(req, res, next);
});
app.use(checkBodySize(50 * 1024 * 1024)); // 50MB limit (allows large chat imports)
app.use(express.json({ limit: '50mb', type: 'application/json' }));
// Raw body for binary / encrypted PMF import (MessagePack, octet-stream).
app.use(express.raw({ type: ['application/x-msgpack', 'application/octet-stream'], limit: '50mb' }));

// OpenAPI spec (public — agents and humans can read before authenticating)
const openApiSpec = generateOpenApiSpec();
app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});
app.get('/', (_req: Request, res: Response) => {
  res.redirect('/docs');
});
app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    customSiteTitle: 'NovaCortex API Docs',
    swaggerOptions: { persistAuthorization: true },
  }),
);

// Mount auth/token routes (before protected routes)
installSetupRoute(app);
installWebhookRoutes(app, webhookService);
installAuthRoute(app);
installTokensRoute(app);
installAdminRoute(app);

/**
 * OPTIMIZATION: Health cache to reduce DB connection checks
 * Health is cached for 5 seconds since it needs to be relatively fresh
 */
interface HealthCache {
  data: {
    status: string;
    timestamp: string;
    stats: unknown;
  } | null;
  cachedAt: number;
}

const healthCache: HealthCache = { data: null, cachedAt: 0 };
const HEALTH_CACHE_TTL_MS = 5 * 1000; // 5 seconds

/**
 * Embedding / search-mode status, surfaced in /health so operators (and the
 * Settings UI) can SEE whether search is running semantically or silently
 * degraded to substring matching — previously the fallback was invisible.
 */
interface EmbeddingStatus {
  status: 'disabled' | 'unreachable' | 'ok' | 'dimension_mismatch';
  model: string;
  dimension?: number;
  expectedDimension: number;
  error?: string;
  checkedAt: string;
}
let embeddingStatus: EmbeddingStatus | null = null;
const EMBEDDING_STATUS_TTL_MS = 60 * 1000;

async function checkEmbeddingStatus(): Promise<EmbeddingStatus> {
  const embeddingService = memoryService.getEmbeddingService();
  const probe = await embeddingService.probe();
  const expectedDimension = config.qdrant.vectorSize ?? 1536;
  const base = {
    model: embeddingService.getModel(),
    expectedDimension,
    checkedAt: new Date().toISOString(),
  };
  if (probe.status === 'disabled') {
    embeddingStatus = { ...base, status: 'disabled' };
  } else if (probe.status === 'unreachable') {
    embeddingStatus = { ...base, status: 'unreachable', error: probe.error };
  } else if (probe.dimension !== expectedDimension) {
    embeddingStatus = {
      ...base,
      status: 'dimension_mismatch',
      dimension: probe.dimension,
      error: `model produces ${probe.dimension}-dim vectors but QDRANT_VECTOR_SIZE is ${expectedDimension}`,
    };
  } else {
    embeddingStatus = { ...base, status: 'ok', dimension: probe.dimension };
  }
  return embeddingStatus;
}

/** Cached view for /health; re-probes when stale or previously not ok. */
async function getEmbeddingStatus(): Promise<EmbeddingStatus> {
  const stale =
    !embeddingStatus ||
    Date.now() - new Date(embeddingStatus.checkedAt).getTime() > EMBEDDING_STATUS_TTL_MS;
  if (stale || embeddingStatus!.status === 'unreachable') {
    return checkEmbeddingStatus();
  }
  return embeddingStatus!;
}

// Health check endpoint
app.get('/health', async (_req: Request, res: Response) => {
  try {
    const now = Date.now();

    // Return cached health if fresh
    if (healthCache.data && (now - healthCache.cachedAt) < HEALTH_CACHE_TTL_MS) {
      // Update timestamp to reflect current time while using cached data
      res.json({
        ...healthCache.data,
        timestamp: new Date().toISOString(),
        cached: true,
      });
      return;
    }

    await memoryService.connect();
    const stats = await memoryService.getStats();
    const embStatus = await getEmbeddingStatus();

    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      stats,
      search: {
        mode: embStatus.status === 'ok' ? 'semantic' : 'text',
        embeddings: embStatus,
      },
      docs: '/docs',
      openapi: '/openapi.json',
    };

    // Update cache
    healthCache.data = healthData;
    healthCache.cachedAt = now;

    res.json(healthData);
  } catch (error) {
    // Clear cache on error
    healthCache.data = null;
    healthCache.cachedAt = 0;

    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Qdrant health check (proxied to avoid CORS)
app.get('/health/qdrant', async (_req: Request, res: Response) => {
  const start = Date.now();
  try {
    const response = await fetch(config.qdrant.url);
    const latency = Date.now() - start;
    if (response.ok) {
      const data = await response.json();
      res.json({
        status: 'healthy',
        version: data.version,
        latency,
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        latency,
        error: `Qdrant returned ${response.status}`,
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      latency: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * OPTIMIZATION: Stats cache to avoid expensive full-table scans
 * Stats are cached for 30 seconds since they don't need to be real-time
 */
interface StatsCache {
  data: {
    total: number;
    byNamespace: Record<string, number>;
    byType: Record<string, number>;
    recentActivity: { created: number; updated: number };
  } | null;
  timestamp: number;
}

const statsCache: StatsCache = { data: null, timestamp: 0 };
const STATS_CACHE_TTL_MS = 30 * 1000; // 30 seconds

// Stats endpoint - Enhanced with caching and optimized counting
app.get('/stats', requireScopes('memories:read'), async (_req: Request, res: Response) => {
  try {
    const now = Date.now();

    // Return cached stats if fresh
    if (statsCache.data && (now - statsCache.timestamp) < STATS_CACHE_TTL_MS) {
      res.json(statsCache.data);
      return;
    }

    await memoryService.connect();

    // OPTIMIZATION: Fetch only necessary fields with a reasonable limit
    // For large datasets, consider adding aggregate queries to the adapter
    const memories = await memoryService.searchMemories({ limit: 10000 });

    // Build stats manually since core service doesn't return proper breakdown
    const byNamespace: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let recentCreated = 0;
    let recentUpdated = 0;
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

    for (const mem of memories) {
      // By namespace
      const ns = mem.id.namespace || 'default';
      byNamespace[ns] = (byNamespace[ns] || 0) + 1;

      // By type
      const type = mem.memoryType || 'unknown';
      byType[type] = (byType[type] || 0) + 1;

      // Recent activity
      if (mem.createdAt && new Date(mem.createdAt) > oneDayAgo) {
        recentCreated++;
      }
      if (mem.accessedAt && new Date(mem.accessedAt) > oneDayAgo) {
        recentUpdated++;
      }
    }

    const statsData = {
      total: memories.length,
      byNamespace,
      byType,
      recentActivity: {
        created: recentCreated,
        updated: recentUpdated,
      },
    };

    // Update cache
    statsCache.data = statsData;
    statsCache.timestamp = now;

    res.json(statsData);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// License-based namespace limits
const licenseService = getLicenseService();

// License-tier request limiter across the data plane (per token, falls back to
// per IP). Advertised as the tiers' api_rate_limit feature; overridable via
// API_RATE_LIMIT for self-hosters. Auth/setup routes keep their own limits.
app.use(
  ['/memories', '/knowledge', '/buckets', '/processor'],
  tierRateLimit(() => licenseService.getApiRateLimit())
);

// Mount memories router
app.use('/memories', createMemoriesRouter(memoryService));

function getMaxNamespaces(): number {
  return licenseService.getNamespaceLimit();
}

// Namespaces endpoint - List all namespaces
app.get('/namespaces', requireScopes('namespaces:read'), async (_req: Request, res: Response) => {
  try {
    await memoryService.connect();
    // Get all memories and extract unique namespaces
    const memories = await memoryService.searchMemories({ limit: 1000 });
    const namespaceSet = new Set<string>();
    namespaceSet.add('default'); // Always include default
    for (const mem of memories) {
      if (mem.id.namespace) {
        namespaceSet.add(mem.id.namespace);
      }
    }
    const namespaces = Array.from(namespaceSet).sort();
    const maxNs = getMaxNamespaces();
    const tierInfo = licenseService.getCurrentTier();

    res.json({
      data: namespaces,
      count: namespaces.length,
      limit: maxNs,
      remaining: Math.max(0, maxNs - namespaces.length),
      tier: tierInfo.tier,
      upgrade: tierInfo.tier === 'unregistered' ? 'Register free for 3 namespaces' :
               tierInfo.tier === 'free' ? 'Upgrade to Pro for 10 namespaces ($10)' : null,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Create/register a namespace (just creates an empty memory to establish it)
app.post('/namespaces', requireScopes('namespaces:write'), async (req: Request, res: Response) => {
  try {
    const { name, description, agentId } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Namespace name is required' });
      return;
    }

    // Validate namespace name (alphanumeric, hyphens, underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      res.status(400).json({ error: 'Namespace name must be alphanumeric with hyphens/underscores only' });
      return;
    }

    await memoryService.connect();

    // Check namespace limit (on-prem free version)
    const memories = await memoryService.searchMemories({ limit: 1000 });
    const existingNamespaces = new Set<string>();
    existingNamespaces.add('default');
    for (const mem of memories) {
      if (mem.id.namespace) {
        existingNamespaces.add(mem.id.namespace);
      }
    }

    // Check if namespace already exists
    if (existingNamespaces.has(name)) {
      res.status(409).json({ error: `Namespace '${name}' already exists` });
      return;
    }

    // Check limit based on license tier
    const maxNs = getMaxNamespaces();
    const tierInfo = licenseService.getCurrentTier();

    if (existingNamespaces.size >= maxNs) {
      res.status(403).json({
        error: `Namespace limit reached (max ${maxNs} for ${tierInfo.tier} tier)`,
        limit: maxNs,
        current: existingNamespaces.size,
        tier: tierInfo.tier,
        upgrade: tierInfo.tier === 'unregistered' ? 'Register free at memory-stack.com for 3 namespaces' :
                 tierInfo.tier === 'free' ? 'Upgrade to Pro for 10 namespaces ($10 one-time)' :
                 'Contact support for enterprise tier',
      });
      return;
    }

    // Create a metadata memory to establish the namespace
    const namespaceMeta = await memoryService.createMemory({
      content: `Namespace: ${name}${description ? ` - ${description}` : ''}${agentId ? ` (Agent: ${agentId})` : ''}`,
      memoryType: 'semantic' as any,
      namespace: name,
      tags: ['_namespace_meta'],
      source: {
        type: 'api',
        agentId: agentId || undefined,
      },
      salience: 10, // High salience so it doesn't decay
    });

    res.status(201).json({
      namespace: name,
      description: description || null,
      agentId: agentId || null,
      created: true,
      metaMemoryId: namespaceMeta.id,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Delete a namespace (deletes all memories in it)
app.delete('/namespaces/:name', requireScopes('namespaces:write'), async (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    if (name === 'default') {
      res.status(400).json({ error: 'Cannot delete default namespace' });
      return;
    }

    await memoryService.connect();

    // Get all memories in this namespace
    const memories = await memoryService.searchMemories({ namespace: name, limit: 1000 });

    // Delete each memory
    let deleted = 0;
    for (const memory of memories) {
      await memoryService.deleteMemory(memory.id);
      deleted++;
    }

    res.json({
      namespace: name,
      deleted: true,
      memoriesDeleted: deleted,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Search shortcut at root level
app.post('/search', requireScopes('memories:read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await memoryService.connect();

    // Accept EITHER a pre-computed `vector` OR a plain text `query`. When a text
    // query is given, the server embeds it and runs a true semantic search
    // (falling back to substring search if embeddings are disabled) — so callers
    // no longer need to compute embeddings client-side.
    const { vector, query, ...options } = req.body ?? {};

    if (Array.isArray(vector) && vector.length > 0) {
      const results = await memoryService.vectorSearch({ ...options, vector });
      res.json({ data: results, count: results.length, mode: 'vector' });
      return;
    }

    if (typeof query === 'string' && query.length > 0) {
      const { results, mode } = await memoryService.searchByText(query, options);
      res.json({ data: results, count: results.length, mode });
      return;
    }

    res.status(400).json({
      error: 'bad_request',
      message: 'Provide either a `query` (text) or a `vector` (number[]) to search.',
    });
  } catch (error) {
    next(error);
  }
});

// ============ PROCESSOR ENDPOINTS ============

// Get processor status and stats
app.get('/processor', requireScopes('processor:read'), (_req: Request, res: Response) => {
  res.json(memoryProcessor.getStats());
});

// Update processor config
app.patch('/processor', requireScopes('processor:write'), (req: Request, res: Response) => {
  try {
    const config = req.body as Partial<ProcessorConfig>;
    memoryProcessor.updateConfig(config);
    res.json({
      message: 'Processor configuration updated',
      config: memoryProcessor.getStats().config,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Manually trigger processing
app.post('/processor/run', requireScopes('processor:write'), async (req: Request, res: Response) => {
  try {
    const { task, threshold, namespace, background } = req.body;

    // Optional per-run override of the relation-discovery similarity threshold,
    // so callers can tune sensitivity without restarting / env changes.
    if (typeof threshold === 'number' && threshold >= 0 && threshold <= 1) {
      memoryProcessor.updateConfig({ relationDiscovery: { similarityThreshold: threshold } as never });
    }

    const ns = typeof namespace === 'string' && namespace.length > 0 ? namespace : undefined;

    if (task === 'relations') {
      const effThreshold = memoryProcessor.getStats().config.relationDiscovery.similarityThreshold;
      // On large stores discovery can exceed the request timeout; allow running it
      // in the background (returns immediately, observe progress via GET /processor).
      if (background === true) {
        memoryProcessor.runRelationDiscovery({ namespace: ns }).catch((e) => console.error('[Processor] bg relations:', e));
        res.status(202).json({ task: 'relations', status: 'started', namespace: ns ?? null, threshold: effThreshold });
      } else {
        const created = await memoryProcessor.runRelationDiscovery({ namespace: ns });
        res.json({ task: 'relations', relationsCreated: created, namespace: ns ?? null, threshold: effThreshold });
      }
    } else if (task === 'decay') {
      const processed = await memoryProcessor.runDecayProcessing();
      res.json({ task: 'decay', memoriesProcessed: processed });
    } else if (task === 'consolidation') {
      const consolidated = await memoryProcessor.runConsolidation();
      res.json({ task: 'consolidation', clustersFound: consolidated });
    } else if (task === 'reconcile') {
      // Scans all vectors; on large stores run it in the background to avoid the
      // request timeout (observe completion in logs).
      if (background === true) {
        memoryService.reconcileVectors().catch((e) => console.error('[Processor] bg reconcile:', e));
        res.status(202).json({ task: 'reconcile', status: 'started' });
      } else {
        const result = await memoryService.reconcileVectors();
        res.json({ task: 'reconcile', ...result });
      }
    } else if (task === 'all' || !task) {
      await memoryProcessor.runAll();
      res.json({ task: 'all', stats: memoryProcessor.getStats() });
    } else {
      res.status(400).json({ error: `Unknown task: ${task}. Valid: relations, decay, consolidation, reconcile, all` });
    }
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Start/stop processor
app.post('/processor/start', requireScopes('processor:write'), (_req: Request, res: Response) => {
  memoryProcessor.start();
  res.json({ message: 'Processor started', config: memoryProcessor.getStats().config });
});

app.post('/processor/stop', requireScopes('processor:write'), (_req: Request, res: Response) => {
  memoryProcessor.stop();
  res.json({ message: 'Processor stopped' });
});

// Get scheduler config
app.get('/processor/schedule', requireScopes('processor:read'), (_req: Request, res: Response) => {
  res.json(memoryProcessor.getSchedule());
});

// Update scheduler config
app.put('/processor/schedule', requireScopes('processor:write'), async (req: Request, res: Response) => {
  try {
    const schedule = memoryProcessor.setSchedule(req.body);
    res.json({ success: true, schedule });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to update schedule' });
  }
});

// ============ LICENSE ENDPOINTS ============

// Get current license status
app.get('/license', requireScopes('memories:read'), (_req: Request, res: Response) => {
  const tier = licenseService.getCurrentTier();
  const license = licenseService.getCurrentLicense();

  res.json({
    tier: tier.tier,
    maxNamespaces: tier.maxNamespaces,
    valid: tier.valid,
    hasLicense: !!license,
    key: license?.key || null,
    email: license?.email || null,
    features: license?.features || {
      maxNamespaces: 1,
      priority_support: false,
      api_rate_limit: 100,
      federation: false,
    },
  });
});

// Activate a license key
app.post('/license/activate', requireScopes('admin:*'), (req: Request, res: Response) => {
  try {
    const { key } = req.body;

    if (!key) {
      res.status(400).json({ error: 'License key is required' });
      return;
    }

    const result = licenseService.activateKey(key);

    if (!result.success || !result.license) {
      res.status(400).json({
        error: 'Invalid license key',
        message: result.message,
      });
      return;
    }

    res.json({
      success: true,
      tier: result.license.tier,
      maxNamespaces: result.license.features.maxNamespaces,
      message: `License activated! You now have ${result.license.features.maxNamespaces} namespaces.`,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Validate a license key (without activating)
app.post('/license/validate', requireScopes('admin:*'), (req: Request, res: Response) => {
  const { key } = req.body;
  const validation = licenseService.validateKey(key);
  res.json(validation);
});

// ============ FEDERATION ENDPOINTS (Pro+ Feature) ============

// Check federation status
app.get('/federation/status', requireScopes('federation:*'), (_req: Request, res: Response) => {
  res.json({
    enabled: licenseService.isFederationEnabled(),
    tier: licenseService.getCurrentTier().tier,
    message: licenseService.isFederationEnabled()
      ? 'Federation is enabled. Agents can read from multiple namespaces.'
      : 'Federation requires Pro tier. Upgrade to enable cross-namespace reads.',
  });
});

// Get all federation configs
app.get('/federation', requireScopes('federation:*'), (_req: Request, res: Response) => {
  if (!licenseService.isFederationEnabled()) {
    res.status(403).json({
      error: 'Federation is a Pro feature',
      message: 'Upgrade to Pro to enable cross-namespace reads',
    });
    return;
  }

  res.json({
    configs: licenseService.getAllFederationConfigs(),
  });
});

// Get federation config for a specific agent
app.get('/federation/:agentId', requireScopes('federation:*'), (req: Request, res: Response) => {
  const agentId = req.params['agentId'];

  if (!agentId) {
    res.status(400).json({ error: 'Agent ID is required' });
    return;
  }

  const config = licenseService.getAgentFederation(agentId);

  if (!config) {
    res.status(404).json({
      error: 'No federation config found',
      agentId,
      message: 'This agent has no federation rules configured',
    });
    return;
  }

  res.json(config);
});

// Set federation config for an agent
app.post('/federation', requireScopes('federation:*'), (req: Request, res: Response) => {
  const { agentId, primaryNamespace, readableNamespaces } = req.body;

  if (!agentId || !primaryNamespace) {
    res.status(400).json({
      error: 'agentId and primaryNamespace are required',
    });
    return;
  }

  const rule: FederationRule = {
    agentId,
    primaryNamespace,
    readableNamespaces: readableNamespaces || [],
  };

  const result = licenseService.setAgentFederation(rule);

  if (!result.success) {
    res.status(403).json({
      error: result.message,
      upgradeRequired: true,
    });
    return;
  }

  res.json({
    success: true,
    message: result.message,
    config: rule,
  });
});

// Update federation config for an agent
app.put('/federation/:agentId', requireScopes('federation:*'), (req: Request, res: Response) => {
  const agentId = req.params['agentId'];
  const { primaryNamespace, readableNamespaces } = req.body;

  if (!agentId) {
    res.status(400).json({ error: 'Agent ID is required' });
    return;
  }

  // Get existing config or create new
  const existing = licenseService.getAgentFederation(agentId);

  const rule: FederationRule = {
    agentId,
    primaryNamespace: primaryNamespace || existing?.primaryNamespace || 'default',
    readableNamespaces: readableNamespaces || existing?.readableNamespaces || [],
  };

  const result = licenseService.setAgentFederation(rule);

  if (!result.success) {
    res.status(403).json({
      error: result.message,
      upgradeRequired: true,
    });
    return;
  }

  res.json({
    success: true,
    message: result.message,
    config: rule,
  });
});

// Delete federation config for an agent
app.delete('/federation/:agentId', requireScopes('federation:*'), (req: Request, res: Response) => {
  const agentId = req.params['agentId'];

  if (!agentId) {
    res.status(400).json({ error: 'Agent ID is required' });
    return;
  }

  const removed = licenseService.removeAgentFederation(agentId);

  if (!removed) {
    res.status(404).json({
      error: 'No federation config found for this agent',
      agentId,
    });
    return;
  }

  res.json({
    success: true,
    message: `Federation config removed for agent ${agentId}`,
  });
});

// Get readable namespaces for an agent (used by memory search)
app.get('/federation/:agentId/namespaces', requireScopes('federation:*'), (req: Request, res: Response) => {
  const agentId = req.params['agentId'];
  const fallback = (req.query['fallback'] as string) || 'default';

  if (!agentId) {
    res.status(400).json({ error: 'Agent ID is required' });
    return;
  }

  const readable = licenseService.getReadableNamespaces(agentId, fallback);
  const primary = licenseService.getPrimaryNamespace(agentId, fallback);

  res.json({
    agentId,
    primaryNamespace: primary,
    readableNamespaces: readable,
    federationEnabled: licenseService.isFederationEnabled(),
  });
});

// ============ AGENT CONTEXT HELPER ============

function requireAgentContext(req: Request, res: Response): { agentId: string; namespaceClaim: string } | null {
  const agentId = req.auth?.agentId;
  const namespaceClaim = req.auth?.namespaceClaim;
  if (!agentId || !namespaceClaim) {
    res.status(403).json({ error: 'forbidden_namespace', message: 'Token is not an agent token' });
    return null;
  }
  return { agentId, namespaceClaim };
}

// ============ DEPRECATED API KEY ENDPOINTS (use /tokens instead) ============
// These respond with 410 Gone to guide clients to migrate.
app.all('/api-keys', (_req: Request, res: Response) => {
  res.status(410).json({ error: 'gone', message: 'Use /tokens (POST/GET/DELETE) instead. See /admin/migrate to migrate existing keys.' });
});
app.all('/api-keys/*', (_req: Request, res: Response) => {
  res.status(410).json({ error: 'gone', message: 'Use /tokens (POST/GET/DELETE) instead.' });
});

// ============ KNOWLEDGE BASE ENDPOINTS ============

// Upload a document to knowledge base
app.post('/knowledge/upload', requireScopes('knowledge:write'), async (req: Request, res: Response) => {
  try {
    const upload = await parseMultipartUpload(req);
    if (!upload) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const namespace = upload.fields.namespace || 'default';
    const uploadedBy = upload.fields.uploadedBy;
    const accessAgents = upload.fields.accessAgents
      ? JSON.parse(upload.fields.accessAgents)
      : [];

    const entry = await knowledgeService.storeDocument(
      upload.buffer,
      upload.name,
      upload.mimetype,
      namespace,
      uploadedBy,
      accessAgents
    );

    // Optionally create memories from chunks
    const createMemories = upload.fields.createMemories === 'true';
    if (createMemories) {
      const memoryIds: string[] = [];
      for (let i = 0; i < entry.document.chunks.length; i++) {
        const chunk = entry.document.chunks[i];
        if (!chunk) continue;
        const memory = await memoryService.createMemory({
          content: `[Source: ${entry.document.filename} | Chunk ${i + 1}/${entry.document.chunks.length}]\n\n${chunk}`,
          memoryType: MemoryType.SEMANTIC,
          namespace,
          tags: ['knowledge-base', `doc:${entry.document.id}`, entry.document.filename],
        });
        memoryIds.push(memory.id.id);
        // Embed this chunk so the uploaded document is retrievable by semantic search.
        memoryProcessor.embedSingleMemory(memory.id).catch(() => {});
      }
      await knowledgeService.linkMemories(entry.document.id, memoryIds);
      entry.memoryIds = memoryIds;
    }

    res.json({
      success: true,
      document: {
        id: entry.document.id,
        filename: entry.document.filename,
        mimeType: entry.document.mimeType,
        size: entry.document.size,
        chunks: entry.document.chunks.length,
        namespace: entry.document.namespace,
        uploadedAt: entry.document.uploadedAt,
        metadata: entry.document.metadata,
      },
      access: entry.access,
      memoriesCreated: entry.memoryIds.length,
    });
  } catch (error) {
    // Clean up temp file on error
    console.error('Upload error:', error);
    res.status(500).json({
      error: 'Upload failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// List documents in a namespace
app.get('/knowledge', requireScopes('knowledge:read'), async (req: Request, res: Response) => {
  const namespace = (req.query.namespace as string) || 'default';
  const documents = await knowledgeService.getDocumentsAsync(namespace);

  res.json({
    namespace,
    documents: documents.map((e) => ({
      id: e.document.id,
      filename: e.document.filename,
      mimeType: e.document.mimeType,
      size: e.document.size,
      chunks: e.document.chunks.length,
      uploadedAt: e.document.uploadedAt,
      metadata: e.document.metadata,
      accessCount: e.access.length,
      memoriesLinked: e.memoryIds.length,
    })),
    count: documents.length,
  });
});

// Get documents accessible by an agent
app.get('/knowledge/agent/:agentId', requireScopes('knowledge:read'), async (req: Request, res: Response) => {
  const agentId = req.params.agentId!;
  const documents = await knowledgeService.getAccessibleDocumentsAsync(agentId);

  res.json({
    agentId,
    documents: documents.map((e) => ({
      id: e.document.id,
      filename: e.document.filename,
      namespace: e.document.namespace,
      mimeType: e.document.mimeType,
      permissions: e.access.find((a) => a.agentId === agentId)?.permissions || [],
    })),
    count: documents.length,
  });
});

// Get all known agents (must be before /:documentId)
app.get('/knowledge/agents/list', requireScopes('knowledge:read'), async (_req: Request, res: Response) => {
  const agents = await knowledgeService.getAllAgents();
  res.json({ agents });
});

// Get specific document
app.get('/knowledge/:documentId', requireScopes('knowledge:read'), async (req: Request, res: Response) => {
  const entry = await knowledgeService.getDocumentAsync(req.params.documentId!);

  if (!entry) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  res.json({
    document: {
      id: entry.document.id,
      filename: entry.document.filename,
      mimeType: entry.document.mimeType,
      size: entry.document.size,
      content: entry.document.content,
      chunks: entry.document.chunks,
      namespace: entry.document.namespace,
      uploadedAt: entry.document.uploadedAt,
      uploadedBy: entry.document.uploadedBy,
      metadata: entry.document.metadata,
    },
    access: entry.access,
    memoryIds: entry.memoryIds,
  });
});

// Grant agent access to a document
app.post('/knowledge/:documentId/access', requireScopes('knowledge:write'), async (req: Request, res: Response) => {
  const { agentId, permissions } = req.body;
  const grantedBy = req.body.grantedBy;
  const documentId = req.params.documentId!;

  if (!agentId) {
    res.status(400).json({ error: 'agentId is required' });
    return;
  }

  const perms = permissions || ['read'];
  const success = await knowledgeService.grantAccess(
    documentId,
    agentId,
    perms,
    grantedBy
  );

  if (!success) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  res.json({
    success: true,
    message: `Granted ${perms.join(', ')} access to ${agentId}`,
    documentId,
    agentId,
    permissions: perms,
  });
});

// Revoke agent access
app.delete('/knowledge/:documentId/access/:agentId', requireScopes('knowledge:write'), async (req: Request, res: Response) => {
  const documentId = req.params.documentId!;
  const agentId = req.params.agentId!;
  const success = await knowledgeService.revokeAccess(documentId, agentId);

  if (!success) {
    res.status(404).json({ error: 'Document or access not found' });
    return;
  }

  res.json({
    success: true,
    message: `Revoked access for ${agentId}`,
    documentId,
    agentId,
  });
});

// Delete a document
app.delete('/knowledge/:documentId', requireScopes('knowledge:write'), async (req: Request, res: Response) => {
  const documentId = req.params.documentId!;
  const success = await knowledgeService.deleteDocument(documentId);

  if (!success) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  res.json({
    success: true,
    message: 'Document deleted',
    documentId,
  });
});

// ============ AGENT-AUTHENTICATED KNOWLEDGE ENDPOINTS ============
// These endpoints use API key auth - agents access knowledge via their key

// Agent: Get all accessible knowledge documents (based on token namespaces)
app.get('/agent/knowledge', requireScopes('knowledge:read'), async (req: Request, res: Response) => {
  const ctx = requireAgentContext(req, res);
  if (!ctx) return;

  const readableNamespaces = licenseService.getReadableNamespaces(ctx.agentId, ctx.namespaceClaim);
  const allDocs: Array<{
    id: string;
    filename: string;
    namespace: string;
    mimeType: string;
    size: number;
    chunks: number;
    uploadedAt: Date;
  }> = [];

  for (const ns of readableNamespaces) {
    const docs = await knowledgeService.getDocumentsAsync(ns);
    for (const entry of docs) {
      const hasAccess = entry.access.some(a => a.agentId === ctx.agentId) ||
                        readableNamespaces.includes(entry.document.namespace);
      if (hasAccess) {
        allDocs.push({
          id: entry.document.id,
          filename: entry.document.filename,
          namespace: entry.document.namespace,
          mimeType: entry.document.mimeType,
          size: entry.document.size,
          chunks: entry.document.chunks.length,
          uploadedAt: entry.document.uploadedAt,
        });
      }
    }
  }

  const explicitAccess = await knowledgeService.getAccessibleDocumentsAsync(ctx.agentId);
  for (const entry of explicitAccess) {
    if (!allDocs.some(d => d.id === entry.document.id)) {
      allDocs.push({
        id: entry.document.id,
        filename: entry.document.filename,
        namespace: entry.document.namespace,
        mimeType: entry.document.mimeType,
        size: entry.document.size,
        chunks: entry.document.chunks.length,
        uploadedAt: entry.document.uploadedAt,
      });
    }
  }

  res.json({
    agentId: ctx.agentId,
    readableNamespaces,
    documents: allDocs,
    count: allDocs.length,
  });
});

// Agent: Search knowledge content (full text search across accessible docs)
// NOTE: This route MUST be defined BEFORE /:documentId to avoid matching "search" as a documentId
app.get('/agent/knowledge/search', requireScopes('knowledge:read'), async (req: Request, res: Response) => {
  const ctx = requireAgentContext(req, res);
  if (!ctx) return;
  const query = (req.query.q as string || '').toLowerCase();

  if (!query) {
    res.status(400).json({ error: 'Search query required (use ?q=...)' });
    return;
  }

  const results: Array<{
    documentId: string;
    filename: string;
    namespace: string;
    matches: Array<{ chunkIndex: number; preview: string }>;
  }> = [];

  const readableNamespaces = licenseService.getReadableNamespaces(ctx.agentId, ctx.namespaceClaim);
  // Search through all accessible namespaces
  for (const ns of readableNamespaces) {
    const docs = await knowledgeService.getDocumentsAsync(ns);
    for (const entry of docs) {
      const hasAccess = entry.access.some(a => a.agentId === ctx.agentId) ||
                        readableNamespaces.includes(entry.document.namespace);
      if (!hasAccess) continue;

      const matches: Array<{ chunkIndex: number; preview: string }> = [];

      // Search in content
      if (entry.document.content.toLowerCase().includes(query)) {
        // Find matching chunks
        entry.document.chunks.forEach((chunk, idx) => {
          if (chunk.toLowerCase().includes(query)) {
            const pos = chunk.toLowerCase().indexOf(query);
            const start = Math.max(0, pos - 50);
            const end = Math.min(chunk.length, pos + query.length + 50);
            matches.push({
              chunkIndex: idx,
              preview: '...' + chunk.slice(start, end) + '...',
            });
          }
        });
      }

      if (matches.length > 0) {
        results.push({
          documentId: entry.document.id,
          filename: entry.document.filename,
          namespace: entry.document.namespace,
          matches: matches.slice(0, 5), // Limit matches per doc
        });
      }
    }
  }

  res.json({
    query,
    agentId: ctx.agentId,
    readableNamespaces,
    results,
    totalMatches: results.reduce((sum, r) => sum + r.matches.length, 0),
  });
});

// Agent: Get specific document content (if accessible)
app.get('/agent/knowledge/:documentId', requireScopes('knowledge:read'), async (req: Request, res: Response) => {
  const ctx = requireAgentContext(req, res);
  if (!ctx) return;
  const documentId = req.params.documentId!;
  const entry = await knowledgeService.getDocumentAsync(documentId);

  if (!entry) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  // Check access: agent has explicit access OR doc is in readable namespace
  const hasExplicitAccess = entry.access.some(a => a.agentId === ctx.agentId);
  const readableNamespaces = licenseService.getReadableNamespaces(ctx.agentId, ctx.namespaceClaim);
  const hasNamespaceAccess = readableNamespaces.includes(entry.document.namespace);

  if (!hasExplicitAccess && !hasNamespaceAccess) {
    res.status(403).json({ error: 'Access denied to this document' });
    return;
  }

  res.json({
    document: {
      id: entry.document.id,
      filename: entry.document.filename,
      mimeType: entry.document.mimeType,
      size: entry.document.size,
      content: entry.document.content,
      chunks: entry.document.chunks,
      namespace: entry.document.namespace,
      uploadedAt: entry.document.uploadedAt,
      metadata: entry.document.metadata,
    },
    memoryIds: entry.memoryIds,
  });
});

// Agent: Upload document to their primary namespace
app.post('/agent/knowledge/upload', requireScopes('knowledge:write'), async (req: Request, res: Response) => {
  const ctx = requireAgentContext(req, res);
  if (!ctx) return;

  try {
    const upload = await parseMultipartUpload(req);
    if (!upload) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Always upload to agent's primary namespace
    const namespace = ctx.namespaceClaim;

    // Parse additional agents to grant access (optional)
    const additionalAgents = upload.fields.grantAccessTo
      ? JSON.parse(upload.fields.grantAccessTo)
      : [];

    // Agent always gets access + any additional agents
    const accessAgents = [ctx.agentId, ...additionalAgents];

    const entry = await knowledgeService.storeDocument(
      upload.buffer,
      upload.name,
      upload.mimetype,
      namespace,
      ctx.agentId,
      accessAgents
    );

    // Optionally create memories from chunks
    const createMemories = upload.fields.createMemories === 'true';
    if (createMemories) {
      const memoryIds: string[] = [];
      for (let i = 0; i < entry.document.chunks.length; i++) {
        const chunk = entry.document.chunks[i];
        if (!chunk) continue;
        const memory = await memoryService.createMemory({
          content: `[Source: ${entry.document.filename} | Chunk ${i + 1}/${entry.document.chunks.length}]\n\n${chunk}`,
          memoryType: MemoryType.SEMANTIC,
          namespace,
          tags: ['knowledge-base', `doc:${entry.document.id}`, entry.document.filename],
        });
        memoryIds.push(memory.id.id);
        // Embed this chunk so the uploaded document is retrievable by semantic search.
        memoryProcessor.embedSingleMemory(memory.id).catch(() => {});
      }
      await knowledgeService.linkMemories(entry.document.id, memoryIds);
      entry.memoryIds = memoryIds;
    }

    res.json({
      success: true,
      document: {
        id: entry.document.id,
        filename: entry.document.filename,
        mimeType: entry.document.mimeType,
        size: entry.document.size,
        chunks: entry.document.chunks.length,
        namespace: entry.document.namespace,
        uploadedAt: entry.document.uploadedAt,
        metadata: entry.document.metadata,
      },
      access: entry.access,
      memoriesCreated: entry.memoryIds.length,
    });
  } catch (error) {
    console.error('Agent upload error:', error);
    res.status(500).json({
      error: 'Upload failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============ KNOWLEDGE BUCKETS ENDPOINTS ============

// List all buckets
app.get('/buckets', requireScopes('buckets:read'), async (_req: Request, res: Response) => {
  const buckets = await bucketService.getAllBuckets();
  res.json({ buckets, count: buckets.length });
});

// Create bucket
app.post('/buckets', requireScopes('buckets:write'), async (req: Request, res: Response) => {
  try {
    const { name, description, namespace, agents } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Bucket name is required' });
      return;
    }

    const bucket = await bucketService.createBucket({
      name,
      description,
      namespace: namespace || 'default',
      agents: agents || [],
    });

    res.status(201).json({ success: true, bucket });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to create bucket',
    });
  }
});

// Get single bucket
app.get('/buckets/:id', requireScopes('buckets:read'), async (req: Request, res: Response) => {
  const bucket = await bucketService.getBucket(req.params.id!);
  if (!bucket) {
    res.status(404).json({ error: 'Bucket not found' });
    return;
  }
  res.json({ bucket });
});

// Update bucket
app.patch('/buckets/:id', requireScopes('buckets:write'), async (req: Request, res: Response) => {
  try {
    const { name, description, namespace, agents } = req.body;
    const bucket = await bucketService.updateBucket(req.params.id!, {
      name,
      description,
      namespace,
      agents,
    });
    res.json({ success: true, bucket });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to update bucket',
    });
  }
});

// Delete bucket
app.delete('/buckets/:id', requireScopes('buckets:write'), async (req: Request, res: Response) => {
  const deleted = await bucketService.deleteBucket(req.params.id!);
  if (!deleted) {
    res.status(404).json({ error: 'Bucket not found' });
    return;
  }
  res.json({ success: true, message: 'Bucket deleted' });
});

// Add agent to bucket
app.post('/buckets/:id/agents', requireScopes('buckets:write'), async (req: Request, res: Response) => {
  try {
    const { agentId } = req.body;
    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }
    const bucket = await bucketService.addAgent(req.params.id!, agentId);
    res.json({ success: true, bucket });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to add agent',
    });
  }
});

// Remove agent from bucket
app.delete('/buckets/:id/agents/:agentId', requireScopes('buckets:write'), async (req: Request, res: Response) => {
  try {
    const bucket = await bucketService.removeAgent(req.params.id!, req.params.agentId!);
    res.json({ success: true, bucket });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to remove agent',
    });
  }
});

// Upload to bucket
app.post('/buckets/:id/upload', requireScopes('buckets:write'), async (req: Request, res: Response) => {
  try {
    const bucket = await bucketService.getBucket(req.params.id!);
    if (!bucket) {
      res.status(404).json({ error: 'Bucket not found' });
      return;
    }

    const upload = await parseMultipartUpload(req);
    if (!upload) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const createMemories = upload.fields.createMemories === 'true';

    // Store document in bucket's namespace
    const entry = await knowledgeService.storeDocument(
      upload.buffer,
      upload.name,
      upload.mimetype,
      bucket.namespace,
      'admin', // uploadedBy
      bucket.agents // initial access for bucket agents
    );

    // Grant access to all bucket agents
    for (const agentId of bucket.agents) {
      await knowledgeService.grantAccess(entry.document.id, agentId, ['read'], 'bucket:' + bucket.id);
    }

    // Optionally create memories from chunks
    if (createMemories) {
      const memoryIds: string[] = [];
      for (let i = 0; i < entry.document.chunks.length; i++) {
        const chunk = entry.document.chunks[i];
        if (!chunk) continue;
        const memory = await memoryService.createMemory({
          content: `[Source: ${entry.document.filename} | Chunk ${i + 1}/${entry.document.chunks.length}]\n\n${chunk}`,
          memoryType: MemoryType.SEMANTIC,
          namespace: bucket.namespace,
          tags: ['knowledge-base', `doc:${entry.document.id}`, `bucket:${bucket.id}`, entry.document.filename],
        });
        memoryIds.push(memory.id.id);
        // Embed this chunk so the uploaded document is retrievable by semantic search.
        memoryProcessor.embedSingleMemory(memory.id).catch(() => {});
      }
      await knowledgeService.linkMemories(entry.document.id, memoryIds);
      entry.memoryIds = memoryIds;
    }

    // Add to bucket upload history
    await bucketService.addUpload(bucket.id, {
      filename: entry.document.filename,
      size: entry.document.size,
      mimeType: entry.document.mimeType,
      uploadedBy: 'admin',
      documentId: entry.document.id,
    });

    res.json({
      success: true,
      document: {
        id: entry.document.id,
        filename: entry.document.filename,
        mimeType: entry.document.mimeType,
        size: entry.document.size,
        chunks: entry.document.chunks.length,
        namespace: entry.document.namespace,
        uploadedAt: entry.document.uploadedAt,
      },
      bucket: {
        id: bucket.id,
        name: bucket.name,
      },
      agentsWithAccess: bucket.agents,
      memoriesCreated: entry.memoryIds.length,
    });
  } catch (error) {
    console.error('Bucket upload error:', error);
    res.status(500).json({
      error: 'Upload failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Get bucket upload history
app.get('/buckets/:id/history', requireScopes('buckets:read'), async (req: Request, res: Response) => {
  const bucket = await bucketService.getBucket(req.params.id!);
  if (!bucket) {
    res.status(404).json({ error: 'Bucket not found' });
    return;
  }

  const limit = parseInt(req.query.limit as string) || 50;
  const history = await bucketService.getUploadHistory(bucket.id, limit);

  res.json({
    bucket: { id: bucket.id, name: bucket.name },
    history,
    count: history.length,
    total: bucket.uploadHistory.length,
  });
});

// Get bucket documents (active documents)
app.get('/buckets/:id/documents', requireScopes('buckets:read'), async (req: Request, res: Response) => {
  const bucket = await bucketService.getBucket(req.params.id!);
  if (!bucket) {
    res.status(404).json({ error: 'Bucket not found' });
    return;
  }

  // Get documents using upload history (reliable even for buckets with no agents)
  const history = await bucketService.getUploadHistory(bucket.id, 1000);
  const docIds = history.map((h) => h.documentId).filter(Boolean);
  const bucketDocs = await knowledgeService.getDocumentsByIds(docIds);

  res.json({
    bucket: { id: bucket.id, name: bucket.name },
    documents: bucketDocs.map(e => ({
      id: e.document.id,
      filename: e.document.filename,
      mimeType: e.document.mimeType,
      size: e.document.size,
      chunks: e.document.chunks.length,
      uploadedAt: e.document.uploadedAt,
    })),
    count: bucketDocs.length,
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler
app.use(notFoundHandler);

// Graceful shutdown
let httpServer: import('http').Server | undefined;
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Shutting down gracefully...');
  memoryProcessor.stop();
  // Stop accepting new connections, then drain in-flight webhook deliveries.
  if (httpServer) await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
  await Promise.race([webhookService.drain(), new Promise((r) => setTimeout(r, 5000))]);
  await memoryService.disconnect();
  await shutdownTelemetry(); // flush the final OpenTelemetry span batch before exit
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Convert stray async errors into logged, observable events instead of letting
// Node 20's default behavior hard-kill the unattended container on a single
// unhandled rejection from a route or a third-party client.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection: ' + (reason instanceof Error ? reason.stack : String(reason)));
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException: ' + (err instanceof Error ? err.stack : String(err)));
});

// Start server
async function start() {
  try {
    logger.info('Connecting to databases...');
    await memoryService.connect();
    await knowledgeService.connect(config.surrealdb);
    await bucketService.connect(config.surrealdb);
    await apiKeyService.connect(config.surrealdb);
    await webhookService.connect(config.surrealdb);

    // Connect TokenService and run migration
    await tokenService.connect(config.surrealdb);
    try {
      const result = await tokenService.migrateFromApiKeys();
      if (result.migrated > 0) {
        logger.info(`migration: migrated ${result.migrated} legacy api_keys → tokens`);
      }
    } catch (e) {
      logger.error('MIGRATION_FAILED: ' + (e instanceof Error ? e.stack : String(e)));
      // Legacy fallback: apiKeyService already connected above
      logger.warn('legacy apiKeyService loaded as fallback');
    }

    if (await tokenService.needsBootstrap()) {
      const code = await tokenService.generateBootstrapCode();
      console.log('');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('  NovaCortex Setup Required');
      console.log('  Bootstrap code: ' + code);
      console.log('  Valid for 1 hour');
      console.log('  Exchange via:');
      console.log('    novacortex setup --url <URL> --code ' + code);
      console.log('  Or visit the /login page in the web UI');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');
    }

    logger.info('Connected successfully.');

    // Embedding dimension guard: a model whose vectors don't match
    // QDRANT_VECTOR_SIZE makes every background upsert fail silently, so a
    // confirmed mismatch is a hard misconfiguration — fail loudly instead of
    // running a deployment that quietly stores nothing. An UNREACHABLE endpoint
    // (e.g. an Ollama sidecar still pulling its model) only degrades to
    // substring search and is reported via /health, not fatal.
    // Escape hatch: EMBEDDING_DIM_CHECK=off.
    if (process.env['EMBEDDING_DIM_CHECK'] !== 'off') {
      const embStatus = await checkEmbeddingStatus();
      if (embStatus.status === 'dimension_mismatch') {
        logger.error(
          `FATAL: embedding dimension mismatch — ${embStatus.error}. ` +
            `Fix EMBEDDING_MODEL or QDRANT_VECTOR_SIZE (a new size needs a fresh Qdrant collection), ` +
            `or set EMBEDDING_DIM_CHECK=off to bypass.`
        );
        process.exit(1);
      }
      if (embStatus.status === 'unreachable') {
        logger.warn(
          `Embedding endpoint unreachable (${embStatus.error}) — semantic search degraded to substring matching until it recovers. See /health.`
        );
      }
      if (embStatus.status === 'disabled') {
        logger.warn(
          'No embedding provider configured (OPENAI_API_KEY unset) — search runs in SUBSTRING mode, not semantic. ' +
            'For fully local semantic search, run the local-embeddings compose profile or point OPENAI_BASE_URL at any OpenAI-compatible server.'
        );
      }
      if (embStatus.status === 'ok') {
        logger.info(
          `Semantic search active: model=${embStatus.model} dim=${embStatus.dimension}`
        );
      }
    }

    // Start memory processor if enabled
    if (process.env['PROCESSOR_ENABLED'] !== 'false') {
      memoryProcessor.start();
      logger.info('Memory processor started');
    }

    httpServer = app.listen(config.port, () => {
      logger.info('Memory Stack API started', {
        port: config.port,
        healthEndpoint: `http://localhost:${config.port}/health`,
        processorEndpoint: `http://localhost:${config.port}/processor`,
      });
    });
  } catch (error) {
    logger.error('Failed to start server', {}, error as Error);
    process.exit(1);
  }
}

start();
