import type {
  Memory,
  MemoryId,
  MemoryRelation,
  RelationType,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchOptions,
  VectorSearchOptions,
  SearchResult,
  PortableMemory,
  PortableMemoryFormat,
  PMFMemoryEntry,
  PMFRelationEntry,
  PMFGraphMetadata,
} from '../types/memory.js';
import { SurrealDBAdapter, type SurrealDBConfig } from '../adapters/surrealdb.js';
import { QdrantAdapter, type QdrantConfig } from '../adapters/qdrant.js';
import { ConnectionManager, ConnectionState } from '../lib/connection-manager.js';
import { EmbeddingService, type EmbeddingServiceConfig } from './embedding-service.js';
import { createHash } from 'crypto';

export interface MemoryServiceConfig {
  surrealdb: SurrealDBConfig;
  qdrant: QdrantConfig;
  /** Maximum reconnection attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Health check interval in ms (default: 30000) */
  healthCheckIntervalMs?: number;
  /**
   * Optional embedding config. When provided (with an API key), text search via
   * `searchByText` will embed the query and run a true semantic vector search,
   * transparently falling back to substring search when embeddings are disabled.
   */
  embedding?: EmbeddingServiceConfig;
}

export interface ServiceHealth {
  connected: boolean;
  surrealdb: ConnectionState;
  qdrant: ConnectionState;
  lastHealthCheck: Date | null;
}

export class MemoryService {
  private surrealdb: SurrealDBAdapter;
  private qdrant: QdrantAdapter;
  private connected = false;
  private surrealdbManager: ConnectionManager;
  private qdrantManager: ConnectionManager;
  private lastHealthCheck: Date | null = null;
  private embeddingService: EmbeddingService;

  constructor(config: MemoryServiceConfig) {
    this.surrealdb = new SurrealDBAdapter(config.surrealdb);
    this.qdrant = new QdrantAdapter(config.qdrant);
    this.embeddingService = new EmbeddingService(config.embedding ?? {});

    // Setup connection manager for SurrealDB
    this.surrealdbManager = new ConnectionManager(
      {
        name: 'surrealdb',
        maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
        healthCheckIntervalMs: config.healthCheckIntervalMs ?? 30000,
      },
      {
        onConnected: () => console.log('[MemoryService] SurrealDB connected'),
        onDisconnected: () => console.log('[MemoryService] SurrealDB disconnected'),
        onReconnecting: (attempt, max) =>
          console.log(`[MemoryService] SurrealDB reconnecting (${attempt}/${max})`),
        onReconnectFailed: () =>
          console.error('[MemoryService] SurrealDB reconnection failed'),
      },
      {
        connect: () => this.surrealdb.connect(),
        disconnect: () => this.surrealdb.disconnect(),
        healthCheck: async () => {
          try {
            await this.surrealdb.countMemories();
            return true;
          } catch {
            return false;
          }
        },
      }
    );

    // Setup connection manager for Qdrant
    this.qdrantManager = new ConnectionManager(
      {
        name: 'qdrant',
        maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
        healthCheckIntervalMs: config.healthCheckIntervalMs ?? 30000,
      },
      {
        onConnected: () => console.log('[MemoryService] Qdrant connected'),
        onDisconnected: () => console.log('[MemoryService] Qdrant disconnected'),
        onReconnecting: (attempt, max) =>
          console.log(`[MemoryService] Qdrant reconnecting (${attempt}/${max})`),
        onReconnectFailed: () =>
          console.error('[MemoryService] Qdrant reconnection failed'),
      },
      {
        connect: () => this.qdrant.initialize(),
        disconnect: async () => { /* Qdrant client doesn't need explicit disconnect */ },
        healthCheck: async () => {
          try {
            await this.qdrant.getCollectionInfo();
            return true;
          } catch {
            return false;
          }
        },
      }
    );
  }

  /**
   * Get health status of the service and its connections
   */
  getHealth(): ServiceHealth {
    return {
      connected: this.connected,
      surrealdb: this.surrealdbManager.getState(),
      qdrant: this.qdrantManager.getState(),
      lastHealthCheck: this.lastHealthCheck,
    };
  }

