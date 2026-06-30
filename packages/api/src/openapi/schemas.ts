import { z } from 'zod';
import { registry } from './registry.js';

// ─── Primitives ────────────────────────────────────────────────────────────────

export const ErrorResponse = registry.register(
  'ErrorResponse',
  z.object({ error: z.string(), message: z.string().optional() }).openapi('ErrorResponse'),
);

export const SuccessResponse = registry.register(
  'SuccessResponse',
  z.object({ success: z.boolean(), message: z.string().optional() }).openapi('SuccessResponse'),
);

// ─── Health ────────────────────────────────────────────────────────────────────

export const HealthResponse = registry.register(
  'HealthResponse',
  z
    .object({
      status: z.enum(['healthy', 'unhealthy']),
      timestamp: z.string(),
      stats: z.unknown().optional(),
      cached: z.boolean().optional(),
      docs: z.string().optional(),
      openapi: z.string().optional(),
    })
    .openapi('HealthResponse'),
);

export const QdrantHealthResponse = registry.register(
  'QdrantHealthResponse',
  z
    .object({
      status: z.enum(['healthy', 'unhealthy']),
      version: z.string().optional(),
      latency: z.number(),
      error: z.string().optional(),
    })
    .openapi('QdrantHealthResponse'),
);

// ─── Stats ─────────────────────────────────────────────────────────────────────

