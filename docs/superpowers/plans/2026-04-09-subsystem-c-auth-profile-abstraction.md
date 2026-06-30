# Subsystem C: Auth & Profile Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock down all admin routes behind a unified token+scope auth model, add a bootstrap flow for self-hosted first-run, ship a `novacortex` CLI with multi-profile management, and migrate existing agent API keys transparently — all without breaking existing MCP/agent clients.

**Architecture:** Unified `tokens` table (SHA-256 hashed, scope-gated, template-issued) replaces the current open-admin + separate `api_keys` model. A new `packages/cli` workspace package talks to the API purely over HTTP with per-profile file-based credential storage. The web UI gets a minimal paste-token login to keep working. Existing `sk_...` agent keys are migrated transparently and continue to work without client changes.

**Tech Stack:** TypeScript 5.4 · Node 20+ · Express 4 · SurrealDB 2 · Vitest 1.6 · Zod · Commander · Kleur · Prompts

**Spec reference:** `docs/superpowers/specs/2026-04-09-subsystem-c-auth-profile-abstraction-design.md`

---

## File Structure

### Created

```
packages/api/src/
  middleware/auth.ts                         ← extractToken, requireScopes, rateLimit
  services/token-service.ts                  ← unified TokenService (replaces api-keys.ts)
  routes/setup.ts                            ← POST /setup/exchange
  routes/auth.ts                             ← GET /auth/whoami
  routes/tokens.ts                           ← POST/GET/DELETE /tokens
  routes/admin.ts                            ← POST /admin/migrate (legacy-fallback retry)

packages/cli/                                ← NEW workspace package
  package.json
  tsconfig.json
  src/index.ts                               ← entry + command dispatcher
  src/client/http.ts                         ← fetch wrapper
  src/client/types.ts                        ← response types
  src/config/schema.ts                       ← Zod config schema
  src/config/profile-store.ts                ← read/write ~/.config/novacortex/config.json
  src/lib/errors.ts                          ← typed CliError classes
  src/lib/output.ts                          ← table / json / human formatting
  src/commands/setup.ts
  src/commands/auth/login.ts
  src/commands/auth/logout.ts
  src/commands/auth/whoami.ts
  src/commands/profile/list.ts
  src/commands/profile/use.ts
  src/commands/profile/show.ts
  src/commands/profile/rm.ts
  src/commands/profile/rename.ts
  src/commands/admin/tokens/list.ts
  src/commands/admin/tokens/create.ts
  src/commands/admin/tokens/revoke.ts

packages/web/src/
  app/login/page.tsx                         ← paste-token login
  hooks/use-auth-token.ts                    ← localStorage helper

tests/
  helpers/fake-surreal.ts                    ← in-memory SurrealDB surrogate for unit tests
  helpers/test-server.ts                     ← starts Express app for integration tests
  api/token-service.test.ts                  ← unit
  api/auth-middleware.test.ts                ← unit
  api/setup-flow.test.ts                     ← integration
  api/auth-routes.test.ts                    ← integration
  api/migration.test.ts                      ← integration
  api/security.test.ts                       ← security smoke
  cli/profile-store.test.ts                  ← unit
  cli/http-client.test.ts                    ← unit
  cli/e2e-cli-flow.test.ts                   ← e2e
```

### Modified

```
packages/api/src/index.ts                    ← mount new routes, apply requireScopes,
                                               wire TokenService into startup, drop apiKeyAuth
packages/api/src/services/api-keys.ts        ← RENAMED to legacy-api-keys.ts
packages/api/src/routes/memories.ts          ← swap apiKeyAuth → requireScopes(…)
packages/api/package.json                    ← no new deps (crypto is stdlib)
packages/web/src/lib/api.ts                  ← inject Authorization header from localStorage
packages/web/src/components/sidebar.tsx      ← add logout button
package.json                                 ← register packages/cli in workspaces (already globbed)
docker-compose.yml                           ← document TRUST_PROXY env var
README.md                                    ← new bootstrap + CLI setup walkthrough
```

---

## Phase 1 — TokenService & Migration

### Task 1: Rename `api-keys.ts` to `legacy-api-keys.ts` and stub the new TokenService

**Files:**
- Rename: `packages/api/src/services/api-keys.ts` → `packages/api/src/services/legacy-api-keys.ts`
- Create: `packages/api/src/services/token-service.ts`

- [ ] **Step 1: Rename the legacy file**

```bash
git mv packages/api/src/services/api-keys.ts packages/api/src/services/legacy-api-keys.ts
```

- [ ] **Step 2: Update imports of the legacy module**

Search for imports of the old path and update to the new one:

```bash
grep -rn "services/api-keys" packages/api/src/
```

For each match, edit the import from `'./services/api-keys.js'` to `'./services/legacy-api-keys.js'`. Currently this is only `packages/api/src/index.ts:13`.

- [ ] **Step 3: Create the new TokenService skeleton**

Create `packages/api/src/services/token-service.ts`:

```ts
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

export interface CreateOpts {
  template: TokenTemplate;
  name: string;
  agentId?: string;
  namespaceClaim?: string;
  expiresAt?: Date;
  createdBy?: string;
}

export class TokenService {
  private db: Surreal | null = null;
  private cache: Map<string, TokenRecord> = new Map(); // hash → record

  async connect(_cfg: SurrealDBConfig): Promise<void> {
    throw new Error('not implemented');
  }

  async needsBootstrap(): Promise<boolean> {
    throw new Error('not implemented');
  }

  async generateBootstrapCode(): Promise<string> {
    throw new Error('not implemented');
  }

  async exchangeBootstrapCode(_code: string): Promise<{ token: string; record: TokenRecord }> {
    throw new Error('not implemented');
  }

  async validate(_cleartext: string): Promise<TokenRecord | null> {
    throw new Error('not implemented');
  }

  hasScope(_record: TokenRecord, _required: string): boolean {
    throw new Error('not implemented');
  }

  async create(_opts: CreateOpts): Promise<{ token: string; record: TokenRecord }> {
    throw new Error('not implemented');
  }

  async list(_filter?: { prefix?: TokenPrefix }): Promise<Array<Omit<TokenRecord, 'tokenHash'>>> {
    throw new Error('not implemented');
  }

  async revoke(_id: string, _revokedBy?: string): Promise<boolean> {
    throw new Error('not implemented');
  }

  async migrateFromApiKeys(): Promise<{ migrated: number; skipped: number }> {
    throw new Error('not implemented');
  }
}

export const tokenService = new TokenService();

/** Hash helper exported for tests. */
export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (legacy-api-keys.ts still imports work; new token-service.ts has no references yet)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/ packages/api/src/index.ts
git commit -m "Rename api-keys.ts to legacy-api-keys.ts and stub TokenService"
```

---

### Task 2: TDD pure `hasScope()` logic

**Files:**
- Modify: `packages/api/src/services/token-service.ts`
- Create: `tests/api/token-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/api/token-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TokenService, type TokenRecord } from '../../packages/api/src/services/token-service.js';

const base: TokenRecord = {
  id: 'tokens:abc',
  tokenHash: 'hash',
  prefix: 'nc_pat',
  name: 'test',
  scopes: [],
  createdAt: new Date(),
};

describe('TokenService.hasScope', () => {
  const svc = new TokenService();

  it('matches literal scopes', () => {
    const rec = { ...base, scopes: ['memories:read'] };
    expect(svc.hasScope(rec, 'memories:read')).toBe(true);
    expect(svc.hasScope(rec, 'memories:write')).toBe(false);
  });

  it('admin:* matches every non-agent scope', () => {
    const rec = { ...base, scopes: ['admin:*'] };
    expect(svc.hasScope(rec, 'memories:read')).toBe(true);
    expect(svc.hasScope(rec, 'namespaces:write')).toBe(true);
    expect(svc.hasScope(rec, 'knowledge:read')).toBe(true);
    expect(svc.hasScope(rec, 'tokens:write')).toBe(true);
    expect(svc.hasScope(rec, 'federation:*')).toBe(true);
  });

  it('admin:* does NOT match agent:x scopes', () => {
    const rec = { ...base, scopes: ['admin:*'] };
    expect(svc.hasScope(rec, 'agent:alpha')).toBe(false);
  });

  it('agent:{id} matches only its own id', () => {
    const rec = { ...base, scopes: ['agent:alpha', 'memories:read'] };
    expect(svc.hasScope(rec, 'agent:alpha')).toBe(true);
    expect(svc.hasScope(rec, 'agent:beta')).toBe(false);
  });

  it('returns false for empty scopes', () => {
    expect(svc.hasScope(base, 'memories:read')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/token-service.test.ts`
Expected: FAIL with `Error: not implemented` from `hasScope`.

- [ ] **Step 3: Implement `hasScope`**

In `packages/api/src/services/token-service.ts`, replace the `hasScope` stub:

```ts
hasScope(record: TokenRecord, required: string): boolean {
  if (!record.scopes || record.scopes.length === 0) return false;
  // Literal match
  if (record.scopes.includes(required)) return true;
  // admin:* matches everything except agent:{id}
  if (record.scopes.includes('admin:*') && !required.startsWith('agent:')) return true;
  return false;
}
```

- [ ] **Step 4: Re-run tests — should pass**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/token-service.test.ts`
Expected: PASS 5/5.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/token-service.ts tests/api/token-service.test.ts
git commit -m "TokenService.hasScope: literal + admin:* + agent:{id} matching"
```

---

### Task 3: TDD token-template expansion

**Files:**
- Modify: `packages/api/src/services/token-service.ts`
- Modify: `tests/api/token-service.test.ts`

- [ ] **Step 1: Add the failing test for template expansion**

Append to `tests/api/token-service.test.ts`:

```ts
import { expandTemplate } from '../../packages/api/src/services/token-service.js';

describe('expandTemplate', () => {
  it('admin-full → admin:*, tokens:read, tokens:write', () => {
    expect(expandTemplate('admin-full')).toEqual([
      'admin:*',
      'tokens:read',
      'tokens:write',
    ]);
  });

  it('admin-readonly → read scopes only', () => {
    expect(expandTemplate('admin-readonly')).toEqual([
      'memories:read',
      'namespaces:read',
      'knowledge:read',
      'buckets:read',
      'processor:read',
    ]);
  });

  it('agent requires agentId and injects agent:{id} scope', () => {
    expect(expandTemplate('agent', { agentId: 'alpha' })).toEqual([
      'memories:read',
      'memories:write',
      'knowledge:read',
      'agent:alpha',
    ]);
  });

  it('agent without agentId throws', () => {
    expect(() => expandTemplate('agent')).toThrow('agentId required for agent template');
  });

  it('knowledge-ingest → knowledge read + write', () => {
    expect(expandTemplate('knowledge-ingest')).toEqual([
      'knowledge:write',
      'knowledge:read',
    ]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/token-service.test.ts`
Expected: FAIL — `expandTemplate` not exported.

- [ ] **Step 3: Implement `expandTemplate`**

Add to `packages/api/src/services/token-service.ts` (above the class):

```ts
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
```

- [ ] **Step 4: Re-run tests — should pass**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/token-service.test.ts`
Expected: PASS 10/10 (5 hasScope + 5 template).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/token-service.ts tests/api/token-service.test.ts
git commit -m "TokenService: expandTemplate with admin-full/readonly/agent/knowledge-ingest"
```

---

### Task 4: Fake-Surreal test helper + TDD `create()`

**Files:**
- Create: `tests/helpers/fake-surreal.ts`
- Modify: `packages/api/src/services/token-service.ts`
- Modify: `tests/api/token-service.test.ts`

- [ ] **Step 1: Create the fake-surreal helper**

Create `tests/helpers/fake-surreal.ts`:

```ts
/**
 * In-memory SurrealDB-like stub for unit tests.
 * Supports the subset of queries TokenService uses.
 */
export class FakeSurreal {
  private tables: Map<string, Map<string, Record<string, unknown>>> = new Map();
  private idCounter = 0;

  async connect(): Promise<void> {}

  async query<T = unknown>(sql: string, params?: Record<string, unknown>): Promise<T> {
    const trimmed = sql.trim();

    if (/DEFINE TABLE|DEFINE FIELD|DEFINE INDEX|BEGIN|COMMIT|CANCEL/i.test(trimmed)) {
      return [[]] as unknown as T;
    }

    // CREATE tokens SET ...
    const createMatch = trimmed.match(/^CREATE\s+(\w+)\s+SET/i);
    if (createMatch) {
      const table = createMatch[1]!;
      const rows = this.tables.get(table) ?? new Map();
      this.idCounter += 1;
      const id = `${table}:${this.idCounter}`;
      rows.set(id, { id, ...(params ?? {}) });
      this.tables.set(table, rows);
      return [[{ id, ...(params ?? {}) }]] as unknown as T;
    }

    // SELECT * FROM <table> [WHERE ...]
    const selectMatch = trimmed.match(/^SELECT\s+.*\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?/i);
    if (selectMatch) {
      const table = selectMatch[1]!;
      const whereClause = selectMatch[2];
      const rows = Array.from(this.tables.get(table)?.values() ?? []);
      if (!whereClause) return [rows] as unknown as T;
      const filtered = rows.filter((r) => matchesWhere(r, whereClause, params ?? {}));
      return [filtered] as unknown as T;
    }

    // UPDATE <table> SET ... WHERE ...
    const updateMatch = trimmed.match(/^UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
    if (updateMatch) {
      const table = updateMatch[1]!;
      const setClause = updateMatch[2]!;
      const whereClause = updateMatch[3];
      const rows = this.tables.get(table) ?? new Map();
      const matching = Array.from(rows.values()).filter((r) =>
        whereClause ? matchesWhere(r, whereClause, params ?? {}) : true
      );
      for (const row of matching) {
        applySet(row, setClause, params ?? {});
      }
      return [matching] as unknown as T;
    }

    // DELETE FROM <table> WHERE ...
    const deleteMatch = trimmed.match(/^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?/i);
    if (deleteMatch) {
      const table = deleteMatch[1]!;
      const whereClause = deleteMatch[2];
      const rows = this.tables.get(table) ?? new Map();
      if (!whereClause) {
        rows.clear();
        return [[]] as unknown as T;
      }
      for (const [id, row] of rows.entries()) {
        if (matchesWhere(row, whereClause, params ?? {})) rows.delete(id);
      }
      return [[]] as unknown as T;
    }

    return [[]] as unknown as T;
  }

  /** Test introspection — not part of Surreal client API. */
  _getTable(name: string): Array<Record<string, unknown>> {
    return Array.from(this.tables.get(name)?.values() ?? []);
  }

  _seed(table: string, row: Record<string, unknown>): void {
    const rows = this.tables.get(table) ?? new Map();
    const id = (row['id'] as string) ?? `${table}:${++this.idCounter}`;
    rows.set(id, { ...row, id });
    this.tables.set(table, rows);
  }

  _clear(): void {
    this.tables.clear();
    this.idCounter = 0;
  }
}

function matchesWhere(row: Record<string, unknown>, clause: string, params: Record<string, unknown>): boolean {
  // Support a tiny subset: `field = $param`, `field IS NULL`, combined with AND
  const parts = clause.split(/\s+AND\s+/i);
  return parts.every((part) => {
    const isNullMatch = part.match(/(\w+)\s+IS\s+NULL/i);
    if (isNullMatch) return row[isNullMatch[1]!] == null;
    const eqMatch = part.match(/(\w+)\s*=\s*\$(\w+)/);
    if (eqMatch) return row[eqMatch[1]!] === params[eqMatch[2]!];
    // Comparisons like `expiresAt > now` or `revokedAt IS NULL` beyond our subset: accept (true)
    return true;
  });
}

function applySet(row: Record<string, unknown>, clause: string, params: Record<string, unknown>): void {
  const assignments = clause.split(',').map((s) => s.trim());
  for (const assign of assignments) {
    const match = assign.match(/(\w+)\s*=\s*\$(\w+)/);
    if (match) row[match[1]!] = params[match[2]!];
  }
}
```

- [ ] **Step 2: Add TokenService constructor for injection**

