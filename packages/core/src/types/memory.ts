/**
 * Memory Stack - Core Types
 *
 * DESIGN PRINCIPLES:
 * 1. Immutable memory objects (append-only)
 * 2. Versioning for all changes
 * 3. Temporal metadata for decay
 * 4. Graph relations as first-class citizens
 */

export interface MemoryId {
  readonly id: string;
  readonly namespace: string;
}

export interface MemoryCore {
  readonly id: MemoryId;
  readonly content: string;
  readonly contentHash: string;
  readonly memoryType: MemoryType;
  readonly createdAt: Date;
  readonly accessedAt: Date;
  readonly version: number;
  /**
   * Set when this memory stopped being the current truth (superseded by a newer
   * fact). Append-only semantics: the memory is never deleted or rewritten —
   * it is invalidated and stays queryable as history.
   */
  readonly invalidatedAt?: Date;
}

export enum MemoryType {
  EPISODIC = 'episodic',
  SEMANTIC = 'semantic',
  PROCEDURAL = 'procedural',
  WORKING = 'working',
}

export interface MemoryMetadata {
  readonly source: MemorySource;
  readonly confidence: number;
  readonly salience: number;
  readonly decayRate: number;
  readonly lastDecayCalculation: Date;
  readonly effectiveSalience: number;
  readonly tags: ReadonlyArray<string>;
  readonly entities: ReadonlyArray<Entity>;
  readonly signals: ReadonlyArray<Signal>;
}

export interface MemorySource {
  readonly type: 'conversation' | 'document' | 'api' | 'extraction';
  readonly sessionId?: string;
  readonly documentId?: string;
  readonly agentId?: string;
  readonly timestamp: Date;
}

export interface Entity {
  readonly name: string;
  readonly type: 'person' | 'organization' | 'location' | 'concept' | 'event';
  readonly confidence: number;
}

export interface Signal {
  readonly keyword: string;
  readonly weight: number;
  readonly extractedAt: Date;
}

export interface MemoryRelation {
  readonly id: string;
  readonly fromMemory: MemoryId;
  readonly toMemory: MemoryId;
  readonly relationType: RelationType;
  readonly strength: number;
  readonly bidirectional: boolean;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;
}

export enum RelationType {
  CAUSES = 'causes',
  CAUSED_BY = 'caused_by',
  RELATED_TO = 'related_to',
  CONTRADICTS = 'contradicts',
  SUPPORTS = 'supports',
  SUPERSEDES = 'supersedes',
  PART_OF = 'part_of',
  REFERENCES = 'references',
  TEMPORAL_BEFORE = 'temporal_before',
  TEMPORAL_AFTER = 'temporal_after',
  // Aliases / same-entity links (e.g. a product and its codename).
  SAME_AS = 'same_as',
}

export interface Memory extends MemoryCore {
  readonly metadata: MemoryMetadata;
  readonly embedding?: number[];
  readonly relations: ReadonlyArray<MemoryRelation>;
}

export interface PortableMemory {
  readonly formatVersion: '1.0';
  readonly exportedAt: Date;
  readonly memories: ReadonlyArray<Memory>;
  readonly relations: ReadonlyArray<MemoryRelation>;
  readonly checksum: string;
}

/**
 * PMF - Portable Memory Format v1.0
 *
 * NovaCortex's native format for complete memory graph portability.
 * Unlike JSON export, PMF preserves:
 * - Full graph topology with relation weights
 * - Embedding vectors for semantic continuity
 * - Namespace federation metadata
 * - Integrity verification via Merkle root
 *
 * RFC: https://novacortex.dev/rfc/pmf-001
 */
export interface PMFHeader {
  readonly magic: 'NCPMF';           // Magic bytes for format detection
  /** 1.1 adds the optional per-memory `invalidated` timestamp (append-only supersession). */
  readonly version: '1.0' | '1.1';
  readonly created: Date;
  readonly source: PMFSourceInfo;
  readonly integrity: PMFIntegrity;
}

export interface PMFSourceInfo {
  readonly namespace: string;
  readonly nodeId?: string;          // For federated exports
  readonly exportedBy?: string;      // Agent or user ID
  readonly description?: string;
}

export interface PMFIntegrity {
  readonly memoryCount: number;
  readonly relationCount: number;
  readonly embeddingDim: number;     // e.g. 1536 for OpenAI, 384 for MiniLM
  readonly merkleRoot: string;       // SHA-256 of sorted memory hashes
  readonly checksum: string;         // CRC32 of full payload
}

export interface PMFGraphMetadata {
  readonly nodes: number;
  readonly edges: number;
  readonly density: number;          // edges / (nodes * (nodes-1))
  readonly components: number;       // Number of disconnected subgraphs
  readonly avgDegree: number;        // Average relations per memory
  readonly hubNodes: string[];       // Top 5 most connected memory IDs
}

