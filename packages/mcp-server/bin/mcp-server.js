#!/usr/bin/env node

/**
 * Memory Stack MCP Server - Entry Point
 *
 * Usage:
 *   memory-stack-mcp
 *
 * Configuration is resolved via the shared @memory-stack/core helpers so the MCP
 * server ALWAYS reads/writes the same SurrealDB namespace/database and Qdrant
 * collection as the REST API (and honors both SURREALDB_NAMESPACE/DATABASE and
 * the legacy SURREALDB_NS/DB names). Set OPENAI_API_KEY to enable semantic search.
 *
 * Environment Variables:
 *   SURREALDB_URL                          - SurrealDB URL (default: http://localhost:8000/rpc)
 *   SURREALDB_NAMESPACE / SURREALDB_NS     - namespace (default: memory)
 *   SURREALDB_DATABASE  / SURREALDB_DB     - database  (default: stack)
 *   SURREALDB_USER / SURREALDB_PASS        - credentials (default: root/root)
 *   QDRANT_URL                             - Qdrant URL (default: http://localhost:6333)
 *   QDRANT_COLLECTION                      - collection (default: memories)
 *   QDRANT_VECTOR_SIZE                     - vector dim (default: 1536)
 *   OPENAI_API_KEY / EMBEDDING_MODEL       - enable + configure query/stored embeddings
 */

import { runServer } from '../dist/server.js';
import {
  resolveSurrealConfig,
  resolveQdrantConfig,
  resolveEmbeddingConfig,
} from '@memory-stack/core';

const config = {
  memoryService: {
    surrealdb: resolveSurrealConfig(),
    qdrant: resolveQdrantConfig(),
    embedding: resolveEmbeddingConfig(),
  },
};

runServer(config).catch((err) => {
  console.error('Memory Stack MCP Server failed:', err);
  process.exit(1);
});