Modify `packages/api/src/services/token-service.ts` — change the class header to accept an injectable db:

```ts
export interface SurrealLike {
  query<T = unknown>(sql: string, params?: Record<string, unknown>): Promise<T>;
}

export class TokenService {
  private db: SurrealLike | null = null;
  private cache: Map<string, TokenRecord> = new Map(); // tokenHash → record

  constructor(db?: SurrealLike) {
    if (db) this.db = db;
  }

  // ... existing methods unchanged
}
```

Also change `async connect(cfg: SurrealDBConfig)` to only run the real Surreal client when `this.db` is not already set by the constructor:

```ts
async connect(cfg: SurrealDBConfig): Promise<void> {
  if (!this.db) {
    const real = new Surreal();
    const wsUrl = cfg.url.replace(/^http/, 'ws');
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
```

Add at the bottom of the file, outside the class:

```ts
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
```

- [ ] **Step 3: Write the failing test for `create()`**

Append to `tests/api/token-service.test.ts`:

```ts
import { FakeSurreal } from '../helpers/fake-surreal.js';
import { sha256Hex } from '../../packages/api/src/services/token-service.js';

describe('TokenService.create', () => {
  it('returns cleartext exactly once and stores only the hash', async () => {
    const fake = new FakeSurreal();
    const svc = new TokenService(fake);
    await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });

    const { token, record } = await svc.create({ template: 'admin-full', name: 'Root Admin' });

    expect(token).toMatch(/^nc_pat_[A-Za-z0-9_-]+$/);
    expect(record.tokenHash).toBe(sha256Hex(token));
    expect(record.scopes).toContain('admin:*');
    expect(record.name).toBe('Root Admin');

    const stored = fake._getTable('tokens');
    expect(stored).toHaveLength(1);
    expect(stored[0]!['tokenHash']).toBe(sha256Hex(token));
    // The cleartext is never stored in any row
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('agent template stores namespaceClaim and agentId', async () => {
    const fake = new FakeSurreal();
    const svc = new TokenService(fake);
    await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });

    const { record } = await svc.create({
      template: 'agent',
      name: 'Alpha agent',
      agentId: 'alpha',
      namespaceClaim: 'alpha-workspace',
    });

    expect(record.agentId).toBe('alpha');
    expect(record.namespaceClaim).toBe('alpha-workspace');
    expect(record.scopes).toContain('agent:alpha');
    expect(record.prefix).toBe('nc_agt');
  });
});
```

