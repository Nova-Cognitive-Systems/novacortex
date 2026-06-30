# NovaCortex — Phase 0 Verifikationsreport (Live-Bring-up & End-to-End-Audit)

> Datum: 2026-06-24 · Methode: voller Dev-Stack lokal (Docker) + statische Analyse +
> Live-Tests gegen echte DBs. Dies ist die **verifizierte Baseline** für alle weiteren Phasen.

## Gesamturteil

**Das Projekt ist deutlich vollständiger als befürchtet und läuft end-to-end.** Der frühere
Eindruck "funktioniert nicht" rührte daher, dass das System nie live validiert wurde — nicht
von halbfertigem Code. Mit laufendem Stack sind **alle 122 Tests grün**. Es gibt **eine große
funktionale Lücke** (kein durchgängiger semantischer Such-Pfad) und einige bestätigte Bugs.

## Verifikationsmethode (tatsächlich ausgeführt)
- `tsc --noEmit` über alle 5 Packages → **0 Fehler**.
- Voller Dev-Stack via `docker-compose.dev.yml` (SurrealDB v2.2, Qdrant v1.14, Redis 7, API, Web) — alle healthy.
- `npm test` (Vitest) gegen den **laufenden** Stack → **122/122 grün, 15/15 Test-Files**.
- Manuelle Live-Tests: Auth, Memory-CRUD, Stats, Namespaces, Embeddings, Vector-Search, Web-UI, MCP-Server.
- OpenAI-Embeddings live getestet (Key aus 1Password).

## Status-Matrix

