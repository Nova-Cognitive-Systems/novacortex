# Subsystem C: Auth & Profile Abstraction — Design Spec

| | |
|---|---|
| **Status** | Draft — pending user review |
| **Date** | 2026-04-09 |
| **Author** | Brainstorming session with user |
| **Scope** | Authentication, tokens, CLI profile management, self-hosted bootstrap |
| **Next step** | Implementation plan via `superpowers:writing-plans` |

---

## 0. Context & Decomposition

### 0.1 What NovaCortex is today

NovaCortex is a semantic memory system for AI agents, distributed as a monorepo with these packages:

- `packages/api` — Node/Express REST API
- `packages/web` — Next.js admin UI
- `packages/core` — shared types and services (memory + surrealdb + qdrant adapters)
- `packages/mcp-server` — MCP server that agents use

It runs against SurrealDB (primary store), Qdrant (vector index), and Redis (cache). Two deployment targets: **self-hosted** (Docker Compose today, production-ready) and **SaaS** (future).

### 0.2 The original request

The user asked for three things in one message:

1. **Admin-UI simplification** — reorganize the 8-page admin UI into a Standard view (90% of users) and an Advanced area.
2. **CLI tool** — `novacortex` command to manage the server and bulk-ingest knowledge (e.g., Obsidian vaults). Must work for humans AND agents. Must support both self-hosted and SaaS.
3. **Modular design with login/setup command** — CLI must work against both deployment targets.

### 0.3 Why we decompose

These are three independent subsystems with different technology concerns, code surfaces, and success criteria. Collapsing them into a single spec produces a document that is too large to validate, too interleaved to implement incrementally, and too ambiguous to test. Per the `superpowers:brainstorming` guidance, the right move is to decompose first, brainstorm the first sub-project, and defer the others to their own spec → plan → implementation cycles.

The three subsystems we identified:

- **Subsystem A** — Admin-UI reorganization (Standard / Advanced)
- **Subsystem B** — CLI tool (management + bulk ingest)
- **Subsystem C** — Auth & Profile Abstraction (foundation for B and part of A)

**Recommended build order:** C → B → A. Rationale: C is the foundation that B depends on, and A benefits from knowing what the CLI already covers (so the UI can be aggressively simplified without worrying about power users).

**This spec covers Subsystem C only.**

### 0.4 Why C first and why it was shrunk mid-brainstorm

Subsystem C was originally scoped to cover auth for **both** self-hosted AND SaaS. During brainstorming, we realized that the SaaS half would force us to commit to a User/Org model that doesn't exist yet and will almost certainly be re-designed when the SaaS user-login subsystem ("Subsystem D") is actually scoped. Writing OAuth device endpoints and a `/cli/authorize` page now would be dead-code-magnet — code that waits for assumptions that will change.

**Decision:** Subsystem C is scoped to **self-hosted only**. The CLI profile shape still carries `kind: 'selfhosted' | 'saas'` as a forward-compatibility commitment, but `kind: 'saas'` will throw a clear error until Subsystem D is implemented. The unified token model, token hashing, scope vocabulary, bootstrap flow, and CLI plumbing all land in C. SaaS-specific authentication (OAuth device grant, `/cli/authorize` page, user/org model) is explicitly deferred to Subsystem D.

---

## 1. Goals & Non-Goals

### 1.1 Goals (the 25-point definition of done)

#### Server (API package)

1. New `tokens` table in SurrealDB with fields: `id`, `tokenHash` (sha256 hex), `prefix`, `name`, `scopes[]`, `namespaceClaim?`, `agentId?`, `createdAt`, `createdBy?`, `lastUsedAt?`, `expiresAt?`, `revokedAt?`.
2. Scope vocabulary defined and enforced: `admin:*`, `memories:{read,write}`, `namespaces:{read,write}`, `knowledge:{read,write}`, `buckets:{read,write}`, `processor:{read,write}`, `federation:*`, `tokens:{read,write}`, and `agent:{id}` as an implicit scope for agent tokens.
3. **All Admin routes** (`/memories`, `/namespaces`, `/stats`, `/knowledge`, `/buckets`, `/api-keys`, `/license`, `/processor`, `/federation`) are behind a unified `requireScopes(...)` middleware. **No unauthenticated admin routes remain.**
4. Agent routes (`/agent/*`) continue to work via the same middleware, with `agent:{id}` scope and namespace claim enforcement.
5. Bootstrap flow: a freshly-started server with an empty `tokens` table prints a one-time bootstrap code to stdout/docker logs; `POST /setup/exchange { code }` exchanges it for a permanent admin token; after exchange the bootstrap code is burned.
6. Token validation endpoint `GET /auth/whoami` — returns `{ kind, name, scopes, expiresAt?, server: { version, mode: 'selfhosted' } }`. Used by the CLI to hydrate profile metadata after login.
7. Audit log: auth-related events (`auth.login`, `auth.failed`, `auth.scope_denied`, `auth.rate_limited`, `token.create`, `token.revoke`, `setup.exchange`, `setup.failed`, `setup.not_needed`, `migration.success`, `migration.failed`) are written to an `audit_log` table with **7-day retention** (MVP — cleanup job is Phase 2).
8. Migration of the existing `api_keys` table into `tokens` runs automatically on server startup, is idempotent, and archives the old table as `api_keys_migrated_v1` after success. Existing agents with `sk_...` keys continue to work without client-side changes.
9. Token storage: **only the SHA-256 hash** of the cleartext token is persisted. The cleartext is returned exactly once in the `POST /tokens` create response and in the `POST /setup/exchange` response, and never again.

#### CLI (new `packages/cli` package)