export const StatsResponse = registry.register(
  'StatsResponse',
  z
    .object({
      total: z.number(),
      byNamespace: z.record(z.number()),
      byType: z.record(z.number()),
      recentActivity: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .openapi('StatsResponse'),
);

// ─── Memory ────────────────────────────────────────────────────────────────────

const MemoryType = z.enum([
  'episodic',
  'semantic',
  'procedural',
  'working',
  'emotional',
  'sensory',
]);

const EntitySchema = registry.register(
  'Entity',
  z
    .object({
      name: z.string(),
      type: z.enum(['person', 'organization', 'location', 'concept', 'event']),
      confidence: z.number().min(0).max(1),
    })
    .openapi('Entity'),
);

const SignalSchema = registry.register(
  'Signal',
  z
    .object({
      keyword: z.string(),
      weight: z.number(),
      extractedAt: z.string().describe('ISO 8601 datetime string'),
    })
    .openapi('Signal'),
);

const SourceSchema = registry.register(
  'Source',
  z
    .object({
      type: z.enum(['conversation', 'document', 'api', 'extraction']).optional(),
      sessionId: z.string().optional(),
      documentId: z.string().optional(),
      agentId: z.string().optional(),
      timestamp: z.string().optional().describe('ISO 8601 datetime string'),
    })
    .openapi('Source'),
);

export const CreateMemoryRequest = registry.register(
  'CreateMemoryRequest',
  z
    .object({
      content: z.string().min(1).describe('Memory content text'),
      memoryType: MemoryType.describe('Type of memory'),
      namespace: z.string().optional().describe('Namespace to store the memory in (default: "default")'),
      tags: z.array(z.string()).optional(),
      entities: z.array(EntitySchema).optional(),
      signals: z.array(SignalSchema).optional(),
      source: SourceSchema.optional(),
      confidence: z.number().min(0).max(1).optional(),
      salience: z.number().min(0).max(10).optional(),
      decayRate: z.number().positive().optional(),
      embedding: z.array(z.number()).optional().describe('Pre-computed embedding vector'),
    })
    .openapi('CreateMemoryRequest'),
);

export const UpdateMemoryRequest = registry.register(
  'UpdateMemoryRequest',
  z
    .object({
      content: z.string().min(1).optional(),
      tags: z.array(z.string()).optional(),
      entities: z.array(EntitySchema).optional(),
      signals: z.array(SignalSchema).optional(),
      salience: z.number().min(0).max(10).optional(),
    })
    .openapi('UpdateMemoryRequest'),
);

export const MemoryId = registry.register(
  'MemoryId',
  z.object({ id: z.string(), namespace: z.string() }).openapi('MemoryId'),
);

export const MemoryRecord = registry.register(
  'MemoryRecord',
  z
    .object({
      id: MemoryId,
      content: z.string(),
      memoryType: MemoryType,
      contentHash: z.string(),
      createdAt: z.string(),
      accessedAt: z.string().optional(),
      metadata: z.record(z.unknown()),
      tags: z.array(z.string()).optional(),
      entities: z.array(EntitySchema).optional(),
      signals: z.array(SignalSchema).optional(),
      source: SourceSchema.optional(),
    })
    .openapi('MemoryRecord'),
);

export const PaginatedMemories = registry.register(
  'PaginatedMemories',
  z
    .object({
      data: z.array(MemoryRecord),
      count: z.number(),
    })
    .openapi('PaginatedMemories'),
);

export const VectorSearchRequest = registry.register(
  'VectorSearchRequest',
  z
    .object({
      vector: z.array(z.number()).describe('Embedding vector to search by'),
      namespace: z.string().optional(),
      memoryTypes: z.array(MemoryType).optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().int().positive().max(100).optional(),
      offset: z.number().int().min(0).optional(),
      minSalience: z.number().min(0).max(10).optional(),
      scoreThreshold: z.number().min(0).max(1).optional(),
    })
    .openapi('VectorSearchRequest'),
);

export const CreateRelationRequest = registry.register(
  'CreateRelationRequest',
  z
    .object({
      fromMemoryId: z.string(),
      fromNamespace: z.string(),
      toMemoryId: z.string(),
      toNamespace: z.string(),
      relationType: z.enum([
        'related',
        'causes',
        'caused_by',
        'part_of',
        'contains',
        'precedes',
        'follows',
        'contradicts',
        'supports',
        'references',
      ]),
      strength: z.number().min(0).max(1).optional(),
      bidirectional: z.boolean().optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .openapi('CreateRelationRequest'),
);

// ─── Namespaces ────────────────────────────────────────────────────────────────

export const NamespacesResponse = registry.register(
  'NamespacesResponse',
  z
    .object({
      data: z.array(z.string()),
      count: z.number(),
      limit: z.number(),
      remaining: z.number(),
      tier: z.string(),
      upgrade: z.string().nullable(),
    })
    .openapi('NamespacesResponse'),
);

// ─── Tokens ────────────────────────────────────────────────────────────────────

export const TokenRecord = registry.register(
  'TokenRecord',
  z
    .object({
      id: z.string(),
      name: z.string(),
      prefix: z.string(),
      scopes: z.array(z.string()),
      agentId: z.string().optional(),
      namespaceClaim: z.string().optional(),
      createdAt: z.string(),
      expiresAt: z.string().nullable(),
    })
    .openapi('TokenRecord'),
);

export const CreateTokenRequest = registry.register(
  'CreateTokenRequest',
  z
    .object({
      template: z.enum(['admin-full', 'admin-readonly', 'agent', 'knowledge-ingest']),
      name: z.string().min(1),
      agentId: z.string().optional().describe('Required when template is "agent"'),
      namespaceClaim: z.string().optional().describe('Namespace the agent token is bound to'),
      expiresAt: z.string().optional().describe('ISO 8601 expiry datetime'),
    })
    .openapi('CreateTokenRequest'),
);

export const CreateTokenResponse = registry.register(
  'CreateTokenResponse',
  z
    .object({
      token: z.string().describe('The raw bearer token — store securely, shown only once'),
      record: TokenRecord,
    })
    .openapi('CreateTokenResponse'),
);

// ─── Setup ─────────────────────────────────────────────────────────────────────

export const SetupExchangeRequest = registry.register(
  'SetupExchangeRequest',
  z
    .object({ code: z.string().describe('One-time bootstrap code from server startup logs') })
    .openapi('SetupExchangeRequest'),
);

// ─── License ───────────────────────────────────────────────────────────────────

export const LicenseResponse = registry.register(
  'LicenseResponse',
  z
    .object({
      tier: z.string(),
      maxNamespaces: z.number(),
      valid: z.boolean(),
      hasLicense: z.boolean(),
      key: z.string().nullable(),
      email: z.string().nullable(),
      features: z.object({
        maxNamespaces: z.number(),
        priority_support: z.boolean(),
        api_rate_limit: z.number(),
        federation: z.boolean(),
      }),
    })
    .openapi('LicenseResponse'),
);

// ─── Knowledge ─────────────────────────────────────────────────────────────────

export const DocumentRecord = registry.register(
  'DocumentRecord',
  z
    .object({
      id: z.string(),
      filename: z.string(),
      mimeType: z.string(),
      size: z.number(),
      chunks: z.number(),
      namespace: z.string(),
      uploadedAt: z.string(),
      metadata: z.record(z.unknown()).optional(),
    })
    .openapi('DocumentRecord'),
);

// ─── Buckets ───────────────────────────────────────────────────────────────────

export const BucketRecord = registry.register(
  'BucketRecord',
  z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      namespace: z.string(),
      agents: z.array(z.string()),
    })
    .openapi('BucketRecord'),
);
