import { z } from 'zod';
import { registry } from './registry.js';
import {
  ErrorResponse,
  HealthResponse,
  QdrantHealthResponse,
  StatsResponse,
  CreateMemoryRequest,
  UpdateMemoryRequest,
  MemoryRecord,
  PaginatedMemories,
  VectorSearchRequest,
  CreateRelationRequest,
  NamespacesResponse,
  TokenRecord,
  CreateTokenRequest,
  CreateTokenResponse,
  SetupExchangeRequest,
  LicenseResponse,
  DocumentRecord,
  BucketRecord,
  SuccessResponse,
} from './schemas.js';

const bearer = [{ BearerAuth: [] as string[] }];
const noAuth: never[] = [];

const err400 = { description: 'Bad request', content: { 'application/json': { schema: ErrorResponse } } };
const err401 = { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } };
const err403 = { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponse } } };
const err404 = { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } };
const err500 = { description: 'Internal server error', content: { 'application/json': { schema: ErrorResponse } } };
const json = (schema: z.ZodTypeAny) => ({ 'application/json': { schema } });

// ─── Health ────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  summary: 'API health check',
  description: 'Returns service health and basic stats. Response is cached for 5 seconds.',
  security: noAuth,
  responses: {
    200: { description: 'Healthy', content: json(HealthResponse) },
    503: { description: 'Unhealthy', content: json(HealthResponse) },
  },
});

registry.registerPath({
  method: 'get',
  path: '/health/qdrant',
  tags: ['Health'],
  summary: 'Qdrant vector DB health check',
  security: noAuth,
  responses: {
    200: { description: 'Healthy', content: json(QdrantHealthResponse) },
    503: { description: 'Unhealthy', content: json(QdrantHealthResponse) },
  },
});

// ─── Stats ─────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/stats',
  tags: ['Stats'],
  summary: 'Memory stats',
  description: 'Returns aggregate counts by namespace and type. Cached for 30 seconds.',
  security: bearer,
  responses: {
    200: { description: 'Stats', content: json(StatsResponse) },
    401: err401,
    500: err500,
  },
});

// ─── Setup ─────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/setup/exchange',
  tags: ['Setup'],
  summary: 'Exchange one-time bootstrap code for a bearer token',
  description:
    'On first run the server prints a one-time bootstrap code to stdout. Exchange it here to obtain an admin token.',
  security: noAuth,
  request: { body: { content: json(SetupExchangeRequest) } },
  responses: {
    200: {
      description: 'Token issued',
      content: json(
        z.object({
          token: z.string(),
          whoami: z.object({
            kind: z.string(),
            name: z.string(),
            scopes: z.array(z.string()),
            server: z.object({ version: z.string(), mode: z.string() }),
          }),
        }),
      ),
    },
    400: err400,
    401: err401,
  },
});

// ─── Auth ──────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/auth/whoami',
  tags: ['Auth'],
  summary: 'Get current token identity',
  security: bearer,
  responses: {
    200: {
      description: 'Token identity',
      content: json(
        z.object({
          kind: z.string(),
          name: z.string(),
          scopes: z.array(z.string()),
          expiresAt: z.string().nullable(),
          server: z.object({ version: z.string(), mode: z.string() }),
        }),
      ),
    },
    401: err401,
  },
});

// ─── Tokens ────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/tokens',
  tags: ['Tokens'],
  summary: 'List all tokens',
  security: bearer,
  responses: {
    200: { description: 'Token list', content: json(z.array(TokenRecord)) },
    401: err401,
    403: err403,
  },
});

registry.registerPath({
  method: 'post',
  path: '/tokens',
  tags: ['Tokens'],
  summary: 'Create a new token',
  description:
    'Templates: `admin-full` (all scopes), `admin-readonly`, `agent` (requires agentId), `knowledge-ingest`.',
  security: bearer,
  request: { body: { content: json(CreateTokenRequest) } },
  responses: {
    201: { description: 'Token created', content: json(CreateTokenResponse) },
    400: err400,
    401: err401,
    403: err403,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/tokens/{id}',
  tags: ['Tokens'],
  summary: 'Revoke a token',
  security: bearer,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Token revoked' },
    401: err401,
    403: err403,
    404: err404,
  },
});