- [ ] **Step 4: Run tests — should fail on `create not implemented`**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/token-service.test.ts`
Expected: FAIL on `create not implemented`.

- [ ] **Step 5: Implement `create()`**

Replace the `create` stub in `packages/api/src/services/token-service.ts`:

```ts
async create(opts: CreateOpts): Promise<{ token: string; record: TokenRecord }> {
  const db = this.requireDb();
  const scopes = expandTemplate(opts.template, { agentId: opts.agentId });
  const prefix: TokenPrefix = opts.template === 'agent' ? 'nc_agt' : 'nc_pat';
  const random = crypto.randomBytes(24).toString('base64url');
  const cleartext = `${prefix}_${random}`;
  const tokenHash = sha256Hex(cleartext);
  const createdAt = new Date();

  await db.query(
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

  const record: TokenRecord = {
    id: `tokens:cached-${tokenHash.slice(0, 8)}`,
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

private requireDb(): SurrealLike {
  if (!this.db) throw new Error('TokenService not connected — call connect() first');
  return this.db;
}
```

- [ ] **Step 6: Re-run tests — should pass**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/token-service.test.ts`
Expected: PASS 12/12.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/services/token-service.ts tests/helpers/fake-surreal.ts tests/api/token-service.test.ts
git commit -m "TokenService.create + FakeSurreal test helper; cleartext never persisted"
```

---

### Task 5: TDD `validate()` with cache + revoke/expiry handling

**Files:**
- Modify: `packages/api/src/services/token-service.ts`
- Modify: `tests/api/token-service.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/api/token-service.test.ts`:

```ts
describe('TokenService.validate', () => {
  async function setup() {
    const fake = new FakeSurreal();
    const svc = new TokenService(fake);
    await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });
    return { fake, svc };
  }

  it('returns record on valid cleartext (cache hit)', async () => {
    const { svc } = await setup();
    const { token } = await svc.create({ template: 'admin-full', name: 'root' });
    const rec = await svc.validate(token);
    expect(rec?.scopes).toContain('admin:*');
  });

  it('returns null on unknown token', async () => {
    const { svc } = await setup();
    const rec = await svc.validate('nc_pat_bogus');
    expect(rec).toBeNull();
  });

  it('returns null on revoked token', async () => {
    const { svc } = await setup();
    const { token, record } = await svc.create({ template: 'admin-full', name: 'root' });
    await svc.revoke(record.id);
    const rec = await svc.validate(token);
    expect(rec).toBeNull();
  });

  it('returns null on expired token', async () => {
    const { svc } = await setup();
    const { token } = await svc.create({
      template: 'admin-full',
      name: 'root',
      expiresAt: new Date(Date.now() - 1000),
    });
    const rec = await svc.validate(token);
    expect(rec).toBeNull();
  });

  it('returns null for empty or non-string input', async () => {
    const { svc } = await setup();
    expect(await svc.validate('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/token-service.test.ts`
Expected: FAIL on `validate not implemented` and `revoke not implemented`.

- [ ] **Step 3: Implement `validate()` and `revoke()`**

Replace the stubs in `packages/api/src/services/token-service.ts`:

```ts
async validate(cleartext: string): Promise<TokenRecord | null> {
  if (!cleartext || typeof cleartext !== 'string') return null;
  const hash = sha256Hex(cleartext);
  const cached = this.cache.get(hash);
  if (!cached) return null;
  if (cached.revokedAt) return null;
  if (cached.expiresAt && cached.expiresAt.getTime() < Date.now()) return null;

  // Fire-and-forget lastUsedAt update
  cached.lastUsedAt = new Date();
  const db = this.db;
  if (db) {
    void db.query('UPDATE tokens SET lastUsedAt = $now WHERE tokenHash = $hash', {
      now: cached.lastUsedAt.toISOString(),
      hash,
    }).catch(() => {});
  }
  return cached;
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
```

- [ ] **Step 4: Re-run tests — should pass**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/token-service.test.ts`
Expected: PASS 17/17.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/token-service.ts tests/api/token-service.test.ts
git commit -m "TokenService.validate: cache lookup + revocation + expiry checks"
```

---

### Task 6: TDD bootstrap code generate/exchange with constant-time compare

**Files:**
- Modify: `packages/api/src/services/token-service.ts`
- Modify: `tests/api/token-service.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/api/token-service.test.ts`:

```ts
describe('TokenService bootstrap flow', () => {
  async function setup() {
    const fake = new FakeSurreal();
    const svc = new TokenService(fake);
    await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });
    return { fake, svc };
  }

  it('needsBootstrap is true on empty tokens table', async () => {
    const { svc } = await setup();
    expect(await svc.needsBootstrap()).toBe(true);
  });

  it('needsBootstrap is false once any non-boot token exists', async () => {
    const { svc } = await setup();
    await svc.create({ template: 'admin-full', name: 'root' });
    expect(await svc.needsBootstrap()).toBe(false);
  });

  it('generateBootstrapCode returns nc_boot_* and is idempotent within a session', async () => {
    const { svc } = await setup();
    const a = await svc.generateBootstrapCode();
    const b = await svc.generateBootstrapCode();
    expect(a).toMatch(/^nc_boot_[A-Za-z0-9_-]+$/);
    expect(a).toBe(b);
  });

  it('exchangeBootstrapCode succeeds once, burns the code, mints admin-full token', async () => {
    const { svc } = await setup();
    const code = await svc.generateBootstrapCode();
    const result = await svc.exchangeBootstrapCode(code);
    expect(result.token).toMatch(/^nc_pat_/);
    expect(result.record.scopes).toContain('admin:*');

    // Second exchange with the same code must fail
    await expect(svc.exchangeBootstrapCode(code)).rejects.toThrow(/invalid_setup_code/);
  });

  it('exchangeBootstrapCode rejects unknown code with invalid_setup_code', async () => {
    const { svc } = await setup();
    await svc.generateBootstrapCode();
    await expect(svc.exchangeBootstrapCode('nc_boot_nope')).rejects.toThrow(/invalid_setup_code/);
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/token-service.test.ts`
Expected: FAIL on `needsBootstrap not implemented`.

- [ ] **Step 3: Implement bootstrap methods**

In `packages/api/src/services/token-service.ts`, replace the three stubs:

```ts
private currentBootstrapCode: string | null = null;

async needsBootstrap(): Promise<boolean> {
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
```

- [ ] **Step 4: Re-run tests — should pass**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/token-service.test.ts`
Expected: PASS 22/22.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/token-service.ts tests/api/token-service.test.ts
git commit -m "TokenService: bootstrap generate/exchange with timingSafeEqual compare"
```

---

### Task 7: TDD `migrateFromApiKeys()` idempotent migration

**Files:**
- Modify: `packages/api/src/services/token-service.ts`
- Modify: `tests/api/token-service.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/api/token-service.test.ts`:

```ts
describe('TokenService.migrateFromApiKeys', () => {
  async function setup() {
    const fake = new FakeSurreal();
    const svc = new TokenService(fake);
    await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });
    return { fake, svc };
  }

  it('empty api_keys table → zero migrated, no error', async () => {
    const { svc } = await setup();
    const result = await svc.migrateFromApiKeys();
    expect(result).toEqual({ migrated: 0, skipped: 0 });
  });

  it('migrates active api_keys rows into tokens with hashed key', async () => {
    const { fake, svc } = await setup();
    fake._seed('api_keys', {
      id: 'api_keys:alpha',
      agentId: 'alpha',
      key: 'sk_alpha_xyz',
      primaryNamespace: 'alpha-ns',
      readableNamespaces: ['alpha-ns', 'shared-ns'],
      createdAt: new Date().toISOString(),
      active: true,
    });

    const result = await svc.migrateFromApiKeys();
    expect(result.migrated).toBe(1);

    const tokens = fake._getTable('tokens');
    expect(tokens).toHaveLength(1);
    const row = tokens[0]!;
    expect(row['prefix']).toBe('nc_agt_migrated');
    expect(row['agentId']).toBe('alpha');
    expect(row['namespaceClaim']).toBe('alpha-ns');
    expect(row['scopes']).toEqual(
      expect.arrayContaining(['memories:read', 'memories:write', 'knowledge:read', 'agent:alpha'])
    );
    expect(row['tokenHash']).toBe(sha256Hex('sk_alpha_xyz'));

    // Cleartext of sk_alpha_xyz must never appear in the row
    expect(JSON.stringify(row)).not.toContain('sk_alpha_xyz');
  });

  it('is idempotent — running twice does not duplicate rows', async () => {
    const { fake, svc } = await setup();
    fake._seed('api_keys', {
      id: 'api_keys:alpha',
      agentId: 'alpha',
      key: 'sk_alpha_xyz',
      primaryNamespace: 'alpha-ns',
      readableNamespaces: ['alpha-ns'],
      createdAt: new Date().toISOString(),
      active: true,
    });

    const first = await svc.migrateFromApiKeys();
    const second = await svc.migrateFromApiKeys();

    expect(first.migrated).toBe(1);
    expect(second).toEqual({ migrated: 0, skipped: 1 });
    expect(fake._getTable('tokens')).toHaveLength(1);
  });

  it('migrated agent key validates through TokenService.validate', async () => {
    const { fake, svc } = await setup();
    fake._seed('api_keys', {
      id: 'api_keys:alpha',
      agentId: 'alpha',
      key: 'sk_alpha_xyz',
      primaryNamespace: 'alpha-ns',
      readableNamespaces: ['alpha-ns'],
      createdAt: new Date().toISOString(),
      active: true,
    });
    await svc.migrateFromApiKeys();

    const rec = await svc.validate('sk_alpha_xyz');
    expect(rec).not.toBeNull();
    expect(rec?.scopes).toContain('agent:alpha');
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/token-service.test.ts`
Expected: FAIL on `migrateFromApiKeys not implemented`.

- [ ] **Step 3: Implement `migrateFromApiKeys()`**

Replace the stub in `packages/api/src/services/token-service.ts`:

```ts
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
         prefix = 'nc_agt_migrated',
         name = $name,
         scopes = $scopes,
         namespaceClaim = $namespaceClaim,
         agentId = $agentId,
         createdAt = $createdAt`,
      {
        tokenHash,
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
```

- [ ] **Step 4: Re-run tests — should pass**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/token-service.test.ts`
Expected: PASS 26/26.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/token-service.ts tests/api/token-service.test.ts
git commit -m "TokenService.migrateFromApiKeys: idempotent hash migration of legacy keys"
```

---

<!-- END OF PHASE 1 -->

## Phase 2 — Auth Middleware

### Task 8: TDD `extractToken()` + middleware scaffold

**Files:**
- Create: `packages/api/src/middleware/auth.ts`
- Create: `tests/api/auth-middleware.test.ts`

- [ ] **Step 1: Create auth.ts scaffold**

Create `packages/api/src/middleware/auth.ts`:

```ts
/**
 * Auth middleware — token extraction, scope enforcement, rate limiting.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { tokenService, type TokenRecord } from '../services/token-service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: {
        tokenId: string;
        scopes: string[];
        agentId?: string;
        namespaceClaim?: string;
      };
    }
  }
}

/** Extract a bearer token from the Authorization header or X-API-Key header. */
export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const rest = authHeader.slice(7).trim();
    return rest.length > 0 ? rest : null;
  }
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) return apiKeyHeader;
  return null;
}

/** Enforce that the request bears a token with all of the required scopes. */
export function requireScopes(..._required: string[]): RequestHandler {
  return async (_req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: 'not_implemented' });
  };
}

/** In-memory per-IP rate limiter. */
export function rateLimit(_opts: { perMinute: number }): RequestHandler {
  return (_req: Request, _res: Response, next: NextFunction) => next();
}

/** Resolve client IP, honoring TRUST_PROXY env var. */
export function resolveClientIp(req: Request): string {
  if (process.env['TRUST_PROXY'] === 'true') {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0]!.trim();
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}

// Re-export for tests
export { tokenService };
export type { TokenRecord };
```

- [ ] **Step 2: Write failing tests for extractToken**

Create `tests/api/auth-middleware.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { extractToken, resolveClientIp } from '../../packages/api/src/middleware/auth.js';

function fakeReq(headers: Record<string, string | string[] | undefined>, socketAddr = '127.0.0.1'): Request {
  return {
    headers,
    socket: { remoteAddress: socketAddr },
  } as unknown as Request;
}

describe('extractToken', () => {
  it('returns the token after "Bearer "', () => {
    expect(extractToken(fakeReq({ authorization: 'Bearer nc_pat_abc' }))).toBe('nc_pat_abc');
  });

  it('returns the X-API-Key header when Authorization is missing', () => {
    expect(extractToken(fakeReq({ 'x-api-key': 'sk_foo_bar' }))).toBe('sk_foo_bar');
  });

  it('returns null when both headers are missing', () => {
    expect(extractToken(fakeReq({}))).toBeNull();
  });

  it('returns null when Authorization is present but empty', () => {
    expect(extractToken(fakeReq({ authorization: 'Bearer ' }))).toBeNull();
  });
});

describe('resolveClientIp', () => {
  it('uses socket.remoteAddress by default', () => {
    delete process.env['TRUST_PROXY'];
    expect(resolveClientIp(fakeReq({}, '203.0.113.1'))).toBe('203.0.113.1');
  });

  it('uses first X-Forwarded-For entry when TRUST_PROXY=true', () => {
    process.env['TRUST_PROXY'] = 'true';
    expect(resolveClientIp(fakeReq({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' }))).toBe(
      '198.51.100.2'
    );
    delete process.env['TRUST_PROXY'];
  });
});
```

- [ ] **Step 3: Run — expect extractToken tests to pass and requireScopes/rateLimit tests (not yet written) absent**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/auth-middleware.test.ts`
Expected: PASS 6/6.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/middleware/auth.ts tests/api/auth-middleware.test.ts
git commit -m "Auth middleware scaffold: extractToken + resolveClientIp with TRUST_PROXY"
```

---

### Task 9: TDD `requireScopes()` middleware

**Files:**
- Modify: `packages/api/src/middleware/auth.ts`
- Modify: `tests/api/auth-middleware.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/api/auth-middleware.test.ts`:

```ts
import { vi } from 'vitest';
import type { Response, NextFunction } from 'express';
import { requireScopes } from '../../packages/api/src/middleware/auth.js';
import { tokenService } from '../../packages/api/src/services/token-service.js';
import type { TokenRecord } from '../../packages/api/src/services/token-service.js';

function mockRes() {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  return { status, json } as unknown as Response;
}

const record = (scopes: string[], overrides: Partial<TokenRecord> = {}): TokenRecord => ({
  id: 'tokens:test',
  tokenHash: 'hash',
  prefix: 'nc_pat',
  name: 'test',
  scopes,
  createdAt: new Date(),
  ...overrides,
});

describe('requireScopes', () => {
  it('returns 401 missing_token when no auth header', async () => {
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await requireScopes('memories:read')(
      { headers: {}, socket: { remoteAddress: '1.1.1.1' } } as never,
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'missing_token' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 invalid_token when validate returns null', async () => {
    vi.spyOn(tokenService, 'validate').mockResolvedValueOnce(null);
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await requireScopes('memories:read')(
      { headers: { authorization: 'Bearer bogus' }, socket: { remoteAddress: '1.1.1.1' } } as never,
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_token' })
    );
  });

  it('returns 403 insufficient_scope when scopes missing', async () => {
    vi.spyOn(tokenService, 'validate').mockResolvedValueOnce(record(['memories:read']));
    vi.spyOn(tokenService, 'hasScope').mockImplementation((r, s) => r.scopes.includes(s));
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await requireScopes('namespaces:write')(
      { headers: { authorization: 'Bearer any' }, socket: { remoteAddress: '1.1.1.1' } } as never,
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'insufficient_scope',
        required: ['namespaces:write'],
        granted: ['memories:read'],
      })
    );
  });

  it('calls next() and attaches req.auth on success', async () => {
    vi.spyOn(tokenService, 'validate').mockResolvedValueOnce(
      record(['admin:*'], { agentId: undefined })
    );
    vi.spyOn(tokenService, 'hasScope').mockReturnValueOnce(true);
    const next = vi.fn() as unknown as NextFunction;
    const req = {
      headers: { authorization: 'Bearer any' },
      socket: { remoteAddress: '1.1.1.1' },
    } as Record<string, unknown> & { auth?: unknown };
    await requireScopes('memories:read')(req as never, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth).toEqual(
      expect.objectContaining({ tokenId: 'tokens:test', scopes: ['admin:*'] })
    );
  });
});
```

- [ ] **Step 2: Run — should fail (current stub returns 500)**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/auth-middleware.test.ts`
Expected: FAIL — middleware returns `not_implemented`.

- [ ] **Step 3: Add `auditEvent()` helper to TokenService**

In `packages/api/src/services/token-service.ts`, add a public method on the class:

```ts
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
```

- [ ] **Step 4: Implement `requireScopes` with audit logging**

Replace the stub in `packages/api/src/middleware/auth.ts`:

```ts
export function requireScopes(...required: string[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = resolveClientIp(req);
    const cleartext = extractToken(req);
    if (!cleartext) {
      void tokenService.auditEvent('auth.failed', { reason: 'missing_token', ip, path: req.path });
      res.status(401).json({
        error: 'missing_token',
        message: 'Authentication required',
        hint: 'Send Authorization: Bearer <token>',
      });
      return;
    }

    const record = await tokenService.validate(cleartext);
    if (!record) {
      void tokenService.auditEvent('auth.failed', { reason: 'invalid_token', ip, path: req.path });
      res.status(401).json({
        error: 'invalid_token',
        message: 'Token is invalid, revoked, or expired',
      });
      return;
    }

    const missing = required.filter((s) => !tokenService.hasScope(record, s));
    if (missing.length > 0) {
      void tokenService.auditEvent('auth.scope_denied', {
        ip,
        path: req.path,
        tokenId: record.id,
        required,
        granted: record.scopes,
      });
      res.status(403).json({
        error: 'insufficient_scope',
        message: 'Token does not grant the required scopes',
        required,
        granted: record.scopes,
      });
      return;
    }

    req.auth = {
      tokenId: record.id,
      scopes: record.scopes,
      agentId: record.agentId,
      namespaceClaim: record.namespaceClaim,
    };
    next();
  };
}
```

- [ ] **Step 5: Re-run tests**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/auth-middleware.test.ts`
Expected: PASS 10/10.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/middleware/auth.ts packages/api/src/services/token-service.ts tests/api/auth-middleware.test.ts
git commit -m "requireScopes middleware: 401/403 with audit logging and info-disclosure-safe shapes"
```

---

### Task 10: TDD `rateLimit()` middleware

**Files:**
- Modify: `packages/api/src/middleware/auth.ts`
- Modify: `tests/api/auth-middleware.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/api/auth-middleware.test.ts`:

```ts
import { rateLimit } from '../../packages/api/src/middleware/auth.js';

describe('rateLimit', () => {
  it('allows requests under the limit and rejects over it', async () => {
    const limiter = rateLimit({ perMinute: 3 });
    const req = { headers: {}, socket: { remoteAddress: '9.9.9.9' } } as never;

    for (let i = 0; i < 3; i += 1) {
      const res = mockRes();
      const next = vi.fn() as unknown as NextFunction;
      limiter(req, res, next);
      expect(next).toHaveBeenCalled();
    }

    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    limiter(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'rate_limited' })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — should fail (stub always calls next)**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/auth-middleware.test.ts`
Expected: FAIL on the 4th call.

- [ ] **Step 3: Implement `rateLimit`**

Replace the stub in `packages/api/src/middleware/auth.ts`:

```ts
interface RateBucket {
  count: number;
  resetAt: number;
}
const rateBuckets = new Map<string, RateBucket>();

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets.entries()) {
    if (bucket.resetAt < now) rateBuckets.delete(key);
  }
}, 60_000).unref?.();

export function rateLimit(opts: { perMinute: number }): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = resolveClientIp(req);
    const now = Date.now();
    const bucket = rateBuckets.get(ip);
    if (!bucket || bucket.resetAt < now) {
      rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
      next();
      return;
    }
    if (bucket.count >= opts.perMinute) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: 'rate_limited',
        message: 'Too many requests',
        hint: `Retry after ${retryAfter} seconds`,
      });
      return;
    }
    bucket.count += 1;
    next();
  };
}
```

- [ ] **Step 4: Re-run tests**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/auth-middleware.test.ts`
Expected: PASS 11/11.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/middleware/auth.ts tests/api/auth-middleware.test.ts
git commit -m "rateLimit middleware: per-IP in-memory bucket with Retry-After"
```

---

<!-- END OF PHASE 2 -->

## Phase 3 — API Routes & Admin Lockdown

### Task 11: Integration test harness + `setup.ts` route

**Files:**
- Create: `tests/helpers/test-server.ts`
- Create: `packages/api/src/routes/setup.ts`
- Create: `tests/api/setup-flow.test.ts`

- [ ] **Step 1: Create the test-server helper**

Create `tests/helpers/test-server.ts`:

```ts
import express, { type Express } from 'express';
import { TokenService } from '../../packages/api/src/services/token-service.js';
import { FakeSurreal } from './fake-surreal.js';
import { tokenService as singletonTokenService } from '../../packages/api/src/middleware/auth.js';

/**
 * Build a minimal Express app wired to a FakeSurreal-backed TokenService.
 * Mounts the given list of route installers. The singleton tokenService is
 * rebound to the test instance so that middleware using it sees the test DB.
 */
export async function buildTestApp(
  installers: Array<(app: Express) => void>
): Promise<{ app: Express; fake: FakeSurreal; svc: TokenService }> {
  const fake = new FakeSurreal();
  const svc = new TokenService(fake);
  await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });

  // Rebind every method of the singleton to the test instance so existing
  // middleware imports still work.
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(svc))) {
    if (key === 'constructor') continue;
    const fn = (svc as unknown as Record<string, unknown>)[key];
    if (typeof fn === 'function') {
      (singletonTokenService as unknown as Record<string, unknown>)[key] = fn.bind(svc);
    }
  }

  const app = express();
  app.use(express.json());
  for (const install of installers) install(app);
  return { app, fake, svc };
}

export async function jsonRequest(
  app: Express,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: unknown }> {
  // Use Node's native fetch against an on-the-fly listening server.
  const { createServer } = await import('http');
  const server = app.listen(0);
  try {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const parsed = res.status === 204 ? undefined : await res.json().catch(() => undefined);
    return { status: res.status, body: parsed };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
```

- [ ] **Step 2: Write failing integration tests for setup flow**

Create `tests/api/setup-flow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTestApp, jsonRequest } from '../helpers/test-server.js';
import { installSetupRoute } from '../../packages/api/src/routes/setup.js';

describe('POST /setup/exchange', () => {
  it('exchanges a valid bootstrap code for an admin token, burns the code', async () => {
    const { app, svc } = await buildTestApp([installSetupRoute]);
    const code = await svc.generateBootstrapCode();

    const first = await jsonRequest(app, 'POST', '/setup/exchange', { code });
    expect(first.status).toBe(200);
    expect((first.body as { token: string }).token).toMatch(/^nc_pat_/);

    const second = await jsonRequest(app, 'POST', '/setup/exchange', { code });
    expect(second.status).toBe(401);
    expect((second.body as { error: string }).error).toBe('invalid_setup_code');
  });

  it('rejects an unknown code with invalid_setup_code', async () => {
    const { app, svc } = await buildTestApp([installSetupRoute]);
    await svc.generateBootstrapCode();
    const res = await jsonRequest(app, 'POST', '/setup/exchange', { code: 'nc_boot_wrong' });
    expect(res.status).toBe(401);
  });

  it('rejects missing code with 400', async () => {
    const { app } = await buildTestApp([installSetupRoute]);
    const res = await jsonRequest(app, 'POST', '/setup/exchange', {});
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run — expect import failure**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/setup-flow.test.ts`
Expected: FAIL — `installSetupRoute` does not exist.

- [ ] **Step 4: Implement the setup route**

Create `packages/api/src/routes/setup.ts`:

```ts
import type { Express, Request, Response } from 'express';
import { tokenService } from '../services/token-service.js';
import { rateLimit } from '../middleware/auth.js';

export function installSetupRoute(app: Express): void {
  app.post('/setup/exchange', rateLimit({ perMinute: 5 }), async (req: Request, res: Response) => {
    const { code } = (req.body ?? {}) as { code?: string };
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'bad_request', message: 'code required' });
      return;
    }
    try {
      const { token, record } = await tokenService.exchangeBootstrapCode(code);
      res.status(200).json({
        token,
        whoami: {
          kind: 'selfhosted',
          name: record.name,
          scopes: record.scopes,
          server: { version: process.env['npm_package_version'] ?? 'dev', mode: 'selfhosted' },
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown';
      res.status(401).json({ error: message });
    }
  });
}
```

- [ ] **Step 5: Re-run tests**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/setup-flow.test.ts`
Expected: PASS 3/3.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/test-server.ts tests/api/setup-flow.test.ts packages/api/src/routes/setup.ts
git commit -m "POST /setup/exchange route with rate limit + test harness helper"
```

---

### Task 12: `auth.ts` route — `GET /auth/whoami`

**Files:**
- Create: `packages/api/src/routes/auth.ts`
- Create: `tests/api/auth-routes.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/api/auth-routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTestApp, jsonRequest } from '../helpers/test-server.js';
import { installAuthRoute } from '../../packages/api/src/routes/auth.js';

describe('GET /auth/whoami', () => {
  it('401 without token', async () => {
    const { app } = await buildTestApp([installAuthRoute]);
    const res = await jsonRequest(app, 'GET', '/auth/whoami');
    expect(res.status).toBe(401);
  });

  it('200 with valid admin token, returns scopes and server info', async () => {
    const { app, svc } = await buildTestApp([installAuthRoute]);
    const { token } = await svc.create({ template: 'admin-full', name: 'Root' });

    const res = await jsonRequest(app, 'GET', '/auth/whoami', undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      kind: string;
      name: string;
      scopes: string[];
      server: { mode: string };
    };
    expect(body.kind).toBe('selfhosted');
    expect(body.name).toBe('Root');
    expect(body.scopes).toContain('admin:*');
    expect(body.server.mode).toBe('selfhosted');
  });
});
```

- [ ] **Step 2: Run — expect import failure**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/auth-routes.test.ts`
Expected: FAIL — `installAuthRoute` missing.

- [ ] **Step 3: Implement the route**

Create `packages/api/src/routes/auth.ts`:

```ts
import type { Express, Request, Response } from 'express';
import { requireScopes, tokenService, rateLimit } from '../middleware/auth.js';

export function installAuthRoute(app: Express): void {
  app.get(
    '/auth/whoami',
    rateLimit({ perMinute: 30 }),
    requireScopes(),
    async (req: Request, res: Response) => {
      const tokenId = req.auth!.tokenId;
      const list = await tokenService.list();
      const record = list.find((t) => t.id === tokenId);
      res.status(200).json({
        kind: 'selfhosted',
        name: record?.name ?? 'unknown',
        scopes: req.auth!.scopes,
        expiresAt: record?.expiresAt ?? null,
        server: {
          version: process.env['npm_package_version'] ?? 'dev',
          mode: 'selfhosted',
        },
      });
    }
  );
}
```

- [ ] **Step 4: Implement `TokenService.list()`**

Replace the `list` stub in `packages/api/src/services/token-service.ts`:

```ts
async list(filter?: { prefix?: TokenPrefix }): Promise<Array<Omit<TokenRecord, 'tokenHash'>>> {
  return Array.from(this.cache.values())
    .filter((rec) => !filter?.prefix || rec.prefix === filter.prefix)
    .map(({ tokenHash: _tokenHash, ...rest }) => rest);
}
```

- [ ] **Step 5: Re-run tests**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/auth-routes.test.ts tests/api/token-service.test.ts`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/auth.ts packages/api/src/services/token-service.ts tests/api/auth-routes.test.ts
git commit -m "GET /auth/whoami route + TokenService.list"
```

---

### Task 13: `tokens.ts` route — CRUD

**Files:**
- Create: `packages/api/src/routes/tokens.ts`
- Modify: `tests/api/auth-routes.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/api/auth-routes.test.ts`:

```ts
import { installTokensRoute } from '../../packages/api/src/routes/tokens.js';

describe('Tokens CRUD', () => {
  async function setup() {
    const { app, svc } = await buildTestApp([installAuthRoute, installTokensRoute]);
    const { token } = await svc.create({ template: 'admin-full', name: 'Root' });
    return { app, svc, token };
  }

  it('POST /tokens requires tokens:write scope', async () => {
    const { app, svc } = await buildTestApp([installTokensRoute]);
    const { token } = await svc.create({ template: 'admin-readonly', name: 'Reader' });
    const res = await jsonRequest(
      app,
      'POST',
      '/tokens',
      { template: 'knowledge-ingest', name: 'CI' },
      { Authorization: `Bearer ${token}` }
    );
    expect(res.status).toBe(403);
  });

  it('POST /tokens creates a token and returns the cleartext exactly once', async () => {
    const { app, token } = await setup();
    const res = await jsonRequest(
      app,
      'POST',
      '/tokens',
      { template: 'knowledge-ingest', name: 'CI' },
      { Authorization: `Bearer ${token}` }
    );
    expect(res.status).toBe(201);
    const body = res.body as { token: string; record: { name: string; scopes: string[] } };
    expect(body.token).toMatch(/^nc_pat_/);
    expect(body.record.name).toBe('CI');
    expect(body.record.scopes).toEqual(
      expect.arrayContaining(['knowledge:write', 'knowledge:read'])
    );
  });

  it('GET /tokens lists tokens without cleartext', async () => {
    const { app, token } = await setup();
    const res = await jsonRequest(app, 'GET', '/tokens', undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    const list = res.body as Array<{ name: string; tokenHash?: string }>;
    expect(list.length).toBeGreaterThanOrEqual(1);
    for (const entry of list) {
      expect(entry.tokenHash).toBeUndefined();
    }
  });

  it('DELETE /tokens/:id revokes a token', async () => {
    const { app, svc, token } = await setup();
    const { record } = await svc.create({ template: 'knowledge-ingest', name: 'doomed' });
    const res = await jsonRequest(app, 'DELETE', `/tokens/${encodeURIComponent(record.id)}`, undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run — expect import failure**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/auth-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `tokens.ts`**

Create `packages/api/src/routes/tokens.ts`:

```ts
import type { Express, Request, Response } from 'express';
import { requireScopes, tokenService, rateLimit } from '../middleware/auth.js';
import type { TokenTemplate } from '../services/token-service.js';

const VALID_TEMPLATES: TokenTemplate[] = ['admin-full', 'admin-readonly', 'agent', 'knowledge-ingest'];

export function installTokensRoute(app: Express): void {
  app.get(
    '/tokens',
    rateLimit({ perMinute: 60 }),
    requireScopes('tokens:read'),
    async (_req: Request, res: Response) => {
      const list = await tokenService.list();
      res.status(200).json(list);
    }
  );

  app.post(
    '/tokens',
    rateLimit({ perMinute: 20 }),
    requireScopes('tokens:write'),
    async (req: Request, res: Response) => {
      const { template, name, agentId, namespaceClaim, expiresAt } =
        (req.body ?? {}) as {
          template?: string;
          name?: string;
          agentId?: string;
          namespaceClaim?: string;
          expiresAt?: string;
        };

      if (!template || !VALID_TEMPLATES.includes(template as TokenTemplate)) {
        res.status(400).json({
          error: 'bad_request',
          message: `template must be one of ${VALID_TEMPLATES.join(', ')}`,
        });
        return;
      }
      if (!name || typeof name !== 'string' || name.length === 0) {
        res.status(400).json({ error: 'bad_request', message: 'name required' });
        return;
      }
      if (template === 'agent' && !agentId) {
        res.status(400).json({ error: 'bad_request', message: 'agentId required for agent template' });
        return;
      }

      try {
        const { token, record } = await tokenService.create({
          template: template as TokenTemplate,
          name,
          agentId,
          namespaceClaim,
          expiresAt: expiresAt ? new Date(expiresAt) : undefined,
          createdBy: req.auth!.tokenId,
        });
        res.status(201).json({
          token,
          record: {
            id: record.id,
            name: record.name,
            prefix: record.prefix,
            scopes: record.scopes,
            agentId: record.agentId,
            namespaceClaim: record.namespaceClaim,
            createdAt: record.createdAt,
            expiresAt: record.expiresAt,
          },
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'unknown';
        res.status(400).json({ error: 'bad_request', message });
      }
    }
  );

  app.delete(
    '/tokens/:id',
    rateLimit({ perMinute: 20 }),
    requireScopes('tokens:write'),
    async (req: Request, res: Response) => {
      const ok = await tokenService.revoke(req.params['id']!, req.auth!.tokenId);
      res.status(ok ? 204 : 404).end();
    }
  );
}
```

- [ ] **Step 4: Re-run tests**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/auth-routes.test.ts`
Expected: PASS all.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/tokens.ts tests/api/auth-routes.test.ts
git commit -m "Tokens CRUD routes: scope-gated create/list/revoke, cleartext returned once"
```

---

### Task 14: `admin.ts` route — `POST /admin/migrate` retry

**Files:**
- Create: `packages/api/src/routes/admin.ts`
- Create: `tests/api/migration.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/api/migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTestApp, jsonRequest } from '../helpers/test-server.js';
import { installAdminRoute } from '../../packages/api/src/routes/admin.js';

describe('POST /admin/migrate', () => {
  it('requires admin:* scope', async () => {
    const { app, svc } = await buildTestApp([installAdminRoute]);
    const { token } = await svc.create({ template: 'admin-readonly', name: 'Reader' });
    const res = await jsonRequest(app, 'POST', '/admin/migrate', undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(403);
  });

  it('runs migrateFromApiKeys with admin token', async () => {
    const { app, fake, svc } = await buildTestApp([installAdminRoute]);
    const { token } = await svc.create({ template: 'admin-full', name: 'Root' });
    fake._seed('api_keys', {
      id: 'api_keys:new',
      agentId: 'new',
      key: 'sk_new_abc',
      primaryNamespace: 'new-ns',
      readableNamespaces: ['new-ns'],
      createdAt: new Date().toISOString(),
      active: true,
    });

    const res = await jsonRequest(app, 'POST', '/admin/migrate', undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    expect((res.body as { migrated: number }).migrated).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect import failure**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/migration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `admin.ts`**

Create `packages/api/src/routes/admin.ts`:

```ts
import type { Express, Request, Response } from 'express';
import { requireScopes, tokenService, rateLimit } from '../middleware/auth.js';

export function installAdminRoute(app: Express): void {
  app.post(
    '/admin/migrate',
    rateLimit({ perMinute: 3 }),
    requireScopes('admin:*'),
    async (_req: Request, res: Response) => {
      try {
        const result = await tokenService.migrateFromApiKeys();
        res.status(200).json(result);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'unknown';
        res.status(500).json({ error: 'migration_failed', message });
      }
    }
  );
}
```

- [ ] **Step 4: Re-run tests**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/migration.test.ts`
Expected: PASS 2/2.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/admin.ts tests/api/migration.test.ts
git commit -m "POST /admin/migrate route for legacy-fallback retry (admin:* scope)"
```

---

### Task 15: Lock down `index.ts` — apply `requireScopes` to every admin route

**Files:**
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Read the current index.ts auth middleware block**

Run: `grep -n "apiKeyAuth\|app\.\(get\|post\|put\|delete\)" packages/api/src/index.ts | head -80`

Note the line numbers of every route handler and the existing `apiKeyAuth` middleware definition.

- [ ] **Step 2: Add the new imports at the top**

In `packages/api/src/index.ts`, locate the existing imports (around lines 9-22) and change:

```ts
import { apiKeyService, type ApiKeyConfig } from './services/api-keys.js';
```

to:

```ts
import { apiKeyService, type ApiKeyConfig } from './services/legacy-api-keys.js';
import { tokenService } from './services/token-service.js';
import { requireScopes, rateLimit } from './middleware/auth.js';
import { installSetupRoute } from './routes/setup.js';
import { installAuthRoute } from './routes/auth.js';
import { installTokensRoute } from './routes/tokens.js';
import { installAdminRoute } from './routes/admin.js';
```

- [ ] **Step 3: Remove the old `apiKeyAuth` middleware definition**

Locate `const apiKeyAuth = (req: Request, …) => { … }` near line 824. Delete the entire function and its comment line. Any route using `apiKeyAuth` will be updated in the next steps.

- [ ] **Step 4: Replace admin route handlers with `requireScopes` wrappers**

For each admin route, wrap the existing handler with `requireScopes(<scope>)` as second argument. Map:

| Route | Scope |
|---|---|
| `GET /stats` | `memories:read` |
| `GET /namespaces` | `namespaces:read` |
| `POST /namespaces` | `namespaces:write` |
| `DELETE /namespaces/:name` | `namespaces:write` |
| `POST /search` | `memories:read` |
| `GET /memories` routes (via router) | wrap at mount — see Step 5 |
| `GET /processor*` | `processor:read` |
| `POST /processor*` | `processor:write` |
| `PUT /processor/schedule` | `processor:write` |
| `GET /license` | `memories:read` (read-only info) |
| `POST /license/activate`, `POST /license/validate` | `admin:*` |
| `GET /federation*` | `federation:*` |
| `POST /federation`, `PUT/DELETE /federation/:id` | `federation:*` |
| `POST /api-keys`, `GET /api-keys`, `PUT/DELETE/…` | `tokens:write` (deprecated CRUD path) |
| `POST /knowledge/upload`, `DELETE /knowledge/:id` | `knowledge:write` |
| `GET /knowledge`, `GET /knowledge/:id` | `knowledge:read` |
| `GET /buckets`, `GET /buckets/:id` | `buckets:read` |
| `POST/DELETE /buckets*` | `buckets:write` |

Concretely, an edit looks like this:

```ts
// before
app.get('/stats', async (_req: Request, res: Response) => { ... });

// after
app.get('/stats', requireScopes('memories:read'), async (_req: Request, res: Response) => { ... });
```

Leave `/health*` endpoints **unauthenticated** (health checks must be reachable).

- [ ] **Step 5: Replace `apiKeyAuth` references on agent routes with `requireScopes` + namespace check**

Lines 1206, 1266, 1328, 1364 use `apiKeyAuth`. Replace each with:

```ts
app.get('/agent/knowledge', requireScopes('knowledge:read'), async (req: Request, res: Response) => { ... });
```

Any handler that reads `req.agentContext` must be updated to read `req.auth?.agentId` and `req.auth?.namespaceClaim` instead. Add a helper at the top of the agent-route block:

```ts
function requireAgentContext(req: Request, res: Response): { agentId: string; namespaceClaim: string } | null {
  const agentId = req.auth?.agentId;
  const namespaceClaim = req.auth?.namespaceClaim;
  if (!agentId || !namespaceClaim) {
    res.status(403).json({ error: 'forbidden_namespace', message: 'Token is not an agent token' });
    return null;
  }
  return { agentId, namespaceClaim };
}
```

Then inside each agent handler:

```ts
const ctx = requireAgentContext(req, res);
if (!ctx) return;
// use ctx.agentId and ctx.namespaceClaim where req.agentContext used to be
```

- [ ] **Step 6: Mount the new routes**

Right after the `app.use(express.json(...))` block, add:

```ts
installSetupRoute(app);
installAuthRoute(app);
installTokensRoute(app);
installAdminRoute(app);
```

- [ ] **Step 7: Delete the old `POST/GET/PUT/DELETE /api-keys` handlers**

Those are now replaced by `POST/GET/DELETE /tokens`. Remove lines 845-980 (the entire `/api-keys` block) from `index.ts`. Leave the legacy `apiKeyService` import only for the migration-fallback path (next task).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Run the full suite**

Run: `npx vitest run --config tests/vitest.config.ts`
Expected: All existing + new tests pass.

- [ ] **Step 10: Commit**

```bash
git add packages/api/src/index.ts
git commit -m "Lock down all admin routes with requireScopes; remove legacy apiKeyAuth"
```

---

### Task 16: Wire bootstrap + migration into startup

**Files:**
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Add the startup routine**

Locate the server start section in `packages/api/src/index.ts` (near the end of the file, where `app.listen(...)` is called). Replace it with:

```ts
async function startup(): Promise<void> {
  await tokenService.connect(config.surrealdb);

  try {
    const result = await tokenService.migrateFromApiKeys();
    if (result.migrated > 0) {
      logger.info(`migration: migrated ${result.migrated} legacy api_keys → tokens`);
    }
  } catch (e) {
    logger.error('MIGRATION_FAILED: ' + (e instanceof Error ? e.stack : String(e)));
    // Legacy fallback: load the pre-existing apiKeyService so agents keep working
    try {
      await apiKeyService.connect(config.surrealdb);
      logger.warn('legacy apiKeyService loaded as fallback');
    } catch (inner) {
      logger.error('legacy fallback also failed: ' + String(inner));
    }
  }

  if (await tokenService.needsBootstrap()) {
    const code = await tokenService.generateBootstrapCode();
    // Prominent banner in stdout
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  NovaCortex Setup Required');
    console.log('  Bootstrap code: ' + code);
    console.log('  Valid for 1 hour');
    console.log('  Exchange via:');
    console.log('    novacortex setup --url <URL> --code ' + code);
    console.log('  Or visit the /login page in the web UI');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
  }

  app.listen(config.port, () => {
    logger.info(`API listening on port ${config.port}`);
  });
}

startup().catch((err) => {
  logger.error('startup failed: ' + String(err));
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build --workspace=@memory-stack/api`
Expected: PASS.

- [ ] **Step 3: Smoke test the bootstrap banner manually**

Start a local SurrealDB (if available) and run:

```bash
npm run dev --workspace=@memory-stack/api
```

Expected: banner visible in stdout with a `nc_boot_...` code.

Stop the server (Ctrl+C).

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/index.ts
git commit -m "API startup: connect TokenService, run migration, print bootstrap banner"
```

---

<!-- END OF PHASE 3 -->

## Phase 4 — CLI Foundation

### Task 17: Scaffold `packages/cli` workspace package

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`

- [ ] **Step 1: Create package.json**

Create `packages/cli/package.json`:

```json
{
  "name": "@memory-stack/cli",
  "version": "1.0.0",
  "description": "NovaCortex command-line interface",
  "type": "module",
  "bin": {
    "novacortex": "dist/index.js"
  },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "test": "node --experimental-vm-modules node_modules/vitest/vitest.mjs run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "kleur": "^4.1.5",
    "prompts": "^2.4.2",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/prompts": "^2.4.9",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `packages/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "moduleResolution": "bundler"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create the entry file**

Create `packages/cli/src/index.ts`:

```ts
#!/usr/bin/env node
/**
 * NovaCortex CLI entry point.
 */
import { Command } from 'commander';

const pkg = { name: 'novacortex', version: '1.0.0' };

const program = new Command()
  .name(pkg.name)
  .description('Manage NovaCortex memory servers from the command line')
  .version(pkg.version);

program.parseAsync(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 4: Install and build**

```bash
npm install
npm run build --workspace=@memory-stack/cli
```

Expected: `packages/cli/dist/index.js` exists.

- [ ] **Step 5: Smoke-test the binary**

```bash
node packages/cli/dist/index.js --version
```

Expected output: `1.0.0`

```bash
node packages/cli/dist/index.js --help
```

Expected: usage text printed.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/ package-lock.json
git commit -m "Scaffold @memory-stack/cli workspace package with commander entry"
```

---

### Task 18: TDD profile config schema + profile-store

**Files:**
- Create: `packages/cli/src/config/schema.ts`
- Create: `packages/cli/src/config/profile-store.ts`
- Create: `tests/cli/profile-store.test.ts`

- [ ] **Step 1: Create the Zod schema**

Create `packages/cli/src/config/schema.ts`:

```ts
import { z } from 'zod';

export const ProfileKindSchema = z.enum(['selfhosted', 'saas']);
export type ProfileKind = z.infer<typeof ProfileKindSchema>;

export const ProfileSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  token: z.string().min(1),
  kind: ProfileKindSchema,
  createdAt: z.string(),
  lastUsedAt: z.string().optional(),
  serverInfo: z
    .object({
      version: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      tokenName: z.string().optional(),
    })
    .optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ConfigV1Schema = z.object({
  version: z.literal(1),
  activeProfile: z.string(),
  profiles: z.record(z.string(), ProfileSchema),
});
export type ConfigV1 = z.infer<typeof ConfigV1Schema>;

export function emptyConfig(): ConfigV1 {
  return { version: 1, activeProfile: '', profiles: {} };
}
```

- [ ] **Step 2: Write failing tests**

Create `tests/cli/profile-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ProfileStore,
  ConfigCorruptedError,
} from '../../packages/cli/src/config/profile-store.js';

describe('ProfileStore', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-cli-test-'));
    configPath = path.join(tmpDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('read() returns an empty config when the file does not exist', async () => {
    const store = new ProfileStore(configPath);
    const cfg = await store.read();
    expect(cfg.version).toBe(1);
    expect(cfg.profiles).toEqual({});
    expect(cfg.activeProfile).toBe('');
  });

  it('write() persists atomically and sets chmod 600 on unix', async () => {
    const store = new ProfileStore(configPath);
    await store.write({
      version: 1,
      activeProfile: 'default',
      profiles: {
        default: {
          name: 'default',
          url: 'http://localhost:3001',
          token: 'nc_pat_abc',
          kind: 'selfhosted',
          createdAt: new Date().toISOString(),
        },
      },
    });
    expect(fs.existsSync(configPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(parsed.activeProfile).toBe('default');
    if (process.platform !== 'win32') {
      const mode = fs.statSync(configPath).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('read() throws ConfigCorruptedError on broken JSON', async () => {
    fs.writeFileSync(configPath, '{not json');
    const store = new ProfileStore(configPath);
    await expect(store.read()).rejects.toBeInstanceOf(ConfigCorruptedError);
  });

  it('read() throws ConfigCorruptedError on unknown version', async () => {
    fs.writeFileSync(configPath, JSON.stringify({ version: 99, profiles: {} }));
    const store = new ProfileStore(configPath);
    await expect(store.read()).rejects.toBeInstanceOf(ConfigCorruptedError);
  });

  it('setActiveProfile() throws on unknown profile', async () => {
    const store = new ProfileStore(configPath);
    await store.write({
      version: 1,
      activeProfile: '',
      profiles: {
        default: {
          name: 'default',
          url: 'http://x',
          token: 't',
          kind: 'selfhosted',
          createdAt: new Date().toISOString(),
        },
      },
    });
    await expect(store.setActiveProfile('nope')).rejects.toThrow(/unknown profile/);
  });

  it('deleteProfile() throws on deleting the active profile without force', async () => {
    const store = new ProfileStore(configPath);
    const initial = {
      version: 1 as const,
      activeProfile: 'default',
      profiles: {
        default: {
          name: 'default',
          url: 'http://x',
          token: 't',
          kind: 'selfhosted' as const,
          createdAt: new Date().toISOString(),
        },
      },
    };
    await store.write(initial);
    await expect(store.deleteProfile('default')).rejects.toThrow(/active profile/);
    await store.deleteProfile('default', true);
    const after = await store.read();
    expect(after.profiles).toEqual({});
  });
});
```

- [ ] **Step 3: Run — should fail (profile-store not created)**

Run: `npx vitest run --config tests/vitest.config.ts tests/cli/profile-store.test.ts`
Expected: FAIL on missing import.

- [ ] **Step 4: Implement `profile-store.ts`**

Create `packages/cli/src/config/profile-store.ts`:

```ts
import fs from 'fs';
import path from 'path';
import { ConfigV1Schema, emptyConfig, type ConfigV1, type Profile } from './schema.js';

export class ConfigCorruptedError extends Error {
  readonly code = 'config_corrupted';
  constructor(public readonly filePath: string, reason: string) {
    super(`Config at ${filePath} is corrupted: ${reason}`);
    this.name = 'ConfigCorruptedError';
  }
}

export class ProfileStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<ConfigV1> {
    if (!fs.existsSync(this.filePath)) return emptyConfig();
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (e) {
      throw new ConfigCorruptedError(this.filePath, `read failed: ${String(e)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new ConfigCorruptedError(this.filePath, `invalid JSON: ${String(e)}`);
    }
    const result = ConfigV1Schema.safeParse(parsed);
    if (!result.success) {
      throw new ConfigCorruptedError(this.filePath, result.error.message);
    }
    return result.data;
  }

  async write(cfg: ConfigV1): Promise<void> {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
    if (process.platform !== 'win32') fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.filePath);
  }

  async upsertProfile(profile: Profile, makeActive = false): Promise<void> {
    const cfg = await this.read();
    cfg.profiles[profile.name] = profile;
    if (makeActive || !cfg.activeProfile) cfg.activeProfile = profile.name;
    await this.write(cfg);
  }

  async setActiveProfile(name: string): Promise<void> {
    const cfg = await this.read();
    if (!cfg.profiles[name]) throw new Error(`unknown profile: ${name}`);
    cfg.activeProfile = name;
    await this.write(cfg);
  }

  async deleteProfile(name: string, force = false): Promise<void> {
    const cfg = await this.read();
    if (!cfg.profiles[name]) throw new Error(`unknown profile: ${name}`);
    if (cfg.activeProfile === name && !force) {
      throw new Error('Cannot delete the active profile without force');
    }
    delete cfg.profiles[name];
    if (cfg.activeProfile === name) cfg.activeProfile = '';
    await this.write(cfg);
  }

  async renameProfile(oldName: string, newName: string): Promise<void> {
    const cfg = await this.read();
    const existing = cfg.profiles[oldName];
    if (!existing) throw new Error(`unknown profile: ${oldName}`);
    if (cfg.profiles[newName]) throw new Error(`profile already exists: ${newName}`);
    delete cfg.profiles[oldName];
    cfg.profiles[newName] = { ...existing, name: newName };
    if (cfg.activeProfile === oldName) cfg.activeProfile = newName;
    await this.write(cfg);
  }
}

/** Default config file path for the current platform. */
export function defaultConfigPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? path.join(process.env['USERPROFILE'] ?? '.', 'AppData', 'Roaming');
    return path.join(appData, 'novacortex', 'config.json');
  }
  const xdg = process.env['XDG_CONFIG_HOME'];
  const home = process.env['HOME'] ?? '.';
  return path.join(xdg ?? path.join(home, '.config'), 'novacortex', 'config.json');
}
```

- [ ] **Step 5: Re-run tests**

Run: `npx vitest run --config tests/vitest.config.ts tests/cli/profile-store.test.ts`
Expected: PASS 6/6.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/config/ tests/cli/profile-store.test.ts
git commit -m "CLI profile-store: Zod v1 schema + atomic writes + chmod 600"
```

---

### Task 19: TDD http client wrapper with typed errors

**Files:**
- Create: `packages/cli/src/lib/errors.ts`
- Create: `packages/cli/src/client/types.ts`
- Create: `packages/cli/src/client/http.ts`
- Create: `tests/cli/http-client.test.ts`

- [ ] **Step 1: Create the error classes**

Create `packages/cli/src/lib/errors.ts`:

```ts
export abstract class CliError extends Error {
  abstract readonly exitCode: number;
  abstract readonly code: string;
}

export class ProfileNotFoundError extends CliError {
  readonly exitCode = 2;
  readonly code = 'profile_not_found';
}

export class NotLoggedInError extends CliError {
  readonly exitCode = 2;
  readonly code = 'not_logged_in';
}

export class InvalidTokenError extends CliError {
  readonly exitCode = 3;
  readonly code = 'invalid_token';
}

export class InsufficientScopeError extends CliError {
  readonly exitCode = 3;
  readonly code = 'insufficient_scope';
  constructor(message: string, public readonly required: string[], public readonly granted: string[]) {
    super(message);
  }
}

export class ServerUnreachableError extends CliError {
  readonly exitCode = 4;
  readonly code = 'server_unreachable';
}

export class ConfigCorruptedError extends CliError {
  readonly exitCode = 5;
  readonly code = 'config_corrupted';
}

export class BootstrapExpiredError extends CliError {
  readonly exitCode = 6;
  readonly code = 'bootstrap_expired';
}

export class BootstrapAlreadyUsedError extends CliError {
  readonly exitCode = 6;
  readonly code = 'bootstrap_already_used';
}

export class UnsupportedServerError extends CliError {
  readonly exitCode = 7;
  readonly code = 'unsupported_server';
}
```

- [ ] **Step 2: Create the response types**

Create `packages/cli/src/client/types.ts`:

```ts
export interface WhoamiResponse {
  kind: 'selfhosted' | 'saas';
  name: string;
  scopes: string[];
  expiresAt?: string | null;
  server: {
    version: string;
    mode: 'selfhosted' | 'saas';
  };
}

export interface SetupExchangeResponse {
  token: string;
  whoami: WhoamiResponse;
}

export interface TokenSummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  agentId?: string;
  namespaceClaim?: string;
  createdAt: string;
  expiresAt?: string | null;
}

export interface CreateTokenRequest {
  template: 'admin-full' | 'admin-readonly' | 'agent' | 'knowledge-ingest';
  name: string;
  agentId?: string;
  namespaceClaim?: string;
}

export interface CreateTokenResponse {
  token: string;
  record: TokenSummary;
}
```

- [ ] **Step 3: Write failing tests**

Create `tests/cli/http-client.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { HttpClient } from '../../packages/cli/src/client/http.js';
import {
  InvalidTokenError,
  InsufficientScopeError,
  ServerUnreachableError,
} from '../../packages/cli/src/lib/errors.js';

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('HttpClient', () => {
  it('attaches Authorization: Bearer header from the client token', async () => {
    const fetchMock = mockFetch(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const client = new HttpClient({ url: 'http://localhost:3001', token: 'nc_pat_abc' });
    await client.get('/stats');
    const calledWith = fetchMock.mock.calls[0]![1]!;
    const headers = calledWith.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer nc_pat_abc');
  });

  it('attaches a User-Agent header with CLI version', async () => {
    const fetchMock = mockFetch(async () =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    const client = new HttpClient({ url: 'http://localhost:3001', token: 't', userAgent: 'novacortex/1.0.0' });
    await client.get('/stats');
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('novacortex/1.0.0');
  });

  it('translates 401 to InvalidTokenError', async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: 'invalid_token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const client = new HttpClient({ url: 'http://x', token: 't' });
    await expect(client.get('/stats')).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('translates 403 to InsufficientScopeError with required/granted fields', async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          error: 'insufficient_scope',
          required: ['namespaces:write'],
          granted: ['memories:read'],
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const client = new HttpClient({ url: 'http://x', token: 't' });
    try {
      await client.get('/namespaces');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientScopeError);
      const err = e as InsufficientScopeError;
      expect(err.required).toEqual(['namespaces:write']);
      expect(err.granted).toEqual(['memories:read']);
    }
  });

  it('translates fetch TypeError to ServerUnreachableError', async () => {
    mockFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const client = new HttpClient({ url: 'http://x', token: 't' });
    await expect(client.get('/stats')).rejects.toBeInstanceOf(ServerUnreachableError);
  });
});
```

- [ ] **Step 4: Run — should fail (http.ts missing)**

Run: `npx vitest run --config tests/vitest.config.ts tests/cli/http-client.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement `http.ts`**

Create `packages/cli/src/client/http.ts`:

```ts
import {
  InvalidTokenError,
  InsufficientScopeError,
  ServerUnreachableError,
  UnsupportedServerError,
} from '../lib/errors.js';

export interface HttpClientOptions {
  url: string;
  token: string;
  userAgent?: string;
}

interface ApiErrorBody {
  error?: string;
  message?: string;
  required?: string[];
  granted?: string[];
}

export class HttpClient {
  constructor(private readonly opts: HttpClientOptions) {}

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.opts.url.replace(/\/$/, '')}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.token}`,
      'Content-Type': 'application/json',
    };
    if (this.opts.userAgent) headers['User-Agent'] = this.opts.userAgent;

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (e instanceof TypeError) {
        throw new ServerUnreachableError(`Cannot reach ${this.opts.url}`);
      }
      throw e;
    }

    if (res.status === 204) return undefined as unknown as T;

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      if (res.ok) return undefined as unknown as T;
      throw new UnsupportedServerError(`Server at ${this.opts.url} returned non-JSON`);
    }

    if (res.ok) return parsed as T;

    const errorBody = parsed as ApiErrorBody;
    const message = errorBody.message ?? errorBody.error ?? `HTTP ${res.status}`;

    if (res.status === 401) {
      throw new InvalidTokenError(message);
    }
    if (res.status === 403 && errorBody.error === 'insufficient_scope') {
      throw new InsufficientScopeError(message, errorBody.required ?? [], errorBody.granted ?? []);
    }
    throw new UnsupportedServerError(`${message} (status ${res.status})`);
  }
}
```

- [ ] **Step 6: Re-run tests**

Run: `npx vitest run --config tests/vitest.config.ts tests/cli/http-client.test.ts`
Expected: PASS 5/5.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/lib/errors.ts packages/cli/src/client/ tests/cli/http-client.test.ts
git commit -m "CLI HttpClient: typed error mapping + auth header injection"
```

---

### Task 20: Output formatter utility

**Files:**
- Create: `packages/cli/src/lib/output.ts`

- [ ] **Step 1: Create the formatter**

Create `packages/cli/src/lib/output.ts`:

```ts
import kleur from 'kleur';

export interface OutputOptions {
  json?: boolean;
}

/** Print a human-readable success line (or JSON if opts.json). */
export function success(message: string, data?: unknown, opts: OutputOptions = {}): void {
  if (opts.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, message, data: data ?? null }));
    return;
  }
  // eslint-disable-next-line no-console
  console.log(kleur.green('✓') + ' ' + message);
  if (data !== undefined) {
    // eslint-disable-next-line no-console
    console.log(formatValue(data));
  }
}

/** Print a human-readable failure line to stderr (or JSON if opts.json). */
export function failure(code: string, message: string, hint?: string, opts: OutputOptions = {}): void {
  if (opts.json) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ error: code, message, hint: hint ?? null }));
    return;
  }
  // eslint-disable-next-line no-console
  console.error('');
  // eslint-disable-next-line no-console
  console.error(kleur.red('✗') + ' ' + message);
  if (hint) {
    // eslint-disable-next-line no-console
    console.error('');
    // eslint-disable-next-line no-console
    console.error('  ' + kleur.gray(hint));
  }
  // eslint-disable-next-line no-console
  console.error('');
}

/** Render a list of objects as an aligned table. */
export function table<T extends Record<string, unknown>>(rows: T[], columns: Array<keyof T>): string {
  if (rows.length === 0) return '(none)';
  const widths = columns.map((col) =>
    Math.max(String(col).length, ...rows.map((r) => String(r[col] ?? '').length))
  );
  const header = columns.map((c, i) => String(c).padEnd(widths[i]!)).join('  ');
  const sep = widths.map((w) => '─'.repeat(w)).join('  ');
  const body = rows
    .map((r) => columns.map((c, i) => String(r[c] ?? '').padEnd(widths[i]!)).join('  '))
    .join('\n');
  return [header, sep, body].join('\n');
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/lib/output.ts
git commit -m "CLI output utility: success/failure/table with json mode"
```

---

<!-- END OF PHASE 4 -->

## Phase 5 — CLI Commands

### Task 21: `setup` command + e2e smoke test

**Files:**
- Create: `packages/cli/src/commands/setup.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Implement the setup command**

Create `packages/cli/src/commands/setup.ts`:

```ts
import { Command } from 'commander';
import { HttpClient } from '../client/http.js';
import { ProfileStore, defaultConfigPath } from '../config/profile-store.js';
import type { SetupExchangeResponse } from '../client/types.js';
import { success, failure } from '../lib/output.js';
import { CliError } from '../lib/errors.js';

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Exchange a bootstrap code for an admin token (first-run self-hosted setup)')
    .requiredOption('--url <url>', 'NovaCortex API base URL (e.g. http://localhost:3001)')
    .requiredOption('--code <code>', 'Bootstrap code from the server logs (nc_boot_...)')
    .option('--profile <name>', 'Profile name to create or overwrite', 'default')
    .option('--json', 'Emit machine-readable JSON output')
    .action(async (opts: { url: string; code: string; profile: string; json?: boolean }) => {
      const client = new HttpClient({ url: opts.url, token: 'bootstrap', userAgent: 'novacortex/1.0.0' });
      try {
        // POST /setup/exchange uses an unauthenticated path but we send the code in the body
        const response = await (async () => {
          const res = await fetch(`${opts.url.replace(/\/$/, '')}/setup/exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: opts.code }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
            throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
          }
          return (await res.json()) as SetupExchangeResponse;
        })();

        const store = new ProfileStore(defaultConfigPath());
        await store.upsertProfile(
          {
            name: opts.profile,
            url: opts.url,
            token: response.token,
            kind: 'selfhosted',
            createdAt: new Date().toISOString(),
            lastUsedAt: new Date().toISOString(),
            serverInfo: {
              version: response.whoami.server.version,
              scopes: response.whoami.scopes,
              tokenName: response.whoami.name,
            },
          },
          true
        );

        success(
          `Setup complete. Logged in as '${response.whoami.name}' on ${opts.url} (profile: ${opts.profile})`,
          { scopes: response.whoami.scopes },
          { json: opts.json }
        );
      } catch (e) {
        if (e instanceof CliError) {
          failure(e.code, e.message, undefined, { json: opts.json });
          process.exit(e.exitCode);
        }
        failure('setup_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
        process.exit(6);
      }
    });
}
```

- [ ] **Step 2: Wire the command into the dispatcher**

Modify `packages/cli/src/index.ts`:

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { registerSetupCommand } from './commands/setup.js';

const pkg = { name: 'novacortex', version: '1.0.0' };

const program = new Command()
  .name(pkg.name)
  .description('Manage NovaCortex memory servers from the command line')
  .version(pkg.version);

registerSetupCommand(program);

program.parseAsync(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 3: Write an e2e smoke test**

Create `tests/cli/e2e-cli-flow.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { buildTestApp } from '../helpers/test-server.js';
import { installSetupRoute } from '../../packages/api/src/routes/setup.js';
import { installAuthRoute } from '../../packages/api/src/routes/auth.js';
import { installTokensRoute } from '../../packages/api/src/routes/tokens.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { Express } from 'express';

