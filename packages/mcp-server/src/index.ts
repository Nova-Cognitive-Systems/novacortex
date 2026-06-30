/**
 * Memory Stack MCP Server
 *
 * Exports the MCP server for programmatic usage and provides
 * a CLI entry point for standalone operation.
 */

export { createMCPServer, runServer, type MCPServerConfig } from './server.js';
export { ToolHandler, type ToolDefinition, type ToolResult } from './tools.js';
export { SessionManager } from './session-manager.js';
export * from './schemas.js';

// Default export for direct execution
import { runServer } from './server.js';
import { resolveSurrealConfig, resolveQdrantConfig, resolveEmbeddingConfig } from '@memory-stack/core';

async function main(): Promise<void> {
  // Resolve config via the shared core helper so the MCP server and the REST API
  // ALWAYS read/write the same SurrealDB namespace/database and Qdrant collection.
  // Previously the MCP defaults (memory_stack/memories, collection "memory_vectors")
  // diverged from the API (memory/stack, collection "memories"), so memory stored
  // via one interface was invisible to the other.
  const config = {
    memoryService: {
      surrealdb: resolveSurrealConfig(),
      qdrant: resolveQdrantConfig(),
      embedding: resolveEmbeddingConfig(),
    },
  };

  await runServer(config);
}

// Run if executed directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ''))) {
  main().catch((err) => {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  });
}
