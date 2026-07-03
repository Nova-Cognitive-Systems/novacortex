import WebSocket from 'ws';
import { Surreal, Table, DateTime } from 'surrealdb';
import { ulid } from 'ulid';
import { createHash } from 'crypto';

// Polyfill WebSocket for Node.js environment
if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;
}
import type {
  Memory,
  MemoryId,
  MemoryType,
  MemoryRelation,
  RelationType,
  CreateMemoryInput,
  UpdateMemoryInput,
  SearchOptions,
} from '../types/memory.js';

export interface SurrealDBConfig {
  url: string;
  user: string;
  pass: string;
  namespace: string;
  database: string;
}

interface SurrealMemoryRecord {
  id?: unknown;
  memoryId: string;
  namespace: string;
  content: string;
  contentHash: string;
  memoryType: string;
  createdAt: string | DateTime;
  accessedAt: string | DateTime;
  version: number;
  invalidatedAt?: string | DateTime | null;
  metadata: {
    source: {
      type: string;
      sessionId?: string;
      documentId?: string;
      agentId?: string;
      timestamp: string | DateTime;
    };
    confidence: number;
    salience: number;
    decayRate: number;
    lastDecayCalculation: string | DateTime;
    effectiveSalience: number;
    tags: string[];
    entities: Array<{ name: string; type: string; confidence: number }>;
    signals: Array<{ keyword: string; weight: number; extractedAt: string | DateTime }>;
  };
  embedding?: number[];
  [key: string]: unknown;
}

interface SurrealRelationRecord {
  id?: unknown;
  relationId: string;
  fromMemoryId: string;
  fromNamespace: string;
  toMemoryId: string;
  toNamespace: string;
  relationType: string;
  strength: number;
  bidirectional: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  [key: string]: unknown;
}

export class SurrealDBAdapter {
  private db: Surreal;
  private config: SurrealDBConfig;
  private connected = false;

  constructor(config: SurrealDBConfig) {
    this.config = config;
    this.db = new Surreal();
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    // Convert http URL to WebSocket URL for SurrealDB, ensuring the /rpc endpoint
    // is present (SurrealDB's WebSocket RPC lives at /rpc). This makes the adapter
    // robust whether or not the configured URL already includes it.
    let wsUrl = this.config.url.replace(/^http/, 'ws');
    if (!/\/rpc\/?$/.test(wsUrl)) {
      wsUrl = `${wsUrl.replace(/\/+$/, '')}/rpc`;
    }
    await this.db.connect(new URL(wsUrl), {
      versionCheck: false,
      namespace: this.config.namespace,
      database: this.config.database,
      authentication: {
        username: this.config.user,
        password: this.config.pass,
      },
    });

    await this.initializeSchema();
    this.connected = true;
  }

