/**
 * Centralized environment → config resolution shared by the REST API, the MCP
 * server, and the test harness.
 *
 * Historically the API and the MCP server resolved SurrealDB/Qdrant config
 * inline with DIFFERENT env-var names and DIFFERENT defaults:
 *   - API read SURREALDB_NS / SURREALDB_DB         (defaults: memory / stack)
 *   - MCP read SURREALDB_NS / SURREALDB_DB         (defaults: memory_stack / memories)
 *   - all docker-compose files set SURREALDB_NAMESPACE / SURREALDB_DATABASE
 *   - API Qdrant collection default "memories", MCP default "memory_vectors"
 *
 * The result was that the API and MCP server (and every Docker deployment) could
 * silently talk to different namespaces / collections, so memory written through
 * one interface was invisible to the other. This module is the single source of
 * truth: it accepts BOTH the long (`SURREALDB_NAMESPACE`/`SURREALDB_DATABASE`)
 * and short (`SURREALDB_NS`/`SURREALDB_DB`) names for backward compatibility,
 * preferring the long form, and uses ONE set of defaults everywhere.
 */
import type { SurrealDBConfig } from '../adapters/surrealdb.js';
import type { QdrantConfig } from '../adapters/qdrant.js';
import type { EmbeddingServiceConfig } from '../services/embedding-service.js';

type Env = Record<string, string | undefined>;

/** Unified defaults — used by API, MCP server and tests alike. */
export const CONFIG_DEFAULTS = {
  surrealUrl: 'http://localhost:8000/rpc',
  surrealUser: 'root',
  surrealPass: 'root',
  surrealNamespace: 'memory',
  surrealDatabase: 'stack',
  qdrantUrl: 'http://localhost:6333',
  qdrantCollection: 'memories',
  qdrantVectorSize: 1536,
} as const;

export function resolveSurrealConfig(env: Env = process.env): SurrealDBConfig {
  return {
    url: env['SURREALDB_URL'] || CONFIG_DEFAULTS.surrealUrl,
    user: env['SURREALDB_USER'] || CONFIG_DEFAULTS.surrealUser,
    pass: env['SURREALDB_PASS'] || CONFIG_DEFAULTS.surrealPass,
    namespace:
      env['SURREALDB_NAMESPACE'] || env['SURREALDB_NS'] || CONFIG_DEFAULTS.surrealNamespace,
    database:
      env['SURREALDB_DATABASE'] || env['SURREALDB_DB'] || CONFIG_DEFAULTS.surrealDatabase,
  };
}

export function resolveQdrantConfig(env: Env = process.env): QdrantConfig {
  const apiKey = env['QDRANT_API_KEY'];
  return {
    url: env['QDRANT_URL'] || CONFIG_DEFAULTS.qdrantUrl,
    ...(apiKey ? { apiKey } : {}),
    collectionName: env['QDRANT_COLLECTION'] || CONFIG_DEFAULTS.qdrantCollection,
    vectorSize: parseInt(env['QDRANT_VECTOR_SIZE'] || String(CONFIG_DEFAULTS.qdrantVectorSize), 10),
  };
}

export function resolveEmbeddingConfig(env: Env = process.env): EmbeddingServiceConfig {
  const cfg: EmbeddingServiceConfig = {};
  if (env['OPENAI_API_KEY']) cfg.apiKey = env['OPENAI_API_KEY'];
  if (env['EMBEDDING_MODEL']) cfg.model = env['EMBEDDING_MODEL'];
  if (env['OPENAI_BASE_URL']) cfg.baseUrl = env['OPENAI_BASE_URL'];
  return cfg;
}