10. `novacortex auth login` — adaptive: `--token` flag for explicit paste; interactive prompt if `--token` missing and self-hosted; clear error if `kind='saas'` ("SaaS login not yet available — see Subsystem D roadmap").
11. `novacortex auth logout [--profile NAME]` — removes the token from the profile.
12. `novacortex auth whoami [--profile NAME]` — prints the current profile and server info.
13. `novacortex profile list | use | show | rm | rename` — multi-profile management.
14. `novacortex setup --url URL --code CODE [--profile NAME]` — bootstrap exchange for self-hosted first-time setup.
15. Config file at `~/.config/novacortex/config.json` on Linux/macOS, `%APPDATA%\novacortex\config.json` on Windows. `chmod 600` on unix.
16. ENV overrides `NOVACORTEX_URL`, `NOVACORTEX_TOKEN`, `NOVACORTEX_PROFILE` take precedence over the config file. CI/container workflows do not need a config file.
17. Every command respects `--profile <name>` as a one-shot override of the active profile.
18. `--help`, `--version`, `profile list`, `profile show` work **without** being logged in.

#### Web UI (minimal transition support)

19. After bootstrap, the Settings section exposes an "Access Tokens" panel with a list of existing tokens, "Create Token" (with **template** selection — see §3.3), and Revoke.
20. **Paste-token login** for the web UI: first load without a token redirects to `/login`, where the user pastes an access token. Token is stored in `localStorage.novacortex_token`. On 401 the token is cleared and the user is sent back to `/login`. Logout button in sidebar.
21. Subsystem C does **not** ship a "real" user/session system for the web UI. Paste-token login is a deliberate transitional UX that is forward-compatible with Subsystem D.

#### Security hardening

22. Rate-limiting on auth endpoints (`/setup/exchange`, `/auth/whoami`, `/tokens`): in-memory per-IP counter, 10 req/min soft limit for most endpoints, 5 req/min for `/setup/exchange`.
23. Bootstrap-code comparison uses `crypto.timingSafeEqual` (constant-time, timing-attack resistance).
24. Token create responses return the cleartext token **exactly once**. No endpoint ever returns the cleartext of a stored token after creation.
25. Auth middleware responses are shaped to avoid information disclosure: `missing_token` and `invalid_token` return identical bodies (differ only in the `error` code, with no per-token-existence signal) and comparable timing.

### 1.2 Non-Goals (explicit)

- **N-1.** User accounts, passwords, or org/workspace entities in self-hosted.
- **N-2.** SaaS-side OAuth device grant endpoints (`/oauth/device/code`, `/oauth/device/token`) and `/cli/authorize` page — deferred to Subsystem D.
- **N-3.** Real server-side sessions, cookies, or CSRF protection for the web UI. Paste-token + localStorage is deliberate for the transitional window.
- **N-4.** SSO / SAML / OIDC for login (Subsystem D at earliest, possibly never for self-hosted).
- **N-5.** Token auto-rotation / refresh-token flows. Tokens are long-lived; revocation is manual.
- **N-6.** Free-form scope editor in the UI. Token creation goes through **templates** (§3.3); free-form is Phase 2.
- **N-7.** Changing the existing `LICENSE_KEY` env-var mechanism. License handling stays where it is.
- **N-8.** Audit-log rotation/cleanup job. 7-day retention is a documented expectation; the cleanup job is Phase 2.
- **N-9.** Load testing, fuzzing, or Docker-Compose-level E2E tests.
- **N-10.** Keychain-based credential storage. The user explicitly chose file storage with `chmod 600` for simplicity. Schema is forward-compatible with `tokenRef: "file" | "keychain"` but only `file` is implemented.

---

## 2. Architecture

### 2.1 Package layout

```
packages/
├── api/                          ← modified
│   └── src/
│       ├── middleware/
│       │   └── auth.ts           ← NEW: extractToken + requireScopes
│       ├── services/
│       │   ├── token-service.ts  ← NEW: replaces api-keys.ts (with migration)
│       │   └── api-keys.ts       ← removed after migration release
│       ├── routes/
│       │   ├── setup.ts          ← NEW: POST /setup/exchange
│       │   ├── auth.ts           ← NEW: GET /auth/whoami
│       │   └── tokens.ts         ← NEW: CRUD for tokens
│       └── index.ts              ← modified: mount new routes, drop apiKeyAuth
│
├── cli/                          ← NEW workspace package
│   ├── package.json              (bin: { novacortex: "dist/index.js" })
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts              ← entry, command dispatcher
│       ├── client/
│       │   ├── http.ts           ← fetch wrapper (auth, errors, user-agent)
│       │   └── types.ts          ← response types mirrored from api
│       ├── config/
│       │   ├── profile-store.ts  ← read/write ~/.config/novacortex/config.json
│       │   └── schema.ts         ← Zod schema + version migration
│       ├── commands/
│       │   ├── auth/
│       │   │   ├── login.ts
│       │   │   ├── logout.ts
│       │   │   └── whoami.ts
│       │   ├── profile/
│       │   │   ├── list.ts
│       │   │   ├── use.ts
│       │   │   ├── show.ts
│       │   │   ├── rm.ts
│       │   │   └── rename.ts
│       │   ├── setup.ts
│       │   └── admin/
│       │       └── tokens/       ← list | create | revoke
│       └── lib/
│           ├── errors.ts         ← typed CliError subclasses
│           └── output.ts         ← table / json / human formatting
│
├── core/                         ← unchanged in Subsystem C
├── web/                          ← minimal changes: /login page + api.ts header
└── mcp-server/                   ← unchanged (keeps using agent routes via migrated keys)
```

### 2.2 Dependency graph

```
   ┌─────────┐
   │   cli   │──┐   HTTP only (no direct code import)
   └─────────┘  │
                ▼
           ┌─────────┐        ┌────────────┐
           │   api   │───────▶│   core     │
           └─────────┘        └────────────┘
                ▲
                │   HTTP only
                │
           ┌─────────┐
           │   web   │
           └─────────┘
```

The CLI imports **nothing** from `api` or `core` directly. Communication is strictly HTTP. If type sharing via `packages/core/src/types/` becomes desirable, it is a unidirectional, low-risk future change.

### 2.3 New runtime dependencies