async function listen(app: Express): Promise<{ server: Server; url: string }> {
  return await new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function runCli(args: string[], env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('node', ['packages/cli/dist/index.js', ...args], {
      env: { ...process.env, ...env },
      cwd: process.cwd(),
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += String(c); });
    proc.stderr.on('data', (c) => { stderr += String(c); });
    proc.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

describe('CLI e2e: setup flow', () => {
  let tmpHome: string;
  let server: Server | null = null;
  let url = '';

  beforeEach(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-e2e-'));
    const { app, svc } = await buildTestApp([installSetupRoute, installAuthRoute, installTokensRoute]);
    const listened = await listen(app);
    server = listened.server;
    url = listened.url;
    // Pre-generate a bootstrap code so setup has something to exchange
    (globalThis as unknown as { __bootCode: string }).__bootCode = await svc.generateBootstrapCode();
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('setup command writes a profile and exits 0', async () => {
    const code = (globalThis as unknown as { __bootCode: string }).__bootCode;
    const env = { HOME: tmpHome, XDG_CONFIG_HOME: path.join(tmpHome, '.config') };
    const result = await runCli(['setup', '--url', url, '--code', code, '--profile', 'test'], env);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Setup complete');

    const configPath = path.join(tmpHome, '.config', 'novacortex', 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(cfg.activeProfile).toBe('test');
    expect(cfg.profiles.test.url).toBe(url);
  });

  it('setup with wrong code exits non-zero', async () => {
    const env = { HOME: tmpHome, XDG_CONFIG_HOME: path.join(tmpHome, '.config') };
    const result = await runCli(['setup', '--url', url, '--code', 'nc_boot_wrong'], env);
    expect(result.code).not.toBe(0);
  });
});
```

- [ ] **Step 4: Build the CLI**

```bash
npm run build --workspace=@memory-stack/cli
```

Expected: PASS.

- [ ] **Step 5: Run the e2e tests**

Run: `npx vitest run --config tests/vitest.config.ts tests/cli/e2e-cli-flow.test.ts`
Expected: PASS 2/2.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/setup.ts packages/cli/src/index.ts tests/cli/e2e-cli-flow.test.ts
git commit -m "CLI: novacortex setup command + e2e smoke tests"
```

---

### Task 22: `auth login | logout | whoami` commands

**Files:**
- Create: `packages/cli/src/commands/auth/login.ts`
- Create: `packages/cli/src/commands/auth/logout.ts`
- Create: `packages/cli/src/commands/auth/whoami.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Implement `auth login`**

Create `packages/cli/src/commands/auth/login.ts`:

```ts
import { Command } from 'commander';
import prompts from 'prompts';
import { HttpClient } from '../../client/http.js';
import { ProfileStore, defaultConfigPath } from '../../config/profile-store.js';
import type { WhoamiResponse } from '../../client/types.js';
import type { ProfileKind } from '../../config/schema.js';
import { success, failure } from '../../lib/output.js';
import { CliError } from '../../lib/errors.js';

export function registerLoginCommand(parent: Command): void {
  parent
    .command('login')
    .description('Log into a NovaCortex server with an access token')
    .requiredOption('--url <url>', 'NovaCortex API base URL')
    .option('--token <token>', 'Access token (if omitted, prompts interactively)')
    .option('--profile <name>', 'Profile name', 'default')
    .option('--kind <kind>', 'selfhosted | saas', 'selfhosted')
    .option('--json', 'Machine-readable JSON output')
    .action(
      async (opts: { url: string; token?: string; profile: string; kind: string; json?: boolean }) => {
        try {
          if (opts.kind === 'saas') {
            throw new Error(
              'SaaS login is not yet available — see the Subsystem D roadmap for details.'
            );
          }
          const kind = opts.kind as ProfileKind;

          let token = opts.token;
          if (!token) {
            const response = await prompts({
              type: 'password',
              name: 'value',
              message: 'Paste your access token:',
            });
            token = response.value as string | undefined;
          }
          if (!token) {
            throw new Error('Token is required');
          }

          const client = new HttpClient({ url: opts.url, token, userAgent: 'novacortex/1.0.0' });
          const whoami = await client.get<WhoamiResponse>('/auth/whoami');

          const store = new ProfileStore(defaultConfigPath());
          await store.upsertProfile(
            {
              name: opts.profile,
              url: opts.url,
              token,
              kind,
              createdAt: new Date().toISOString(),
              lastUsedAt: new Date().toISOString(),
              serverInfo: {
                version: whoami.server.version,
                scopes: whoami.scopes,
                tokenName: whoami.name,
              },
            },
            true
          );

          success(
            `Logged in as '${whoami.name}' on ${opts.url} (profile: ${opts.profile})`,
            { scopes: whoami.scopes },
            { json: opts.json }
          );
        } catch (e) {
          if (e instanceof CliError) {
            failure(e.code, e.message, undefined, { json: opts.json });
            process.exit(e.exitCode);
          }
          failure('login_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
          process.exit(3);
        }
      }
    );
}
```

- [ ] **Step 2: Implement `auth logout`**

Create `packages/cli/src/commands/auth/logout.ts`:

```ts
import { Command } from 'commander';
import { ProfileStore, defaultConfigPath } from '../../config/profile-store.js';
import { success, failure } from '../../lib/output.js';

export function registerLogoutCommand(parent: Command): void {
  parent
    .command('logout')
    .description('Remove a profile from local config (does not revoke on the server)')
    .option('--profile <name>', 'Profile name (defaults to the active profile)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { profile?: string; json?: boolean }) => {
      try {
        const store = new ProfileStore(defaultConfigPath());
        const cfg = await store.read();
        const name = opts.profile ?? cfg.activeProfile;
        if (!name || !cfg.profiles[name]) {
          failure('profile_not_found', `No profile '${name ?? '(active)'}' to log out from`, undefined, {
            json: opts.json,
          });
          process.exit(2);
          return;
        }
        await store.deleteProfile(name, true);
        success(`Logged out from profile '${name}'`, undefined, { json: opts.json });
      } catch (e) {
        failure('logout_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
        process.exit(1);
      }
    });
}
```

- [ ] **Step 3: Implement `auth whoami`**

Create `packages/cli/src/commands/auth/whoami.ts`:

```ts
import { Command } from 'commander';
import { HttpClient } from '../../client/http.js';
import { ProfileStore, defaultConfigPath } from '../../config/profile-store.js';
import type { WhoamiResponse } from '../../client/types.js';
import { success, failure } from '../../lib/output.js';
import { CliError, NotLoggedInError } from '../../lib/errors.js';
import { resolveActiveProfile } from '../../config/resolve.js';

export function registerWhoamiCommand(parent: Command): void {
  parent
    .command('whoami')
    .description('Show the current profile and server identity')
    .option('--profile <name>', 'Profile name (defaults to the active profile)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { profile?: string; json?: boolean }) => {
      try {
        const profile = await resolveActiveProfile(opts.profile);
        const client = new HttpClient({
          url: profile.url,
          token: profile.token,
          userAgent: 'novacortex/1.0.0',
        });
        const whoami = await client.get<WhoamiResponse>('/auth/whoami');
        success(
          `Profile '${profile.name}' — ${whoami.name} on ${profile.url}`,
          {
            scopes: whoami.scopes,
            server: whoami.server,
            kind: profile.kind,
          },
          { json: opts.json }
        );
      } catch (e) {
        if (e instanceof NotLoggedInError) {
          failure(e.code, e.message, 'Run `novacortex auth login` first.', { json: opts.json });
          process.exit(e.exitCode);
          return;
        }
        if (e instanceof CliError) {
          failure(e.code, e.message, undefined, { json: opts.json });
          process.exit(e.exitCode);
          return;
        }
        failure('whoami_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
        process.exit(1);
      }
    });
}
```

- [ ] **Step 4: Create the resolve helper**

Create `packages/cli/src/config/resolve.ts`:

```ts
import { ProfileStore, defaultConfigPath } from './profile-store.js';
import type { Profile } from './schema.js';
import { NotLoggedInError, ProfileNotFoundError } from '../lib/errors.js';

/**
 * Resolve the profile to use for a command, honoring in this order:
 *   1. Explicit --profile flag
 *   2. NOVACORTEX_PROFILE env var
 *   3. NOVACORTEX_URL + NOVACORTEX_TOKEN env vars (synthetic profile)
 *   4. activeProfile in the config file
 */
export async function resolveActiveProfile(explicit?: string): Promise<Profile> {
  if (process.env['NOVACORTEX_URL'] && process.env['NOVACORTEX_TOKEN']) {
    return {
      name: '$env',
      url: process.env['NOVACORTEX_URL']!,
      token: process.env['NOVACORTEX_TOKEN']!,
      kind: 'selfhosted',
      createdAt: new Date().toISOString(),
    };
  }

  const envProfile = process.env['NOVACORTEX_PROFILE'];
  const name = explicit ?? envProfile;

  const store = new ProfileStore(defaultConfigPath());
  const cfg = await store.read();
  const target = name ?? cfg.activeProfile;

  if (!target) {
    throw new NotLoggedInError('No active profile configured');
  }
  const profile = cfg.profiles[target];
  if (!profile) {
    throw new ProfileNotFoundError(`Profile '${target}' not found`);
  }
  return profile;
}
```

- [ ] **Step 5: Wire the auth subcommands into index.ts**

Modify `packages/cli/src/index.ts` to add auth subcommands:

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { registerSetupCommand } from './commands/setup.js';
import { registerLoginCommand } from './commands/auth/login.js';
import { registerLogoutCommand } from './commands/auth/logout.js';
import { registerWhoamiCommand } from './commands/auth/whoami.js';

const pkg = { name: 'novacortex', version: '1.0.0' };

const program = new Command()
  .name(pkg.name)
  .description('Manage NovaCortex memory servers from the command line')
  .version(pkg.version);

registerSetupCommand(program);

const authGroup = program.command('auth').description('Authentication commands');
registerLoginCommand(authGroup);
registerLogoutCommand(authGroup);
registerWhoamiCommand(authGroup);

program.parseAsync(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 6: Add e2e tests for whoami**

Append to `tests/cli/e2e-cli-flow.test.ts`:

```ts
describe('CLI e2e: auth whoami', () => {
  let tmpHome2: string;
  let server2: Server | null = null;
  let url2 = '';
  let token = '';

  beforeEach(async () => {
    tmpHome2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-e2e-who-'));
    const { app, svc } = await buildTestApp([installAuthRoute, installSetupRoute, installTokensRoute]);
    const minted = await svc.create({ template: 'admin-full', name: 'TestRoot' });
    token = minted.token;
    const listened = await listen(app);
    server2 = listened.server;
    url2 = listened.url;
  });

  afterEach(async () => {
    if (server2) {
      await new Promise<void>((r) => server2!.close(() => r()));
      server2 = null;
    }
    fs.rmSync(tmpHome2, { recursive: true, force: true });
  });

  it('auth login → auth whoami returns identity', async () => {
    const env = { HOME: tmpHome2, XDG_CONFIG_HOME: path.join(tmpHome2, '.config') };
    const login = await runCli(['auth', 'login', '--url', url2, '--token', token], env);
    expect(login.code).toBe(0);
    const who = await runCli(['auth', 'whoami', '--json'], env);
    expect(who.code).toBe(0);
    const payload = JSON.parse(who.stdout);
    expect(payload.data.scopes).toContain('admin:*');
  });

  it('whoami with NOVACORTEX_URL + NOVACORTEX_TOKEN env bypasses config', async () => {
    const env = {
      HOME: tmpHome2,
      XDG_CONFIG_HOME: path.join(tmpHome2, '.config'),
      NOVACORTEX_URL: url2,
      NOVACORTEX_TOKEN: token,
    };
    const who = await runCli(['auth', 'whoami', '--json'], env);
    expect(who.code).toBe(0);
  });
});
```

- [ ] **Step 7: Build + test**

```bash
npm run build --workspace=@memory-stack/cli
npx vitest run --config tests/vitest.config.ts tests/cli/e2e-cli-flow.test.ts
```

Expected: ALL PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/commands/auth/ packages/cli/src/config/resolve.ts packages/cli/src/index.ts tests/cli/e2e-cli-flow.test.ts
git commit -m "CLI: auth login/logout/whoami + resolveActiveProfile with ENV override"
```

---

### Task 23: `profile list | use | show | rm | rename`

**Files:**
- Create: `packages/cli/src/commands/profile/list.ts`
- Create: `packages/cli/src/commands/profile/use.ts`
- Create: `packages/cli/src/commands/profile/show.ts`
- Create: `packages/cli/src/commands/profile/rm.ts`
- Create: `packages/cli/src/commands/profile/rename.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Implement `profile list`**

Create `packages/cli/src/commands/profile/list.ts`:

```ts
import { Command } from 'commander';
import { ProfileStore, defaultConfigPath } from '../../config/profile-store.js';
import { success, table } from '../../lib/output.js';

export function registerProfileListCommand(parent: Command): void {
  parent
    .command('list')
    .description('List all configured profiles')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { json?: boolean }) => {
      const store = new ProfileStore(defaultConfigPath());
      const cfg = await store.read();
      const entries = Object.values(cfg.profiles).map((p) => ({
        name: p.name + (cfg.activeProfile === p.name ? ' (active)' : ''),
        url: p.url,
        kind: p.kind,
      }));
      if (opts.json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ activeProfile: cfg.activeProfile, profiles: entries }));
        return;
      }
      if (entries.length === 0) {
        success('No profiles configured. Run `novacortex auth login` or `novacortex setup` to add one.');
        return;
      }
      // eslint-disable-next-line no-console
      console.log(table(entries, ['name', 'url', 'kind']));
    });
}
```

- [ ] **Step 2: Implement `profile use`, `show`, `rm`, `rename`**

Create `packages/cli/src/commands/profile/use.ts`:

```ts
import { Command } from 'commander';
import { ProfileStore, defaultConfigPath } from '../../config/profile-store.js';
import { success, failure } from '../../lib/output.js';

