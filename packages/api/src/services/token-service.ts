/**
 * TokenService — unified token storage with SHA-256 hashing and scope enforcement.
 *
 * Replaces the legacy ApiKeyService. Migrates existing rows from `api_keys` on
 * first start. Cleartext tokens are NEVER persisted — only their SHA-256 hashes.
 */

import crypto from 'crypto';
import { Surreal } from 'surrealdb';

export type TokenPrefix = 'nc_pat' | 'nc_agt' | 'nc_boot' | 'nc_agt_migrated';

export type TokenTemplate =
  | 'admin-full'
  | 'admin-readonly'
  | 'agent'
  | 'knowledge-ingest';

export interface TokenRecord {
  id: string;
  tokenHash: string;
  prefix: TokenPrefix;
  name: string;
  scopes: string[];
  namespaceClaim?: string;
  agentId?: string;
  createdAt: Date;
  createdBy?: string;
  lastUsedAt?: Date;
  expiresAt?: Date;
  revokedAt?: Date;
}

export interface SurrealDBConfig {
  url: string;
  user: string;
  pass: string;
  namespace: string;
  database: string;
}

export interface SurrealLike {
  query<T = unknown>(sql: string, params?: Record<string, unknown>): Promise<T>;
}

export interface CreateOpts {
  template: TokenTemplate;
  name: string;
  agentId?: string;
  namespaceClaim?: string;
  expiresAt?: Date;
  createdBy?: string;
}

/**
 * Expand a token template into its concrete scope list.
 * Agent templates require an agentId to inject the agent:{id} scope.
 */
export function expandTemplate(
  template: TokenTemplate,
  opts?: { agentId?: string }
): string[] {
  switch (template) {
    case 'admin-full':
      return ['admin:*', 'tokens:read', 'tokens:write'];
    case 'admin-readonly':
      return [
        'memories:read',
        'namespaces:read',
        'knowledge:read',
        'buckets:read',
        'processor:read',
      ];
    case 'agent':
      if (!opts?.agentId) throw new Error('agentId required for agent template');
      return ['memories:read', 'memories:write', 'knowledge:read', `agent:${opts.agentId}`];
    case 'knowledge-ingest':
      return ['knowledge:write', 'knowledge:read'];
    default: {
      const _exhaustive: never = template;
      throw new Error(`unknown template: ${_exhaustive as string}`);
    }
  }
}

export class TokenService {
  private db: SurrealLike | null = null;
  private cache: Map<string, TokenRecord> = new Map(); // tokenHash → record
  private currentBootstrapCode: string | null = null;

  constructor(db?: SurrealLike) {
    if (db) this.db = db;
  }

  async connect(cfg: SurrealDBConfig): Promise<void> {
    if (!this.db) {
      const real = new Surreal();
      let wsUrl = cfg.url.replace(/^http/, 'ws');
      if (!/\/rpc\/?$/.test(wsUrl)) {
        wsUrl = `${wsUrl.replace(/\/+$/, '')}/rpc`;
      }
      await real.connect(new URL(wsUrl), {
        versionCheck: false,
        namespace: cfg.namespace,
        database: cfg.database,
        authentication: { username: cfg.user, password: cfg.pass },
      });
      this.db = real as unknown as SurrealLike;
    }
    await this.initSchema();
    await this.loadCache();
  }

  private async initSchema(): Promise<void> {
    const db = this.db!;
    await db.query(`
      DEFINE TABLE IF NOT EXISTS tokens SCHEMALESS;
      DEFINE INDEX IF NOT EXISTS idx_token_hash ON tokens FIELDS tokenHash UNIQUE;
      DEFINE INDEX IF NOT EXISTS idx_token_agent ON tokens FIELDS agentId;
      DEFINE TABLE IF NOT EXISTS audit_log SCHEMALESS;
    `);
  }

