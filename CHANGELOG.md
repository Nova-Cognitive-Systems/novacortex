# Changelog

All notable changes to NovaCortex are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/); this project uses semantic versioning.

## [Unreleased]

Foundation for v1.3 "Intelligence" (Phase A).

### Added
- **Local-embeddings compose profile**: `docker compose --profile local-embeddings up -d`
  starts an Ollama sidecar (default model `nomic-embed-text`) so semantic search runs
  fully on your own host — no memory text ever leaves your infrastructure.
  `scripts/gen-env.sh --local-embeddings` preconfigures the required env in one step.
- **Embedding dimension guard**: at startup the API probes the embedding endpoint and
  **fails loudly** when the model's vector dimension doesn't match `QDRANT_VECTOR_SIZE`
  (previously every background upsert failed silently). An unreachable endpoint only
  degrades to substring search and is reported. Escape hatch: `EMBEDDING_DIM_CHECK=off`.
- **Search-mode visibility**: `/health` now reports the active search mode
  (`semantic` vs `text`) plus embedding provider status; the Settings page shows it
  prominently — a silent substring fallback is no longer invisible.
- **License activation in the UI**: paste an `nclic.…` key on the Settings page
  (admin token required) instead of env-only activation. Activated licenses now carry
  the licensee email/expiry from the signed key payload.
- **Tier request limits enforced**: the advertised `api_rate_limit` tier feature
  (100/1000/10000 req/min) is now wired to a per-token limiter across the data-plane
  routes. Self-hosters can raise or disable it via `API_RATE_LIMIT` (`off`/`0`
  disables) — storage and retrieval remain unmetered.

### Fixed
- **`hybridSearch` text leg ignored the query**: the query string was never forwarded
  to the SurrealDB search, so the "text" contribution silently degenerated into a
  top-salience browse and fused unrelated memories into hybrid results.
- **Compose naming footgun**: `docker-compose.yml` is now the supported GHCR-image
  stack (the experimental Traefik variant moved to `docker-compose.traefik.yml`), so a
  plain `docker compose up -d` works. Dev scripts use the self-contained
  `docker-compose.dev.yml` directly.

## [1.2.1] — 2026-06-25

Public site + docs (Phase 4).

### Added
- **Public landing page** at `/` (was a redirect to `/login`) — wires the existing
  hero/canvas components, a feature grid, a self-host section and a footer.
- **Pricing page** at `/pricing` — Free / Pro / Enterprise tiers.
- README: documents PMF formats, OpenTelemetry, and the ed25519 licensing + issuer
  workflow (`gen-license-keypair.mjs` / `issue-license.mjs`) with a tier table.

### Fixed
- Self-host compose default image tag now tracks the release (was lagging at 1.1.1).

## [1.2.0] — 2026-06-25

Open-core licensing hardening (Phase 3, part 1). Stripe checkout will follow as a
separate (closed) billing service.

### Changed (breaking for license keys)
- **License keys are now ed25519-signed** instead of HMAC. The OSS build embeds
  only the public key, so it can verify keys offline but **cannot forge them** —
  issuance requires the private key, held solely by the issuer. The old HMAC
  scheme shipped a shared secret in the build, making keys forgeable; **all legacy
  `MS-*` keys (incl. the previously-leaked one) no longer validate.**
- Key format: `nclic.<base64url(payload)>.<base64url(signature)>`, with the tier,
  email, issued-at and optional expiry carried in the signed payload. Expiry is now
  enforced. Override the verification key with `NOVACORTEX_LICENSE_PUBKEY`.

### Added
- `scripts/gen-license-keypair.mjs` — generate an ed25519 signing keypair (private
  key written gitignored + `0600`; public key printed for embedding).
- `scripts/issue-license.mjs` — issue a signed key for an email/tier (issuer-only,
  reads the private key from `LICENSE_SIGNING_KEY` / `…_FILE` / `config/`).
- Tiers unchanged: unregistered (1 ns) · free (3) · pro (10, federation +
  priority support) · enterprise (unlimited). Pricing model: free self-host +
  one-time Pro unlock + Enterprise.

## [1.1.1] — 2026-06-25

Fixes from an adversarial multi-agent bug hunt over the v1.1.0 code (20 confirmed
findings; all verified and fixed except a deferred unique-index change).

### Security
- **Broken access control on `/memories`**: the router authenticated but never
  authorized, so read-only / narrow tokens could export, import, and delete all
  memory data. Now scope-enforced — reads require `memories:read`, writes/deletes
  require `memories:write`.
- **PMF integrity**: import now recomputes each memory's content hash and rejects
  any mismatch (tampered/corrupted content with an intact hash no longer imports
  silently); the checksum now also covers type, metadata and embeddings.
- PMF export password is **header-only** (`X-PMF-Password`) — the query-string
  fallback (which leaked into request logs) was removed.

### Fixed
- Exports (`/export`, `/pmf`, `/diff`) paginate fully instead of silently capping
  at 100k rows; `diff` pushes the `since` filter down to the store.
- NDJSON streaming export handles client disconnect + backpressure; the error
  handler no longer crashes when a response has already started.
- Encrypted PMF uses **async scrypt** (no event-loop blocking under load).
- Recency-weighted search over-fetches and normalizes recency on an absolute
  scale, so it works with pagination instead of breaking it.
- `includeRelations` hydration is parallelized (was a serial N+1); `GET /memories?includeRelations=false` is no longer coerced to `true`.
- Imported (PMF/chat) and bucket-uploaded memories are embedded directly, so they
  are semantically searchable even on large stores (was a global salience-capped rescan).
