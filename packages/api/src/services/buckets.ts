/**
 * Knowledge Buckets Service
 * Persisted in SurrealDB
 */

import { Surreal } from 'surrealdb';

export interface UploadHistoryEntry {
  filename: string;
  size: number;
  mimeType: string;
  uploadedAt: Date;
  uploadedBy?: string;
  documentId: string;
}

export interface KnowledgeBucket {
  id: string;
  name: string;
  description?: string;
  namespace: string;
  agents: string[];
  createdAt: Date;
  updatedAt: Date;
  documentCount: number;
  uploadHistory: UploadHistoryEntry[];
}

export interface CreateBucketInput {
  name: string;
  description?: string;
  namespace: string;
  agents: string[];
}

interface SurrealDBConfig {
  url: string;
  user: string;
  pass: string;
  namespace: string;
  database: string;
}

class BucketService {
  private db: Surreal | null = null;

  async connect(config: SurrealDBConfig): Promise<void> {
    this.db = new Surreal();
    const wsUrl = config.url.replace(/^http/, 'ws');
    await this.db.connect(new URL(wsUrl), {
      versionCheck: false,
      namespace: config.namespace,
      database: config.database,
      authentication: {
        username: config.user,
        password: config.pass,
      },
    });
    await this.initSchema();
  }

  private async initSchema(): Promise<void> {
    if (!this.db) return;
    await this.db.query(`
      DEFINE TABLE IF NOT EXISTS knowledge_buckets SCHEMALESS;
      DEFINE INDEX IF NOT EXISTS idx_bucket_id ON knowledge_buckets FIELDS bucketId UNIQUE;
      DEFINE INDEX IF NOT EXISTS idx_bucket_name ON knowledge_buckets FIELDS nameLower;
    `);
  }

  private ensureDb(): Surreal {
    if (!this.db) throw new Error('BucketService not connected');
    return this.db;
  }

  private toBucket(record: any): KnowledgeBucket {
    return {
      id: record.bucketId,
      name: record.name,
      description: record.description || undefined,
      namespace: record.namespace,
      agents: record.agents || [],
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      documentCount: record.documentCount || 0,
      uploadHistory: (record.uploadHistory || []).map((h: any) => ({
        filename: h.filename,
        size: h.size,
        mimeType: h.mimeType,
        uploadedAt: new Date(h.uploadedAt),
        uploadedBy: h.uploadedBy,
        documentId: h.documentId,
      })),
    };
  }

