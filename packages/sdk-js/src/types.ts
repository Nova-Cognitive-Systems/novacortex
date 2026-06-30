// Public types for the NovaCortex SDK. Kept standalone (no dependency on the
// server packages) so the SDK can be published and consumed independently.

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'working';

export type RelationType =
  | 'causes'
  | 'caused_by'
  | 'related_to'
  | 'contradicts'
  | 'supports'
  | 'supersedes'
  | 'part_of'
  | 'references'
  | 'temporal_before'
  | 'temporal_after';

export interface MemoryId {
  id: string;
  namespace: string;
}

export interface Entity {
  name: string;
  type: string;
  confidence: number;
}

export interface Memory {
  id: MemoryId;
  content: string;
  memoryType: MemoryType;
  metadata: {
    salience: number;
    effectiveSalience: number;
    tags: string[];
    entities: Entity[];
    confidence: number;
  };
  relations: {
    id: string;
    relationType: string;
    toMemory: MemoryId;
    strength: number;
  }[];
  version: number;
  createdAt: string;
  // Optional / not always present in API responses.
  updatedAt?: string;
  accessedAt?: string;
  contentHash?: string;
}

export interface SearchResult {
  memory: Memory;
  score?: number;
}

export interface CreateMemoryInput {
  content: string;
  memoryType: MemoryType;
  namespace?: string;
  tags?: string[];
  entities?: Entity[];
  confidence?: number;
  salience?: number;
  decayRate?: number;
  embedding?: number[];
}

export interface UpdateMemoryInput {
  content?: string;
  tags?: string[];
  entities?: Entity[];
  salience?: number;
}

export interface ListMemoriesOptions {
  namespace?: string;
  memoryTypes?: MemoryType[];
  tags?: string[];
  limit?: number;
  offset?: number;
  minSalience?: number;
  query?: string;
  includeRelations?: boolean;
}

export interface SearchOptions {
  namespace?: string;
  memoryTypes?: MemoryType[];
  tags?: string[];
  limit?: number;
  offset?: number;
  minSalience?: number;
  scoreThreshold?: number;
}

export interface ListResponse<T> {
  data: T[];
  count: number;
  total?: number;
  page?: number;
  limit?: number;
}

export interface SearchResponse {
  data: SearchResult[];
  count: number;
  /** Which path served the request: 'semantic' (query embedded), 'text', or 'vector'. */
  mode?: 'semantic' | 'text' | 'vector';
}

export interface CreateRelationInput {
  fromMemoryId: string;
  fromNamespace: string;
  toMemoryId: string;
  toNamespace: string;
  relationType: RelationType;
  strength?: number;
  bidirectional?: boolean;
  metadata?: Record<string, unknown>;
}

export interface NamespacesResponse {
  data: string[];
  count: number;
  limit?: number;
  remaining?: number;
  tier?: string;
}

export interface StatsResponse {
  total: number;
  byType: Record<string, number>;
  byNamespace: Record<string, number>;
  recentActivity?: { created: number; updated: number; accessed?: number };
}

export interface WhoamiResponse {
  kind: 'selfhosted' | 'saas';
  name: string;
  scopes: string[];
  expiresAt?: string | null;
  server: { version: string; mode: 'selfhosted' | 'saas' };
}

export interface ClientOptions {
  /** Base URL of the NovaCortex API, e.g. http://localhost:3001 */
  baseUrl: string;
  /** API token (Bearer). */
  token: string;
  /** Optional custom fetch implementation (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Optional default request timeout in ms. */
  timeoutMs?: number;
  /** Optional User-Agent. */
  userAgent?: string;
}