- Consolidation is idempotent (no duplicate `supersedes` edges / repeated salience
  halving on re-runs); decay processing pages over all memories, not just the top 1000.
- `delete` removes relations + memory in one transaction; `findByIds` accessed-time
  bump is best-effort; embedding cache no longer stores empty vectors.

### Internal
- Telemetry shutdown folded into the single graceful-shutdown path (final spans flushed).
- Unraid deploy default image tag tracks the current release.

## [1.1.0] — 2026-06-25

Roadmap v1.1 features plus polish from the deep test.

### Added
- **Binary PMF** export/import (MessagePack, `?format=binary`) — ~60% smaller than JSON.
- **Encrypted PMF** (AES-256-GCM, scrypt KDF) — `?encrypt=true` with the
  `X-PMF-Password` header; import auto-detects the `NCENC1` envelope.
- **Differential export** — `GET /memories/export/:ns/diff?since=<ISO>` for incremental backups.
- **Streaming export** — `GET /memories/export/:ns/stream` (NDJSON, constant memory).
- **OpenTelemetry** (opt-in) — set `OTEL_EXPORTER_OTLP_ENDPOINT` to emit traces; no-op otherwise.
- **Recency-weighted search** — `recencyWeight` (0..1) blends recency into ranking
  so the current fact can outrank an older, equally-similar one.
- **Relation hydration in search** — `includeRelations` surfaces contradicts/supersedes
  edges on results (conflict signal).
- **`same_as` relation type** for aliases / same-entity links.
- **Vector reconciliation** — `POST /processor/run {"task":"reconcile"}` removes orphaned
  Qdrant points (bounded + batched; `background:true` for large stores).
- Query-embedding **LRU cache** (repeated searches skip the embedding call).

### Fixed
- `/health` `stats.namespaces` listed `[null]` (queried the wrong column).
- Knowledge-base uploads now embed targeted chunks instead of a global rescan.
- Embedding generation has a concurrency guard (overlapping imports no longer pile up
  and saturate the process).

## [1.0.1] — 2026-06-25

Functional fixes from a large-scale deep test (1079 memories across 9 namespaces).

### Fixed
- **Pagination stability**: list queries now have a unique secondary sort (id), so
  paging no longer drifts/silently drops ~10% of rows when many memories share a
  salience. `GET /memories` also returns `total`, `limit`, `offset`.
- **`GET /memories?query=`** now actually filters by content substring (was a
  silent no-op because the route schema dropped the param).
- **PMF import** preserves the relation graph: endpoints are remapped through an
  id map (relations were 100% silently lost), supports a `targetNamespace`, and
  returns `relationsImported`. Malformed PMF bodies return 400, not 500.
- **Knowledge-base uploads** now embed each chunk, so uploaded documents are
  retrievable by semantic search.
- **Relation discovery** is namespace-scoped and bounded (no more 504 timeouts on
  large stores; no cross-namespace edges); `POST /processor/run` accepts
  `namespace` and `background`.
- **Referential integrity**: `POST /memories/relations` rejects empty/nonexistent
  endpoints (404/400) instead of creating dangling edges.
- **Transaction-conflict resilience**: SurrealDB writes retry on transient
  "read or write conflict" errors; accessed-time bumps are best-effort.
- Malformed JSON request bodies return 400 (not 500); `GET /memories?limit>100`
  is clamped instead of rejected.

### Internal
- Integration tests run sequentially (shared live DB); CI runs the API with the
  background processor disabled during tests.

## [1.0.0] — 2026-06-24

First clean, verified self-hosted (Apache-2.0) release.

### Added
- **End-to-end semantic search**: a shared `EmbeddingService` plus
  `MemoryService.searchByText()` embeds the query server-side and runs a vector
  search (transparent substring fallback when embeddings are disabled). Wired into
  the REST `POST /search` (`query` or `vector`), MCP `memory_search`, and the SDKs.
- **`@novacortex/sdk`** — official TypeScript/JavaScript client.
- **Python SDK** — semantic `search`, `namespaces`/`stats`/`whoami`.
- **Webhooks** — `PUT/GET/DELETE /webhooks`; HMAC-signed, retried delivery of
  `memory.created/updated/deleted` and `processor.completed`.
- **CI/CD** — GitHub Actions (lint, typecheck, tests against a live stack, image
  build, audit) and a tag-triggered multi-arch GHCR release pipeline.
- `scripts/gen-env.sh` to generate strong self-host secrets.

### Changed
- Unified SurrealDB/Qdrant/embedding configuration across the API, MCP server, and
  tests — MCP and the REST API now share the same namespace/database/collection by
  default (previously diverged, so memory written via one was invisible to the other).
- Relation-discovery default similarity threshold 0.75 → 0.6 (0.75 surfaced nothing
  on realistic paraphrased memories); `POST /processor/run` accepts a `threshold`.
- Self-host compose: secure-by-default (required secrets via `${VAR:?}`, no weak
  fallbacks), pinned multi-arch GHCR images, and bind-mounted data under `${APPDATA}`.
- Consolidation made real but **non-destructive** (links + salience demotion, no deletes).
- Licensed the open-source core under **Apache-2.0**.

### Fixed
- Decay is now persisted (was a no-op empty update).
- Qdrant `deleteByNamespace` returns the real deleted count; `vectorSearch` drops
  orphaned vectors instead of returning stub results; `deleteMemory` tolerates a
  failed Qdrant delete.
- `CORS_ORIGINS` is honored (was dead config); added process-level
  `unhandledRejection`/`uncaughtException` handlers and graceful shutdown.

### Security
- Removed live license-key files from version control (rotate the leaked key).
- Self-host stack no longer boots with `changeme` / `change-this-secret` defaults.