// ─── Memories ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/memories',
  tags: ['Memories'],
  summary: 'Create a memory',
  security: bearer,
  request: { body: { content: json(CreateMemoryRequest) } },
  responses: {
    201: { description: 'Memory created', content: json(MemoryRecord) },
    400: err400,
    401: err401,
  },
});

registry.registerPath({
  method: 'get',
  path: '/memories',
  tags: ['Memories'],
  summary: 'Search / list memories',
  security: bearer,
  request: {
    query: z.object({
      namespace: z.string().optional(),
      memoryTypes: z.string().optional().describe('Comma-separated or repeated: episodic,semantic,…'),
      tags: z.string().optional().describe('Comma-separated or repeated'),
      limit: z.coerce.number().int().max(100).optional(),
      offset: z.coerce.number().int().optional(),
      minSalience: z.coerce.number().optional(),
      includeRelations: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    200: { description: 'Memory list', content: json(PaginatedMemories) },
    401: err401,
  },
});

registry.registerPath({
  method: 'get',
  path: '/memories/{namespace}/{id}',
  tags: ['Memories'],
  summary: 'Get a single memory',
  security: bearer,
  request: {
    params: z.object({ namespace: z.string(), id: z.string() }),
    query: z.object({ includeRelations: z.coerce.boolean().optional() }),
  },
  responses: {
    200: { description: 'Memory', content: json(MemoryRecord) },
    401: err401,
    404: err404,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/memories/{namespace}/{id}',
  tags: ['Memories'],
  summary: 'Update a memory',
  security: bearer,
  request: {
    params: z.object({ namespace: z.string(), id: z.string() }),
    body: { content: json(UpdateMemoryRequest) },
  },
  responses: {
    200: { description: 'Updated memory', content: json(MemoryRecord) },
    400: err400,
    401: err401,
    404: err404,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/memories/{namespace}/{id}',
  tags: ['Memories'],
  summary: 'Delete a memory',
  security: bearer,
  request: { params: z.object({ namespace: z.string(), id: z.string() }) },
  responses: {
    204: { description: 'Deleted' },
    401: err401,
    404: err404,
  },
});

registry.registerPath({
  method: 'get',
  path: '/memories/{namespace}/{id}/current',
  tags: ['Memories'],
  summary: 'Resolve a memory to its current version (walk the supersedes chain)',
  description:
    'Append-only resolution never deletes: superseded facts stay stored with invalidatedAt. ' +
    'This endpoint follows incoming supersedes edges to the newest version of the fact and returns the chain walked. Deterministic, no LLM.',
  security: bearer,
  request: { params: z.object({ namespace: z.string(), id: z.string() }) },
  responses: {
    200: {
      description: 'Current version + chain',
      content: json(
        z.object({
          current: z.unknown(),
          superseded: z.boolean(),
          hops: z.number(),
          chain: z.array(z.unknown()),
        }),
      ),
    },
    401: err401,
    404: err404,
  },
});

registry.registerPath({
  method: 'get',
  path: '/memories/{namespace}/{id}/similar',
  tags: ['Memories'],
  summary: 'Find similar memories',
  security: bearer,
  request: {
    params: z.object({ namespace: z.string(), id: z.string() }),
    query: z.object({
      limit: z.coerce.number().int().optional(),
      targetNamespace: z.string().optional(),
    }),
  },
  responses: {
    200: { description: 'Similar memories', content: json(PaginatedMemories) },
    401: err401,
  },
});

registry.registerPath({
  method: 'get',
  path: '/memories/{namespace}/{id}/relations',
  tags: ['Memories'],
  summary: 'Get memory relations',
  security: bearer,
  request: { params: z.object({ namespace: z.string(), id: z.string() }) },
  responses: {
    200: {
      description: 'Relations',
      content: json(z.object({ data: z.array(z.unknown()), count: z.number() })),
    },
    401: err401,
  },
});

registry.registerPath({
  method: 'post',
  path: '/memories/relations',
  tags: ['Memories'],
  summary: 'Create a relation between two memories',
  security: bearer,
  request: { body: { content: json(CreateRelationRequest) } },
  responses: {
    201: { description: 'Relation created', content: json(z.unknown()) },
    400: err400,
    401: err401,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/memories/relations/{id}',
  tags: ['Memories'],
  summary: 'Delete a relation',
  security: bearer,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Deleted' },
    401: err401,
    404: err404,
  },
});

// ─── Export / Import ───────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/memories/export/{namespace}',
  tags: ['Import / Export'],
  summary: 'Export namespace as JSON',
  security: bearer,
  request: { params: z.object({ namespace: z.string() }) },
  responses: {
    200: { description: 'Namespace export (JSON file download)', content: { 'application/json': { schema: z.unknown() } } },
    401: err401,
  },
});

registry.registerPath({
  method: 'get',
  path: '/memories/export/{namespace}/pmf',
  tags: ['Import / Export'],
  summary: 'Export namespace in Portable Memory Format (PMF)',
  security: bearer,
  request: {
    params: z.object({ namespace: z.string() }),
    query: z.object({
      embeddings: z.string().optional().describe('"true" to include embedding vectors'),
      nodeId: z.string().optional(),
      exportedBy: z.string().optional(),
    }),
  },
  responses: {
    200: { description: 'PMF file download', content: { 'application/vnd.novacortex.pmf+json': { schema: z.unknown() } } },
    401: err401,
  },
});

registry.registerPath({
  method: 'post',
  path: '/memories/import',
  tags: ['Import / Export'],
  summary: 'Import memories from JSON export',
  security: bearer,
  request: { body: { content: { 'application/json': { schema: z.unknown() } } } },
  responses: {
    200: { description: 'Import result', content: json(z.unknown()) },
    401: err401,
  },
});

registry.registerPath({
  method: 'post',
  path: '/memories/import/pmf',
  tags: ['Import / Export'],
  summary: 'Import from Portable Memory Format (PMF)',
  security: bearer,
  request: { body: { content: { 'application/json': { schema: z.unknown() } } } },
  responses: {
    200: { description: 'Import result', content: json(z.unknown()) },
    401: err401,
  },
});

registry.registerPath({
  method: 'post',
  path: '/memories/import/chat',
  tags: ['Import / Export'],
  summary: 'Import conversation history (Claude.ai JSON, Claude Code JSONL, ChatGPT JSON)',
  security: bearer,
  request: {
    body: {
      content: json(
        z.object({
          data: z.string().describe('Raw conversation export as string'),
          format: z.enum(['auto', 'claude-ai', 'claude-code', 'chatgpt']).optional().default('auto'),
          namespace: z.string().optional().default('imported'),
          dryRun: z.boolean().optional().default(false),
        }),
      ),
    },
  },
  responses: {
    200: { description: 'Import result', content: json(z.unknown()) },
    400: err400,
    401: err401,
  },
});

registry.registerPath({
  method: 'post',
  path: '/memories/ingest',
  tags: ['Intelligence'],
  summary: 'Distill conversation messages into memories (LLM fact extraction + append-only conflict resolution)',
  description:
    'Requires a configured LLM (LLM_MODEL; any OpenAI-compatible endpoint incl. local Ollama). ' +
    'Async by default: returns 202 with a jobId (jobs are in-process, expire after 1h, not persisted across restarts). ' +
    'wait=true runs synchronously; dryRun=true previews extracted facts without storing. ' +
    'Resolution writes typed edges (supersedes/contradicts/same_as/related_to) and stamps invalidatedAt on superseded facts — nothing is deleted.',
  security: bearer,
  request: {
    body: {
      content: json(
        z.object({
          messages: z
            .array(
              z.object({
                role: z.enum(['user', 'assistant', 'system', 'tool']),
                content: z.string(),
                name: z.string().optional(),
                timestamp: z.string().optional(),
              }),
            )
            .min(1),
          namespace: z.string().optional().default('default'),
          sessionId: z.string().optional(),
          agentId: z.string().optional(),
          dryRun: z.boolean().optional().default(false),
          wait: z.boolean().optional().default(false),
          resolve: z.boolean().optional().default(true),
        }),
      ),
    },
  },
  responses: {
    200: { description: 'Sync/dryRun result (facts, created memories, resolutions)', content: json(z.unknown()) },
    202: { description: 'Job accepted (async default)', content: json(z.unknown()) },
    400: err400,
    401: err401,
    503: { description: 'Intelligence layer disabled (no LLM configured)', content: json(z.unknown()) },
  },
});

registry.registerPath({
  method: 'get',
  path: '/memories/ingest/{jobId}',
  tags: ['Intelligence'],
  summary: 'Ingest job status/result',
  security: bearer,
  request: { params: z.object({ jobId: z.string() }) },
  responses: {
    200: { description: 'Job status', content: json(z.unknown()) },
    401: err401,
    404: { description: 'Unknown or expired job', content: json(z.unknown()) },
  },
});

registry.registerPath({
  method: 'post',
  path: '/memories/embeddings/generate',
  tags: ['Import / Export'],
  summary: 'Generate OpenAI embeddings for memories that lack vectors (backfill)',
  security: bearer,
  responses: {
    200: { description: 'Generation started', content: json(z.object({
      status: z.string(),
      startedAt: z.string(),
      message: z.string(),
    })) },
    400: err400,
    401: err401,
    503: { description: 'Service unavailable', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/memories/deduplicate',
  tags: ['Import / Export'],
  summary: 'Find and remove near-duplicate memories in a namespace',
  security: bearer,
  request: {
    body: {
      content: json(
        z.object({
          namespace: z.string().optional().default('default'),
          threshold: z.number().min(0).max(1).optional().default(0.92),
          dryRun: z.boolean().optional().default(false),
          limit: z.number().int().optional().default(1000),
        }),
      ),
    },
  },
  responses: {
    200: { description: 'Dedup result', content: json(z.unknown()) },
    401: err401,
  },
});

// ─── Search ────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/search',
  tags: ['Search'],
  summary: 'Search memories (text query or pre-computed vector)',
  description:
    'Provide `query` (text — embedded server-side, semantic when embeddings are configured) or `vector` (number[]). ' +
    'Temporal controls: by default only CURRENT facts are returned (superseded/invalidated memories are filtered); ' +
    'set `includeInvalidated: true` to include them, or `asOf` (ISO 8601) for a point-in-time view of what was believed at that instant. ' +
    '`recencyWeight` (0..1) blends recency into ranking; `includeRelations` hydrates typed edges (conflict signals).',
  security: bearer,
  request: { body: { content: json(VectorSearchRequest) } },
  responses: {
    200: { description: 'Search results', content: json(PaginatedMemories) },
    401: err401,
  },
});

registry.registerPath({
  method: 'post',
  path: '/memories/search',
  tags: ['Search'],
  summary: 'Vector search on memories',
  security: bearer,
  request: { body: { content: json(VectorSearchRequest) } },
  responses: {
    200: { description: 'Search results', content: json(PaginatedMemories) },
    401: err401,
  },
});

// ─── Namespaces ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/namespaces',
  tags: ['Namespaces'],
  summary: 'List all namespaces',
  security: bearer,
  responses: {
    200: { description: 'Namespaces', content: json(NamespacesResponse) },
    401: err401,
    500: err500,
  },
});