- **`packages/cli`**: `commander` *or* `citty` (decided at implementation time — both work; `commander` has broader ecosystem, `citty` is smaller and more modern), `zod` (config schema + response validation), `kleur` (ANSI colors, zero-dep), `prompts` (interactive paste input).
- **`packages/api`**: no new dependencies. Node's `crypto` module and the existing `surrealdb` client cover everything.

### 2.4 What is NOT in scope

- No changes to `packages/web` beyond the `/login` page and the `api.ts` auth-header injection.
- No changes to `packages/mcp-server`. The MCP server uses agent routes, and the transparent migration ensures those keep working.
- No SDK package. A future SDK extraction (if it happens) will start from `packages/cli/src/client/`, whose boundary is designed to be extractable.

---

## 3. Components & Data Model

### 3.1 `tokens` table

```sql
DEFINE TABLE tokens SCHEMAFULL;

DEFINE FIELD id              ON tokens TYPE string;
DEFINE FIELD tokenHash       ON tokens TYPE string;             -- sha256 hex, lookup key
DEFINE FIELD prefix          ON tokens TYPE string;             -- "nc_pat" | "nc_agt" | "nc_boot" | "nc_agt_migrated"
DEFINE FIELD name            ON tokens TYPE string;             -- human label
DEFINE FIELD scopes          ON tokens TYPE array<string>;
DEFINE FIELD namespaceClaim  ON tokens TYPE option<string>;     -- agent tokens only
DEFINE FIELD agentId         ON tokens TYPE option<string>;     -- agent tokens only
DEFINE FIELD createdAt       ON tokens TYPE datetime;
DEFINE FIELD createdBy       ON tokens TYPE option<string>;     -- token id that created this
DEFINE FIELD lastUsedAt      ON tokens TYPE option<datetime>;
DEFINE FIELD expiresAt       ON tokens TYPE option<datetime>;
DEFINE FIELD revokedAt       ON tokens TYPE option<datetime>;

DEFINE INDEX idx_token_hash  ON tokens FIELDS tokenHash UNIQUE;
DEFINE INDEX idx_token_agent ON tokens FIELDS agentId;
```

**The cleartext token is never stored.** Storage is only `tokenHash = sha256(cleartext)`.

### 3.2 `audit_log` table

```sql
DEFINE TABLE audit_log SCHEMAFULL;
DEFINE FIELD event         ON audit_log TYPE string;
DEFINE FIELD actorTokenId  ON audit_log TYPE option<string>;
DEFINE FIELD ip            ON audit_log TYPE option<string>;
DEFINE FIELD at            ON audit_log TYPE datetime;
DEFINE FIELD meta          ON audit_log TYPE object;
-- Retention: 7 days (cleanup job deferred to Phase 2)
```

Event vocabulary:

| Event | Meta |
|---|---|
| `auth.login` | `{ profile? }` |
| `auth.failed` | `{ reason: 'missing_token' | 'invalid_token' | 'token_revoked' | 'token_expired' }` |
| `auth.scope_denied` | `{ required: string[], granted: string[] }` |
| `auth.rate_limited` | `{ endpoint }` |
| `token.create` | `{ template, name, scopes }` |
| `token.revoke` | `{ tokenId }` |
| `setup.exchange` | `{}` |
| `setup.failed` | `{ reason }` |
| `setup.not_needed` | `{}` |
| `migration.success` | `{ migrated: number }` |
| `migration.failed` | `{ reason }` |

**Not logged:** cleartext tokens, request bodies, successful token validations (too noisy).

### 3.3 Scope vocabulary

| Scope | Allows |
|---|---|
| `admin:*` | All routes except `/agent/*`. Implicitly includes every other non-`agent:` scope. |
| `memories:read` | `GET /memories`, `POST /search` |
| `memories:write` | `POST /memories`, `DELETE /memories/:id` |
| `namespaces:read` | `GET /namespaces` |
| `namespaces:write` | `POST /namespaces`, `DELETE /namespaces/:name` |
| `knowledge:read` | `GET /knowledge`, `GET /knowledge/:id` |
| `knowledge:write` | `POST /knowledge/upload`, `DELETE /knowledge/:id`, `POST /knowledge/:id/access` |
| `buckets:read` / `buckets:write` | read / write of `/buckets/*` |
| `processor:read` / `processor:write` | read / write of `/processor/*` |
| `federation:*` | all `/federation/*` |
| `tokens:read` / `tokens:write` | self-management CRUD on `/tokens` |
| `agent:{agentId}` | implicit scope for agent tokens, combined with namespace claim |

`admin:*` is implemented as a shortcut in `hasScope()`: if the token has `admin:*`, any required scope that does not start with `agent:` is granted automatically.

### 3.4 Token templates

| Template ID | Display name | Scopes granted |
|---|---|---|
| `admin-full` | Full Admin | `admin:*`, `tokens:read`, `tokens:write` |
| `admin-readonly` | Read-only Admin | `memories:read`, `namespaces:read`, `knowledge:read`, `buckets:read`, `processor:read` |
| `agent` | Agent (requires namespace) | `memories:read`, `memories:write`, `knowledge:read`, `agent:{id}` + `namespaceClaim` |
| `knowledge-ingest` | Knowledge Ingest (CI/Pipeline) | `knowledge:write`, `knowledge:read` |

Token creation (both CLI `admin tokens create` and Web UI "Create Token") accepts **only template IDs**. Free-form scope selection is Phase 2.

### 3.5 `TokenService` contract (`packages/api/src/services/token-service.ts`)

