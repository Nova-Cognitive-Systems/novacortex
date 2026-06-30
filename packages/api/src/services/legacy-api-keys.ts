/**
 * API Key Service
 * Manages API keys for agent authentication and namespace access control.
 * Persisted in SurrealDB — keys survive server restarts.
 */

/**
 * @deprecated Transitional shim — stores API keys in plaintext in memory.
 * Will be fully replaced by TokenService once migration is complete.
 * DO NOT add new features here.
 */

import crypto from 'crypto';
import { Surreal } from 'surrealdb';

export interface ApiKeyConfig {
  key: string;
  agentId: string;
  primaryNamespace: string;
  readableNamespaces: string[];
  createdAt: Date;
  lastUsedAt?: Date;
  description?: string;
  active: boolean;
}

interface SurrealDBConfig {
  url: string;
  user: string;
  pass: string;
  namespace: string;
  database: string;
}

export class ApiKeyService {
  private db: Surreal | null = null;

  // In-memory cache for fast lookups (populated from DB on connect)
  private keyIndex: Map<string, ApiKeyConfig> = new Map(); // key -> config

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
    await this.loadKeysIntoCache();
  }

  private async initSchema(): Promise<void> {
    if (!this.db) return;
    await this.db.query(`
      DEFINE TABLE IF NOT EXISTS api_keys SCHEMALESS;
      DEFINE INDEX IF NOT EXISTS idx_apikey_agent ON api_keys FIELDS agentId UNIQUE;
      DEFINE INDEX IF NOT EXISTS idx_apikey_key ON api_keys FIELDS key UNIQUE;
    `);
  }

  /** Load all active keys into memory for fast auth checks */
  private async loadKeysIntoCache(): Promise<void> {
    if (!this.db) return;
    const result = await this.db.query<[any[]]>('SELECT * FROM api_keys WHERE active = true');
    const rows = result[0] || [];
    this.keyIndex.clear();
    for (const row of rows) {
      const config = this.rowToConfig(row);
      this.keyIndex.set(config.key, config);
    }
  }

  private rowToConfig(row: any): ApiKeyConfig {
    return {
      key: row.key,
      agentId: row.agentId,
      primaryNamespace: row.primaryNamespace,
      readableNamespaces: row.readableNamespaces || [],
      createdAt: new Date(row.createdAt),
      lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt) : undefined,
      description: row.description,
      active: row.active,
    };
  }

  private getDb(): Surreal {
    if (!this.db) throw new Error('ApiKeyService not connected — call connect() first');
    return this.db;
  }

  /**
   * Generate a new API key for an agent
   */
  async createKey(
    agentId: string,
    primaryNamespace: string,
    readableNamespaces: string[] = [],
    description?: string
  ): Promise<ApiKeyConfig> {
    const db = this.getDb();

    const prefix = agentId.slice(0, 8).replace(/[^a-zA-Z0-9]/g, '');
    const random = crypto.randomBytes(24).toString('base64url');
    const key = `sk_${prefix}_${random}`;

    const config: ApiKeyConfig = {
      key,
      agentId,
      primaryNamespace,
      readableNamespaces: [...new Set([primaryNamespace, ...readableNamespaces])],
      createdAt: new Date(),
      description,
      active: true,
    };

    await db.query(
      `CREATE api_keys SET
        agentId = $agentId,
        key = $key,
        primaryNamespace = $primaryNamespace,
        readableNamespaces = $readableNamespaces,
        createdAt = $createdAt,
        description = $description,
        active = true`,
      {
        agentId: config.agentId,
        key: config.key,
        primaryNamespace: config.primaryNamespace,
        readableNamespaces: config.readableNamespaces,
        createdAt: config.createdAt.toISOString(),
        description: config.description ?? null,
      }
    );

    this.keyIndex.set(key, config);
    return config;
  }

  /**
   * Validate an API key and return the agent config
   */
  validateKey(key: string): ApiKeyConfig | null {
    const config = this.keyIndex.get(key);
    if (!config || !config.active) return null;

    // Update last used (async, non-blocking)
    config.lastUsedAt = new Date();
    if (this.db) {
      this.db.query(
        'UPDATE api_keys SET lastUsedAt = $now WHERE agentId = $agentId',
        { now: config.lastUsedAt.toISOString(), agentId: config.agentId }
      ).catch(() => {}); // best-effort
    }
    return config;
  }

  /**
   * Get config by agent ID
   */
  getByAgentId(agentId: string): ApiKeyConfig | null {
    for (const config of this.keyIndex.values()) {
      if (config.agentId === agentId) return config;
    }
    return null;
  }

  /**
   * List all API keys (without exposing full keys)
   */
  listKeys(): Array<Omit<ApiKeyConfig, 'key'> & { keyPreview: string }> {
    return Array.from(this.keyIndex.values()).map((config) => ({
      ...config,
      key: undefined as never,
      keyPreview: `${config.key.slice(0, 12)}...${config.key.slice(-4)}`,
    }));
  }

  /**
   * Update readable namespaces for an agent
   */
  async updateReadableNamespaces(agentId: string, namespaces: string[]): Promise<boolean> {
    const config = this.getByAgentId(agentId);
    if (!config) return false;

    const updated = [...new Set([config.primaryNamespace, ...namespaces])];
    config.readableNamespaces = updated;

    await this.getDb().query(
      'UPDATE api_keys SET readableNamespaces = $ns WHERE agentId = $agentId',
      { ns: updated, agentId }
    );
    return true;
  }

  /**
   * Revoke/deactivate an API key
   */
  async revokeKey(agentId: string): Promise<boolean> {
    const config = this.getByAgentId(agentId);
    if (!config) return false;

    config.active = false;
    this.keyIndex.delete(config.key);

    await this.getDb().query(
      'UPDATE api_keys SET active = false WHERE agentId = $agentId',
      { agentId }
    );
    return true;
  }

  /**
   * Delete an API key completely
   */
  async deleteKey(agentId: string): Promise<boolean> {
    const config = this.getByAgentId(agentId);
    if (!config) return false;

    this.keyIndex.delete(config.key);

    await this.getDb().query(
      'DELETE FROM api_keys WHERE agentId = $agentId',
      { agentId }
    );
    return true;
  }

  /**
   * Regenerate key for an agent (keeps config, new key)
   */
  async regenerateKey(agentId: string): Promise<ApiKeyConfig | null> {
    const config = this.getByAgentId(agentId);
    if (!config) return null;

    // Remove old key from cache
    this.keyIndex.delete(config.key);

    // Generate new key
    const prefix = agentId.slice(0, 8).replace(/[^a-zA-Z0-9]/g, '');
    const random = crypto.randomBytes(24).toString('base64url');
    config.key = `sk_${prefix}_${random}`;

    // Update DB
    await this.getDb().query(
      'UPDATE api_keys SET key = $key WHERE agentId = $agentId',
      { key: config.key, agentId }
    );

    // Re-index
    this.keyIndex.set(config.key, config);
    return config;
  }

  /**
   * Get all namespaces an agent can read
   */
  getReadableNamespaces(agentId: string): string[] {
    const config = this.getByAgentId(agentId);
    if (!config) return [];
    return config.readableNamespaces;
  }

  /**
   * Check if agent can access a namespace
   */
  canAccessNamespace(agentId: string, namespace: string): boolean {
    const config = this.getByAgentId(agentId);
    if (!config) return false;
    return config.readableNamespaces.includes(namespace);
  }

  /**
   * Check if agent can write to a namespace
   */
  canWriteNamespace(agentId: string, namespace: string): boolean {
    const config = this.getByAgentId(agentId);
    if (!config) return false;
    return config.primaryNamespace === namespace;
  }
}

export const apiKeyService = new ApiKeyService();