registry.registerPath({
  method: 'post',
  path: '/namespaces',
  tags: ['Namespaces'],
  summary: 'Create a namespace',
  security: bearer,
  request: {
    body: {
      content: json(
        z.object({
          name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
          description: z.string().optional(),
          agentId: z.string().optional(),
        }),
      ),
    },
  },
  responses: {
    201: { description: 'Namespace created', content: json(z.unknown()) },
    400: err400,
    401: err401,
    403: err403,
    409: { description: 'Namespace already exists', content: json(ErrorResponse) },
    500: err500,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/namespaces/{name}',
  tags: ['Namespaces'],
  summary: 'Delete a namespace (deletes all memories in it)',
  security: bearer,
  request: { params: z.object({ name: z.string() }) },
  responses: {
    200: { description: 'Deleted', content: json(z.unknown()) },
    400: err400,
    401: err401,
    500: err500,
  },
});

// ─── Processor ─────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/processor',
  tags: ['Processor'],
  summary: 'Get processor status and stats',
  security: bearer,
  responses: {
    200: { description: 'Processor stats', content: json(z.unknown()) },
    401: err401,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/processor',
  tags: ['Processor'],
  summary: 'Update processor config',
  security: bearer,
  request: { body: { content: json(z.unknown()) } },
  responses: {
    200: { description: 'Updated config', content: json(z.unknown()) },
    401: err401,
    500: err500,
  },
});