```ts
interface TokenRecord {
  id: string;
  tokenHash: string;
  prefix: 'nc_pat' | 'nc_agt' | 'nc_boot' | 'nc_agt_migrated';
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

class TokenService {
  connect(cfg: SurrealDBConfig): Promise<void>;

  // Bootstrap
  needsBootstrap(): Promise<boolean>;                        // no non-'nc_boot' admin token exists
  generateBootstrapCode(): Promise<string>;                  // idempotent per server start
  exchangeBootstrapCode(code: string): Promise<{ token: string; record: TokenRecord }>;

  // Lookup (hot path, in-memory cache)
  validate(cleartextToken: string): Promise<TokenRecord | null>;
  hasScope(record: TokenRecord, required: string): boolean;

  // CRUD
  create(opts: {
    template: 'admin-full' | 'admin-readonly' | 'agent' | 'knowledge-ingest';
    name: string;
    agentId?: string;
    namespaceClaim?: string;
    expiresAt?: Date;
    createdBy?: string;
  }): Promise<{ token: string; record: TokenRecord }>;

  list(filter?: { prefix?: string }): Promise<Array<Omit<TokenRecord, 'tokenHash'>>>;
  revoke(id: string, revokedBy?: string): Promise<boolean>;

  // Migration (idempotent, runs on startup)
  migrateFromApiKeys(): Promise<{ migrated: number; skipped: number }>;
}
```

- `create()` is the **only** method that returns cleartext. The cleartext is not retained anywhere else.
- `validate()` uses an in-memory cache populated at `connect()`. Cache invalidation on `create`, `revoke`, and bootstrap-code burn.
- `lastUsedAt` updates are fire-and-forget.

### 3.6 `requireScopes` middleware (`packages/api/src/middleware/auth.ts`)

```ts
function extractToken(req: Request): string | null;
//   1. Authorization: Bearer <token>
//   2. X-API-Key: <token>            (legacy agent key support)
//   3. null otherwise

function requireScopes(...required: string[]): RequestHandler;
// Flow:
//   1. extractToken(req)
//   2. tokenService.validate(cleartext) → record or null
//   3. record == null                          → 401 { error: 'invalid_token' | 'missing_token' }
//   4. record.revokedAt                        → 401 { error: 'token_revoked' }
//   5. record.expiresAt < now                  → 401 { error: 'token_expired' }
//   6. for each required scope → hasScope()
//   7. any missing                             → 403 { error: 'insufficient_scope', required, granted }
//   8. req.auth = { tokenId, scopes, agentId?, namespaceClaim? }
//   9. next()

function rateLimit(opts: { perMinute: number }): RequestHandler;
// Separate middleware composed before requireScopes on auth-sensitive routes.
```

### 3.7 CLI config schema (`packages/cli/src/config/schema.ts`)

```ts
const ConfigV1 = z.object({
  version: z.literal(1),
  activeProfile: z.string(),
  profiles: z.record(z.string(), z.object({
    name: z.string(),
    url: z.string().url(),
    token: z.string(),                               // cleartext; file is chmod 600
    kind: z.enum(['selfhosted', 'saas']),
    createdAt: z.string().datetime(),
    lastUsedAt: z.string().datetime().optional(),
    serverInfo: z.object({                           // cached from /auth/whoami
      version: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      tokenName: z.string().optional(),
    }).optional(),
  })),
});
```

`version: 1` is mandatory. Unknown version → `ConfigCorruptedError` with an upgrade hint. Writes are atomic (`writeFileSync(tmpPath); renameSync(tmpPath, configPath)`).

---

## 4. Data Flows

### 4.1 Bootstrap flow (first server start)

```
docker compose up
  │
  ▼
api startup
  │
  ├─ tokenService.connect()
  ├─ await migrateFromApiKeys()    (idempotent, no-op if empty)
  ├─ needsBootstrap() → true        (no admin token exists)
  └─ generateBootstrapCode()
         │
         ▼
    stdout / docker logs:
    ─────────────────────────────────────────────
      NovaCortex Setup Required
      Bootstrap code: nc_boot_ABC123…
      Valid for 1 hour
      Exchange via:
        novacortex setup --url URL --code nc_boot_ABC123…
    ─────────────────────────────────────────────
```

**Idempotent:** If the admin token exists at next boot, no bootstrap code is generated. If the table is empty and the previous bootstrap code is still valid, the **same** code is reprinted (no refresh — operators must not lose the code).

**`needsBootstrap()` definition:** `SELECT count(*) FROM tokens WHERE prefix != 'nc_boot' AND revokedAt IS NULL` → false if count > 0.

### 4.2 Setup flow (CLI first contact)

```
CLI                              API                         SurrealDB
  │                                │                            │
  │ novacortex setup \              │                            │
  │   --url http://localhost:3001 \ │                            │
  │   --code nc_boot_ABC123         │                            │
  │                                │                            │
  │─ POST /setup/exchange ─────────▶                            │
  │   { code: "nc_boot_ABC123" }   │                            │
  │                                │─ SELECT FROM tokens ─────▶│
  │                                │   WHERE prefix='nc_boot'   │
  │                                │   AND tokenHash = sha256(code)
  │                                │   AND revokedAt IS NULL    │
  │                                │   AND expiresAt > now      │
  │                                │                            │
  │                                │ (constant-time compare)    │
  │                                │                            │
  │                                │─ UPDATE tokens ──────────▶│
  │                                │   SET revokedAt = now      │
  │                                │                            │
  │                                │─ INSERT INTO tokens ─────▶│
  │                                │   new admin-full token     │
  │                                │   name='Initial Admin'     │
  │                                │   prefix='nc_pat'          │
  │                                │                            │
  │◀─ 200 { token, whoami } ───────│                            │
  │                                                             │
  │ write ~/.config/novacortex/config.json                       │
  │ chmod 600                                                     │
  │                                                               │
  │ ✓ Setup complete.
```

- `/setup/exchange` is **not** behind `requireScopes`. It is the only endpoint that accepts a token with `prefix='nc_boot'`.
- Rate limit: 5 req/min per IP.
- After exchange, the bootstrap code is "burned" (`revokedAt = now`). A second call fails with `invalid_setup_code`.
- The Admin token exists in the DB **only as a hash**. Cleartext is returned once and written to the CLI config.

### 4.3 Login flow (second machine, existing server)

