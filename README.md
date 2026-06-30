# NovaCortex

**Self-hosted, graph-native memory for AI agents.** Typed memories, semantic vector
search, a relation graph, a knowledge base, and native MCP — all running on your own
infrastructure. Use it from Claude/Cursor (MCP), the REST API, the CLI, or the
TypeScript / Python SDKs.

[![CI](https://github.com/Nova-Cognitive-Systems/novacortex/actions/workflows/ci.yml/badge.svg)](https://github.com/Nova-Cognitive-Systems/novacortex/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

---

## What it is

NovaCortex gives your agents a persistent, queryable memory:

- **Memory types** — episodic, semantic, procedural, working — with salience & decay.
- **Semantic search** — natural-language queries are embedded server-side and matched
  via a Qdrant vector index (with transparent substring fallback when embeddings are off).
- **Relation graph** — typed edges (causes, supports, contradicts, supersedes, …); your
  agent asserts causal/typed links, NovaCortex stores and serves the graph.
- **Knowledge base** — drop in documents, get auto-generated semantic memories.
- **Namespaces** — isolate memory per agent/project.
- **Portable (PMF)** — export/import the whole graph as JSON, binary MessagePack
  (~60% smaller), or AES-256-GCM-encrypted, with Merkle + content-hash integrity
  and differential/streaming variants. No lock-in.
- **Ops-ready** — opt-in OpenTelemetry traces (`OTEL_EXPORTER_OTLP_ENDPOINT`),
  scope-gated tokens, audit log, webhooks.
- **Interfaces** — MCP server, REST API (+ Swagger), CLI, `@novacortex/sdk` (TS) and
  `novacortex` (Python).

> **Open-core.** The self-hostable core in this repo is **Apache-2.0** (see [LICENSE](./LICENSE)).
> The free tier runs fully self-hosted with **no key**. Pro/Enterprise unlock more
> namespaces + federation via an **ed25519-signed license key** — the build embeds only
> the public key, so keys are verified offline and cannot be forged. See [pricing](#licensing--tiers).

## Quick start (self-host, ~5 min)

Requirements: Docker + Docker Compose. Works on Unraid and any Docker host.

```bash
git clone https://github.com/Nova-Cognitive-Systems/novacortex.git
cd novacortex

# 1. Generate strong secrets into .env
./scripts/gen-env.sh

# 2. (generic Docker host) keep data next to the repo; (Unraid) use appdata:
#    edit .env -> APPDATA=./data            (generic)
#    edit .env -> APPDATA=/mnt/user/appdata/novacortex   (Unraid)
#    Optional: set OPENAI_API_KEY for semantic search.

# 3. Start the stack (pulls pinned multi-arch images from GHCR)
docker compose -f docker-compose.unraid.yml up -d

# 4. Grab the one-time bootstrap code from the logs
docker logs novacortex-api 2>&1 | grep -A1 "Bootstrap code"
```

Then open the Web UI at **http://localhost:3000** (or `http://<host-ip>:${WEB_PORT}`),
paste the `nc_boot_…` bootstrap code on the login page to mint your admin token, and
you're in. The REST API is at **http://localhost:3001** (Swagger at `/docs`).

> Data lives under `${APPDATA}` (bind-mounted), so it survives container/image rebuilds.

## Privacy & embeddings

NovaCortex stores and serves all memory data **on your own infrastructure**. Semantic
search is **off by default**; it activates only when you set `OPENAI_API_KEY`, at which
point memory text is sent to OpenAI to compute embeddings. For **fully local** embeddings,
point `OPENAI_BASE_URL` at any OpenAI-compatible server (e.g. Ollama or LiteLLM) and set
`EMBEDDING_MODEL` accordingly. Without a key, search falls back to local substring matching.

## Use it from an agent (MCP)

`.mcp.json` in this repo registers the MCP server for Claude Code / Cursor. Point its
`SURREALDB_*` / `QDRANT_*` env at the same store your deployment uses so memory is shared
across MCP, the REST API, and the Web UI. Tools: `memory_store`, `memory_search`,
`memory_recall`, `memory_relate`, `memory_status`, `memory_wakeup`, `session_*`.

## SDKs

```ts
import { NovaCortexClient } from '@novacortex/sdk';
const nc = new NovaCortexClient({ baseUrl: 'http://localhost:3001', token });
await nc.memories.create({ content: 'The user prefers dark mode', memoryType: 'semantic', namespace: 'agent' });
const { data, mode } = await nc.search({ query: 'what does the user like?', namespace: 'agent' });
```

```python
from novacortex import NovaCortexClient
nc = NovaCortexClient("http://localhost:3001", token)
nc.memories.create("The user prefers dark mode", namespace="agent")
res = nc.search("what does the user like?", namespace="agent")
```

## Development

```bash
npm ci
npm run build --workspace=packages/core
npm run dev:db          # SurrealDB + Qdrant + Redis in Docker
npm run dev             # API on :3001 (from source)
npm run dev:web         # Web UI on :3000
npm test                # full suite (needs the dev stack up)
```

Full developer/deploy docs live in [`docs/novacortex-docs`](./docs/novacortex-docs).

## Deployment variants

- **`docker-compose.unraid.yml`** — supported self-host path (Unraid + any Docker host
  via `APPDATA`). Pulls pinned GHCR images, secure-by-default.
- **`docker-compose.dev.yml`** — local development (builds from source, hot-reload).
- **`docker-compose.yml`** — ⚠️ experimental Traefik/Let's-Encrypt variant, **not** part
  of v1 (needs a `traefik/` config tree that isn't shipped yet).

## Licensing & tiers

| Tier | Price | Namespaces | Notable |
|------|-------|-----------|---------|
| **Free** (self-host) | $0 | 3 | Full engine, MCP/REST/SDK/CLI, PMF export/import |
| **Pro** | one-time unlock | 10 | Namespace federation, higher rate limits, priority support |
| **Enterprise** | custom | unlimited | SLA, onboarding & migration help |

The free tier needs no key. Pro/Enterprise keys are **ed25519-signed** and validated
offline against an embedded public key — set one via `LICENSE_KEY` or `POST /license/activate`.

**Issuing keys (for the provider).** The build only *verifies* keys; minting requires the
private signing key, which never ships in the OSS image:

```bash
node scripts/gen-license-keypair.mjs            # writes config/.license-signing-key.pem (gitignored), prints the public key
# embed the printed public key via NOVACORTEX_LICENSE_PUBKEY (or DEFAULT_LICENSE_PUBKEY)
node scripts/issue-license.mjs --email you@example.com --tier pro   # prints a signed nclic.… key
```

(Stripe checkout is rolling out as a separate billing service; for now request Pro access
via GitHub Discussions.)

## Security

See [SECURITY.md](./SECURITY.md). Secrets are generated by `scripts/gen-env.sh` and the
self-host compose **fails fast** if they're missing. To expose the API cross-origin, set
`CORS_ORIGINS`.

## License

[Apache-2.0](./LICENSE) for the open-source core. © 2026 Nova Cognitive Systems.
