/**
 * Knowledge Base Service
 * Handles document uploads, parsing, and agent access control
 * Persisted in SurrealDB
 */

import { parse as csvParse } from 'csv-parse/sync';
import { createRequire } from 'module';
import { Surreal } from 'surrealdb';

export interface KnowledgeDocument {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  content: string;
  chunks: string[];
  namespace: string;
  uploadedAt: Date;
  uploadedBy?: string;
  metadata: Record<string, unknown>;
}

export interface AgentAccess {
  agentId: string;
  permissions: ('read' | 'write' | 'delete')[];
  grantedAt: Date;
  grantedBy?: string;
}

export interface KnowledgeEntry {
  document: KnowledgeDocument;
  access: AgentAccess[];
  memoryIds: string[];
}

interface SurrealDBConfig {
  url: string;
  user: string;
  pass: string;
  namespace: string;
  database: string;
}

export class KnowledgeService {
  private chunkSize = 1500;
  private chunkOverlap = 200;
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
      DEFINE TABLE IF NOT EXISTS knowledge_documents SCHEMALESS;
      DEFINE INDEX IF NOT EXISTS idx_kdoc_id ON knowledge_documents FIELDS docId UNIQUE;
      DEFINE INDEX IF NOT EXISTS idx_kdoc_ns ON knowledge_documents FIELDS namespace;
    `);
  }

  private ensureDb(): Surreal {
    if (!this.db) throw new Error('KnowledgeService not connected');
    return this.db;
  }

  private toEntry(record: any): KnowledgeEntry {
    return {
      document: {
        id: record.docId,
        filename: record.filename,
        mimeType: record.mimeType,
        size: record.size,
        content: record.content,
        chunks: record.chunks || [],
        namespace: record.namespace,
        uploadedAt: new Date(record.uploadedAt),
        uploadedBy: record.uploadedBy,
        metadata: record.metadata || {},
      },
      access: (record.agentAccess || []).map((a: any) => ({
        agentId: a.agentId,
        permissions: a.permissions,
        grantedAt: new Date(a.grantedAt),
        grantedBy: a.grantedBy,
      })),
      memoryIds: record.memoryIds || [],
    };
  }

  async parseDocument(
    buffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<{ content: string; metadata: Record<string, unknown> }> {
    const ext = filename.split('.').pop()?.toLowerCase();

    if (mimeType === 'text/plain' || ext === 'txt') {
      return { content: buffer.toString('utf-8'), metadata: { type: 'text' } };
    }

    if (mimeType === 'text/markdown' || ext === 'md') {
      return { content: buffer.toString('utf-8'), metadata: { type: 'markdown' } };
    }

    if (mimeType === 'text/csv' || ext === 'csv') {
      const text = buffer.toString('utf-8');
      const records = csvParse(text, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
      const content = records
        .map((row) => Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(', '))
        .join('\n');
      return { content, metadata: { type: 'csv', rowCount: records.length } };
    }

    if (mimeType === 'application/pdf' || ext === 'pdf') {
      const require = createRequire(import.meta.url);
      const mod = require('pdf-parse');
      const pdfParse = typeof mod === 'function' ? mod : (mod.default ?? mod);
      const data = await pdfParse(buffer);
      return { content: data.text, metadata: { type: 'pdf', pages: data.numpages, info: data.info } };
    }

    if (mimeType === 'application/json' || ext === 'json') {
      const json = JSON.parse(buffer.toString('utf-8'));
      const content = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
      return { content, metadata: { type: 'json' } };
    }

    throw new Error(`Unsupported file type: ${mimeType} (${ext})`);
  }

  chunkContent(content: string): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < content.length) {
      const end = Math.min(start + this.chunkSize, content.length);
      let chunk = content.slice(start, end);

      if (end < content.length) {
        const lastPeriod = chunk.lastIndexOf('.');
        const lastNewline = chunk.lastIndexOf('\n');
        const breakPoint = Math.max(lastPeriod, lastNewline);
        if (breakPoint > this.chunkSize * 0.5) {
          chunk = chunk.slice(0, breakPoint + 1);
        }
      }

      chunks.push(chunk.trim());
      const advance = chunk.length - this.chunkOverlap;
      if (advance <= 0) {
        start = end;
      } else {
        start += advance;
      }
    }

    return chunks.filter((c) => c.length > 0);
  }

  async storeDocument(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    namespace: string,
    uploadedBy?: string,
    initialAccess?: string[]
  ): Promise<KnowledgeEntry> {
    const db = this.ensureDb();
    const { content: rawContent, metadata } = await this.parseDocument(buffer, filename, mimeType);
    // Strip null bytes and other control chars that SurrealDB can't serialize via CBOR
    const content = rawContent
      .replace(/\0/g, '')
      .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
      .replace(/\uFFFD/g, '')
      .trim();
    const chunks = this.chunkContent(content);

    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const access = (initialAccess || []).map((agentId) => ({
      agentId,
      permissions: ['read'],
      grantedAt: now,
      grantedBy: uploadedBy || null,
    }));

    await db.query(
      `CREATE knowledge_documents CONTENT {
        docId: $docId,
        filename: $filename,
        mimeType: $mimeType,
        size: $size,
        content: $content,
        chunks: $chunks,
        namespace: $namespace,
        uploadedAt: $now,
        uploadedBy: $uploadedBy,
        metadata: $metadata,
        agentAccess: $agentAccess,
        memoryIds: []
      }`,
      { docId, filename, mimeType, size: buffer.length, content, chunks, namespace, now, uploadedBy: uploadedBy || null, metadata, agentAccess: access }
    );

    return {
      document: { id: docId, filename, mimeType, size: buffer.length, content, chunks, namespace, uploadedAt: new Date(), uploadedBy, metadata },
      access: access.map((a) => ({ ...a, grantedAt: new Date(a.grantedAt), grantedBy: a.grantedBy || undefined, permissions: a.permissions as ('read' | 'write' | 'delete')[] })),
      memoryIds: [],
    };
  }

  getDocuments(namespace: string): KnowledgeEntry[] {
    // Sync wrapper for backward compatibility - uses cached query
    return this._cachedDocs.filter((e) => e.document.namespace === namespace);
  }

  private _cachedDocs: KnowledgeEntry[] = [];

  async getDocumentsAsync(namespace: string): Promise<KnowledgeEntry[]> {
    const db = this.ensureDb();
    const result = await db.query<[any[]]>('SELECT * FROM knowledge_documents WHERE namespace = $ns', { ns: namespace });
    const entries = (result[0] || []).map((r: any) => this.toEntry(r));
    this._cachedDocs = entries;
    return entries;
  }

  getAccessibleDocuments(agentId: string): KnowledgeEntry[] {
    return this._cachedDocs.filter((e) =>
      e.access.some((a) => a.agentId === agentId && a.permissions.includes('read'))
    );
  }

  async getAccessibleDocumentsAsync(agentId: string): Promise<KnowledgeEntry[]> {
    const db = this.ensureDb();
    const result = await db.query<[any[]]>(
      `SELECT * FROM knowledge_documents WHERE agentAccess[WHERE agentId = $agentId AND permissions CONTAINS 'read'].agentId CONTAINS $agentId`,
      { agentId }
    );
    return (result[0] || []).map((r: any) => this.toEntry(r));
  }

  getDocument(id: string): KnowledgeEntry | undefined {
    return this._cachedDocs.find((e) => e.document.id === id);
  }

  async getDocumentAsync(id: string): Promise<KnowledgeEntry | undefined> {
    const db = this.ensureDb();
    const result = await db.query<[any[]]>('SELECT * FROM knowledge_documents WHERE docId = $id LIMIT 1', { id });
    if (!result[0]?.length) return undefined;
    const entry = this.toEntry(result[0][0]);
    return entry;
  }

  async getDocumentsByIds(ids: string[]): Promise<KnowledgeEntry[]> {
    if (ids.length === 0) return [];
    const db = this.ensureDb();
    const result = await db.query<[any[]]>('SELECT * FROM knowledge_documents WHERE docId IN $ids', { ids });
    return (result[0] || []).map((r: any) => this.toEntry(r));
  }

  async grantAccess(
    documentId: string,
    agentId: string,
    permissions: ('read' | 'write' | 'delete')[],
    grantedBy?: string
  ): Promise<boolean> {
    const db = this.ensureDb();
    const doc = await this.getDocumentAsync(documentId);
    if (!doc) return false;

    const newAccess = doc.access.filter((a) => a.agentId !== agentId);
    newAccess.push({ agentId, permissions, grantedAt: new Date(), grantedBy });

    const accessData = newAccess.map((a) => ({
      agentId: a.agentId,
      permissions: a.permissions,
      grantedAt: a.grantedAt.toISOString(),
      grantedBy: a.grantedBy || null,
    }));

    await db.query('UPDATE knowledge_documents SET agentAccess = $agentAccess WHERE docId = $id', { agentAccess: accessData, id: documentId });
    return true;
  }

  async revokeAccess(documentId: string, agentId: string): Promise<boolean> {
    const db = this.ensureDb();
    const doc = await this.getDocumentAsync(documentId);
    if (!doc) return false;

    const newAccess = doc.access.filter((a) => a.agentId !== agentId);
    if (newAccess.length === doc.access.length) return false;

    const accessData = newAccess.map((a) => ({
      agentId: a.agentId,
      permissions: a.permissions,
      grantedAt: a.grantedAt.toISOString(),
      grantedBy: a.grantedBy || null,
    }));

    await db.query('UPDATE knowledge_documents SET agentAccess = $agentAccess WHERE docId = $id', { agentAccess: accessData, id: documentId });
    return true;
  }

  async hasPermission(documentId: string, agentId: string, permission: 'read' | 'write' | 'delete'): Promise<boolean> {
    const doc = await this.getDocumentAsync(documentId);
    if (!doc) return false;
    return doc.access.some((a) => a.agentId === agentId && a.permissions.includes(permission));
  }

  async deleteDocument(id: string): Promise<boolean> {
    const db = this.ensureDb();
    await db.query('DELETE FROM knowledge_documents WHERE docId = $id', { id });
    return true;
  }

  async linkMemories(documentId: string, memoryIds: string[]): Promise<boolean> {
    const db = this.ensureDb();
    const doc = await this.getDocumentAsync(documentId);
    if (!doc) return false;

    const merged = [...new Set([...doc.memoryIds, ...memoryIds])];
    await db.query('UPDATE knowledge_documents SET memoryIds = $memoryIds WHERE docId = $id', { memoryIds: merged, id: documentId });
    return true;
  }

  async getAllAgents(): Promise<string[]> {
    const db = this.ensureDb();
    const result = await db.query<[any[]]>('SELECT access FROM knowledge_documents');
    const agents = new Set<string>();
    for (const record of (result[0] || [])) {
      for (const a of (record.agentAccess || [])) {
        agents.add(a.agentId);
      }
    }
    return Array.from(agents);
  }
}

export const knowledgeService = new KnowledgeService();