  private async initializeSchema(): Promise<void> {
    // Create memories table with indexes - SCHEMALESS to allow nested metadata
    // OPTIMIZATION: Added composite indexes for common query patterns
    await this.db.query(`
      DEFINE TABLE IF NOT EXISTS memories SCHEMALESS;
      DEFINE INDEX IF NOT EXISTS idx_memory_namespace ON TABLE memories COLUMNS namespace;
      DEFINE INDEX IF NOT EXISTS idx_memory_type ON TABLE memories COLUMNS memoryType;
      DEFINE INDEX IF NOT EXISTS idx_memory_hash ON TABLE memories COLUMNS contentHash;
      DEFINE INDEX IF NOT EXISTS idx_memory_id_ns ON TABLE memories COLUMNS memoryId, namespace UNIQUE;
      DEFINE INDEX IF NOT EXISTS idx_memory_ns_type ON TABLE memories COLUMNS namespace, memoryType;
      DEFINE INDEX IF NOT EXISTS idx_memory_ns_salience ON TABLE memories COLUMNS namespace, metadata.effectiveSalience;
    `);

    // Create relations table
    await this.db.query(`
      DEFINE TABLE IF NOT EXISTS memory_relations SCHEMALESS;
      DEFINE INDEX IF NOT EXISTS idx_relation_from ON TABLE memory_relations COLUMNS fromMemoryId, fromNamespace;
      DEFINE INDEX IF NOT EXISTS idx_relation_to ON TABLE memory_relations COLUMNS toMemoryId, toNamespace;
      DEFINE INDEX IF NOT EXISTS idx_relation_type ON TABLE memory_relations COLUMNS relationType;
    `);
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.db.close();
      this.connected = false;
    }
  }

  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private calculateEffectiveSalience(
    baseSalience: number,
    decayRate: number,
    lastCalculation: Date
  ): number {
    const now = new Date();
    const daysPassed =
      (now.getTime() - lastCalculation.getTime()) / (1000 * 60 * 60 * 24);
    const halfLives = daysPassed / decayRate;
    return baseSalience * Math.pow(0.5, halfLives);
  }

  private toDate(value: string | DateTime | Date): Date {
    if (value instanceof Date) return value;
    if (value instanceof DateTime) return value.toDate();
    return new Date(value);
  }

  private recordToMemory(record: SurrealMemoryRecord): Memory {
    return {
      id: {
        id: record.memoryId,
        namespace: record.namespace,
      },
      content: record.content,
      contentHash: record.contentHash,
      memoryType: record.memoryType as MemoryType,
      createdAt: this.toDate(record.createdAt),
      accessedAt: this.toDate(record.accessedAt),
      version: record.version,
      ...(record.invalidatedAt ? { invalidatedAt: this.toDate(record.invalidatedAt) } : {}),
      metadata: {
        source: {
          type: record.metadata.source.type as
            | 'conversation'
            | 'document'
            | 'api'
            | 'extraction',
          sessionId: record.metadata.source.sessionId,
          documentId: record.metadata.source.documentId,
          agentId: record.metadata.source.agentId,
          timestamp: this.toDate(record.metadata.source.timestamp),
        },
        confidence: record.metadata.confidence,
        salience: record.metadata.salience,
        decayRate: record.metadata.decayRate,
        lastDecayCalculation: this.toDate(record.metadata.lastDecayCalculation),
        effectiveSalience: record.metadata.effectiveSalience,
        tags: record.metadata.tags,
        entities: record.metadata.entities.map((e) => ({
          name: e.name,
          type: e.type as
            | 'person'
            | 'organization'
            | 'location'
            | 'concept'
            | 'event',
          confidence: e.confidence,
        })),
        signals: record.metadata.signals.map((s) => ({
          keyword: s.keyword,
          weight: s.weight,
          extractedAt: this.toDate(s.extractedAt),
        })),
      },
      embedding: record.embedding,
      relations: [],
    };
  }

  private relationRecordToRelation(record: SurrealRelationRecord): MemoryRelation {
    return {
      id: record.relationId,
      fromMemory: {
        id: record.fromMemoryId,
        namespace: record.fromNamespace,
      },
      toMemory: {
        id: record.toMemoryId,
        namespace: record.toNamespace,
      },
      relationType: record.relationType as RelationType,
      strength: record.strength,
      bidirectional: record.bidirectional,
      metadata: record.metadata,
      createdAt: new Date(record.createdAt),
    };
  }

  /**
   * Retry a write when SurrealDB reports a transient transaction conflict
   * ("Failed to commit transaction due to a read or write conflict ... can be
   * retried"), which happens under concurrent writes. Read paths are unaffected.
   */
  private async withConflictRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (i < attempts - 1 && /conflict|can be retried|failed transaction/i.test(msg)) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 25 * 2 ** i + Math.floor(Math.random() * 25)));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  async create(input: CreateMemoryInput): Promise<Memory> {
    await this.connect();

    const memoryId = ulid();
    const namespace = input.namespace || 'default';
    const now = new Date();
    const contentHash = this.computeHash(input.content);

    // Check for duplicates
    const existing = await this.findByHash(contentHash, namespace);
    if (existing) {
      return existing;
    }

    const salience = input.salience ?? 5.0;
    const decayRate = input.decayRate ?? 30;

    // Use raw query with time::now() for proper datetime handling
    const hasEmbedding = input.embedding && input.embedding.length > 0;
    const embeddingClause = hasEmbedding ? ', embedding: $embedding' : '';

    const params: Record<string, unknown> = {
      memoryId,
      namespace,
      content: input.content,
      contentHash,
      memoryType: input.memoryType,
      sourceType: input.source?.type || 'api',
      sessionId: input.source?.sessionId || null,
      documentId: input.source?.documentId || null,
      agentId: input.source?.agentId || null,
      confidence: input.confidence ?? 1.0,
      salience,
      decayRate,
      tags: input.tags || [],
      entities: (input.entities || []).map((e) => ({
        name: e.name,
        type: e.type,
        confidence: e.confidence,
      })),
      signals: (input.signals || []).map((s) => ({
        keyword: s.keyword,
        weight: s.weight,
        extractedAt: s.extractedAt.toISOString(),
      })),
    };

    if (hasEmbedding) {
      params['embedding'] = Array.from(input.embedding!);
    }

    const result = await this.withConflictRetry(() => this.db.query<[SurrealMemoryRecord[]]>(`
      CREATE memories CONTENT {
        memoryId: $memoryId,
        namespace: $namespace,
        content: $content,
        contentHash: $contentHash,
        memoryType: $memoryType,
        createdAt: time::now(),
        accessedAt: time::now(),
        version: 1,
        metadata: {
          source: {
            type: $sourceType,
            sessionId: $sessionId,
            documentId: $documentId,
            agentId: $agentId,
            timestamp: time::now()
          },
          confidence: $confidence,
          salience: $salience,
          decayRate: $decayRate,
          lastDecayCalculation: time::now(),
          effectiveSalience: $salience,
          tags: $tags,
          entities: $entities,
          signals: $signals
        }${embeddingClause}
      }
    `, params));

    const createdArray = result[0] || [];

    if (!createdArray[0]) {
      throw new Error('Failed to create memory');
    }

    return this.recordToMemory(createdArray[0] as SurrealMemoryRecord);
  }

  async findById(id: MemoryId): Promise<Memory | null> {
    await this.connect();

    const result = await this.db.query<[SurrealMemoryRecord[]]>(
      `SELECT * FROM memories WHERE memoryId = $memoryId AND namespace = $namespace LIMIT 1`,
      { memoryId: id.id, namespace: id.namespace }
    );

    const records = result[0];
    if (!records || records.length === 0) {
      return null;
    }

    const memory = this.recordToMemory(records[0]!);

    // Best-effort accessed-time bump: a read must never fail because this
    // write-on-read lost a transaction conflict. Fire-and-forget with retry.
    void this.withConflictRetry(() => this.db.query(
      `UPDATE memories SET accessedAt = $now WHERE memoryId = $memoryId AND namespace = $namespace`,
      { now: new DateTime(new Date()), memoryId: id.id, namespace: id.namespace }
    )).catch(() => {});

    return memory;
  }

  /**
   * OPTIMIZATION: Batch fetch multiple memories in a single query
   * Eliminates N+1 query problem in vectorSearch and findSimilar
   */
  async findByIds(ids: MemoryId[]): Promise<Memory[]> {
    await this.connect();

    if (ids.length === 0) {
      return [];
    }

    // Build conditions for batch lookup
    const conditions = ids.map((_, i) =>
      `(memoryId = $memoryId${i} AND namespace = $namespace${i})`
    ).join(' OR ');

    const params: Record<string, string> = {};
    ids.forEach((id, i) => {
      params[`memoryId${i}`] = id.id;
      params[`namespace${i}`] = id.namespace;
    });

    const result = await this.db.query<[SurrealMemoryRecord[]]>(
      `SELECT * FROM memories WHERE ${conditions}`,
      params
    );

    const records = result[0] || [];
    const memories = records.map((r: SurrealMemoryRecord) => this.recordToMemory(r));

    // Best-effort batch accessed-time bump: like findById, a read must never fail
    // because this write-on-read lost a transaction conflict. Fire-and-forget.
    if (memories.length > 0) {
      const now = new DateTime(new Date());
      void this.withConflictRetry(() => this.db.query(
        `UPDATE memories SET accessedAt = $now WHERE ${conditions}`,
        { ...params, now }
      )).catch(() => {});
    }

    return memories;
  }

  async findByHash(hash: string, namespace: string): Promise<Memory | null> {
    await this.connect();

    const result = await this.db.query<[SurrealMemoryRecord[]]>(
      `SELECT * FROM memories WHERE contentHash = $hash AND namespace = $namespace LIMIT 1`,
      { hash, namespace }
    );

    const records = result[0];
    if (!records || records.length === 0) {
      return null;
    }

    return this.recordToMemory(records[0]!);
  }

  async update(id: MemoryId, input: UpdateMemoryInput): Promise<Memory | null> {
    await this.connect();

    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    const now = new Date();
    const updates: Record<string, unknown> = {
      accessedAt: new DateTime(now),
      version: existing.version + 1,
    };

    if (input.content !== undefined) {
      updates['content'] = input.content;
      updates['contentHash'] = this.computeHash(input.content);
    }

    if (input.tags !== undefined) {
      updates['metadata.tags'] = input.tags;
    }

    if (input.entities !== undefined) {
      updates['metadata.entities'] = input.entities.map((e) => ({
        name: e.name,
        type: e.type,
        confidence: e.confidence,
      }));
    }

    if (input.signals !== undefined) {
      updates['metadata.signals'] = input.signals.map((s) => ({
        keyword: s.keyword,
        weight: s.weight,
        extractedAt: new DateTime(s.extractedAt),
      }));
    }

    if (input.invalidatedAt !== undefined) {
      updates['invalidatedAt'] = input.invalidatedAt ? new DateTime(input.invalidatedAt) : null;
    }

    if (input.salience !== undefined) {
      updates['metadata.salience'] = input.salience;
      updates['metadata.lastDecayCalculation'] = new DateTime(now);
      updates['metadata.effectiveSalience'] = input.salience;
    } else {
      // Decay processor path: persist the decayed value without resetting base salience.
      if (input.effectiveSalience !== undefined) {
        updates['metadata.effectiveSalience'] = input.effectiveSalience;
      }
      if (input.lastDecayCalculation !== undefined) {
        updates['metadata.lastDecayCalculation'] = new DateTime(input.lastDecayCalculation);
      }
    }

    const setClause = Object.entries(updates)
      .map(([key]) => `${key} = $${key.replace(/\./g, '_')}`)
      .join(', ');

    const params: Record<string, unknown> = {
      memoryId: id.id,
      namespace: id.namespace,
    };
    for (const [key, value] of Object.entries(updates)) {
      params[key.replace(/\./g, '_')] = value;
    }

    await this.withConflictRetry(() => this.db.query(
      `UPDATE memories SET ${setClause} WHERE memoryId = $memoryId AND namespace = $namespace`,
      params
    ));

    return this.findById(id);
  }

  async delete(id: MemoryId): Promise<boolean> {
    await this.connect();

    // Delete relations and the memory atomically: a single transaction rolls back
    // both if either fails, so a partial failure can't leave a memory with its
    // relations silently removed (or vice versa). RETURN BEFORE on the memory
    // delete tells us whether a row existed.
    const result = await this.withConflictRetry(() => this.db.query<[unknown, { count: number }[]]>(
      `BEGIN TRANSACTION;
       DELETE FROM memory_relations WHERE (fromMemoryId = $memoryId AND fromNamespace = $namespace) OR (toMemoryId = $memoryId AND toNamespace = $namespace);
       DELETE FROM memories WHERE memoryId = $memoryId AND namespace = $namespace RETURN BEFORE;
       COMMIT TRANSACTION;`,
      { memoryId: id.id, namespace: id.namespace }
    ));

    return (result[1]?.length ?? 0) > 0;
  }

  /** Build the shared WHERE clause + params for search/count (keeps them in sync). */
  private buildSearchWhere(options: SearchOptions): { whereClause: string; params: Record<string, unknown> } {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (options.namespace) {
      conditions.push('namespace = $namespace');
      params['namespace'] = options.namespace;
    }
    if (options.memoryTypes && options.memoryTypes.length > 0) {
      conditions.push('memoryType IN $memoryTypes');
      params['memoryTypes'] = options.memoryTypes;
    }
    if (options.tags && options.tags.length > 0) {
      conditions.push('metadata.tags CONTAINSANY $tags');
      params['tags'] = options.tags;
    }
    if (options.minSalience !== undefined) {
      conditions.push('metadata.effectiveSalience >= $minSalience');
      params['minSalience'] = options.minSalience;
    }
    if (options.query) {
      conditions.push('string::contains(string::lowercase(content), string::lowercase($query))');
      params['query'] = options.query;
    }
    if (options.createdAfter) {
      conditions.push('createdAt >= $createdAfter');
      params['createdAfter'] = new DateTime(options.createdAfter);
    }
    if (options.asOf) {
      // Point-in-time: rows that existed AND were still current at `asOf`.
      conditions.push('createdAt <= $asOf');
      conditions.push('(invalidatedAt = NONE OR invalidatedAt = NULL OR invalidatedAt > $asOf)');
      params['asOf'] = new DateTime(options.asOf);
    } else if (!options.includeInvalidated) {
      // Default: only CURRENT facts — superseded memories stay stored (append-
      // only) but no longer surface in search.
      conditions.push('(invalidatedAt = NONE OR invalidatedAt = NULL)');
    }

    return { whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params };
  }

  /** Count memories matching the same filters as search() (ignoring limit/offset). */
  async countSearch(options: SearchOptions): Promise<number> {
    await this.connect();
    const { whereClause, params } = this.buildSearchWhere(options);
    const result = await this.db.query<[{ total: number }[]]>(
      `SELECT count() AS total FROM memories ${whereClause} GROUP ALL`,
      params
    );
    return result[0]?.[0]?.total ?? 0;
  }

  async search(options: SearchOptions): Promise<Memory[]> {
    await this.connect();

    const { whereClause, params } = this.buildSearchWhere(options);
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    // Stable total order: secondary sort by id so offset/limit paging does not
    // drift when many rows share the same effectiveSalience (e.g. bulk inserts).
    const result = await this.db.query<[SurrealMemoryRecord[]]>(
      `SELECT * FROM memories ${whereClause} ORDER BY metadata.effectiveSalience DESC, id ASC LIMIT $limit START $offset`,
      { ...params, limit, offset }
    );

    const records = result[0] || [];
    const memories = records.map((r: SurrealMemoryRecord) => this.recordToMemory(r));

    if (options.includeRelations) {
      return Promise.all(memories.map((m: Memory) => this.loadRelations(m)));
    }

    return memories;
  }

  async loadRelations(memory: Memory): Promise<Memory> {
    const result = await this.db.query<[SurrealRelationRecord[]]>(
      `SELECT * FROM memory_relations WHERE (fromMemoryId = $memoryId AND fromNamespace = $namespace) OR (toMemoryId = $memoryId AND toNamespace = $namespace)`,
      { memoryId: memory.id.id, namespace: memory.id.namespace }
    );

    const relations = (result[0] || []).map((r: SurrealRelationRecord) =>
      this.relationRecordToRelation(r)
    );

    return {
      ...memory,
      relations,
    };
  }

  async createRelation(
    fromMemory: MemoryId,
    toMemory: MemoryId,
    relationType: RelationType,
    strength: number = 1.0,
    bidirectional: boolean = false,
    metadata: Record<string, unknown> = {}
  ): Promise<MemoryRelation> {
    await this.connect();

    const relationId = ulid();
    const now = new Date();

    const record = {
      relationId,
      fromMemoryId: fromMemory.id,
      fromNamespace: fromMemory.namespace,
      toMemoryId: toMemory.id,
      toNamespace: toMemory.namespace,
      relationType,
      strength,
      bidirectional,
      metadata,
      createdAt: new DateTime(now),
    };

    await this.withConflictRetry(() => this.db.create(new Table('memory_relations')).content(record));

    return {
      id: relationId,
      fromMemory,
      toMemory,
      relationType,
      strength,
      bidirectional,
      metadata,
      createdAt: now,
    };
  }

  async findRelations(memoryId: MemoryId): Promise<MemoryRelation[]> {
    await this.connect();

    const result = await this.db.query<[SurrealRelationRecord[]]>(
      `SELECT * FROM memory_relations WHERE (fromMemoryId = $memoryId AND fromNamespace = $namespace) OR (toMemoryId = $memoryId AND toNamespace = $namespace)`,
      { memoryId: memoryId.id, namespace: memoryId.namespace }
    );

    return (result[0] || []).map((r: SurrealRelationRecord) => this.relationRecordToRelation(r));
  }

  async deleteRelation(relationId: string): Promise<boolean> {
    await this.connect();

    const result = await this.db.query<[{ count: number }[]]>(
      `DELETE FROM memory_relations WHERE relationId = $relationId RETURN BEFORE`,
      { relationId }
    );

    return (result[0]?.length ?? 0) > 0;
  }

  async listNamespaces(): Promise<string[]> {
    await this.connect();

    const result = await this.db.query<[{ namespace: string }[]]>(
      `SELECT namespace FROM memories GROUP BY namespace`
    );

    return (result[0] || [])
      .map((r: { namespace: string }) => r.namespace)
      .filter((n): n is string => !!n)
      .sort();
  }

  async countMemories(namespace?: string): Promise<number> {
    await this.connect();

    const query = namespace
      ? `SELECT count() AS total FROM memories WHERE namespace = $namespace GROUP ALL`
      : `SELECT count() AS total FROM memories GROUP ALL`;

    const result = await this.db.query<[{ total: number }[]]>(
      query,
      namespace ? { namespace } : {}
    );

    return result[0]?.[0]?.total ?? 0;
  }
}
