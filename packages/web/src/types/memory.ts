export interface MemoryId {
  id: string;
  namespace: string;
}

export enum MemoryType {
  EPISODIC = "episodic",
  SEMANTIC = "semantic",
  PROCEDURAL = "procedural",
  WORKING = "working",
}

export interface Entity {
  name: string;
  type: "person" | "organization" | "location" | "concept" | "event";
  confidence: number;
}

export interface Signal {
  keyword: string;
  weight: number;
  extractedAt: string;
}

export interface MemorySource {
  type: "conversation" | "document" | "api" | "extraction";
  sessionId?: string;
  documentId?: string;
  agentId?: string;
  timestamp: string;
}

export interface MemoryMetadata {
  source: MemorySource;
  confidence: number;
  salience: number;
  decayRate: number;
  lastDecayCalculation: string;
  effectiveSalience: number;
  tags: string[];
  entities: Entity[];
  signals: Signal[];
}

export enum RelationType {
  CAUSES = "causes",
  CAUSED_BY = "caused_by",
  RELATED_TO = "related_to",
  CONTRADICTS = "contradicts",
  SUPPORTS = "supports",
  SUPERSEDES = "supersedes",
  PART_OF = "part_of",
  REFERENCES = "references",
  TEMPORAL_BEFORE = "temporal_before",
  TEMPORAL_AFTER = "temporal_after",
}

export interface MemoryRelation {
  id: string;
  fromMemory: MemoryId;
  toMemory: MemoryId;
  relationType: RelationType;
  strength: number;
  bidirectional: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Memory {
  id: MemoryId;
  content: string;
  contentHash: string;
  memoryType: MemoryType;
  createdAt: string;
  accessedAt: string;
  version: number;
  metadata: MemoryMetadata;
  embedding?: number[];
  relations: MemoryRelation[];
}

export interface CreateMemoryInput {
  content: string;
  memoryType: MemoryType;
  namespace?: string;
  tags?: string[];
  entities?: Entity[];
  signals?: Signal[];
  source?: Partial<MemorySource>;
  confidence?: number;
  salience?: number;
  decayRate?: number;
}

export interface UpdateMemoryInput {
  content?: string;
  tags?: string[];
  entities?: Entity[];
  signals?: Signal[];
  salience?: number;
}

export interface SearchOptions {
  namespace?: string;
  memoryTypes?: MemoryType[];
  tags?: string[];
  limit?: number;
  offset?: number;
  minSalience?: number;
  includeRelations?: boolean;
}

export interface SearchResult {
  memory: Memory;
  score?: number;
}

export interface MemoryStats {
  total: number;
  byType: Record<MemoryType, number>;
  byNamespace: Record<string, number>;
  recentActivity: {
    created: number;
    accessed: number;
    updated: number;
  };
}

export interface PortableMemory {
  formatVersion: "1.0";
  exportedAt: string;
  memories: Memory[];
  relations: MemoryRelation[];
  checksum: string;
}
