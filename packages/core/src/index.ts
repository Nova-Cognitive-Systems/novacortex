// Types
export * from './types/memory.js';

// Adapters
export { SurrealDBAdapter, type SurrealDBConfig } from './adapters/surrealdb.js';
export { QdrantAdapter, type QdrantConfig } from './adapters/qdrant.js';

// Services
export {
  MemoryService,
  type MemoryServiceConfig,
  type ServiceHealth,
} from './services/memory-service.js';
export {
  EmbeddingService,
  type EmbeddingServiceConfig,
} from './services/embedding-service.js';
export { LLMService, type LLMServiceConfig } from './services/llm-service.js';
export {
  IntelligenceService,
  type IngestOptions,
  type IngestResult,
  type ResolveOptions,
} from './services/intelligence-service.js';

// Connection management
export {
  ConnectionManager,
  ConnectionPool,
  ConnectionState,
  type ConnectionConfig,
  type ConnectionEvents,
} from './lib/connection-manager.js';

// PMF v1.1 codecs (binary MessagePack + AES-256-GCM encryption)
export {
  encodePmfBinary,
  decodePmfBinary,
  encryptPmf,
  decryptPmf,
  isEncryptedPmf,
} from './lib/pmf-codec.js';

// Centralized env → config resolution (shared by API, MCP server, tests)
export {
  CONFIG_DEFAULTS,
  resolveSurrealConfig,
  resolveQdrantConfig,
  resolveEmbeddingConfig,
  resolveLLMConfig,
} from './lib/env-config.js';