| Subsystem | Status | Evidenz |
|---|---|---|
| Build / Typecheck (5 Packages) | ✅ Funktioniert | `tsc --noEmit` 0 Fehler |
| Testsuite (live) | ✅ Funktioniert | 122/122 grün inkl. 21 Integration + 13 Web-E2E |
| Stack-Boot (API/Web/DBs) | ✅ Funktioniert | alle Container healthy |
| Auth (Token/Scope/whoami) | ✅ Funktioniert | `whoami` → scopes `admin:*`; Token gültig nach Restart |
| Memory CRUD / Stats / Namespaces | ✅ Funktioniert | Create→201; `/stats` 20→22; `/namespaces` korrekt |
| Embeddings **Store-Seite** | ✅ Funktioniert | `/embeddings/generate` → Qdrant 20→22 Vektoren (1536-dim) |
| Vector-Search-**Engine** | ✅ Funktioniert | Query "landmarks in France": Eiffel **0.4578** vs Sourdough 0.0135 |
| Semantischer **Query→Search** | ❌ **Lücke** | Kein Interface embeddet den Query (siehe Bug #1) |
| MCP-Server (12 Tools) | ✅ Funktioniert | JSON-RPC `tools/list` → 12 Tools |
| Web-UI + SSR-Proxy | ✅ Funktioniert | `/`→307→`/login` (200, 21KB); `/api/v1`-Proxy 200 |
| License-Enforcement (Tier-Limit) | ✅ Funktioniert | free: count 8 > limit 3 → `remaining:0`, neue NS geblockt |
| Stripe / Lizenzverkauf | ❌ Fehlt | keine Checkout-Anbindung (Phase 3) |
| CI/CD | ❌ Fehlt | kein `.github/workflows` |

## Bestätigte Bugs & Lücken (priorisiert)

### #1 — [HOCH] Kein durchgängiger semantischer Such-Pfad (Headline-Feature)
Embeddings werden nur für **gespeicherte** Memories erzeugt. **Nichts embeddet den Such-Query.**
- `memory-service.vectorSearch()` verlangt fertigen `vector`; `hybridSearch()` verlangt Query *und* Vektor (`packages/core/src/services/memory-service.ts:262,293`).
- MCP `memory_search`: nur wenn `embedding` mitgegeben → Vektor-Suche, sonst Substring-Text (`packages/mcp-server/src/tools.ts:313-333`).
- REST `POST /search`: Pflichtfeld `vector` (`packages/api/src/index.ts:535`, `VectorSearchSchema`).
- CLI `search` → `GET /memories?query=` → reine Substring-Suche.
- **Beweis:** Vektor-Suche funktioniert perfekt — *aber nur*, weil ich den Query selbst via OpenAI embeddet habe.
- **Fix (Phase 1):** OpenAI-Embedding-Logik aus `processor.ts` in einen wiederverwendbaren `EmbeddingService` (core) extrahieren; Such-Endpoints/MCP/CLI embedden den Text-Query serverseitig, wenn Embeddings aktiv sind.

### #2 — [HOCH] Env-Var-Namenskonflikt → Docker nutzt falsche Namespace/DB
Alle Compose-Dateien setzen `SURREALDB_NAMESPACE`/`SURREALDB_DATABASE`, der Code liest aber
`SURREALDB_NS`/`SURREALDB_DB` (`packages/api/src/index.ts:119-120`, Defaults `memory`/`stack`).
- **Folge:** In *jedem* Docker-Deployment werden die konfigurierten Werte (z.B. `novacortex`/`production`) ignoriert; Daten landen in `memory/stack`. Live bestätigt (Token in `memory/stack` funktioniert gegen die Container-API).
- **Fix (Phase 1):** Env-Namen angleichen (Code liest beide Varianten ODER Compose umbenennen) — konsistent über `docker-compose*.yml`, `.env.example`, MCP, Tests.

### #3 — [MITTEL] Decay wird nie persistiert
`processor.ts:427` ruft `updateMemory(memory.id, {})` mit **leerem Objekt**; berechneter Decay
landet nie in der DB. **Fix:** `UpdateMemoryInput` um `effectiveSalience`+`lastDecayCalculation`
erweitern, im SurrealDB-Adapter schreiben, Processor echte Werte übergeben.

### #4 — [MITTEL] Consolidation ist ein Stub
`processor.ts:485` zählt nur Cluster ("in production, we'd merge these"), führt nicht zusammen.
**Fix:** echtes Merge hinter Config-Flag — oder ehrlich als experimentell/deaktiviert kennzeichnen.

### #5 — [NIEDRIG] Qdrant Batch-Delete liefert count 0 (Platzhalter, `qdrant.ts:315`).

### #6 — [NIEDRIG] Verwaiste Qdrant-Collection `memory_vectors` neben aktiver `memories` (Legacy-Name).

### #7 — [NIEDRIG] Qdrant Client/Server-Versionskonflikt (npm-Client 1.17 vs Server 1.14) — Warnung; Versionen angleichen oder `checkCompatibility:false`.

### #8 — [INFO] Docker-Images sind **amd64-only** → auf arm64 (Apple Silicon) emuliert → Multi-Arch-Build nötig (Phase 5).

### #9 — [INFO] Ohne `OPENAI_API_KEY` werden Embeddings still übersprungen (graceful) → semantische Features brauchen Key; Docs-Widerspruch "keine Dritten" (Phase 4).

### #10 — [PHASE 3] Licensing: kein Stripe-Checkout (Dependency ungenutzt); Signatur HMAC-symmetrisch (für OSS-Self-Host fälschbar → ed25519).

## Empfohlene Plan-Anpassung
**#1 (semantischer Such-Pfad) und #2 (Env-Var-Konflikt) in Phase 1 als Top-Items aufnehmen** —
das sind die eigentlichen "funktioniert nicht wie geplant"-Probleme, zusätzlich zu Decay/Consolidation.

---

# Phase 1 — Durchgeführte Fixes (abgeschlossen, alle live verifiziert)

> Ergebnis: **132/132 Tests grün** (18 Files, inkl. 4 neuer Tests), alle 5 Packages typecheck-clean.
> Verifikations-Workflow: DBs in Docker, API aus dem Quellcode auf dem Host (Port 3001), Live-Tests
> mit OpenAI-Key aus 1Password.

### #1 — Durchgängige semantische Suche ✅
Neuer wiederverwendbarer `EmbeddingService` (`packages/core/src/services/embedding-service.ts`) als
einzige Embedding-Codestelle (geteilt von API, MCP, Processor). `MemoryService.searchByText()`
embeddet den Query serverseitig → Vector-Search, mit transparentem Text-Fallback (liefert `mode:
'semantic' | 'text'`). Verdrahtet in: REST `POST /search` (akzeptiert jetzt `query` ODER `vector`),
MCP `memory_search`, Processor (refactored auf den Service).
- **Live verifiziert (API):** `POST /search {query:"famous monuments and landmarks in France"}` →
  `mode: semantic`, Eiffel **0.5231** vs Sourdough 0.0506 — *ohne* Client-Vektor.
- **Live verifiziert (MCP):** `memory_search` mit Text-Query → 2 Treffer, Eiffel 0.5231; findet die
  **via API** erstellten Memories → unified memory zwischen MCP & API bestätigt.
- Tests: `tests/core/semantic-search.test.ts` (Text-Fallback deterministisch).

### #2 — Env/Config-Vereinheitlichung ✅
Zentraler Helper `packages/core/src/lib/env-config.ts` (`resolveSurrealConfig`/`resolveQdrantConfig`/
`resolveEmbeddingConfig`) — honoriert **beide** Namensvarianten (`SURREALDB_NAMESPACE/DATABASE` +
`NS/DB`) mit **einheitlichen Defaults** (`memory`/`stack`, Collection `memories`). Verdrahtet in API,
MCP `index.ts` **und** `bin/mcp-server.js` (der echte Entry, der zuvor divergente Defaults
`memory_stack`/`memory_vectors` ohne Embedding nutzte) sowie `tests/globalSetup.ts`.
- **Wurzelbefund:** MCP und API schrieben per Default in **verschiedene** Namespaces *und*
  Qdrant-Collections → "unified memory" war gebrochen. Jetzt teilen sie Speicher.
- SurrealDB-`/rpc`-Suffix wird im Adapter **und** TokenService defensiv ergänzt (latenter Host-Bug).
- **Live verifiziert:** Host-Lauf mit `SURREALDB_NAMESPACE=verify2` → Daten landen in `verify2/verify2`
  (vorher still in `memory/stack`).

### #3 — Decay-Persistenz ✅
`UpdateMemoryInput` um `effectiveSalience`+`lastDecayCalculation` erweitert; SurrealDB-Adapter
persistiert sie ohne Basis-`salience` zu resetten; Processor (`processor.ts:427`) schreibt echte Werte.
Test: `tests/core/decay-persistence.test.ts`.

### #4 — Consolidation (echt, nicht-destruktiv) ✅
`runConsolidation` führt jetzt eine echte Konsolidierung durch: Duplikat-Cluster werden per
`SUPERSEDES`-Relation an die salienteste Memory ("primary") gelinkt und die Duplikate in der Salience
abgesenkt — **kein Löschen** von User-Daten (bewusst, für v1). Weiterhin per `PROCESSOR_CONSOLIDATION`
gegated (Default aus).

### #5 — Qdrant Batch-Delete-Count ✅
`deleteByNamespace` zählt jetzt exakt vor dem Löschen und liefert den echten Count (statt `0`).

### #6 — Verwaiste `memory_vectors`-Collection ✅
Ursache war der divergente MCP-Default; durch die Vereinheitlichung auf `memories` behoben (wird nicht
mehr erzeugt). Die vorhandene Alt-Collection kann per Ops gelöscht werden.

### #7 — Qdrant Client/Server-Versionswarnung ✅
`checkCompatibility: false` im Qdrant-Client-Konstruktor (REST-API über die Versionen stabil).

### Bonus — Flaky Timing-Test gefixt ✅
`tests/api/security.test.ts` (Token-Timing) war ~50% flaky (Wall-Clock-Verhältnis). Auf
Minimum-über-7-Runden + großzügige Schwelle umgestellt → 6/6 stabil. Wichtig für CI (Phase 2).

### Neue DevEx-Befunde (für Phase 2/5)
- **Stale Docker-Image:** `docker compose -f docker-compose.dev.yml --force-recreate` ohne `--build`
  startet das gecachte **Production**-Image (`node dist/index.js`) statt des Dev-Hot-Reload
  (`tsx watch src`) → Quelländerungen greifen nicht. Dev-Workflow/Doku schärfen.
- **Config-Duplizierung:** `bin/mcp-server.js` hatte eine eigene Config-Kopie — Quelle der MCP/API-
  Divergenz. Jetzt via geteilten Helper. Auf weitere Kopien achten.

---

# Phase 2 & 6 — Status

### Phase 2 (CI/CD) ✅
GitHub Actions (`.github/workflows/ci.yml`): lint+typecheck (6 Packages), Tests gegen Live-Stack
(docker compose DBs + Host-API), Docker-Build (api+web Production-Images, lokal verifiziert),
npm-audit. ESLint-9-Flat-Config (`eslint.config.mjs`, 0 Fehler). Dependabot (npm/actions/docker).

### Phase 6 — SDKs (abgeschlossen)
- **`@novacortex/sdk` (JS/TS, neu)** — `packages/sdk-js`: typisierter `NovaCortexClient`
  (memories CRUD/list/similar/relations, semantische `search`, relations, namespaces, export/import,
  stats/health/whoami), Fehlerhierarchie, README, MIT. 4/4 Integrationstests grün gegen Live-API.
- **Python-SDK vervollständigt** — `search()` (semantisch), `namespaces()/stats()/whoami()`,
  kaputtes `similar()` gefixt (zeigte auf nicht existierendes Endpoint), `Memory`-Modell korrigiert
  (`updatedAt` war fälschlich Pflicht; API liefert es nicht). Live-Smoke-Test grün.
- **Webhooks (v1.1, abgeschlossen)** — `WebhookService` + `PUT/GET/DELETE /webhooks`;
  emittiert `memory.created/updated/deleted` + `processor.completed`; HMAC-signiert, mit
  Retry/Backoff, fire-and-forget. Unit-Tests + Live-E2E (register → create → signierte
  Delivery empfangen → delete) grün.
- **Verbleibend (Roadmap v1.1):** OpenTelemetry, Binary-PMF (MessagePack),
  Differential-/Streaming-Export, Encrypted-PMF — noch offen.

**Gesamtstatus:** 136/136 Tests grün, alle Packages typecheck-clean, Lint clean, Docker-Images bauen.