export function registerProfileUseCommand(parent: Command): void {
  parent
    .command('use <name>')
    .description('Switch the active profile')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string, opts: { json?: boolean }) => {
      try {
        const store = new ProfileStore(defaultConfigPath());
        await store.setActiveProfile(name);
        success(`Active profile is now '${name}'`, undefined, { json: opts.json });
      } catch (e) {
        failure('profile_not_found', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
        process.exit(2);
      }
    });
}
```

Create `packages/cli/src/commands/profile/show.ts`:

```ts
import { Command } from 'commander';
import { ProfileStore, defaultConfigPath } from '../../config/profile-store.js';
import { success, failure } from '../../lib/output.js';

export function registerProfileShowCommand(parent: Command): void {
  parent
    .command('show [name]')
    .description('Print details of a profile (without revealing the token)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string | undefined, opts: { json?: boolean }) => {
      const store = new ProfileStore(defaultConfigPath());
      const cfg = await store.read();
      const target = name ?? cfg.activeProfile;
      const profile = cfg.profiles[target];
      if (!profile) {
        failure('profile_not_found', `Profile '${target}' not found`, undefined, { json: opts.json });
        process.exit(2);
        return;
      }
      const redacted = {
        name: profile.name,
        url: profile.url,
        kind: profile.kind,
        tokenPreview: profile.token.slice(0, 10) + '...' + profile.token.slice(-4),
        createdAt: profile.createdAt,
        lastUsedAt: profile.lastUsedAt,
        serverInfo: profile.serverInfo,
      };
      success(`Profile '${profile.name}'`, redacted, { json: opts.json });
    });
}
```

Create `packages/cli/src/commands/profile/rm.ts`:

```ts
import { Command } from 'commander';
import { ProfileStore, defaultConfigPath } from '../../config/profile-store.js';
import { success, failure } from '../../lib/output.js';