registry.registerPath({
  method: 'post',
  path: '/processor/run',
  tags: ['Processor'],
  summary: 'Trigger a processing task',
  security: bearer,
  request: {
    body: {
      content: json(
        z.object({
          task: z.enum(['relations', 'decay', 'consolidation', 'all']).optional(),
        }),
      ),
    },
  },
  responses: {
    200: { description: 'Task result', content: json(z.unknown()) },
    400: err400,
    401: err401,
  },
});

registry.registerPath({
  method: 'post',
  path: '/processor/start',
  tags: ['Processor'],
  summary: 'Start the processor scheduler',
  security: bearer,
  responses: { 200: { description: 'Started', content: json(z.unknown()) }, 401: err401 },
});

registry.registerPath({
  method: 'post',
  path: '/processor/stop',
  tags: ['Processor'],
  summary: 'Stop the processor scheduler',
  security: bearer,
  responses: { 200: { description: 'Stopped', content: json(z.unknown()) }, 401: err401 },
});

registry.registerPath({
  method: 'get',
  path: '/processor/schedule',
  tags: ['Processor'],
  summary: 'Get scheduler config',
  security: bearer,
  responses: { 200: { description: 'Schedule', content: json(z.unknown()) }, 401: err401 },
});

registry.registerPath({
  method: 'put',
  path: '/processor/schedule',
  tags: ['Processor'],
  summary: 'Update scheduler config',
  security: bearer,
  request: { body: { content: json(z.unknown()) } },
  responses: {
    200: { description: 'Updated schedule', content: json(z.unknown()) },
    400: err400,
    401: err401,
  },
});

