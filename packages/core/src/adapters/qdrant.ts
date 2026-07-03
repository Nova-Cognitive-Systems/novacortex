import { QdrantClient } from '@qdrant/js-client-rest';
import crypto from 'crypto';
import type {
  Memory,
  MemoryId,
  MemoryType,
  VectorSearchOptions,
  SearchResult,
} from '../types/memory.js';
import { buildSparseVector, type SparseVector } from '../lib/sparse-text.js';

/** Named sparse vector carrying the lexical (BM25-style) signal. */
const SPARSE_NAME = 'text';

export interface QdrantConfig {
  url: string;
  apiKey?: string;
  collectionName?: string;
  vectorSize?: number;
}

interface PointPayload {
  memoryId: string;
  namespace: string;
  content: string;
  memoryType: string;
  tags: string[];
  salience: number;
  createdAt: string;
  /** Mirror of the append-only supersession marker (filtered out by default). */
  invalidated?: boolean;
  invalidatedAt?: string | null;
  [key: string]: unknown;
}

export class QdrantAdapter {
  private client: QdrantClient;
  private collectionName: string;
  private vectorSize: number;
  private initialized = false;
  /**
   * Whether the collection carries the named sparse "text" vector enabling
   * server-side hybrid (dense + BM25) RRF fusion. New collections get it
   * automatically; Qdrant cannot add sparse vectors to an existing collection,
   * so pre-existing deployments run migrateToSparse() once.
   */
  private sparseEnabled = false;