export function registerProfileRmCommand(parent: Command): void {
  parent
    .command('rm <name>')
    .description('Delete a profile from local config')
    .option('--force', 'Delete even if it is the active profile')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string, opts: { force?: boolean; json?: boolean }) => {
      try {
        const store = new ProfileStore(defaultConfigPath());
        await store.deleteProfile(name, opts.force ?? false);
        success(`Profile '${name}' removed`, undefined, { json: opts.json });
      } catch (e) {
        failure('rm_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
        process.exit(1);
      }
    });
}
```

Create `packages/cli/src/commands/profile/rename.ts`:

```ts
import { Command } from 'commander';
import { ProfileStore, defaultConfigPath } from '../../config/profile-store.js';
import { success, failure } from '../../lib/output.js';

export function registerProfileRenameCommand(parent: Command): void {
  parent
    .command('rename <oldName> <newName>')
    .description('Rename a profile')
    .option('--json', 'Machine-readable JSON output')
    .action(async (oldName: string, newName: string, opts: { json?: boolean }) => {
      try {
        const store = new ProfileStore(defaultConfigPath());
        await store.renameProfile(oldName, newName);
        success(`Profile '${oldName}' renamed to '${newName}'`, undefined, { json: opts.json });
      } catch (e) {
        failure('rename_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
        process.exit(1);
      }
    });
}
```

- [ ] **Step 3: Wire the profile subcommands**

Modify `packages/cli/src/index.ts`:

```ts
import { registerProfileListCommand } from './commands/profile/list.js';
import { registerProfileUseCommand } from './commands/profile/use.js';
import { registerProfileShowCommand } from './commands/profile/show.js';
import { registerProfileRmCommand } from './commands/profile/rm.js';
import { registerProfileRenameCommand } from './commands/profile/rename.js';
```

And after the `authGroup` block:

```ts
const profileGroup = program.command('profile').description('Manage CLI profiles');
registerProfileListCommand(profileGroup);
registerProfileUseCommand(profileGroup);
registerProfileShowCommand(profileGroup);
registerProfileRmCommand(profileGroup);
registerProfileRenameCommand(profileGroup);
```

- [ ] **Step 4: Build + smoke test**

```bash
npm run build --workspace=@memory-stack/cli
node packages/cli/dist/index.js profile list
```

Expected: `No profiles configured. Run \`novacortex auth login\` or \`novacortex setup\` to add one.`

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/profile/ packages/cli/src/index.ts
git commit -m "CLI: novacortex profile list/use/show/rm/rename"
```

---

### Task 24: `admin tokens list | create | revoke`

**Files:**
- Create: `packages/cli/src/commands/admin/tokens/list.ts`
- Create: `packages/cli/src/commands/admin/tokens/create.ts`
- Create: `packages/cli/src/commands/admin/tokens/revoke.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Implement `admin tokens list`**

Create `packages/cli/src/commands/admin/tokens/list.ts`:

```ts
import { Command } from 'commander';
import { HttpClient } from '../../../client/http.js';
import type { TokenSummary } from '../../../client/types.js';
import { resolveActiveProfile } from '../../../config/resolve.js';
import { success, failure, table } from '../../../lib/output.js';
import { CliError } from '../../../lib/errors.js';

export function registerTokensListCommand(parent: Command): void {
  parent
    .command('list')
    .description('List tokens on the server')
    .option('--profile <name>', 'Profile to use')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { profile?: string; json?: boolean }) => {
      try {
        const profile = await resolveActiveProfile(opts.profile);
        const client = new HttpClient({
          url: profile.url,
          token: profile.token,
          userAgent: 'novacortex/1.0.0',
        });
        const list = await client.get<TokenSummary[]>('/tokens');
        if (opts.json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify(list));
          return;
        }
        if (list.length === 0) {
          success('No tokens found on the server');
          return;
        }
        // eslint-disable-next-line no-console
        console.log(table(
          list.map((t) => ({
            id: t.id,
            name: t.name,
            prefix: t.prefix,
            scopes: t.scopes.join(','),
          })),
          ['id', 'name', 'prefix', 'scopes']
        ));
      } catch (e) {
        if (e instanceof CliError) {
          failure(e.code, e.message, undefined, { json: opts.json });
          process.exit(e.exitCode);
        }
        failure('list_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
        process.exit(1);
      }
    });
}
```

- [ ] **Step 2: Implement `admin tokens create`**

Create `packages/cli/src/commands/admin/tokens/create.ts`:

```ts
import { Command } from 'commander';
import { HttpClient } from '../../../client/http.js';
import type { CreateTokenRequest, CreateTokenResponse } from '../../../client/types.js';
import { resolveActiveProfile } from '../../../config/resolve.js';
import { success, failure } from '../../../lib/output.js';
import { CliError } from '../../../lib/errors.js';

export function registerTokensCreateCommand(parent: Command): void {
  parent
    .command('create')
    .description('Create a new token from a template')
    .requiredOption('--template <template>', 'admin-full | admin-readonly | agent | knowledge-ingest')
    .requiredOption('--name <name>', 'Human-readable name for the token')
    .option('--agent-id <id>', 'Required for agent template')
    .option('--namespace <ns>', 'Namespace claim (required for agent template)')
    .option('--profile <name>', 'Profile to use')
    .option('--json', 'Machine-readable JSON output')
    .action(
      async (opts: {
        template: string;
        name: string;
        agentId?: string;
        namespace?: string;
        profile?: string;
        json?: boolean;
      }) => {
        try {
          const profile = await resolveActiveProfile(opts.profile);
          const client = new HttpClient({
            url: profile.url,
            token: profile.token,
            userAgent: 'novacortex/1.0.0',
          });
          const body: CreateTokenRequest = {
            template: opts.template as CreateTokenRequest['template'],
            name: opts.name,
            agentId: opts.agentId,
            namespaceClaim: opts.namespace,
          };
          const response = await client.post<CreateTokenResponse>('/tokens', body);
          success(
            `Token created: ${response.record.name} (${response.record.id})`,
            { token: response.token, record: response.record, note: 'Copy the token now — it will not be shown again.' },
            { json: opts.json }
          );
        } catch (e) {
          if (e instanceof CliError) {
            failure(e.code, e.message, undefined, { json: opts.json });
            process.exit(e.exitCode);
          }
          failure('create_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
          process.exit(1);
        }
      }
    );
}
```

- [ ] **Step 3: Implement `admin tokens revoke`**

Create `packages/cli/src/commands/admin/tokens/revoke.ts`:

```ts
import { Command } from 'commander';
import { HttpClient } from '../../../client/http.js';
import { resolveActiveProfile } from '../../../config/resolve.js';
import { success, failure } from '../../../lib/output.js';
import { CliError } from '../../../lib/errors.js';

export function registerTokensRevokeCommand(parent: Command): void {
  parent
    .command('revoke <id>')
    .description('Revoke a token by id')
    .option('--profile <name>', 'Profile to use')
    .option('--json', 'Machine-readable JSON output')
    .action(async (id: string, opts: { profile?: string; json?: boolean }) => {
      try {
        const profile = await resolveActiveProfile(opts.profile);
        const client = new HttpClient({
          url: profile.url,
          token: profile.token,
          userAgent: 'novacortex/1.0.0',
        });
        await client.delete<void>(`/tokens/${encodeURIComponent(id)}`);
        success(`Token '${id}' revoked`, undefined, { json: opts.json });
      } catch (e) {
        if (e instanceof CliError) {
          failure(e.code, e.message, undefined, { json: opts.json });
          process.exit(e.exitCode);
        }
        failure('revoke_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
        process.exit(1);
      }
    });
}
```

- [ ] **Step 4: Wire the admin subcommands**

Modify `packages/cli/src/index.ts` to add:

```ts
import { registerTokensListCommand } from './commands/admin/tokens/list.js';
import { registerTokensCreateCommand } from './commands/admin/tokens/create.js';
import { registerTokensRevokeCommand } from './commands/admin/tokens/revoke.js';
```

And after the profile block:

```ts
const adminGroup = program.command('admin').description('Server administration commands');
const tokensGroup = adminGroup.command('tokens').description('Manage server-side tokens');
registerTokensListCommand(tokensGroup);
registerTokensCreateCommand(tokensGroup);
registerTokensRevokeCommand(tokensGroup);
```

- [ ] **Step 5: Build**

```bash
npm run build --workspace=@memory-stack/cli
```

Expected: PASS.

- [ ] **Step 6: Manual smoke test against in-memory server**

This is verified by the e2e tests in the next step.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/admin/ packages/cli/src/index.ts
git commit -m "CLI: novacortex admin tokens list/create/revoke"
```

---

### Task 25: End-to-end CLI flow coverage

**Files:**
- Modify: `tests/cli/e2e-cli-flow.test.ts`

- [ ] **Step 1: Add a flow test for admin tokens list + create + revoke**

Append to `tests/cli/e2e-cli-flow.test.ts`:

```ts
describe('CLI e2e: admin tokens lifecycle', () => {
  let tmpHome3: string;
  let server3: Server | null = null;
  let url3 = '';
  let rootToken = '';

  beforeEach(async () => {
    tmpHome3 = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-e2e-adm-'));
    const { app, svc } = await buildTestApp([installAuthRoute, installTokensRoute]);
    const minted = await svc.create({ template: 'admin-full', name: 'Root' });
    rootToken = minted.token;
    const listened = await listen(app);
    server3 = listened.server;
    url3 = listened.url;
  });

  afterEach(async () => {
    if (server3) {
      await new Promise<void>((r) => server3!.close(() => r()));
      server3 = null;
    }
    fs.rmSync(tmpHome3, { recursive: true, force: true });
  });

  it('login → admin tokens list → create → revoke', async () => {
    const env = {
      HOME: tmpHome3,
      XDG_CONFIG_HOME: path.join(tmpHome3, '.config'),
      NOVACORTEX_URL: url3,
      NOVACORTEX_TOKEN: rootToken,
    };

    const list1 = await runCli(['admin', 'tokens', 'list', '--json'], env);
    expect(list1.code).toBe(0);

    const create = await runCli(
      ['admin', 'tokens', 'create', '--template', 'knowledge-ingest', '--name', 'ci', '--json'],
      env
    );
    expect(create.code).toBe(0);
    const createBody = JSON.parse(create.stdout);
    expect(createBody.data.token).toMatch(/^nc_pat_/);
    const createdId = createBody.data.record.id as string;

    const revoke = await runCli(['admin', 'tokens', 'revoke', createdId, '--json'], env);
    expect(revoke.code).toBe(0);
  });
});
```

- [ ] **Step 2: Run the full CLI e2e suite**

```bash
npm run build --workspace=@memory-stack/cli
npx vitest run --config tests/vitest.config.ts tests/cli/
```

Expected: ALL PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/e2e-cli-flow.test.ts
git commit -m "CLI e2e: admin tokens lifecycle end-to-end coverage"
```

---

<!-- END OF PHASE 5 -->

## Phase 6 — Web UI Paste-Token Login

### Task 26: Inject Authorization header in `packages/web/src/lib/api.ts`

**Files:**
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Add token retrieval helper**

At the top of `packages/web/src/lib/api.ts`, right after the existing `getApiBaseUrl` function (around line 25), add:

```ts
/** Read the admin token from localStorage (browser only). */
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('novacortex_token');
}

/** Clear the admin token from localStorage. */
export function clearAuthToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('novacortex_token');
}
```

- [ ] **Step 2: Add Authorization header to both fetch paths in `fetchApi`**

In the same file, locate the `fetchApi` function. In the `noRetry` path (around line 78), change the headers object:

```ts
// before
const response = await fetch(url, {
  ...fetchOptions,
  headers: {
    "Content-Type": "application/json",
    ...fetchOptions?.headers,
  },
});

// after
const authToken = getAuthToken();
const response = await fetch(url, {
  ...fetchOptions,
  headers: {
    "Content-Type": "application/json",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...fetchOptions?.headers,
  },
});
```

Do the same for the `fetchWithRetry` call (around line 105):

```ts
// before
return await fetchWithRetry<T>(
  url,
  {
    ...fetchOptions,
    headers: {
      "Content-Type": "application/json",
      ...fetchOptions?.headers,
    },
  },
  ...
);

// after
const authToken = getAuthToken();
return await fetchWithRetry<T>(
  url,
  {
    ...fetchOptions,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...fetchOptions?.headers,
    },
  },
  ...
);
```

- [ ] **Step 3: Redirect on 401 (except from `/login`)**

In the `fetchApi` function, locate the error handling. When the response is not OK and status is 401, add the redirect:

```ts
if (!response.ok) {
  const error = await response.json().catch(() => ({ error: "Unknown error" }));

  // 401 → clear token and redirect to /login (unless we're already there)
  if (response.status === 401 && typeof window !== 'undefined') {
    if (window.location.pathname !== '/login') {
      clearAuthToken();
      window.location.href = '/login';
    }
  }

  throw new ApiError(
    response.status,
    error.error || error.message || "Request failed",
    error.code,
    error.retryable
  );
}
```

Apply the equivalent change in the `fetchWithRetry` path — wrap the call in a try/catch and handle `FetchApiError` with status 401:

```ts
// At the catch block that converts FetchApiError (around line 122):
if (error instanceof FetchApiError) {
  if (error.status === 401 && typeof window !== 'undefined') {
    if (window.location.pathname !== '/login') {
      clearAuthToken();
      window.location.href = '/login';
    }
  }
  throw new ApiError(error.status, error.message, error.code, error.retryable);
}
```

- [ ] **Step 4: Typecheck the web package**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/api.ts
git commit -m "Web: inject Authorization header from localStorage + 401 redirect to /login"
```

---

### Task 27: Create the `/login` page

**Files:**
- Create: `packages/web/src/app/login/page.tsx`

- [ ] **Step 1: Create the login page**

Create `packages/web/src/app/login/page.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Brain, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getApiBaseUrl } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // If a token is already present and valid, go home.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const existing = localStorage.getItem("novacortex_token");
    if (!existing) return;

    const url = `${getApiBaseUrl()}/auth/whoami`;
    fetch(url, { headers: { Authorization: `Bearer ${existing}` } })
      .then((res) => {
        if (res.ok) router.replace("/");
      })
      .catch(() => {});
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token.trim()) {
      setError("Please paste your access token");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/auth/whoami`, {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(body.message ?? body.error ?? "Token is invalid or revoked");
        setSubmitting(false);
        return;
      }
      localStorage.setItem("novacortex_token", token.trim());
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Brain className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>NovaCortex</CardTitle>
          <CardDescription>Paste your access token to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">Access Token</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="token"
                  type="password"
                  placeholder="nc_pat_..."
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="pl-9 font-mono"
                  autoFocus
                />
              </div>
            </div>
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Verifying..." : "Login"}
            </Button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            Need a token? Run <code className="rounded bg-muted px-1">novacortex setup</code> or ask
            your admin to create one in Settings → Access Tokens.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Build the web package**

```bash
npm run build --workspace=web
```

Expected: PASS — the page compiles.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/login/page.tsx
git commit -m "Web: paste-token login page at /login"
```

---

### Task 28: Sidebar logout button

**Files:**
- Modify: `packages/web/src/components/sidebar.tsx`

- [ ] **Step 1: Add logout handler to sidebar**

In `packages/web/src/components/sidebar.tsx`, add the import near the top:

```ts
import { LogOut } from "lucide-react";
import { clearAuthToken } from "@/lib/api";
```

- [ ] **Step 2: Add the logout button**

Inside the `Sidebar` component, locate the `Help & Theme` block (around line 110). Add a logout button above the theme toggle:

```tsx
{/* Help & Theme */}
<div className="p-4 space-y-1">
  <Button
    variant="ghost"
    className="w-full justify-start"
    onClick={() => {
      clearAuthToken();
      window.location.href = "/login";
    }}
  >
    <LogOut className="mr-2 h-4 w-4" />
    <span className="flex-1 text-left">Logout</span>
  </Button>
  <Button
    variant="ghost"
    className="w-full justify-start"
    onClick={toggleDesign}
  >
    ...existing theme button...
  </Button>
</div>
```

- [ ] **Step 3: Build**

```bash
npm run build --workspace=web
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/sidebar.tsx
git commit -m "Web: sidebar logout button clears token and redirects to /login"
```

---

### Task 28a: Access Tokens panel in Settings

**Files:**
- Create: `packages/web/src/components/access-tokens-panel.tsx`
- Modify: `packages/web/src/app/settings/page.tsx`
- Modify: `packages/web/src/lib/api.ts` (add 4 typed helpers)

- [ ] **Step 1: Add the API client helpers**

Append to `packages/web/src/lib/api.ts`:

```ts
// ---------- Tokens (Subsystem C) ----------

export type TokenTemplate = 'admin-full' | 'admin-readonly' | 'agent' | 'knowledge-ingest';

export interface TokenSummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  agentId?: string;
  namespaceClaim?: string;
  createdAt: string;
  expiresAt?: string | null;
}

export interface CreateTokenInput {
  template: TokenTemplate;
  name: string;
  agentId?: string;
  namespaceClaim?: string;
}

export interface CreateTokenResult {
  token: string;
  record: TokenSummary;
}

export async function listTokens(): Promise<TokenSummary[]> {
  return fetchApi<TokenSummary[]>('/tokens');
}

export async function createToken(input: CreateTokenInput): Promise<CreateTokenResult> {
  return fetchApi<CreateTokenResult>('/tokens', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function revokeToken(id: string): Promise<void> {
  await fetchApi<void>(`/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: Create the panel component**

Create `packages/web/src/components/access-tokens-panel.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listTokens,
  createToken,
  revokeToken,
  type TokenSummary,
  type TokenTemplate,
} from "@/lib/api";

const TEMPLATE_LABELS: Record<TokenTemplate, string> = {
  "admin-full": "Full Admin",
  "admin-readonly": "Read-only Admin",
  "agent": "Agent (requires namespace)",
  "knowledge-ingest": "Knowledge Ingest (CI)",
};

export function AccessTokensPanel() {
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState<TokenTemplate>("knowledge-ingest");
  const [newAgentId, setNewAgentId] = useState("");
  const [newNamespace, setNewNamespace] = useState("");
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listTokens();
      setTokens(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate() {
    setError(null);
    if (!newName.trim()) {
      setError("Name is required");
      return;
    }
    if (newTemplate === "agent" && (!newAgentId.trim() || !newNamespace.trim())) {
      setError("Agent template requires an agent id and a namespace");
      return;
    }
    try {
      const result = await createToken({
        template: newTemplate,
        name: newName.trim(),
        agentId: newTemplate === "agent" ? newAgentId.trim() : undefined,
        namespaceClaim: newTemplate === "agent" ? newNamespace.trim() : undefined,
      });
      setRevealedToken(result.token);
      setCreateOpen(false);
      setRevealOpen(true);
      setNewName("");
      setNewAgentId("");
      setNewNamespace("");
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm(`Revoke token ${id}? This cannot be undone.`)) return;
    try {
      await revokeToken(id);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function copyRevealed() {
    if (revealedToken) await navigator.clipboard.writeText(revealedToken);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Access Tokens
              </CardTitle>
              <CardDescription>Create and revoke API tokens for humans, agents, and CI</CardDescription>
            </div>
            <Button onClick={() => setCreateOpen(true)} size="sm">
              <Plus className="mr-1 h-4 w-4" />
              Create Token
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && tokens.length === 0 && (
            <p className="text-sm text-muted-foreground">No tokens yet. Click "Create Token".</p>
          )}
          {tokens.length > 0 && (
            <div className="space-y-2">
              {tokens.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {t.prefix} · {t.scopes.slice(0, 3).join(", ")}
                      {t.scopes.length > 3 && ` +${t.scopes.length - 3}`}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRevoke(t.id)}
                    aria-label={`Revoke ${t.name}`}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Access Token</DialogTitle>
            <DialogDescription>The token is shown exactly once after creation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tpl">Template</Label>
              <Select value={newTemplate} onValueChange={(v) => setNewTemplate(v as TokenTemplate)}>
                <SelectTrigger id="tpl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TEMPLATE_LABELS) as TokenTemplate[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {TEMPLATE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            {newTemplate === "agent" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="agentId">Agent ID</Label>
                  <Input id="agentId" value={newAgentId} onChange={(e) => setNewAgentId(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ns">Namespace</Label>
                  <Input id="ns" value={newNamespace} onChange={(e) => setNewNamespace(e.target.value)} />
                </div>
              </>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revealOpen} onOpenChange={setRevealOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token Created</DialogTitle>
            <DialogDescription>
              Copy this token now. It will never be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted p-3 font-mono text-sm break-all">
            {revealedToken}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={copyRevealed}>
              <Copy className="mr-1 h-4 w-4" />
              Copy
            </Button>
            <Button
              onClick={() => {
                setRevealOpen(false);
                setRevealedToken(null);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Mount the panel in the Settings page**

Open `packages/web/src/app/settings/page.tsx`. Add the import at the top with the other component imports:

```ts
import { AccessTokensPanel } from "@/components/access-tokens-panel";
```

Then, inside the outer `<div className="space-y-4 lg:space-y-6">` (right after the License card, around line 256), add:

```tsx
<AccessTokensPanel />
```

- [ ] **Step 4: Build the web package**

```bash
npm run build --workspace=web
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/components/access-tokens-panel.tsx packages/web/src/app/settings/page.tsx
git commit -m "Web: Access Tokens panel in Settings (list/create/revoke with template selection)"
```

---

<!-- END OF PHASE 6 -->

## Phase 7 — Security Smoke Tests

### Task 29: Security-specific test suite

**Files:**
- Create: `tests/api/security.test.ts`

- [ ] **Step 1: Write the security smoke tests**

Create `tests/api/security.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTestApp, jsonRequest } from '../helpers/test-server.js';
import { installSetupRoute } from '../../packages/api/src/routes/setup.js';
import { installAuthRoute } from '../../packages/api/src/routes/auth.js';
import { installTokensRoute } from '../../packages/api/src/routes/tokens.js';
import { TokenService, sha256Hex } from '../../packages/api/src/services/token-service.js';
import { FakeSurreal } from '../helpers/fake-surreal.js';