// ─── License ───────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/license',
  tags: ['License'],
  summary: 'Get license status',
  security: bearer,
  responses: {
    200: { description: 'License status', content: json(LicenseResponse) },
    401: err401,
  },
});

registry.registerPath({
  method: 'post',
  path: '/license/activate',
  tags: ['License'],
  summary: 'Activate a license key',
  security: bearer,
  request: { body: { content: json(z.object({ key: z.string() })) } },
  responses: {
    200: { description: 'License activated', content: json(z.unknown()) },
    400: err400,
    401: err401,
    500: err500,
  },
});

registry.registerPath({
  method: 'post',
  path: '/license/validate',
  tags: ['License'],
  summary: 'Validate a license key (without activating)',
  security: bearer,
  request: { body: { content: json(z.object({ key: z.string() })) } },
  responses: {
    200: { description: 'Validation result', content: json(z.unknown()) },
    401: err401,
  },
});

// ─── Federation ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/federation/status',
  tags: ['Federation'],
  summary: 'Check federation status',
  description: 'Federation is a Pro+ feature that enables cross-namespace reads.',
  security: bearer,
  responses: { 200: { description: 'Federation status', content: json(z.unknown()) }, 401: err401 },
});

registry.registerPath({
  method: 'get',
  path: '/federation',
  tags: ['Federation'],
  summary: 'List all federation configs',
  security: bearer,
  responses: {
    200: { description: 'Federation configs', content: json(z.unknown()) },
    401: err401,
    403: err403,
  },
});