  async createBucket(input: CreateBucketInput): Promise<KnowledgeBucket> {
    const db = this.ensureDb();
    const name = input.name.trim();
    if (!name) throw new Error('Bucket name is required');

    const existing = await db.query<[any[]]>(
      'SELECT * FROM knowledge_buckets WHERE nameLower = $nameLower LIMIT 1',
      { nameLower: name.toLowerCase() }
    );
    if (existing[0]?.length) throw new Error(`Bucket "${name}" already exists`);

    const bucketId = `bucket_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    await db.query(
      `CREATE knowledge_buckets CONTENT {
        bucketId: $bucketId,
        name: $name,
        nameLower: $nameLower,
        description: $description,
        namespace: $namespace,
        agents: $agents,
        createdAt: $now,
        updatedAt: $now,
        documentCount: 0,
        uploadHistory: []
      }`,
      {
        bucketId, name, nameLower: name.toLowerCase(),
        description: input.description?.trim() || null,
        namespace: input.namespace || 'default',
        agents: [...new Set(input.agents || [])],
        now,
      }
    );

    return {
      id: bucketId, name, description: input.description?.trim(),
      namespace: input.namespace || 'default',
      agents: [...new Set(input.agents || [])],
      createdAt: new Date(), updatedAt: new Date(),
      documentCount: 0, uploadHistory: [],
    };
  }

  async getAllBuckets(): Promise<KnowledgeBucket[]> {
    const db = this.ensureDb();
    const result = await db.query<[any[]]>('SELECT * FROM knowledge_buckets ORDER BY updatedAt DESC');
    return (result[0] || []).map((r: any) => this.toBucket(r));
  }

  async getBucket(id: string): Promise<KnowledgeBucket | undefined> {
    const db = this.ensureDb();
    const result = await db.query<[any[]]>('SELECT * FROM knowledge_buckets WHERE bucketId = $id LIMIT 1', { id });
    if (!result[0]?.length) return undefined;
    return this.toBucket(result[0][0]);
  }

  async getBucketByName(name: string): Promise<KnowledgeBucket | undefined> {
    const db = this.ensureDb();
    const result = await db.query<[any[]]>(
      'SELECT * FROM knowledge_buckets WHERE nameLower = $name LIMIT 1',
      { name: name.toLowerCase() }
    );
    if (!result[0]?.length) return undefined;
    return this.toBucket(result[0][0]);
  }

  async updateBucket(id: string, updates: Partial<CreateBucketInput>): Promise<KnowledgeBucket> {
    const db = this.ensureDb();
    const bucket = await this.getBucket(id);
    if (!bucket) throw new Error('Bucket not found');

    const sets: string[] = ['updatedAt = $now'];
    const params: Record<string, any> = { id, now: new Date().toISOString() };

    if (updates.name !== undefined) {
      const name = updates.name.trim();
      if (!name) throw new Error('Bucket name cannot be empty');
      const existing = await db.query<[any[]]>(
        'SELECT * FROM knowledge_buckets WHERE nameLower = $nameLower AND bucketId != $id LIMIT 1',
        { nameLower: name.toLowerCase(), id }
      );
      if (existing[0]?.length) throw new Error(`Bucket "${name}" already exists`);
      sets.push('name = $name', 'nameLower = $nameLower');
      params.name = name;
      params.nameLower = name.toLowerCase();
    }
    if (updates.description !== undefined) {
      sets.push('description = $description');
      params.description = updates.description.trim() || null;
    }
    if (updates.namespace !== undefined) {
      sets.push('namespace = $namespace');
      params.namespace = updates.namespace;
    }
    if (updates.agents !== undefined) {
      sets.push('agents = $agents');
      params.agents = [...new Set(updates.agents)];
    }

    await db.query(`UPDATE knowledge_buckets SET ${sets.join(', ')} WHERE bucketId = $id`, params);
    return (await this.getBucket(id))!;
  }

  async deleteBucket(id: string): Promise<boolean> {
    const db = this.ensureDb();
    await db.query('DELETE FROM knowledge_buckets WHERE bucketId = $id', { id });
    return true;
  }

  async addAgent(bucketId: string, agentId: string): Promise<KnowledgeBucket> {
    const db = this.ensureDb();
    const bucket = await this.getBucket(bucketId);
    if (!bucket) throw new Error('Bucket not found');

    if (!bucket.agents.includes(agentId)) {
      const agents = [...bucket.agents, agentId];
      await db.query('UPDATE knowledge_buckets SET agents = $agents, updatedAt = $now WHERE bucketId = $id',
        { agents, now: new Date().toISOString(), id: bucketId });
    }
    return (await this.getBucket(bucketId))!;
  }

  async removeAgent(bucketId: string, agentId: string): Promise<KnowledgeBucket> {
    const db = this.ensureDb();
    const bucket = await this.getBucket(bucketId);
    if (!bucket) throw new Error('Bucket not found');

    const agents = bucket.agents.filter((a) => a !== agentId);
    await db.query('UPDATE knowledge_buckets SET agents = $agents, updatedAt = $now WHERE bucketId = $id',
      { agents, now: new Date().toISOString(), id: bucketId });
    return (await this.getBucket(bucketId))!;
  }

  async addUpload(bucketId: string, entry: Omit<UploadHistoryEntry, 'uploadedAt'>): Promise<void> {
    const db = this.ensureDb();
    const bucket = await this.getBucket(bucketId);
    if (!bucket) return;

    const historyEntry = { ...entry, uploadedAt: new Date().toISOString() };
    const history = [historyEntry, ...bucket.uploadHistory.map((h) => ({
      ...h, uploadedAt: h.uploadedAt instanceof Date ? h.uploadedAt.toISOString() : h.uploadedAt,
    }))];

    await db.query(
      'UPDATE knowledge_buckets SET uploadHistory = $history, documentCount = $count, updatedAt = $now WHERE bucketId = $id',
      { history, count: bucket.documentCount + 1, now: new Date().toISOString(), id: bucketId }
    );
  }

  async getUploadHistory(bucketId: string, limit = 50): Promise<UploadHistoryEntry[]> {
    const bucket = await this.getBucket(bucketId);
    return bucket ? bucket.uploadHistory.slice(0, limit) : [];
  }

  async incrementDocCount(bucketId: string): Promise<void> {
    const db = this.ensureDb();
    await db.query('UPDATE knowledge_buckets SET documentCount += 1, updatedAt = $now WHERE bucketId = $id',
      { now: new Date().toISOString(), id: bucketId });
  }

  async decrementDocCount(bucketId: string): Promise<void> {
    const db = this.ensureDb();
    const bucket = await this.getBucket(bucketId);
    if (bucket && bucket.documentCount > 0) {
      await db.query('UPDATE knowledge_buckets SET documentCount -= 1, updatedAt = $now WHERE bucketId = $id',
        { now: new Date().toISOString(), id: bucketId });
    }
  }

  async getBucketsForAgent(agentId: string): Promise<KnowledgeBucket[]> {
    const db = this.ensureDb();
    const result = await db.query<[any[]]>(
      'SELECT * FROM knowledge_buckets WHERE agents CONTAINS $agentId',
      { agentId }
    );
    return (result[0] || []).map((r: any) => this.toBucket(r));
  }

  async hasAccess(bucketId: string, agentId: string): Promise<boolean> {
    const bucket = await this.getBucket(bucketId);
    return bucket ? bucket.agents.includes(agentId) : false;
  }
}

export const bucketService = new BucketService();