export interface PMFMemoryEntry {
  readonly id: string;
  readonly namespace: string;
  readonly content: string;
  readonly contentHash: string;
  readonly memoryType: MemoryType;
  readonly created: string;          // ISO 8601
  readonly accessed: string;         // ISO 8601
  readonly version: number;
  /** ISO 8601 — set when this fact was superseded (PMF v1.1, append-only history). */
  readonly invalidated?: string;
  readonly metadata: {
    readonly confidence: number;
    readonly salience: number;
    readonly decayRate: number;
    readonly effectiveSalience: number;
    readonly tags: ReadonlyArray<string>;
    readonly entities: ReadonlyArray<Entity>;
    readonly signals: ReadonlyArray<Signal>;
    readonly source: MemorySource;
  };
  readonly embedding?: number[];     // Optional, can be large
}

export interface PMFRelationEntry {
  readonly id: string;
  readonly from: string;             // Memory ID
  readonly fromNs: string;           // Namespace
  readonly to: string;               // Memory ID
  readonly toNs: string;             // Namespace
  readonly type: RelationType;
  readonly strength: number;
  readonly bidirectional: boolean;
  readonly metadata?: Record<string, unknown>;
  readonly created: string;          // ISO 8601
}

export interface PortableMemoryFormat {
  readonly header: PMFHeader;
  readonly graph: PMFGraphMetadata;
  readonly memories: ReadonlyArray<PMFMemoryEntry>;
  readonly relations: ReadonlyArray<PMFRelationEntry>;
}

// Input types for creating memories
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
  embedding?: number[];
}

export interface UpdateMemoryInput {
  content?: string;
  tags?: string[];
  entities?: Entity[];
  signals?: Signal[];
  salience?: number;
  /**
   * Decay-adjusted salience. Set by the background decay processor to persist
   * the time-decayed value WITHOUT resetting the base `salience`. When `salience`
   * is provided, it takes precedence and resets `effectiveSalience` to match.
   */
  effectiveSalience?: number;
  /** Timestamp of the last decay recalculation (set alongside effectiveSalience). */
  lastDecayCalculation?: Date;
  /**
   * Mark the memory as no longer current (append-only supersession) or clear
   * the mark with null. Set by the resolution engine when a newer memory
   * supersedes this one.
   */
  invalidatedAt?: Date | null;
}

export interface SearchOptions {
  query?: string;        // content substring search
  namespace?: string;
  memoryTypes?: MemoryType[];
  tags?: string[];
  limit?: number;
  offset?: number;
  minSalience?: number;
  includeRelations?: boolean;
  /** Only memories created at/after this instant (pushed down to the store). */
  createdAfter?: Date;
  /**
   * 0..1 blend of recency into the ranking score (0 = pure relevance, default).
   * Helps surface the *current* fact when older and newer memories are similarly
   * relevant (e.g. a value that changed over time).
   */
  recencyWeight?: number;
  /**
   * Include memories that were superseded/invalidated (default false: search
   * returns only CURRENT facts — the payoff of append-only resolution).
   */
  includeInvalidated?: boolean;
  /**
   * Point-in-time query: return the store as it was believed at this instant —
   * memories created at/before `asOf` and not yet invalidated at `asOf`.
   * Implies looking past later invalidations (independent of includeInvalidated).
   */
  asOf?: Date;
  /**
   * Cross-encoder reranking of the result page (needs a configured
   * RerankService). Defaults to ON when the service is configured; set false
   * to opt out per query. Applied only to text-query searches at offset 0.
   */
  rerank?: boolean;
  /**
   * LLM-free graph-aware boost: results that are hubs in the typed relation
   * graph rank slightly higher (log-scaled edge degree). Default off.
   */
  graphBoost?: boolean;
  /**
   * Deterministic temporal normalization of the text query ("yesterday",
   * "last week", "3 days ago" → createdAfter filter). Default off; explicit
   * createdAfter/asOf options always win.
   */
  parseTemporal?: boolean;
}

export interface VectorSearchOptions extends SearchOptions {
  vector: number[];
  scoreThreshold?: number;
}

export interface SearchResult {
  memory: Memory;
  score?: number;
}

// ---------------------------------------------------------------------------
// Intelligence layer (fact extraction + update resolution)
// ---------------------------------------------------------------------------

/** One conversation turn handed to the ingestion pipeline. */
export interface IngestMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** Optional speaker name (multi-party conversations). */
  name?: string;
  /** Optional ISO timestamp of the turn (improves temporal extraction). */
  timestamp?: string;
}

/** A discrete fact distilled from a conversation by the extraction step. */
export interface ExtractedFact {
  /** Self-contained statement, understandable without the conversation. */
  content: string;
  memoryType: MemoryType;
  tags: string[];
  entities: Entity[];
  /** 1..10 — how important this fact is to remember long-term. */
  salience: number;
  /** 0..1 — extraction confidence. */
  confidence: number;
}

/** What the resolution step decided about a (new memory, existing memory) pair. */
export type ResolutionDecision =
  | 'supersedes' // the new memory is the current version of the old fact
  | 'contradicts' // both claim to be true but conflict — flag, keep both
  | 'duplicates' // same fact, differently worded
  | 'related' // same topic, no conflict
  | 'none';

export interface ResolutionOutcome {
  memory: MemoryId;
  candidate: MemoryId;
  decision: ResolutionDecision;
  reason: string;
}