registry.registerPath({
  method: 'post',
  path: '/federation',
  tags: ['Federation'],
  summary: 'Set federation config for an agent',
  security: bearer,
  request: {
    body: {
      content: json(
        z.object({
          agentId: z.string(),
          primaryNamespace: z.string(),
          readableNamespaces: z.array(z.string()).optional(),
        }),
      ),
    },
  },
  responses: {
    200: { description: 'Config saved', content: json(z.unknown()) },
    400: err400,
    401: err401,
    403: err403,
  },
});

registry.registerPath({
  method: 'get',
  path: '/federation/{agentId}',
  tags: ['Federation'],
  summary: 'Get federation config for a specific agent',
  security: bearer,
  request: { params: z.object({ agentId: z.string() }) },
  responses: {
    200: { description: 'Config', content: json(z.unknown()) },
    401: err401,
    404: err404,
  },
});

registry.registerPath({
  method: 'put',
  path: '/federation/{agentId}',
  tags: ['Federation'],
  summary: 'Update federation config for an agent',
  security: bearer,
  request: {
    params: z.object({ agentId: z.string() }),
    body: {
      content: json(
        z.object({
          primaryNamespace: z.string().optional(),
          readableNamespaces: z.array(z.string()).optional(),
        }),
      ),
    },
  },
  responses: {
    200: { description: 'Updated', content: json(z.unknown()) },
    400: err400,
    401: err401,
    403: err403,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/federation/{agentId}',
  tags: ['Federation'],
  summary: 'Delete federation config for an agent',
  security: bearer,
  request: { params: z.object({ agentId: z.string() }) },
  responses: {
    200: { description: 'Removed', content: json(z.unknown()) },
    401: err401,
    404: err404,
  },
});

registry.registerPath({
  method: 'get',
  path: '/federation/{agentId}/namespaces',
  tags: ['Federation'],
  summary: 'Get readable namespaces for an agent',
  security: bearer,
  request: {
    params: z.object({ agentId: z.string() }),
    query: z.object({ fallback: z.string().optional() }),
  },
  responses: {
    200: { description: 'Readable namespaces', content: json(z.unknown()) },
    401: err401,
  },
});

// ─── Knowledge ─────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/knowledge/upload',
  tags: ['Knowledge'],
  summary: 'Upload a document',
  description: 'Accepts multipart/form-data. Fields: namespace, uploadedBy, accessAgents (JSON array), createMemories.',
  security: bearer,
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.string().describe('File binary'),
            namespace: z.string().optional(),
            uploadedBy: z.string().optional(),
            accessAgents: z.string().optional().describe('JSON array of agent IDs'),
            createMemories: z.string().optional().describe('"true" to create memory chunks'),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Upload result', content: json(z.unknown()) },
    400: err400,
    401: err401,
    500: err500,
  },
});

registry.registerPath({
  method: 'get',
  path: '/knowledge',
  tags: ['Knowledge'],
  summary: 'List documents in a namespace',
  security: bearer,
  request: { query: z.object({ namespace: z.string().optional() }) },
  responses: {
    200: {
      description: 'Documents',
      content: json(z.object({ namespace: z.string(), documents: z.array(DocumentRecord), count: z.number() })),
    },
    401: err401,
  },
});

registry.registerPath({
  method: 'get',
  path: '/knowledge/agents/list',
  tags: ['Knowledge'],
  summary: 'List all known agents that have accessed knowledge',
  security: bearer,
  responses: {
    200: { description: 'Agent list', content: json(z.object({ agents: z.array(z.string()) })) },
    401: err401,
  },
});