describe('Security: information disclosure on setup', () => {
  it('wrong-code response is structurally identical to nonexistent-code response', async () => {
    const { app, svc } = await buildTestApp([installSetupRoute]);
    await svc.generateBootstrapCode();

    const wrong = await jsonRequest(app, 'POST', '/setup/exchange', { code: 'nc_boot_AAAAA' });
    const nonexistent = await jsonRequest(app, 'POST', '/setup/exchange', { code: 'nc_boot_BBBBB' });

    expect(wrong.status).toBe(nonexistent.status);
    expect(Object.keys(wrong.body as object).sort()).toEqual(
      Object.keys(nonexistent.body as object).sort()
    );
    expect((wrong.body as { error: string }).error).toBe(
      (nonexistent.body as { error: string }).error
    );
  });
});

describe('Security: cleartext leakage in list responses', () => {
  it('GET /tokens never contains the full token string', async () => {
    const { app, svc } = await buildTestApp([installTokensRoute]);
    const { token } = await svc.create({ template: 'admin-full', name: 'Root' });
    await svc.create({ template: 'knowledge-ingest', name: 'CI' });

    const res = await jsonRequest(app, 'GET', '/tokens', undefined, {
      Authorization: `Bearer ${token}`,
    });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(token);
    // No nc_pat_ or nc_agt_ cleartext-shaped strings in the response
    expect(body).not.toMatch(/nc_pat_[A-Za-z0-9_-]{30,}/);
    expect(body).not.toMatch(/nc_agt_[A-Za-z0-9_-]{30,}/);
  });
});