  private async loadCache(): Promise<void> {
    const db = this.db!;
    const result = await db.query<[Array<Record<string, unknown>>]>(
      'SELECT * FROM tokens WHERE revokedAt IS NULL'
    );
    const rows = result[0] ?? [];
    this.cache.clear();
    for (const row of rows) {
      const rec = rowToRecord(row);
      if (rec) this.cache.set(rec.tokenHash, rec);
    }
  }

  async needsBootstrap(): Promise<boolean> {
    // Note: revoked non-boot tokens are excluded from this check.
    // If all non-boot tokens are revoked (full de-provisioning),
    // needsBootstrap returns true and a fresh bootstrap code will be issued.
    // The `currentBootstrapCode` guard in generateBootstrapCode prevents
    // duplicate codes within a single process lifetime.
    for (const rec of this.cache.values()) {
      if (rec.prefix !== 'nc_boot' && !rec.revokedAt) return false;
    }
    return true;
  }

  async generateBootstrapCode(): Promise<string> {
    if (this.currentBootstrapCode) return this.currentBootstrapCode;
    const db = this.requireDb();
    const random = crypto.randomBytes(18).toString('base64url');
    const cleartext = `nc_boot_${random}`;
    const tokenHash = sha256Hex(cleartext);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 60 * 60 * 1000); // 1h

    await db.query(
      `CREATE tokens SET
         tokenHash = $tokenHash,
         prefix = 'nc_boot',
         name = 'Bootstrap code',
         scopes = $scopes,
         createdAt = $createdAt,
         expiresAt = $expiresAt`,
      {
        tokenHash,
        scopes: ['bootstrap'],
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }
    );