registry.registerPath({
  method: 'get',
  path: '/knowledge/agent/{agentId}',
  tags: ['Knowledge'],
  summary: 'Get documents accessible by a specific agent',
  security: bearer,
  request: { params: z.object({ agentId: z.string() }) },
  responses: {
    200: { description: 'Documents', content: json(z.unknown()) },
    401: err401,
  },
});

registry.registerPath({
  method: 'get',
  path: '/knowledge/{documentId}',
  tags: ['Knowledge'],
  summary: 'Get a specific document with content and chunks',
  security: bearer,
  request: { params: z.object({ documentId: z.string() }) },
  responses: {
    200: { description: 'Document', content: json(z.unknown()) },
    401: err401,
    404: err404,
  },
});

registry.registerPath({
  method: 'post',
  path: '/knowledge/{documentId}/access',
  tags: ['Knowledge'],
  summary: 'Grant agent access to a document',
  security: bearer,
  request: {
    params: z.object({ documentId: z.string() }),
    body: {
      content: json(
        z.object({
          agentId: z.string(),
          permissions: z.array(z.enum(['read', 'write'])).optional(),
          grantedBy: z.string().optional(),
        }),
      ),
    },
  },
  responses: {
    200: { description: 'Access granted', content: json(SuccessResponse) },
    400: err400,
    401: err401,
    404: err404,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/knowledge/{documentId}/access/{agentId}',
  tags: ['Knowledge'],
  summary: 'Revoke agent access to a document',
  security: bearer,
  request: { params: z.object({ documentId: z.string(), agentId: z.string() }) },
  responses: {
    200: { description: 'Access revoked', content: json(SuccessResponse) },
    401: err401,
    404: err404,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/knowledge/{documentId}',
  tags: ['Knowledge'],
  summary: 'Delete a document',
  security: bearer,
  request: { params: z.object({ documentId: z.string() }) },
  responses: {
    200: { description: 'Deleted', content: json(SuccessResponse) },
    401: err401,
    404: err404,
  },
});

// ─── Agent Knowledge ───────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/agent/knowledge',
  tags: ['Agent Knowledge'],
  summary: 'List documents accessible by the calling agent',
  description: 'Requires an agent token (template: agent). Returns documents across all readable namespaces.',
  security: bearer,
  responses: {
    200: { description: 'Documents', content: json(z.unknown()) },
    401: err401,
    403: err403,
  },
});

registry.registerPath({
  method: 'get',
  path: '/agent/knowledge/search',
  tags: ['Agent Knowledge'],
  summary: 'Full-text search across accessible knowledge documents',
  security: bearer,
  request: { query: z.object({ q: z.string().describe('Search query') }) },
  responses: {
    200: { description: 'Search results', content: json(z.unknown()) },
    400: err400,
    401: err401,
    403: err403,
  },
});

registry.registerPath({
  method: 'get',
  path: '/agent/knowledge/{documentId}',
  tags: ['Agent Knowledge'],
  summary: 'Get a specific document (if the agent has access)',
  security: bearer,
  request: { params: z.object({ documentId: z.string() }) },
  responses: {
    200: { description: 'Document', content: json(z.unknown()) },
    401: err401,
    403: err403,
    404: err404,
  },
});

registry.registerPath({
  method: 'post',
  path: '/agent/knowledge/upload',
  tags: ['Agent Knowledge'],
  summary: "Upload a document to the agent's primary namespace",
  description: 'Multipart/form-data. Fields: file, grantAccessTo (JSON array), createMemories.',
  security: bearer,
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.string().describe('File binary'),
            grantAccessTo: z.string().optional().describe('JSON array of agent IDs to grant read access'),
            createMemories: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Upload result', content: json(z.unknown()) },
    400: err400,
    401: err401,
    403: err403,
    500: err500,
  },
});