```
CLI                            API
 │ novacortex auth login \      │
 │   --url http://nc.local \    │
 │   --token nc_pat_XXX \       │
 │   --profile home             │
 │                              │
 │─ GET /auth/whoami ──────────▶
 │   Authorization: Bearer nc_pat_XXX
 │                              │
 │                              │ requireScopes() → record, ok
 │                              │
 │◀─ 200 { kind, name, scopes, server:{ version, mode:'selfhosted' } }
 │
 │ add profile 'home' to config
 │ (optionally) set activeProfile='home'
 │
 │ ✓ Logged in as '[tokenName]' on http://nc.local (profile: home)
```

**Edge cases:**
- `--token` omitted → interactive prompt: `? Paste your access token:` (hidden input via `prompts`).
- `kind='saas'` explicit → clear error: `SaaS login not yet available — see Subsystem D roadmap`.
- Invalid token → `401`, CLI reports `InvalidTokenError`, no config write.
- Unreachable URL → `ServerUnreachableError`, no config write.

### 4.4 Protected request (typical CLI call or web UI fetch)

```
Client         requireScopes(...)             TokenService       SurrealDB
  │               │                              │                  │
  │─ GET /namespaces ──────────────────▶         │                  │
  │  Authorization: Bearer nc_pat_XXX             │                  │
  │               │                              │                  │
  │               │─ rateLimitCheck(ip) → ok     │                  │
  │               │─ extractToken()               │                  │
  │               │─ validate("nc_pat_XXX") ───▶ │                  │
  │               │                              │ hash + cache     │
  │               │                              │ lookup           │
  │               │                              │ (miss → SELECT) ▶│
  │               │                              │◀─ record ────────│
  │               │◀─ record ────────────────────│                  │
  │               │                              │                  │
  │               │─ hasScope('namespaces:read') │                  │
  │               │ → true (admin:* matches)     │                  │
  │               │                              │                  │
  │               │─ req.auth = { … }            │                  │
  │               │─ next()                      │                  │
  │               │                              │                  │
  │               │ handler executes              │                  │
  │               │                              │                  │
  │               │ (post-handler, non-blocking) │                  │
  │               │─ updateLastUsed(record.id) ─▶│                  │
  │◀─ 200 [...] ──│                              │                  │
```

### 4.5 Agent request (existing `sk_...` client, post-migration)

**Before the upgrade:** Agent sends `Authorization: Bearer sk_foo_xyz` → legacy `apiKeyAuth` → 200.

**Upgrade, server first start:** `migrateFromApiKeys()` copies every active `api_keys` row into `tokens`:
- `tokenHash = sha256(sk_foo_xyz)`
- `prefix = 'nc_agt_migrated'`
- `scopes = ['memories:read', 'memories:write', 'knowledge:read', 'agent:{agentId}']`
- `namespaceClaim = {primary}`, `agentId = {agentId}`
- Old `api_keys` is renamed to `api_keys_migrated_v1` (read-only safety net).

**After the upgrade:** Agent still sends `Authorization: Bearer sk_foo_xyz`. `extractToken()` returns the cleartext, `validate()` hashes it, lookup hits the `tokens` table, scopes match → 200. **The agent client sees no change.**

**Phase 2 (not Subsystem C):** Agent clients can be guided to rotate their keys to new `nc_agt_...` tokens. Old `sk_...` stays functional until explicit revoke.

### 4.6 Web UI — paste-token login

The web UI today makes unauthenticated fetches. After Subsystem C, these fail. The transitional fix:

- `/login` page (new): minimal form with "Paste your access token" input and "Login" button.
- Token is stored in `localStorage.novacortex_token`.
- `packages/web/src/lib/api.ts` reads `localStorage.novacortex_token` and attaches `Authorization: Bearer ${token}` to every fetch.
- Any `401` response clears `localStorage.novacortex_token` and redirects to `/login`, except when the 401 came from the `/login` page itself (defensive to avoid redirect loops).
- Sidebar gains a "Logout" button that clears the token locally.
- CORS: `Access-Control-Allow-Headers` on the API must include `Authorization`.

**Why this is acceptable:**
- Honest: the user must actively provide a token. No hidden dev bypass.
- Consistent with the CLI decision (cleartext on disk ↔ cleartext in localStorage).
- Minimal web code surface: one new page, one hook, one header injection.
- Forward-compatible with Subsystem D: the paste input becomes an email/password form, localStorage becomes a session cookie — but the fetch-layer is already plumbed.

---

## 5. Error Handling

### 5.1 API error response shape

```json
{
  "error": "<snake_case_code>",
  "message": "<human readable>",
  "hint": "<optional next step>"
}
```

### 5.2 Error matrix

| Situation | HTTP | `error` code | Audit event |
|---|---|---|---|
| No auth header | `401` | `missing_token` | `auth.failed` |
| Malformed token | `401` | `invalid_token` | `auth.failed` |
| Token hash not found | `401` | `invalid_token` | `auth.failed` |
| Token revoked | `401` | `token_revoked` | `auth.failed` |
| Token expired | `401` | `token_expired` | `auth.failed` |
| Token valid, scope missing | `403` | `insufficient_scope` + `{ required, granted }` | `auth.scope_denied` |
| Bootstrap code invalid/expired/burned | `401` | `invalid_setup_code` | `setup.failed` |
| Bootstrap endpoint called after setup | `404` | `not_found` | `setup.not_needed` |
| `POST /tokens` without `tokens:write` | `403` | `insufficient_scope` | `auth.scope_denied` |
| Rate limit exceeded | `429` + `Retry-After` | `rate_limited` | `auth.rate_limited` |
| Agent token used for wrong namespace | `403` | `forbidden_namespace` | `auth.scope_denied` |

### 5.3 Information disclosure avoidance

- `missing_token` and `invalid_token` return **structurally identical** bodies and comparable timing. The only difference is the `error` code — and that is itself a minor leak we accept, because splitting it reveals less than a generic `unauthorized` that hides the reason from the legitimate user.
- Error logs never echo cleartext tokens. Only the first 12 chars of the SHA-256 hash are logged for correlation.
- Bootstrap compare uses `crypto.timingSafeEqual`.