    this.cache.set(tokenHash, {
      id: `tokens:boot-${tokenHash.slice(0, 8)}`,
      tokenHash,
      prefix: 'nc_boot',
      name: 'Bootstrap code',
      scopes: ['bootstrap'],
      createdAt,
      expiresAt,
    });
    this.currentBootstrapCode = cleartext;
    return cleartext;
  }

  async exchangeBootstrapCode(code: string): Promise<{ token: string; record: TokenRecord }> {
    const hash = sha256Hex(code);
    const cached = this.cache.get(hash);
    // Constant-time presence compare via stable hash length comparison.
    // We ALWAYS do a dummy compare to make timing uniform.
    const candidate = Buffer.from(hash, 'hex');
    const reference = Buffer.from(cached?.tokenHash ?? '0'.repeat(64), 'hex');
    const hashMatch =
      candidate.length === reference.length && crypto.timingSafeEqual(candidate, reference);
    if (!cached || !hashMatch || cached.prefix !== 'nc_boot') {
      throw new Error('invalid_setup_code');
    }
    if (cached.revokedAt) throw new Error('invalid_setup_code');
    if (cached.expiresAt && cached.expiresAt.getTime() < Date.now()) {
      throw new Error('invalid_setup_code');
    }

    // Burn the code
    await this.revoke(cached.id, 'setup-exchange');
    this.currentBootstrapCode = null;

    // Mint the admin token
    const minted = await this.create({ template: 'admin-full', name: 'Initial Admin' });
    return minted;
  }

  async validate(cleartext: string): Promise<TokenRecord | null> {
    if (!cleartext || typeof cleartext !== 'string') return null;
    const hash = sha256Hex(cleartext);

    let record = this.cache.get(hash);

    // Cache miss — fall back to SurrealDB (handles tokens created after startup
    // and tokens from other instances in multi-node deployments)
    if (!record && this.db) {
      try {
        const rows = await this.db.query<TokenRecord[][]>(
          'SELECT * FROM tokens WHERE tokenHash = $hash LIMIT 1',
          { hash }
        );
        const row = rows?.[0]?.[0];
        if (row) {
          const normalized: TokenRecord = {
            ...row,
            createdAt: new Date(row.createdAt as unknown as string),
            lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt as unknown as string) : undefined,
            expiresAt: row.expiresAt ? new Date(row.expiresAt as unknown as string) : undefined,
            revokedAt: row.revokedAt ? new Date(row.revokedAt as unknown as string) : undefined,
          };
          this.cache.set(hash, normalized);
          record = normalized;
        }
      } catch {
        // DB unavailable — fall through to null
      }
    }

    if (!record) return null;
    if (record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null;

    // Fire-and-forget lastUsedAt update
    record.lastUsedAt = new Date();
    const db = this.db;
    if (db) {
      void db.query('UPDATE tokens SET lastUsedAt = $now WHERE tokenHash = $hash', {
        now: record.lastUsedAt.toISOString(),
        hash,
      }).catch(() => {});
    }
    return record;
  }

  hasScope(record: TokenRecord, required: string): boolean {
    if (!record.scopes || record.scopes.length === 0) return false;
    // Literal match
    if (record.scopes.includes(required)) return true;
    // admin:* matches everything except agent:{id}
    if (record.scopes.includes('admin:*') && !required.startsWith('agent:')) return true;
    return false;
  }

  async create(opts: CreateOpts): Promise<{ token: string; record: TokenRecord }> {
    const db = this.requireDb();
    const scopes = expandTemplate(opts.template, { agentId: opts.agentId });
    const prefix: TokenPrefix = opts.template === 'agent' ? 'nc_agt' : 'nc_pat';
    const random = crypto.randomBytes(24).toString('base64url');
    const cleartext = `${prefix}_${random}`;
    const tokenHash = sha256Hex(cleartext);
    const createdAt = new Date();

    const createResult = await db.query<Array<Array<{ id: string }>>>(
      `CREATE tokens SET
         tokenHash = $tokenHash,
         prefix = $prefix,
         name = $name,
         scopes = $scopes,
         namespaceClaim = $namespaceClaim,
         agentId = $agentId,
         createdAt = $createdAt,
         createdBy = $createdBy,
         expiresAt = $expiresAt`,
      {
        tokenHash,
        prefix,
        name: opts.name,
        scopes,
        namespaceClaim: opts.namespaceClaim ?? null,
        agentId: opts.agentId ?? null,
        createdAt: createdAt.toISOString(),
        createdBy: opts.createdBy ?? null,
        expiresAt: opts.expiresAt?.toISOString() ?? null,
      }
    );

    // Capture the actual DB-assigned ID so that revoke() can target the correct record
    const dbId = createResult?.[0]?.[0]?.id ?? `tokens:cached-${tokenHash.slice(0, 8)}`;

    const record: TokenRecord = {
      id: dbId,
      tokenHash,
      prefix,
      name: opts.name,
      scopes,
      namespaceClaim: opts.namespaceClaim,
      agentId: opts.agentId,
      createdAt,
      createdBy: opts.createdBy,
      expiresAt: opts.expiresAt,
    };
    this.cache.set(tokenHash, record);
    return { token: cleartext, record };
  }

  async list(filter?: { prefix?: TokenPrefix }): Promise<Array<Omit<TokenRecord, 'tokenHash'>>> {
    return Array.from(this.cache.values())
      .filter((rec) => !filter?.prefix || rec.prefix === filter.prefix)
      .map(({ tokenHash: _tokenHash, ...rest }) => rest);
  }

  /** Write a best-effort audit event. Silently drops on error (never blocks a request). */
  async auditEvent(event: string, meta: Record<string, unknown>): Promise<void> {
    const db = this.db;
    if (!db) return;
    try {
      await db.query('CREATE audit_log SET event = $event, at = $at, meta = $meta', {
        event,
        at: new Date().toISOString(),
        meta,
      });
    } catch {
      // swallow — audit must never break request flow
    }
  }

  async revoke(id: string, revokedBy?: string): Promise<boolean> {
    const db = this.requireDb();
    const now = new Date();
    await db.query('UPDATE tokens SET revokedAt = $now WHERE id = $id', {
      now: now.toISOString(),
      id,
    });
    // Invalidate cache by id
    for (const [hash, rec] of this.cache.entries()) {
      if (rec.id === id) {
        this.cache.delete(hash);
        break;
      }
    }
    // Write audit event (best-effort)
    void db.query('CREATE audit_log SET event = $event, at = $at, meta = $meta', {
      event: 'token.revoke',
      at: now.toISOString(),
      meta: { tokenId: id, by: revokedBy ?? null },
    }).catch(() => {});
    return true;
  }

  async migrateFromApiKeys(): Promise<{ migrated: number; skipped: number }> {
    const db = this.requireDb();

    // Read all active rows from the old table
    let legacyRows: Array<Record<string, unknown>> = [];
    try {
      const result = await db.query<[Array<Record<string, unknown>>]>(
        'SELECT * FROM api_keys WHERE active = true'
      );
      legacyRows = result[0] ?? [];
    } catch {
      // Table may not exist on a fresh install — that's fine
      return { migrated: 0, skipped: 0 };
    }

    let migrated = 0;
    let skipped = 0;

    for (const row of legacyRows) {
      const cleartext = row['key'] as string | undefined;
      const agentId = row['agentId'] as string | undefined;
      const primaryNamespace = row['primaryNamespace'] as string | undefined;
      if (!cleartext || !agentId || !primaryNamespace) {
        skipped += 1;
        continue;
      }
      const tokenHash = sha256Hex(cleartext);

      // Skip if already migrated
      if (this.cache.has(tokenHash)) {
        skipped += 1;
        continue;
      }

      const scopes = ['memories:read', 'memories:write', 'knowledge:read', `agent:${agentId}`];
      const createdAt = new Date((row['createdAt'] as string) ?? new Date().toISOString());

      await db.query(
        `CREATE tokens SET
           tokenHash = $tokenHash,
           prefix = $prefix,
           name = $name,
           scopes = $scopes,
           namespaceClaim = $namespaceClaim,
           agentId = $agentId,
           createdAt = $createdAt`,
        {
          tokenHash,
          prefix: 'nc_agt_migrated' as TokenPrefix,
          name: `Migrated: ${agentId}`,
          scopes,
          namespaceClaim: primaryNamespace,
          agentId,
          createdAt: createdAt.toISOString(),
        }
      );

      this.cache.set(tokenHash, {
        id: `tokens:migrated-${tokenHash.slice(0, 8)}`,
        tokenHash,
        prefix: 'nc_agt_migrated',
        name: `Migrated: ${agentId}`,
        scopes,
        namespaceClaim: primaryNamespace,
        agentId,
        createdAt,
      });
      migrated += 1;
    }

    return { migrated, skipped };
  }

  private requireDb(): SurrealLike {
    if (!this.db) throw new Error('TokenService not connected — call connect() first');
    return this.db;
  }
}

/** Singleton instance. Call `tokenService.connect(cfg)` before any method use. */
export const tokenService = new TokenService();

/** Hash helper exported for tests. */
export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function rowToRecord(row: Record<string, unknown>): TokenRecord | null {
  if (!row['tokenHash']) return null;
  return {
    id: row['id'] as string,
    tokenHash: row['tokenHash'] as string,
    prefix: row['prefix'] as TokenPrefix,
    name: row['name'] as string,
    scopes: (row['scopes'] as string[] | undefined) ?? [],
    namespaceClaim: row['namespaceClaim'] as string | undefined,
    agentId: row['agentId'] as string | undefined,
    createdAt: new Date(row['createdAt'] as string),
    createdBy: row['createdBy'] as string | undefined,
    lastUsedAt: row['lastUsedAt'] ? new Date(row['lastUsedAt'] as string) : undefined,
    expiresAt: row['expiresAt'] ? new Date(row['expiresAt'] as string) : undefined,
    revokedAt: row['revokedAt'] ? new Date(row['revokedAt'] as string) : undefined,
  };
}