describe('Security: scope escalation prevented', () => {
  it('knowledge-ingest token cannot call POST /tokens', async () => {
    const { app, svc } = await buildTestApp([installTokensRoute]);
    const { token } = await svc.create({ template: 'knowledge-ingest', name: 'CI' });
    const res = await jsonRequest(
      app,
      'POST',
      '/tokens',
      { template: 'admin-full', name: 'escalated' },
      { Authorization: `Bearer ${token}` }
    );
    expect(res.status).toBe(403);
  });
});

describe('Security: rate limit enforcement on setup', () => {
  it('6th POST /setup/exchange within a minute returns 429', async () => {
    const { app } = await buildTestApp([installSetupRoute]);
    const results: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const r = await jsonRequest(app, 'POST', '/setup/exchange', { code: 'nc_boot_no' });
      results.push(r.status);
    }
    expect(results.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
  });
});

describe('Security: timing sanity of validate()', () => {
  it('validate() is O(1) lookup via hash cache — no prefix-timing leak', async () => {
    const fake = new FakeSurreal();
    const svc = new TokenService(fake);
    await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });
    await svc.create({ template: 'admin-full', name: 'Root' });

    const ITERATIONS = 500;
    const randomBogus: string[] = [];
    const prefixBogus: string[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      randomBogus.push(`nc_pat_bogus${i}`);
      prefixBogus.push(`nc_pat_${'A'.repeat(30 + (i % 4))}`);
    }

    async function bench(list: string[]): Promise<number> {
      const start = process.hrtime.bigint();
      for (const t of list) await svc.validate(t);
      const end = process.hrtime.bigint();
      return Number(end - start);
    }

    // Warm up
    await bench(randomBogus.slice(0, 50));

    const a = await bench(randomBogus);
    const b = await bench(prefixBogus);
    const delta = Math.abs(a - b) / Math.max(a, b);

    // Documented tolerance: this is a smoke, not a hardened timing-attack test.
    expect(delta).toBeLessThan(0.5);
  });
});

describe('Security: hash-only storage invariant', () => {
  it('no row in tokens table contains the cleartext after create()', async () => {
    const fake = new FakeSurreal();
    const svc = new TokenService(fake);
    await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });
    const { token } = await svc.create({ template: 'admin-full', name: 'Root' });
    const rows = fake._getTable('tokens');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]!['tokenHash']).toBe(sha256Hex(token));
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run --config tests/vitest.config.ts tests/api/security.test.ts`
Expected: PASS 6/6.

- [ ] **Step 3: Commit**

```bash
git add tests/api/security.test.ts
git commit -m "Security smoke tests: disclosure, leakage, escalation, rate limit, timing"
```

---

<!-- END OF PHASE 7 -->

## Phase 8 — Documentation & Release

### Task 30: docker-compose TRUST_PROXY + README bootstrap runbook

**Files:**
- Modify: `docker-compose.yml`
- Modify: `README.md`

- [ ] **Step 1: Document TRUST_PROXY env in docker-compose**

Open `docker-compose.yml` and find the `api` service definition. In its `environment` list (or `environment:` block), add:

```yaml
    environment:
      # ... existing env vars ...
      # Trust X-Forwarded-For header (set to "true" when running behind Traefik / nginx / Cloudflare)
      TRUST_PROXY: ${TRUST_PROXY:-false}
```

- [ ] **Step 2: Update README with bootstrap + CLI walkthrough**

In `README.md`, locate the `## Quick Start` section. Add a new section after it:

```markdown
## First-Run Setup (self-hosted)

NovaCortex now requires authentication on all admin routes. On a fresh install, the API
prints a one-time **bootstrap code** at startup. You exchange it for a permanent admin
token using the `novacortex` CLI or the web UI login page.

### Option A — CLI (recommended)

1. Start the stack:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
   ```
2. Watch the API logs for the banner:
   ```
   ═══════════════════════════════════════════════════════════
     NovaCortex Setup Required
     Bootstrap code: nc_boot_aBc123XyZ
     Valid for 1 hour
     Exchange via:
       novacortex setup --url <URL> --code nc_boot_aBc123XyZ
   ═══════════════════════════════════════════════════════════
   ```
3. Install the CLI:
   ```bash
   npm install -g @memory-stack/cli
   ```
4. Run setup:
   ```bash
   novacortex setup --url http://localhost:3001 --code nc_boot_aBc123XyZ
   ```
5. Verify:
   ```bash
   novacortex auth whoami
   ```

### Option B — Web UI

1. Start the stack as above.
2. Open `http://localhost:3000` in a browser — you will be redirected to `/login`.
3. Copy the bootstrap code from the logs and exchange it via `novacortex setup` in any
   terminal that has network access to the API. Copy the minted token from the CLI
   output and paste it into the `/login` page.

> **Note:** The web UI itself does not have a built-in setup wizard in this release.
> Subsystem D (SaaS user login) will introduce a proper first-run wizard.

### Behind a reverse proxy

If you run NovaCortex behind Traefik, nginx, or Cloudflare, set `TRUST_PROXY=true` in
the api service environment so that rate limits and audit logs use the real client IP
from `X-Forwarded-For`.
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml README.md
git commit -m "Docs: TRUST_PROXY env + first-run bootstrap + CLI walkthrough"
```

---

### Task 31: Final end-to-end verification

**Files:** (none — verification only)

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run --config tests/vitest.config.ts
```

Expected: ALL green. If any test fails, stop and debug before proceeding.

- [ ] **Step 2: Run the full typecheck across the workspace**

```bash
npm run typecheck
```

Expected: PASS. (Fix any TS errors inline before continuing.)

- [ ] **Step 3: Build every workspace**

```bash
npm run build
```

Expected: PASS for api, core, web, cli, mcp-server.

- [ ] **Step 4: Manual smoke: start the stack and run a full CLI flow**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d surrealdb qdrant redis
npm run dev:stack &
```

Wait for the bootstrap banner, then in another shell:

```bash
CODE=<paste bootstrap code from logs>
node packages/cli/dist/index.js setup --url http://localhost:3001 --code $CODE
node packages/cli/dist/index.js auth whoami
node packages/cli/dist/index.js admin tokens list
node packages/cli/dist/index.js admin tokens create --template knowledge-ingest --name "CI pipeline"
```

Stop the local stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

Expected: every step exits 0 and prints sensible output.

- [ ] **Step 5: Lint**

```bash
npm run lint
```

Expected: PASS (or resolve any new warnings inline).

- [ ] **Step 6: Verification commit marker**

```bash
git commit --allow-empty -m "Subsystem C complete: auth & profile abstraction ready for release"
```

---

<!-- END OF PHASE 8 -->

## Summary

**Totals:** 32 tasks (Tasks 1–28, 28a, 29–31) across 8 phases. Roughly 180 steps. Each task is independently committable; the plan can be paused between any two tasks and resumed cleanly.

**Critical path invariants preserved across tasks:**
- The `tokenHash` index is unique and is the only lookup key.
- The cleartext token is returned only from `TokenService.create()` and `exchangeBootstrapCode()`.
- Admin routes are wrapped in `requireScopes` at Task 15; every route from Task 15 onward that is newly added must follow the same pattern.
- `TokenService` is a singleton rebound in tests via the `buildTestApp` helper so middleware imports keep working without DI complexity in production code.
- `packages/cli` imports only `HTTP` from the api — no direct code imports cross the boundary.
- The web UI's fetch layer is touched in exactly one place (`packages/web/src/lib/api.ts`) to inject the header and handle 401; all call sites inherit the behavior automatically.