### 5.4 CLI error classes

Exit code ranges:

| Range | Meaning |
|---|---|
| 0 | success |
| 1 | generic failure |
| 2 | config / profile error |
| 3 | auth error |
| 4 | network error |
| 5 | file system error |
| 6 | setup / bootstrap error |
| 7 | server compatibility error |

Classes (in `packages/cli/src/lib/errors.ts`):

```ts
class ProfileNotFoundError        extends CliError { exitCode = 2; }
class NotLoggedInError            extends CliError { exitCode = 2; }
class InvalidTokenError           extends CliError { exitCode = 3; }
class InsufficientScopeError      extends CliError { exitCode = 3; }
class ServerUnreachableError      extends CliError { exitCode = 4; }
class ConfigCorruptedError        extends CliError { exitCode = 5; }
class BootstrapExpiredError       extends CliError { exitCode = 6; }
class BootstrapAlreadyUsedError   extends CliError { exitCode = 6; }
class UnsupportedServerError      extends CliError { exitCode = 7; }
```

### 5.5 CLI output formats

- **TTY (default):** colored multi-line error with icon, problem, hint, docs link.
- **`--json`:** `{ error, message, hint }` on stderr, matching exit code.
- **Non-TTY (pipe/script):** automatic plain text, no ANSI codes.

Example TTY output:

```
✗ Cannot reach http://localhost:3001

  The NovaCortex server at this address is not responding.

  Possible causes:
    • Server is not running (try: docker compose ps)
    • Wrong URL in profile 'default' (try: novacortex profile show)
    • Network / firewall issue

  Run `novacortex profile show` to inspect the current profile.
```

### 5.6 Critical edge cases

- **Partial config write:** writes go through `fs.writeFileSync(tmpPath, data); fs.renameSync(tmpPath, configPath)` so a crash mid-write cannot leave a half-written config.
- **Schema mismatch:** at CLI start, config is parsed via Zod. An unknown `version` yields `ConfigCorruptedError` with the file path and a recovery hint ("backup the file, run `novacortex auth login` to recreate").
- **Migration failure:** `migrateFromApiKeys()` runs in a SurrealDB transaction. On failure → rollback; server **still starts** (crashloop is worse); writes prominent `MIGRATION_FAILED` log; auth middleware uses a **legacy fallback** (old `apiKeyService` loaded from `packages/api/src/services/legacy-api-keys.ts`) until an operator retries via `POST /admin/migrate` (requires `admin:*`). The legacy fallback is a deliberate one-file dead-end that will be removed in a follow-up release.
- **Post-migration bootstrap:** `needsBootstrap()` checks for non-`nc_boot` tokens (not just empty table). If only agent-migrated tokens exist but no admin token, the server generates a new bootstrap code AND keeps accepting the migrated agent tokens in parallel.
- **Bootstrap race:** two parallel calls to `/setup/exchange` with the same code → exactly one succeeds, the other gets `invalid_setup_code`. Enforced by the `revokedAt` update being conditional.
- **Rate-limit bucket overflow:** in-memory `Map<ip, { count, resetAt }>`, cleaned every 60s. On overflow → 429 with `Retry-After`. No IP jailing in Phase 1.
- **Client IP resolution:** the api process trusts the `X-Forwarded-For` header **only if** `TRUST_PROXY=true` is set in the environment (default: false). When true, the leftmost entry in `X-Forwarded-For` is used as the client IP for both rate limiting and audit logging. When false, `req.socket.remoteAddress` is used. Self-hosted users behind Traefik must set `TRUST_PROXY=true`; bare-metal installs should leave it off.
- **Web UI stale token:** any 401 in `api.ts` → `localStorage.removeItem('novacortex_token')` → redirect to `/login`. Loops prevented by not redirecting if the request origin was `/login`.
- **CLI no-profile state:** any command other than `auth`, `profile`, `setup`, `--help`, `--version` → `NotLoggedInError` with hint "Run `novacortex auth login` first."

---

## 6. Testing Strategy

### 6.1 Pyramid shape

```
                   ┌────────────────────┐
                   │ E2E (CLI → API)    │   ~ 8 tests
                   └────────────────────┘
                 ┌────────────────────────┐
                 │ Integration (API ↔ DB) │   ~ 25 tests
                 └────────────────────────┘
              ┌──────────────────────────────┐
              │ Unit (mocked, London-style)  │   ~ 60 tests
              └──────────────────────────────┘
```

### 6.2 Unit tests

**`packages/api/tests/unit/services/token-service.test.ts`:**

- `create()` returns cleartext and stores only hash
- `create()` expands templates correctly (e.g. `agent` → expected scope set)
- `validate()` cache hit
- `validate()` returns null for unknown token
- `validate()` returns null for revoked/expired
- `validate()` updates `lastUsedAt` non-blocking
- `hasScope()` — `admin:*` matches every non-`agent:` scope
- `hasScope()` — `admin:*` does **not** match `agent:x`
- `hasScope()` — literal scope matching
- `exchangeBootstrapCode()` mints admin-full token, burns the code
- `exchangeBootstrapCode()` second call fails
- `migrateFromApiKeys()` idempotent (second run is no-op)
- `migrateFromApiKeys()` on empty table → 0 migrated, no error
- `migrateFromApiKeys()` renames table after success

DB calls are mocked via `fake-surreal`, a small in-memory surrogate under `packages/api/tests/helpers/`.

**`packages/api/tests/unit/middleware/auth.test.ts`:**

- `extractToken()` — Bearer header
- `extractToken()` — `X-API-Key` legacy header
- `extractToken()` — null when both missing
- `requireScopes('memories:read')` — 401 on no token
- `requireScopes(...)` — 401 on invalid token
- `requireScopes(...)` — 403 on insufficient scope, response contains `required` and `granted`
- `requireScopes(...)` — `next()` on success, `req.auth` populated
- Rate limit exceeded → 429 + `Retry-After`
- **Information disclosure**: response body identity between `missing_token` and `invalid_token`

