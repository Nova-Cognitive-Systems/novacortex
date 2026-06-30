// ── Memory types ──────────────────────────────────────────────────────────────

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'working';
export type RelationType =
  | 'causes' | 'caused_by' | 'related_to' | 'contradicts'
  | 'supports' | 'supersedes' | 'part_of' | 'references'
  | 'temporal_before' | 'temporal_after';

export interface MemoryId { id: string; namespace: string }

export interface Memory {
  id: MemoryId;
  content: string;
  memoryType: MemoryType;
  metadata: {
    salience: number;
    effectiveSalience: number;
    tags: string[];
    entities: { name: string; type: string; confidence: number }[];
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
  updatedAt: string;
}

export interface MemoryListResponse {
  data: Memory[];
  count: number;
  total: number;
  page: number;
  limit: number;
}

export interface StatsResponse {
  total: number;
  byType: Record<string, number>;
  byNamespace: Record<string, number>;
  recentActivity?: { created: number; updated: number; accessed: number };
}

// ── Auth / tokens ──────────────────────────────────────────────────────────────

export interface WhoamiResponse {
  kind: 'selfhosted' | 'saas';
  name: string;
  scopes: string[];
  expiresAt?: string | null;
  server: {
    version: string;
    mode: 'selfhosted' | 'saas';
  };
}

export interface SetupExchangeResponse {
  token: string;
  whoami: WhoamiResponse;
}

export interface TokenSummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  agentId?: string;
  namespaceClaim?: string;
  createdAt: string;
  expiresAt?: string | null;
}

export interface CreateTokenRequest {
  template: 'admin-full' | 'admin-readonly' | 'agent' | 'knowledge-ingest';
  name: string;
  agentId?: string;
  namespaceClaim?: string;
}

export interface CreateTokenResponse {
  token: string;
  record: TokenSummary;
}