  constructor(config: QdrantConfig) {
    this.client = new QdrantClient({
      url: config.url,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      // The npm client tracks a newer minor than the pinned server image; the
      // REST API we use is stable across these, so skip the noisy (and
      // sometimes startup-failing) version handshake.
      checkCompatibility: false,
    });
    this.collectionName = config.collectionName || 'memories';
    this.vectorSize = config.vectorSize || 1536; // OpenAI ada-002 default
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(
        (c) => c.name === this.collectionName
      );

      if (!exists) {
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: this.vectorSize,
            distance: 'Cosine',
          },
          // Lexical leg for hybrid search: BM25-style TF client-side, IDF
          // applied server-side per deployment corpus.
          sparse_vectors: {
            [SPARSE_NAME]: { modifier: 'idf' },
          },
          optimizers_config: {
            default_segment_number: 2,
          },
          replication_factor: 1,
        });

        // Create payload indexes
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'namespace',
          field_schema: 'keyword',
        });

        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'memoryType',
          field_schema: 'keyword',
        });

        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'tags',
          field_schema: 'keyword',
        });

        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'salience',
          field_schema: 'float',
        });
      }

      // Idempotent, runs for PRE-EXISTING collections too (the field was added
      // after v1.2): index the invalidation flag used by the default filter.
      await this.client
        .createPayloadIndex(this.collectionName, {
          field_name: 'invalidated',
          field_schema: 'bool',
        })
        .catch(() => {}); // already exists — fine

      // Detect whether this collection supports the sparse hybrid leg (created
      // fresh with it, or migrated). Pre-existing collections without it keep
      // working dense-only.
      try {
        const info = await this.client.getCollection(this.collectionName);
        const sparse = (info.config?.params as { sparse_vectors?: Record<string, unknown> } | undefined)
          ?.sparse_vectors;
        this.sparseEnabled = !!sparse && SPARSE_NAME in sparse;
      } catch {
        this.sparseEnabled = false;
      }

      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize Qdrant: ${error}`);
    }
  }

  async upsert(memory: Memory): Promise<void> {
    await this.initialize();

    if (!memory.embedding || memory.embedding.length === 0) {
      throw new Error('Memory must have an embedding for vector storage');
    }

    const pointId = this.memoryIdToPointId(memory.id);
    const payload: PointPayload = {
      memoryId: memory.id.id,
      namespace: memory.id.namespace,
      content: memory.content,
      memoryType: memory.memoryType,
      tags: [...memory.metadata.tags],
      salience: memory.metadata.effectiveSalience,
      createdAt: memory.createdAt.toISOString(),
      invalidated: !!memory.invalidatedAt,
      invalidatedAt: memory.invalidatedAt ? memory.invalidatedAt.toISOString() : null,
    };

    await this.client.upsert(this.collectionName, {
      wait: true,
      points: [
        {
          id: pointId,
          vector: this.buildPointVector(memory.embedding, memory.content),
          payload: payload as Record<string, unknown>,
        },
      ],
    });
  }

  /**
   * Point vector: plain dense when the collection has no sparse config,
   * otherwise named dense ('') + sparse lexical leg computed from the content.
   */
  private buildPointVector(
    embedding: number[],
    content: string
  ): number[] | Record<string, number[] | SparseVector> {
    if (!this.sparseEnabled) return embedding;
    const sparse = buildSparseVector(content);
    return sparse ? { '': embedding, [SPARSE_NAME]: sparse } : { '': embedding };
  }

  async upsertBatch(memories: Memory[]): Promise<void> {
    await this.initialize();

    const memoriesWithEmbeddings = memories.filter(
      (m) => m.embedding && m.embedding.length > 0
    );

    if (memoriesWithEmbeddings.length === 0) {
      return;
    }

    const points = memoriesWithEmbeddings.map((memory) => {
      const payload: PointPayload = {
        memoryId: memory.id.id,
        namespace: memory.id.namespace,
        content: memory.content,
        memoryType: memory.memoryType,
        tags: [...memory.metadata.tags],
        salience: memory.metadata.effectiveSalience,
        createdAt: memory.createdAt.toISOString(),
        invalidated: !!memory.invalidatedAt,
        invalidatedAt: memory.invalidatedAt ? memory.invalidatedAt.toISOString() : null,
      };
      return {
        id: this.memoryIdToPointId(memory.id),
        vector: this.buildPointVector(memory.embedding!, memory.content),
        payload: payload as Record<string, unknown>,
      };
    });

    // Batch in chunks of 100
    const chunkSize = 100;
    for (let i = 0; i < points.length; i += chunkSize) {
      const chunk = points.slice(i, i + chunkSize);
      await this.client.upsert(this.collectionName, {
        wait: true,
        points: chunk,
      });
    }
  }

  async delete(memoryId: MemoryId): Promise<boolean> {
    await this.initialize();

    const pointId = this.memoryIdToPointId(memoryId);

    try {
      await this.client.delete(this.collectionName, {
        wait: true,
        points: [pointId],
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Shared payload filter for search/hybrid queries. Undefined = no filter. */
  private buildFilter(
    options: Pick<
      VectorSearchOptions,
      'namespace' | 'memoryTypes' | 'tags' | 'minSalience' | 'includeInvalidated' | 'asOf'
    >
  ): Record<string, unknown> | undefined {
    const must: Array<Record<string, unknown>> = [];

    if (options.namespace) {
      must.push({ key: 'namespace', match: { value: options.namespace } });
    }
    if (options.memoryTypes && options.memoryTypes.length > 0) {
      must.push({ key: 'memoryType', match: { any: options.memoryTypes } });
    }
    if (options.tags && options.tags.length > 0) {
      must.push({ key: 'tags', match: { any: options.tags } });
    }
    if (options.minSalience !== undefined) {
      must.push({ key: 'salience', range: { gte: options.minSalience } });
    }

    const filter: Record<string, unknown> = {};
    if (must.length > 0) filter['must'] = must;

    // Default: exclude invalidated (superseded) facts at the index level. Points
    // written before this flag existed simply lack the field and pass must_not;
    // MemoryService applies a second, SurrealDB-truth filter after enrichment.
    // asOf queries need past facts, so they skip the index filter entirely and
    // rely on the post-enrichment time-window filter.
    if (!options.includeInvalidated && !options.asOf) {
      filter['must_not'] = [{ key: 'invalidated', match: { value: true } }];
    }

    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  async search(options: VectorSearchOptions): Promise<SearchResult[]> {
    await this.initialize();

    const searchResult = await this.client.search(this.collectionName, {
      vector: options.vector,
      limit: options.limit ?? 10,
      offset: options.offset ?? 0,
      filter: this.buildFilter(options),
      score_threshold: options.scoreThreshold,
      with_payload: true,
    });

    return searchResult.map((result) => {
      const payload = result.payload as unknown as PointPayload;
      return {
        memory: this.payloadToPartialMemory(payload),
        score: result.score,
      };
    });
  }

  /** Whether the collection supports the sparse lexical leg (hybrid search). */
  isSparseEnabled(): boolean {
    return this.sparseEnabled;
  }

  /**
   * Hybrid retrieval: dense (semantic) + sparse (BM25-style lexical) legs fused
   * server-side with Reciprocal Rank Fusion. Falls back to plain dense search
   * when the collection has no sparse config or the query has no indexable
   * tokens. RRF scores are rank-based (~0..1), not cosine similarities.
   */
  async hybridSearch(
    queryText: string,
    options: VectorSearchOptions
  ): Promise<{ results: SearchResult[]; hybrid: boolean }> {
    await this.initialize();

    const sparse = this.sparseEnabled ? buildSparseVector(queryText) : null;
    if (!sparse) {
      return { results: await this.search(options), hybrid: false };
    }

    const filter = this.buildFilter(options);
    const limit = options.limit ?? 10;
    const offset = options.offset ?? 0;
    // Each leg over-fetches so fusion sees candidates beyond the final page.
    const prefetchLimit = Math.max((offset + limit) * 3, 20);

    const response = await this.client.query(this.collectionName, {
      prefetch: [
        { query: options.vector, limit: prefetchLimit, filter },
        { query: sparse, using: SPARSE_NAME, limit: prefetchLimit, filter },
      ],
      query: { fusion: 'rrf' },
      limit,
      offset,
      with_payload: true,
    });

    return {
      hybrid: true,
      results: response.points.map((result) => {
        const payload = result.payload as unknown as PointPayload;
        return {
          memory: this.payloadToPartialMemory(payload),
          score: result.score,
        };
      }),
    };
  }

  /**
   * One-time migration for collections created before hybrid search: Qdrant
   * cannot add sparse vectors in place, so stream-copy every point through a
   * temp collection into a recreated collection that has the sparse config,
   * computing the lexical leg from each point's stored content. Constant
   * memory (batched scroll), idempotent (no-op when already sparse-enabled).
   */
  async migrateToSparse(): Promise<{ migrated: number; alreadyHybrid: boolean }> {
    await this.initialize();
    if (this.sparseEnabled) return { migrated: 0, alreadyHybrid: true };

    const tmpName = `${this.collectionName}_hybrid_migration`;
    const collectionConfig = {
      vectors: { size: this.vectorSize, distance: 'Cosine' as const },
      sparse_vectors: { [SPARSE_NAME]: { modifier: 'idf' as const } },
      optimizers_config: { default_segment_number: 2 },
      replication_factor: 1,
    };

    const copy = async (from: string, to: string): Promise<number> => {
      let copied = 0;
      let offset: string | number | Record<string, unknown> | null | undefined = undefined;
      for (;;) {
        const res = await this.client.scroll(from, {
          limit: 128,
          offset: offset ?? undefined,
          with_payload: true,
          with_vector: true,
        });
        if (res.points.length > 0) {
          await this.client.upsert(to, {
            wait: true,
            points: res.points.map((p) => {
              const payload = (p.payload ?? {}) as { content?: string };
              const dense = Array.isArray(p.vector)
                ? (p.vector as number[])
                : ((p.vector as Record<string, unknown>)?.[''] as number[]);
              const sparse = payload.content ? buildSparseVector(payload.content) : null;
              return {
                id: p.id,
                vector: sparse ? { '': dense, [SPARSE_NAME]: sparse } : { '': dense },
                payload: p.payload as Record<string, unknown>,
              };
            }),
          });
          copied += res.points.length;
        }
        if (!res.next_page_offset) break;
        offset = res.next_page_offset as string | number;
      }
      return copied;
    };

    // Phase 1: copy old -> tmp (tmp already has the sparse config).
    await this.client.deleteCollection(tmpName).catch(() => {});
    await this.client.createCollection(tmpName, collectionConfig);
    const migrated = await copy(this.collectionName, tmpName);

    // Phase 2: recreate the real collection with sparse and copy back.
    await this.client.deleteCollection(this.collectionName);
    this.initialized = false;
    this.sparseEnabled = false;
    await this.initialize(); // recreates with sparse config + payload indexes
    await copy(tmpName, this.collectionName);
    await this.client.deleteCollection(tmpName).catch(() => {});

    this.sparseEnabled = true;
    return { migrated, alreadyHybrid: false };
  }

  async searchSimilar(
    memoryId: MemoryId,
    limit: number = 10,
    namespace?: string
  ): Promise<SearchResult[]> {
    await this.initialize();

    const pointId = this.memoryIdToPointId(memoryId);

    // Similar-search excludes invalidated (superseded) facts by default — both
    // the UI "similar" view and the resolution engine want current candidates.
    const filter = this.buildFilter(namespace ? { namespace } : {});

    const searchResult = await this.client.recommend(this.collectionName, {
      positive: [pointId],
      limit,
      filter,
      with_payload: true,
    });

    return searchResult.map((result) => {
      const payload = result.payload as unknown as PointPayload;
      return {
        memory: this.payloadToPartialMemory(payload),
        score: result.score,
      };
    });
  }

  /**
   * Mirror the append-only invalidation marker into the point payload without
   * touching the vector (setPayload). Best-effort: memories without a stored
   * embedding have no point; SurrealDB remains the source of truth and the
   * read path re-filters after enrichment.
   */
  async setInvalidated(memoryId: MemoryId, invalidatedAt: Date | null): Promise<boolean> {
    await this.initialize();
    const pointId = this.memoryIdToPointId(memoryId);
    try {
      await this.client.setPayload(this.collectionName, {
        wait: true,
        payload: {
          invalidated: !!invalidatedAt,
          invalidatedAt: invalidatedAt ? invalidatedAt.toISOString() : null,
        },
        points: [pointId],
      });
      return true;
    } catch {
      return false;
    }
  }

  async pointExists(memoryId: MemoryId): Promise<boolean> {
    await this.initialize();
    const pointId = this.memoryIdToPointId(memoryId);
    try {
      const result = await this.client.retrieve(this.collectionName, {
        ids: [pointId],
        with_payload: false,
        with_vector: false,
      });
      return result.length > 0;
    } catch {
      return false;
    }
  }

  async getCollectionInfo(): Promise<{
    vectorCount: number;
    indexedVectorCount: number;
    pointsCount: number;
  }> {
    await this.initialize();

    const info = await this.client.getCollection(this.collectionName);

    return {
      vectorCount: (info as Record<string, unknown>)['vectors_count'] as number ?? 0,
      indexedVectorCount: info.indexed_vectors_count ?? 0,
      pointsCount: info.points_count ?? 0,
    };
  }

  async deleteByNamespace(namespace: string): Promise<number> {
    await this.initialize();

    const filter = {
      must: [
        {
          key: 'namespace',
          match: { value: namespace },
        },
      ],
    };

    // Qdrant's delete doesn't return a count, so count the matching points
    // first (exact) and report how many were removed.
    const { count } = await this.client.count(this.collectionName, { filter, exact: true });

    await this.client.delete(this.collectionName, { wait: true, filter });

    return count;
  }

  /** Scroll up to `maxPoints` points, returning id + (memoryId, namespace) keys. */
  async scrollAll(maxPoints = 5000): Promise<{ pointId: string | number; memoryId: string; namespace: string }[]> {
    await this.initialize();
    const out: { pointId: string | number; memoryId: string; namespace: string }[] = [];
    let offset: string | number | Record<string, unknown> | null | undefined = undefined;
    while (out.length < maxPoints) {
      const res = await this.client.scroll(this.collectionName, {
        limit: 256,
        offset: offset ?? undefined,
        with_payload: true,
        with_vector: false,
      });
      for (const p of res.points) {
        const pl = (p.payload || {}) as { memoryId?: string; namespace?: string };
        out.push({ pointId: p.id, memoryId: pl.memoryId ?? '', namespace: pl.namespace ?? '' });
      }
      if (!res.next_page_offset) break;
      offset = res.next_page_offset as string | number;
    }
    return out;
  }

  /** Delete points by id (used by vector reconciliation). */
  async deletePoints(pointIds: (string | number)[]): Promise<void> {
    if (pointIds.length === 0) return;
    await this.initialize();
    await this.client.delete(this.collectionName, { wait: true, points: pointIds });
  }

  private memoryIdToPointId(memoryId: MemoryId): string {
    // Deterministic UUID v5 from namespace:id using SHA-256
    const input = `${memoryId.namespace}:${memoryId.id}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    // Format as UUID: 8-4-4-4-12
    return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
  }

  private payloadToPartialMemory(payload: PointPayload): Memory {
    // Return a partial memory object with available data from Qdrant
    // Full memory data should be fetched from SurrealDB
    return {
      id: {
        id: payload.memoryId,
        namespace: payload.namespace,
      },
      content: payload.content,
      contentHash: '',
      memoryType: payload.memoryType as MemoryType,
      createdAt: new Date(payload.createdAt),
      accessedAt: new Date(payload.createdAt),
      version: 1,
      metadata: {
        source: {
          type: 'api',
          timestamp: new Date(payload.createdAt),
        },
        confidence: 1.0,
        salience: payload.salience,
        decayRate: 30,
        lastDecayCalculation: new Date(payload.createdAt),
        effectiveSalience: payload.salience,
        tags: payload.tags,
        entities: [],
        signals: [],
      },
      relations: [],
    };
  }
}