**`packages/cli/tests/unit/config/profile-store.test.ts`:**

- `read()` parses valid v1 config
- `read()` → `ConfigCorruptedError` on broken JSON
- `read()` → `ConfigCorruptedError` on unknown `version`
- `write()` is atomic (tmp + rename), sets `chmod 600` on unix
- `write()` preserves profile order
- `setActiveProfile()` throws on unknown name
- `deleteProfile()` throws on deleting the active profile without `force`

**`packages/cli/tests/unit/client/http.test.ts`:**

- Wrapper sets auth header correctly
- User-Agent header includes CLI version
- 401 → `InvalidTokenError`
- 403 → `InsufficientScopeError`
- `ECONNREFUSED` → `ServerUnreachableError`
- JSON parse failure → `UnsupportedServerError`

### 6.3 Integration tests

Run against a real SurrealDB in Docker (via testcontainers or a `docker compose -f docker-compose.test.yml` side-stack). File: `packages/api/tests/integration/auth-flow.test.ts`.

- **Bootstrap → Setup → Whoami** full path, asserting admin-full scopes
- **Setup idempotence** — second exchange with same code → 401
- **Protected route** — `GET /namespaces` without token → 401, with admin token → 200
- **Scope gate** — read-only token allowed on `GET /memories`, denied on `GET /namespaces`
- **Agent backwards compat** — seed old `sk_foo_xxx` in `api_keys`, start server, run migration, agent request with old key → 200
- **Migration failure recovery** — broken `api_keys` row, server starts, legacy fallback works, admin routes still locked
- **Bootstrap race** — parallel `/setup/exchange` calls, exactly one succeeds
- **CORS preflight** — OPTIONS on admin route returns `Authorization` in allow-headers
- **Audit log** — failed login creates expected event row

### 6.4 E2E tests

File: `packages/cli/tests/e2e/full-flow.test.ts`. Starts the API in a child process, runs CLI commands via `execFile`, asserts on stdout/exit code.

1. Fresh setup: extract bootstrap code from logs → `novacortex setup --url --code` → exit 0, config file exists with `chmod 600`
2. `auth whoami` after setup → shows profile, scopes, server info
3. Profile switch: second profile, `profile use work`, whoami
4. `profile list` shows both, active marked
5. Invalid token login → exit 3, stderr contains "invalid or revoked"
6. Unreachable server → exit 4, stderr contains "Cannot reach"
7. `auth whoami --json` → valid JSON on stdout, exit 0
8. ENV override: `NOVACORTEX_URL=... NOVACORTEX_TOKEN=... novacortex admin tokens list` → works with config file removed

### 6.5 Security-specific tests

`packages/api/tests/security/auth.test.ts`:

- **Timing smoke**: avg `validate()` time for 1000 invalid tokens vs 1000 invalid-with-matching-prefix. σ < 5 %. Documented as "smoke" because true timing-attack reproduction requires a hardened harness.
- **Cleartext leakage smoke**: grep all API log output for `nc_(pat|agt|boot)_[a-zA-Z0-9_-]{30,}` → zero matches.
- **Information disclosure smoke**: `POST /setup/exchange` with existing-but-wrong code vs non-existent code → identical body and timing within 10 %.
- **Rate-limit enforcement**: 11 calls in 1 minute at `/setup/exchange` → 11th returns 429.
- **Scope escalation**: token with `memories:read` tries `POST /tokens` → 403.

### 6.6 Explicitly NOT tested

- Load tests (Phase 2 if needed)
- Fuzz testing (optional future work via `jazzer.js`)
- Docker-Compose-level E2E (too slow; process-level E2E is sufficient)
- Web UI tests (the `/login` page + header injection is simple enough for manual smoke testing; revisit if the web surface grows)

### 6.7 Test infrastructure

- Test runner: `vitest` or `node --test` (decided at implementation time; `vitest` preferred if already elsewhere in the monorepo)
- Helpers: `packages/api/tests/helpers/fake-surreal.ts`, `packages/api/tests/helpers/test-server.ts`
- CI: unit tests in default `npm test`; integration and E2E behind `npm run test:integration` and `npm run test:e2e`
- Coverage target: ≥ 90 % for `token-service.ts`, `auth.ts`, `profile-store.ts`. Other files: "sensible", no hard target.

---

## 7. Migration Strategy

### 7.1 What changes for existing installations

Existing installations have:
- `api_keys` table in SurrealDB with rows like `{ key: 'sk_foo_abc', agentId, primaryNamespace, readableNamespaces, … }`
- Agent clients holding their `sk_foo_abc` cleartext keys
- Admin routes without auth

After upgrade:
- `tokens` table exists alongside, populated from `api_keys` by the migration
- Agent clients keep working with their `sk_foo_abc` keys (transparent hash lookup)
- Admin routes require `admin:*` (or finer) scope
- Web UI requires paste-token login on first load
- `api_keys` table is renamed to `api_keys_migrated_v1`

### 7.2 Operator runbook (self-hosted upgrade)

1. Pull the new image / restart the api container.
2. Watch logs for the migration report:
   ```
   migration: start (api_keys → tokens)
   migration: migrated 7 keys, skipped 0
   migration: renamed api_keys → api_keys_migrated_v1
   ```
3. Watch logs for the bootstrap notice (if no admin token exists yet — common for existing installs where the migration only brought over agent keys):
   ```
   NovaCortex Setup Required
   Bootstrap code: nc_boot_…
   ```
4. Run `novacortex setup --url … --code nc_boot_…` to claim the admin token (first time).
5. Open the web UI; it now redirects to `/login`. Paste the admin token.
6. Verify agents still work: check agent logs for normal operation; `novacortex admin tokens list` shows migrated agents with `nc_agt_migrated` prefix.

### 7.3 Rollback plan