  /**
   * Check if the service is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const [surrealOk, qdrantOk] = await Promise.all([
        this.surrealdb.countMemories().then(() => true).catch(() => false),
        this.qdrant.getCollectionInfo().then(() => true).catch(() => false),
      ]);
      this.lastHealthCheck = new Date();
      return surrealOk && qdrantOk;
    } catch {
      return false;
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const results = await Promise.allSettled([
      this.surrealdbManager.connect(),
      this.qdrantManager.connect(),
    ]);

    // Check for connection failures
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      const errors = failures.map((f) => (f as PromiseRejectedResult).reason);
      throw new Error(`Failed to connect to databases: ${errors.map(e => e.message).join(', ')}`);
    }

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await Promise.allSettled([
        this.surrealdbManager.disconnect(),
        this.qdrantManager.disconnect(),
      ]);
      this.connected = false;
    }
  }

  /**
   * Ensure connection is established before operations
   */
  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }

    // Check if connections are still healthy
    if (!this.surrealdbManager.isConnected()) {
      await this.surrealdbManager.connect();
    }
    if (!this.qdrantManager.isConnected()) {
      await this.qdrantManager.connect();
    }
  }

  async createMemory(input: CreateMemoryInput): Promise<Memory> {
    await this.ensureConnected();

    // Store in SurrealDB
    const memory = await this.surrealdb.create(input);

    // If embedding provided, store in Qdrant
    if (input.embedding && input.embedding.length > 0) {
      const memoryWithEmbedding: Memory = {
        ...memory,
        embedding: input.embedding,
      };
      await this.qdrant.upsert(memoryWithEmbedding);
    }

    return memory;
  }

  /** Exact-duplicate lookup by content (SHA-256 hash, per namespace). */
  async findByContent(content: string, namespace: string): Promise<Memory | null> {
    await this.ensureConnected();
    const hash = createHash('sha256').update(content).digest('hex');
    return this.surrealdb.findByHash(hash, namespace);
  }

  async getMemory(id: MemoryId, includeRelations = false): Promise<Memory | null> {
    await this.ensureConnected();

    const memory = await this.surrealdb.findById(id);
    if (!memory) return null;

    if (includeRelations) {
      return this.surrealdb.loadRelations(memory);
    }

    return memory;
  }

  /**
   * Store an embedding vector for an existing memory in Qdrant.
   */
  async hasEmbedding(id: MemoryId): Promise<boolean> {
    await this.ensureConnected();
    return this.qdrant.pointExists(id);
  }

  async storeEmbedding(id: MemoryId, embedding: number[]): Promise<boolean> {
    await this.ensureConnected();
    const memory = await this.surrealdb.findById(id);
    if (!memory) return false;

    const memoryWithEmbedding: Memory = { ...memory, embedding };
    await this.qdrant.upsert(memoryWithEmbedding);
    return true;
  }

  async updateMemory(id: MemoryId, input: UpdateMemoryInput): Promise<Memory | null> {
    await this.ensureConnected();

    const updated = await this.surrealdb.update(id, input);
    if (!updated) return null;

    // If memory has embedding, update in Qdrant
    if (updated.embedding && updated.embedding.length > 0) {
      await this.qdrant.upsert(updated);
    }

    return updated;
  }

  async deleteMemory(id: MemoryId): Promise<boolean> {
    await this.ensureConnected();

    // Delete from both stores tolerantly — a failed Qdrant delete must not throw
    // (it would otherwise leave the caller thinking the delete failed); we report
    // the SurrealDB result and log a possible orphan vector for later reconcile.
    const [surreal, qdrant] = await Promise.allSettled([
      this.surrealdb.delete(id),
      this.qdrant.delete(id),
    ]);
    if (qdrant.status === 'rejected') {
      console.warn(
        `[MemoryService] Qdrant delete failed for ${id.namespace}:${id.id} (orphan vector may remain):`,
        qdrant.reason
      );
    }
    return surreal.status === 'fulfilled' ? surreal.value : false;
  }

  async searchMemories(options: SearchOptions): Promise<Memory[]> {
    await this.ensureConnected();
    return this.surrealdb.search(options);
  }

  /** Total number of memories matching the filters (ignoring limit/offset). */
  async countMemories(options: SearchOptions = {}): Promise<number> {
    await this.ensureConnected();
    return this.surrealdb.countSearch(options);
  }

  /**
   * Page through ALL memories matching the options, so exports are never silently
   * capped (the previous single `limit: 100000` query dropped excess rows while
   * still passing integrity). Pagination is stable thanks to the `id` tiebreaker.
   */
  private async fetchAllForExport(options: SearchOptions): Promise<Memory[]> {
    const PAGE = 1000;
    const out: Memory[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const batch = await this.surrealdb.search({ ...options, limit: PAGE, offset });
      out.push(...batch);
      if (batch.length < PAGE) break;
    }
    return out;
  }

  /**
   * Differential export: memories created at/after `since` (for incremental
   * backups). The `since` filter is pushed down to the store; results newest-first.
   */
  async exportNamespaceDiff(
    namespace: string,
    since: Date
  ): Promise<{ namespace: string; since: string; count: number; memories: Memory[] }> {
    await this.ensureConnected();
    const all = await this.fetchAllForExport({ namespace, createdAfter: since });
    const memories = all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { namespace, since: since.toISOString(), count: memories.length, memories };
  }

  /** The shared embedding service (used to embed both stored memories and queries). */
  getEmbeddingService(): EmbeddingService {
    return this.embeddingService;
  }

  /**
   * Remove orphaned Qdrant vectors that have no backing SurrealDB memory
   * (drift from failed deletes). Read-time search already filters these out;
   * this reclaims storage. Returns how many points were checked and removed.
   */
  async reconcileVectors(maxPoints = 5000): Promise<{ checked: number; orphansRemoved: number }> {
    await this.ensureConnected();
    const points = await this.qdrant.scrollAll(maxPoints);
    const candidates = points.filter((p) => p.memoryId && p.namespace);

    // Resolve existence in chunks to avoid one huge SurrealDB query.
    const existingKeys = new Set<string>();
    const CHUNK = 200;
    for (let i = 0; i < candidates.length; i += CHUNK) {
      const ids = candidates.slice(i, i + CHUNK).map((p) => ({ id: p.memoryId, namespace: p.namespace }));
      const existing = await this.surrealdb.findByIds(ids);
      for (const m of existing) existingKeys.add(`${m.id.namespace}:${m.id.id}`);
    }

    const orphans = candidates
      .filter((p) => !existingKeys.has(`${p.namespace}:${p.memoryId}`))
      .map((p) => p.pointId);

    // Delete orphans in batches.
    for (let i = 0; i < orphans.length; i += CHUNK) {
      await this.qdrant.deletePoints(orphans.slice(i, i + CHUNK));
    }
    return { checked: points.length, orphansRemoved: orphans.length };
  }

  /**
   * Semantic text search: embeds the query and runs a vector search when
   * embeddings are enabled, otherwise transparently falls back to substring
   * search. This is the path the REST API, MCP server and CLI should use for a
   * plain text query so that the headline "semantic search" actually works
   * end-to-end without the caller needing to pre-compute an embedding vector.
   *
   * The returned `mode` tells callers which path was taken (useful for clients
   * that want to surface "semantic" vs "text" results).
   */
  async searchByText(
    query: string,
    options: Omit<VectorSearchOptions, 'vector'> = {}
  ): Promise<{ results: SearchResult[]; mode: 'semantic' | 'text' }> {
    await this.ensureConnected();

    if (this.embeddingService.isEnabled() && query.trim().length > 0) {
      const vector = await this.embeddingService.embed(query);
      if (vector) {
        const results = await this.vectorSearch({ ...options, vector });
        return { results, mode: 'semantic' };
      }
    }

    // Fallback: substring search via SurrealDB.
    const memories = await this.surrealdb.search({ ...options, query });
    return { results: memories.map((memory) => ({ memory })), mode: 'text' };
  }

  async vectorSearch(options: VectorSearchOptions): Promise<SearchResult[]> {
    await this.ensureConnected();

    const recencyWeight = options.recencyWeight && options.recencyWeight > 0 ? Math.min(1, options.recencyWeight) : 0;
    const limit = options.limit ?? 10;
    const offset = options.offset ?? 0;

    // With recency weighting, over-fetch a candidate pool from offset 0 so recency
    // can pull in items that pure relevance ranked just outside the page, then
    // re-rank and page in JS. Otherwise let Qdrant apply limit/offset directly.
    const qOptions: VectorSearchOptions = recencyWeight > 0
      ? { ...options, offset: 0, limit: Math.max((offset + limit) * 4, 20) }
      : options;
    const vectorResults = await this.qdrant.search(qOptions);

    if (vectorResults.length === 0) {
      return [];
    }

    // OPTIMIZATION: Batch fetch all memories in a single query instead of N+1
    const memoryIds = vectorResults.map(r => r.memory.id);
    const fullMemories = await this.surrealdb.findByIds(memoryIds);

    // Create lookup map for O(1) access
    const memoryMap = new Map(
      fullMemories.map(m => [`${m.id.namespace}:${m.id.id}`, m])
    );

    // Enrich with full data from SurrealDB, dropping orphaned vectors (Qdrant
    // points with no backing SurrealDB record). Previously these surfaced as
    // incomplete stub "memories" in search results; now stale drift is filtered.
    let enrichedResults: SearchResult[] = [];
    for (const result of vectorResults) {
      const key = `${result.memory.id.namespace}:${result.memory.id.id}`;
      const full = memoryMap.get(key);
      if (!full) continue; // orphaned vector — skip
      enrichedResults.push({ memory: full, score: result.score });
    }

    // Optional recency weighting: blend an ABSOLUTE recency score (exponential
    // decay, 30-day half-life — stable across requests/pages) with the relevance
    // score (clamped to 0..1) and re-rank, then page in JS. This lets the current
    // fact outrank an older, equally-similar one without breaking pagination.
    if (recencyWeight > 0) {
      const now = Date.now();
      const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
      for (const r of enrichedResults) {
        const ageMs = Math.max(0, now - r.memory.createdAt.getTime());
        const recency = Math.pow(0.5, ageMs / HALF_LIFE_MS);
        const relevance = Math.max(0, Math.min(1, r.score ?? 0));
        r.score = relevance * (1 - recencyWeight) + recency * recencyWeight;
      }
      enrichedResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      enrichedResults = enrichedResults.slice(offset, offset + limit);
    }

    // Optional relation hydration so callers can detect conflicts/supersessions
    // on the returned results (e.g. a contradicts/supersedes edge). Parallelized
    // to avoid an N+1 of serial round-trips.
    if (options.includeRelations) {
      const rels = await Promise.all(enrichedResults.map((r) => this.getRelations(r.memory.id)));
      enrichedResults.forEach((r, i) => {
        r.memory = { ...r.memory, relations: rels[i]! };
      });
    }

    return enrichedResults;
  }

  async hybridSearch(
    query: string,
    vector: number[],
    options: Omit<VectorSearchOptions, 'vector'> = {}
  ): Promise<SearchResult[]> {
    await this.ensureConnected();

    // Get vector search results
    const vectorResults = await this.qdrant.search({
      ...options,
      vector,
      limit: (options.limit ?? 10) * 2, // Get more for fusion
    });

    // Get text search results from SurrealDB. The query MUST be forwarded here:
    // without it the "text leg" degenerates into a top-effective-salience browse
    // and the fusion silently stops being hybrid.
    const textResults = await this.surrealdb.search({
      ...options,
      query,
      limit: (options.limit ?? 10) * 2,
    });

    // Simple rank fusion
    const scoreMap = new Map<string, { memory: Memory; score: number }>();

    // Add vector results with their scores
    for (const result of vectorResults) {
      const key = `${result.memory.id.namespace}:${result.memory.id.id}`;
      scoreMap.set(key, {
        memory: result.memory,
        score: (result.score ?? 0) * 0.7, // Vector weight
      });
    }

    // Add/merge text results
    for (let i = 0; i < textResults.length; i++) {
      const memory = textResults[i]!;
      const key = `${memory.id.namespace}:${memory.id.id}`;
      const textScore = 1 - i / textResults.length; // Rank-based score

      const existing = scoreMap.get(key);
      if (existing) {
        existing.score += textScore * 0.3; // Text weight
        existing.memory = memory; // Use full memory from SurrealDB
      } else {
        scoreMap.set(key, {
          memory,
          score: textScore * 0.3,
        });
      }
    }

    // Sort by combined score and limit
    const results = Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit ?? 10);

    return results;
  }

  async createRelation(
    fromMemory: MemoryId,
    toMemory: MemoryId,
    relationType: RelationType,
    strength = 1.0,
    bidirectional = false,
    metadata: Record<string, unknown> = {}
  ): Promise<MemoryRelation> {
    await this.ensureConnected();
    return this.surrealdb.createRelation(
      fromMemory,
      toMemory,
      relationType,
      strength,
      bidirectional,
      metadata
    );
  }

  async getRelations(memoryId: MemoryId): Promise<MemoryRelation[]> {
    await this.ensureConnected();
    return this.surrealdb.findRelations(memoryId);
  }

  async deleteRelation(relationId: string): Promise<boolean> {
    await this.ensureConnected();
    return this.surrealdb.deleteRelation(relationId);
  }

  async findSimilar(
    memoryId: MemoryId,
    limit = 10,
    namespace?: string
  ): Promise<SearchResult[]> {
    await this.ensureConnected();

    const results = await this.qdrant.searchSimilar(memoryId, limit, namespace);

    if (results.length === 0) {
      return [];
    }

    // OPTIMIZATION: Batch fetch all memories in a single query instead of N+1
    const memoryIds = results.map(r => r.memory.id);
    const fullMemories = await this.surrealdb.findByIds(memoryIds);

    // Create lookup map for O(1) access
    const memoryMap = new Map(
      fullMemories.map(m => [`${m.id.namespace}:${m.id.id}`, m])
    );

    // Enrich with full data from SurrealDB
    const enrichedResults = results.map((result) => {
      const key = `${result.memory.id.namespace}:${result.memory.id.id}`;
      return {
        memory: memoryMap.get(key) || result.memory,
        score: result.score,
      };
    });

    return enrichedResults;
  }

  async exportNamespace(namespace: string): Promise<PortableMemory> {
    await this.ensureConnected();

    const memories = await this.fetchAllForExport({ namespace, includeRelations: true });

    // Collect all relations
    const relationSet = new Map<string, MemoryRelation>();
    for (const memory of memories) {
      for (const relation of memory.relations) {
        relationSet.set(relation.id, relation);
      }
    }

    const relations = Array.from(relationSet.values());

    // Create checksum
    const checksum = this.createExportChecksum(memories, relations);

    return {
      formatVersion: '1.0',
      exportedAt: new Date(),
      memories,
      relations,
      checksum,
    };
  }

  async importMemories(portable: PortableMemory): Promise<{
    imported: number;
    skipped: number;
    errors: string[];
  }> {
    await this.ensureConnected();

    // Verify checksum
    const expectedChecksum = this.createExportChecksum(
      portable.memories as Memory[],
      portable.relations as MemoryRelation[]
    );

    if (expectedChecksum !== portable.checksum) {
      return {
        imported: 0,
        skipped: 0,
        errors: ['Checksum mismatch - data may be corrupted'],
      };
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Import memories
    for (const memory of portable.memories) {
      try {
        const existing = await this.surrealdb.findById(memory.id);
        if (existing) {
          skipped++;
          continue;
        }

        await this.createMemory({
          content: memory.content,
          memoryType: memory.memoryType,
          namespace: memory.id.namespace,
          tags: [...memory.metadata.tags],
          entities: [...memory.metadata.entities],
          signals: [...memory.metadata.signals],
          source: { ...memory.metadata.source },
          confidence: memory.metadata.confidence,
          salience: memory.metadata.salience,
          decayRate: memory.metadata.decayRate,
          embedding: memory.embedding ? [...memory.embedding] : undefined,
        });

        imported++;
      } catch (error) {
        errors.push(`Failed to import memory ${memory.id.id}: ${error}`);
      }
    }

    // Import relations
    for (const relation of portable.relations) {
      try {
        await this.createRelation(
          relation.fromMemory,
          relation.toMemory,
          relation.relationType,
          relation.strength,
          relation.bidirectional,
          { ...relation.metadata }
        );
      } catch (error) {
        errors.push(`Failed to import relation ${relation.id}: ${error}`);
      }
    }

    return { imported, skipped, errors };
  }

  async getStats(namespace?: string): Promise<{
    totalMemories: number;
    totalVectors: number;
    namespaces: string[];
  }> {
    await this.ensureConnected();

    const [memoryCount, vectorInfo, namespaces] = await Promise.all([
      this.surrealdb.countMemories(namespace),
      this.qdrant.getCollectionInfo(),
      this.surrealdb.listNamespaces(),
    ]);

    return {
      totalMemories: memoryCount,
      totalVectors: vectorInfo.pointsCount,
      namespaces,
    };
  }

  private createExportChecksum(
    memories: readonly Memory[],
    relations: readonly MemoryRelation[]
  ): string {
    const data = JSON.stringify({
      memoryIds: memories.map((m) => m.id.id).sort(),
      relationIds: relations.map((r) => r.id).sort(),
      memoryCount: memories.length,
      relationCount: relations.length,
    });

    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Canonical, encoding-independent PMF checksum input. Built from stable string
   * fields so it survives a binary (MessagePack) round-trip — JSON.stringify of the
   * full objects does not (key/format differences). Covers content hash, type,
   * the salient metadata, the embedding (by hash), and relation attributes, so
   * corruption of any of these is detected (not just identity, as in v1.1.0).
   */
  private pmfChecksumPayload(
    memories: ReadonlyArray<PMFMemoryEntry>,
    relations: ReadonlyArray<PMFRelationEntry>
  ): string {
    return JSON.stringify({
      memories: memories
        .map((m) => {
          const md = m.metadata;
          const meta = md
            ? `${md.confidence},${md.salience},${md.decayRate},${[...md.tags].sort().join(',')}`
            : '';
          const emb = m.embedding && m.embedding.length > 0
            ? createHash('sha256').update(JSON.stringify(m.embedding)).digest('hex')
            : '';
          return `${m.contentHash}|${m.memoryType}|${meta}|${emb}`;
        })
        .sort(),
      relations: relations
        .map((r) => `${r.fromNs}:${r.from}->${r.toNs}:${r.to}:${r.type}:${r.strength}:${r.bidirectional}`)
        .sort(),
    });
  }

  /** The v1.1.0 (narrow, identity-only) checksum payload — kept for import compat. */
  private pmfChecksumPayloadV110(
    memories: ReadonlyArray<{ contentHash: string }>,
    relations: ReadonlyArray<{ from: string; fromNs: string; to: string; toNs: string; type: string }>
  ): string {
    return JSON.stringify({
      memories: memories.map((m) => m.contentHash).sort(),
      relations: relations.map((r) => `${r.fromNs}:${r.from}->${r.toNs}:${r.to}:${r.type}`).sort(),
    });
  }

  /**
   * Export namespace in PMF (Portable Memory Format)
   * Includes full graph metadata, embeddings, and Merkle integrity
   */
  async exportNamespacePMF(
    namespace: string,
    options: { includeEmbeddings?: boolean; nodeId?: string; exportedBy?: string } = {}
  ): Promise<PortableMemoryFormat> {
    await this.ensureConnected();

    const memories = await this.fetchAllForExport({ namespace, includeRelations: true });

    // Collect relations
    const relationSet = new Map<string, MemoryRelation>();
    for (const memory of memories) {
      for (const relation of memory.relations) {
        relationSet.set(relation.id, relation);
      }
    }
    const relations = Array.from(relationSet.values());

    // Convert to PMF entries
    const pmfMemories: PMFMemoryEntry[] = memories.map((m) => ({
      id: m.id.id,
      namespace: m.id.namespace,
      content: m.content,
      contentHash: m.contentHash,
      memoryType: m.memoryType,
      created: m.createdAt.toISOString(),
      accessed: m.accessedAt.toISOString(),
      version: m.version,
      metadata: {
        confidence: m.metadata.confidence,
        salience: m.metadata.salience,
        decayRate: m.metadata.decayRate,
        effectiveSalience: m.metadata.effectiveSalience,
        tags: m.metadata.tags,
        entities: m.metadata.entities,
        signals: m.metadata.signals,
        source: m.metadata.source,
      },
      embedding: options.includeEmbeddings ? m.embedding : undefined,
    }));

    const pmfRelations: PMFRelationEntry[] = relations.map((r) => ({
      id: r.id,
      from: r.fromMemory.id,
      fromNs: r.fromMemory.namespace,
      to: r.toMemory.id,
      toNs: r.toMemory.namespace,
      type: r.relationType,
      strength: r.strength,
      bidirectional: r.bidirectional,
      metadata: r.metadata,
      created: r.createdAt.toISOString(),
    }));

    // Calculate graph metadata
    const graph = this.calculateGraphMetadata(pmfMemories, pmfRelations);

    // Create Merkle root from sorted content hashes
    const sortedHashes = pmfMemories.map((m) => m.contentHash).sort();
    const merkleRoot = createHash('sha256')
      .update(sortedHashes.join(''))
      .digest('hex');

    // Create full payload checksum (canonical, binary-round-trip-safe)
    const payload = this.pmfChecksumPayload(pmfMemories, pmfRelations);
    const checksum = this.crc32(payload).toString(16).padStart(8, '0');

    // Detect embedding dimension
    const embeddingDim = pmfMemories.find((m) => m.embedding)?.embedding?.length ?? 0;

    return {
      header: {
        magic: 'NCPMF',
        version: '1.0',
        created: new Date(),
        source: {
          namespace,
          nodeId: options.nodeId,
          exportedBy: options.exportedBy,
        },
        integrity: {
          memoryCount: pmfMemories.length,
          relationCount: pmfRelations.length,
          embeddingDim,
          merkleRoot,
          checksum,
        },
      },
      graph,
      memories: pmfMemories,
      relations: pmfRelations,
    };
  }

  /**
   * Import from PMF format with integrity verification
   */
  async importFromPMF(
    pmf: PortableMemoryFormat,
    options: { targetNamespace?: string } = {}
  ): Promise<{
    imported: number;
    skipped: number;
    relationsImported: number;
    errors: string[];
    importedIds: MemoryId[];
  }> {
    await this.ensureConnected();

    // Verify magic
    if (pmf.header.magic !== 'NCPMF') {
      return { imported: 0, skipped: 0, relationsImported: 0, importedIds: [], errors: ['Invalid PMF format: magic mismatch'] };
    }

    // Verify Merkle root
    const sortedHashes = pmf.memories.map((m) => m.contentHash).sort();
    const expectedMerkle = createHash('sha256')
      .update(sortedHashes.join(''))
      .digest('hex');

    if (expectedMerkle !== pmf.header.integrity.merkleRoot) {
      return { imported: 0, skipped: 0, relationsImported: 0, importedIds: [], errors: ['Integrity check failed: Merkle root mismatch'] };
    }

    // Verify checksum. Accept the current canonical checksum, the v1.1.0 narrow
    // canonical one, or the v1.0.x JSON.stringify one — all for backward compat.
    const crc = (s: string) => this.crc32(s).toString(16).padStart(8, '0');
    const candidates = [
      crc(this.pmfChecksumPayload(pmf.memories, pmf.relations)),
      crc(this.pmfChecksumPayloadV110(pmf.memories, pmf.relations)),
      crc(JSON.stringify({ memories: pmf.memories, relations: pmf.relations })),
    ];
    if (!candidates.includes(pmf.header.integrity.checksum)) {
      return { imported: 0, skipped: 0, relationsImported: 0, importedIds: [], errors: ['Integrity check failed: checksum mismatch'] };
    }

    // Bind each memory's content to its declared contentHash. Without this, the
    // Merkle root / checksum are computed over the SELF-REPORTED contentHash, so
    // tampered or corrupted content with an intact hash would import silently
    // (and createMemory re-hashes content, discarding the declared hash). Reject
    // any entry whose content does not hash to its declared contentHash.
    for (const entry of pmf.memories) {
      const actual = createHash('sha256').update(entry.content).digest('hex');
      if (actual !== entry.contentHash) {
        return {
          imported: 0,
          skipped: 0,
          relationsImported: 0,
          importedIds: [],
          errors: [`Integrity check failed: content hash mismatch for memory ${entry.id}`],
        };
      }
    }

    let imported = 0;
    let skipped = 0;
    let relationsImported = 0;
    const errors: string[] = [];
    const importedIds: MemoryId[] = [];

    // Map each source (namespace:id) to the resulting memory id so relations can be
    // re-pointed after import (createMemory assigns fresh ids). Supports importing
    // into a different target namespace without breaking the graph.
    const idMap = new Map<string, MemoryId>();
    const key = (ns: string, id: string) => `${ns}:${id}`;

    // Import memories
    for (const entry of pmf.memories) {
      const targetNs = options.targetNamespace ?? entry.namespace;
      try {
        // Skip only when importing back into the same namespace and the row exists;
        // still map it so relations link to the existing memory.
        if (!options.targetNamespace) {
          const existing = await this.surrealdb.findById({ id: entry.id, namespace: entry.namespace });
          if (existing) {
            idMap.set(key(entry.namespace, entry.id), existing.id);
            skipped++;
            continue;
          }
        }

        const created = await this.createMemory({
          content: entry.content,
          memoryType: entry.memoryType,
          namespace: targetNs,
          tags: [...entry.metadata.tags],
          entities: [...entry.metadata.entities],
          signals: [...entry.metadata.signals],
          source: { ...entry.metadata.source },
          confidence: entry.metadata.confidence,
          salience: entry.metadata.salience,
          decayRate: entry.metadata.decayRate,
          embedding: entry.embedding ? [...entry.embedding] : undefined,
        });

        idMap.set(key(entry.namespace, entry.id), created.id);
        importedIds.push(created.id);
        imported++;
      } catch (error) {
        errors.push(`Failed to import memory ${entry.id}: ${error}`);
      }
    }

    // Import relations, re-pointing endpoints through the id map.
    for (const rel of pmf.relations) {
      const from = idMap.get(key(rel.fromNs, rel.from));
      const to = idMap.get(key(rel.toNs, rel.to));
      if (!from || !to) {
        errors.push(`Skipped relation ${rel.id}: endpoint not found in import set`);
        continue;
      }
      try {
        await this.createRelation(from, to, rel.type, rel.strength, rel.bidirectional, rel.metadata ?? {});
        relationsImported++;
      } catch (error) {
        errors.push(`Failed to import relation ${rel.id}: ${error}`);
      }
    }

    return { imported, skipped, relationsImported, errors, importedIds };
  }

  private calculateGraphMetadata(
    memories: PMFMemoryEntry[],
    relations: PMFRelationEntry[]
  ): PMFGraphMetadata {
    const nodes = memories.length;
    const edges = relations.length;

    // Calculate degree per node
    const degreeMap = new Map<string, number>();
    for (const rel of relations) {
      degreeMap.set(rel.from, (degreeMap.get(rel.from) ?? 0) + 1);
      degreeMap.set(rel.to, (degreeMap.get(rel.to) ?? 0) + 1);
    }

    const degrees = Array.from(degreeMap.values());
    const avgDegree = degrees.length > 0
      ? degrees.reduce((a, b) => a + b, 0) / degrees.length
      : 0;

    // Find hub nodes (top 5 by degree)
    const sortedByDegree = Array.from(degreeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

    // Simple component count via union-find
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      if (!parent.has(x)) parent.set(x, x);
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
      return parent.get(x)!;
    };
    const union = (a: string, b: string) => {
      parent.set(find(a), find(b));
    };

    for (const m of memories) {
      find(m.id);
    }
    for (const r of relations) {
      union(r.from, r.to);
    }

    const roots = new Set<string>();
    for (const m of memories) {
      roots.add(find(m.id));
    }

    // Graph density
    const maxEdges = nodes * (nodes - 1);
    const density = maxEdges > 0 ? edges / maxEdges : 0;

    return {
      nodes,
      edges,
      density,
      components: roots.size,
      avgDegree,
      hubNodes: sortedByDegree,
    };
  }

  private crc32(str: string): number {
    const table = this.getCrc32Table();
    let crc = 0xFFFFFFFF;

    for (let i = 0; i < str.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ str.charCodeAt(i)) & 0xFF]!;
    }

    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  private crc32Table: number[] | null = null;
  private getCrc32Table(): number[] {
    if (this.crc32Table) return this.crc32Table;

    const table: number[] = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c;
    }

    this.crc32Table = table;
    return table;
  }
}
