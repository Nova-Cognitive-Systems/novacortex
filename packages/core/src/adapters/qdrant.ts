import { QdrantClient } from '@qdrant/js-client-rest';
import crypto from 'crypto';
import type {
  Memory,
  MemoryId,
  MemoryType,
  VectorSearchOptions,
  SearchResult,
} from '../types/memory.js';

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
          vector: memory.embedding,
          payload: payload as Record<string, unknown>,
        },
      ],
    });
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
        vector: memory.embedding!,
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

  async search(options: VectorSearchOptions): Promise<SearchResult[]> {
    await this.initialize();

    const filter: Record<string, unknown> = {
      must: [] as Array<Record<string, unknown>>,
    };

    const mustConditions = filter['must'] as Array<Record<string, unknown>>;

    if (options.namespace) {
      mustConditions.push({
        key: 'namespace',
        match: { value: options.namespace },
      });
    }

    if (options.memoryTypes && options.memoryTypes.length > 0) {
      mustConditions.push({
        key: 'memoryType',
        match: { any: options.memoryTypes },
      });
    }

    if (options.tags && options.tags.length > 0) {
      mustConditions.push({
        key: 'tags',
        match: { any: options.tags },
      });
    }

    if (options.minSalience !== undefined) {
      mustConditions.push({
        key: 'salience',
        range: { gte: options.minSalience },
      });
    }

    // Default: exclude invalidated (superseded) facts at the index level. Points
    // written before this flag existed simply lack the field and pass must_not;
    // MemoryService applies a second, SurrealDB-truth filter after enrichment.
    // asOf queries need past facts, so they skip the index filter entirely and
    // rely on the post-enrichment time-window filter.
    if (!options.includeInvalidated && !options.asOf) {
      filter['must_not'] = [{ key: 'invalidated', match: { value: true } }];
    }

    const hasFilter = mustConditions.length > 0 || !!filter['must_not'];
    const searchResult = await this.client.search(this.collectionName, {
      vector: options.vector,
      limit: options.limit ?? 10,
      offset: options.offset ?? 0,
      filter: hasFilter ? filter : undefined,
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

  async searchSimilar(
    memoryId: MemoryId,
    limit: number = 10,
    namespace?: string
  ): Promise<SearchResult[]> {
    await this.initialize();

    const pointId = this.memoryIdToPointId(memoryId);

    const filter: Record<string, unknown> | undefined = namespace
      ? {
          must: [
            {
              key: 'namespace',
              match: { value: namespace },
            },
          ],
        }
      : undefined;

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