- The old `api_keys_migrated_v1` table is preserved for the full Subsystem C release cycle.
- Reverting to the previous version requires: (a) renaming `api_keys_migrated_v1` back to `api_keys`, (b) downgrading the api image. The new `tokens` table is ignored by the old server.
- **No data is destroyed** by the migration. The rollback is practical for the first two weeks after release.

### 7.4 When the legacy fallback kicks in

If `migrateFromApiKeys()` throws (e.g., on malformed legacy data), the server:
1. Rolls back the migration transaction.
2. Logs `MIGRATION_FAILED: <reason>` with full stack trace.
3. Falls back to loading `apiKeyService` (the pre-existing code, renamed to `legacy-api-keys.ts`) so that existing agents with `sk_...` keys keep working against `/agent/*` routes.
4. **Admin routes remain locked.** They do not fall back, because we cannot mint admin tokens without the new schema being consistent.
5. The server detects it is in a "no admin token exists" state (the `tokens` table is empty or contains only migrated agent rows) and **generates a bootstrap code**, logged the same way as a fresh install (§4.1).
6. The operator fixes the bad data in `api_keys_migrated_v1` (or the still-live `api_keys` after rollback), then:
    - Calls `novacortex setup --url … --code <bootstrap>` to mint an admin token (no migration retry yet).
    - With the admin token, calls `POST /admin/migrate` (requires `admin:*`), which re-runs `migrateFromApiKeys()` with the fixed data.
    - On success, the legacy fallback unloads and the server switches fully to the unified `tokens` path.

This path is the only way Subsystem C tolerates a broken migration without crash-looping. The legacy fallback and `POST /admin/migrate` endpoint are both deliberate dead-ends that will be removed once Subsystem C has shipped stably.

---

## 8. Deferred Decisions (for implementation time)

These are not architectural decisions — they are resolvable during implementation without changing the spec:

1. **CLI framework:** `commander` vs `citty`. Both work. Decision at first commit in `packages/cli`.
2. **Test runner:** `vitest` vs `node --test`. Prefer matching whatever the rest of the monorepo uses.
3. **ANSI/color library:** `kleur` vs `picocolors`. Trivial difference; pick one.
4. **Interactive prompt library:** `prompts` vs `@inquirer/prompts`. Pick whichever has fewer transitive deps.
5. **Audit log cleanup strategy:** MVP leaves the table growing. Phase 2 adds a nightly job (cron inside the api process, or a SurrealDB `DEFINE EVENT`). Choice depends on how ergonomic SurrealDB scheduled events have become.
6. **Token name validation:** we allow any non-empty unicode string for `TokenRecord.name`. Implementation may narrow this (e.g., disallow control characters) without changing the spec.

---

## 9. Future Work

Explicitly *not* Subsystem C, but natural follow-ups:

- **Subsystem D — SaaS user login.** OAuth Device Authorization Grant, user/org model, `/cli/authorize` page, email/password or SSO. When built, the CLI `auth login --kind saas` path becomes functional; the profile shape does not change.
- **Subsystem B — CLI knowledge ingest.** Obsidian vault importer, streaming upload, resumable imports. Builds on the `packages/cli` package created here.
- **Subsystem A — Admin UI reorganization.** Standard/Advanced split. Benefits from knowing what the CLI covers.
- **Keychain credential storage.** `tokenRef: "keychain"` as an opt-in upgrade for users who want OS-keychain integration.
- **Token expiry & auto-rotation.** Currently tokens are long-lived. A future subsystem can add rotation, short-lived tokens, and refresh flows.
- **Audit log rotation.** Nightly cleanup, export to external sinks, SIEM integration.
- **Free-form scope editor.** Replace template-only token creation with arbitrary scope combinations.
- **Redis-backed rate limiting.** Needed if the API ever runs multi-instance.
- **Fine-grained agent scopes** (per-namespace, per-action) beyond the current template.

---

## 10. Open Questions for User Review

None after the brainstorm — all major decisions are captured in §1 and §2. Anything the user wants to revise should be raised during the review of this spec.

---

## Appendix A — Brainstorm Decision Log

Chronological record of decisions made during the brainstorming session. Reading this explains *why* the spec looks the way it does.

| # | Question | Options considered | Decision | Reason |
|---|---|---|---|---|
| 1 | Decompose or single spec? | single / decompose into A/B/C | **decompose into A/B/C; C first** | Multi-subsystem request; C is the foundation |
| 2 | Identity model: same or different for self-hosted and SaaS? | (a) PATs everywhere / (b) self-hosted open, SaaS with users / (c) full user accounts everywhere | **(a)** | Security is a selling point; wants unified primitive |
| 3 | One token type or two? | (a) unified with scopes / (b) separate admin-PATs + agent-keys / (c) unified, binary role only | **(a)** | Scopes are standard; migration is one-time |
| 4 | Initial admin token delivery in self-hosted? | (a) web wizard / (b) log bootstrap code / (c) env var / (d) all three | **(b) only** | Simpler docs, one clear happy path |
| 5 | Single or multi-profile CLI? | (a) single / (b) multi-profile from day one / (c) single now, multi later | **(b)** | Target users need it, low cost |
| 6 | Token storage (CLI)? | (a) file / (b) keychain / (c) keychain+file / (d) file+passphrase / (e) env var mode | **(a) with ENV override always allowed** | "Make it easy for the user" |
| 7 | SaaS login flow? | (a) paste only / (b) device code / (c) both | **(c)** for SaaS — later deferred to Subsystem D |
| 8 | Definition of done (25-point list) | draft presented | **adopted with edits**: removed OAuth endpoints (→ Subsystem D), added hashing, rate-limiting, timing-safe compare, token templates, 7-day audit retention |
| 9 | Architecture approach | (1) monorepo-native CLI package / (2) dumb fetch CLI / (3) SDK-first | **(1)** | Right-sized, no tech debt, no scope creep |
| 10 | Web UI transition | dev bypass / shared env token / sessions / paste-token | **paste-token + localStorage** | Honest, minimal surface, forward-compatible |