// ─── Buckets ───────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/buckets',
  tags: ['Buckets'],
  summary: 'List all knowledge buckets',
  security: bearer,
  responses: {
    200: {
      description: 'Buckets',
      content: json(z.object({ buckets: z.array(BucketRecord), count: z.number() })),
    },
    401: err401,
  },
});

registry.registerPath({
  method: 'post',
  path: '/buckets',
  tags: ['Buckets'],
  summary: 'Create a bucket',
  security: bearer,
  request: {
    body: {
      content: json(
        z.object({
          name: z.string(),
          description: z.string().optional(),
          namespace: z.string().optional(),
          agents: z.array(z.string()).optional(),
        }),
      ),
    },
  },
  responses: {
    201: { description: 'Bucket created', content: json(z.object({ success: z.boolean(), bucket: BucketRecord })) },
    400: err400,
    401: err401,
  },
});

registry.registerPath({
  method: 'get',
  path: '/buckets/{id}',
  tags: ['Buckets'],
  summary: 'Get a single bucket',
  security: bearer,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Bucket', content: json(z.object({ bucket: BucketRecord })) },
    401: err401,
    404: err404,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/buckets/{id}',
  tags: ['Buckets'],
  summary: 'Update a bucket',
  security: bearer,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: json(
        z.object({
          name: z.string().optional(),
          description: z.string().optional(),
          namespace: z.string().optional(),
          agents: z.array(z.string()).optional(),
        }),
      ),
    },
  },
  responses: {
    200: { description: 'Updated bucket', content: json(z.unknown()) },
    400: err400,
    401: err401,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/buckets/{id}',
  tags: ['Buckets'],
  summary: 'Delete a bucket',
  security: bearer,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Deleted', content: json(SuccessResponse) },
    401: err401,
    404: err404,
  },
});

registry.registerPath({
  method: 'post',
  path: '/buckets/{id}/agents',
  tags: ['Buckets'],
  summary: 'Add an agent to a bucket',
  security: bearer,
  request: {
    params: z.object({ id: z.string() }),
    body: { content: json(z.object({ agentId: z.string() })) },
  },
  responses: {
    200: { description: 'Updated bucket', content: json(z.unknown()) },
    400: err400,
    401: err401,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/buckets/{id}/agents/{agentId}',
  tags: ['Buckets'],
  summary: 'Remove an agent from a bucket',
  security: bearer,
  request: { params: z.object({ id: z.string(), agentId: z.string() }) },
  responses: {
    200: { description: 'Updated bucket', content: json(z.unknown()) },
    400: err400,
    401: err401,
  },
});

registry.registerPath({
  method: 'post',
  path: '/buckets/{id}/upload',
  tags: ['Buckets'],
  summary: 'Upload a document to a bucket',
  description: 'Multipart/form-data. Fields: file, createMemories.',
  security: bearer,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.string(),
            createMemories: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Upload result', content: json(z.unknown()) },
    400: err400,
    401: err401,
    404: err404,
    500: err500,
  },
});

registry.registerPath({
  method: 'get',
  path: '/buckets/{id}/history',
  tags: ['Buckets'],
  summary: 'Get bucket upload history',
  security: bearer,
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({ limit: z.coerce.number().int().optional() }),
  },
  responses: {
    200: { description: 'Upload history', content: json(z.unknown()) },
    401: err401,
    404: err404,
  },
});

registry.registerPath({
  method: 'get',
  path: '/buckets/{id}/documents',
  tags: ['Buckets'],
  summary: 'Get documents in a bucket',
  security: bearer,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Documents', content: json(z.unknown()) },
    401: err401,
    404: err404,
  },
});

// ─── Admin ─────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/admin/migrate',
  tags: ['Admin'],
  summary: 'Migrate legacy API keys to tokens',
  description: 'One-time migration from the old /api-keys system to /tokens. Rate limited to 3/min.',
  security: bearer,
  responses: {
    200: { description: 'Migration result', content: json(z.unknown()) },
    401: err401,
    403: err403,
    500: err500,
  },
});
