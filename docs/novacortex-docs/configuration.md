---
title: Configuration Reference
description: Complete environment variable reference for NovaCortex
---

# Configuration Reference

NovaCortex is configured entirely through environment variables. All variables are read by the API container at startup. The web container reads a subset prefixed with `NEXT_PUBLIC_` at build time.

Copy `.env.example` to `.env` and edit it before starting the stack:

```bash
cp .env.example .env
```

---

## Required Variables

These variables must be set before NovaCortex will start. The API will fail with a startup error if any required variable is missing.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DOMAIN` | Yes | — | Primary domain name for the deployment (e.g., `memory.example.com`). Used by Traefik to route traffic and provision SSL certificates. |
| `SURREALDB_USER` | Yes | — | SurrealDB root username. Used by the API to authenticate with SurrealDB. Choose a strong username — avoid `root` or `admin` in production. |
| `SURREALDB_PASS` | Yes | — | SurrealDB root password. Generate with `openssl rand -base64 32`. |
| `JWT_SECRET` | Yes | — | Secret used to sign and verify JWT tokens issued by the API. Must be at least 64 characters. Generate with `openssl rand -base64 64`. Changing this invalidates all existing sessions and tokens. |
| `NEXTAUTH_SECRET` | Yes | — | Secret used by NextAuth to encrypt session cookies in the web UI. Must be at least 32 characters. Generate with `openssl rand -base64 32`. |
| `REDIS_PASSWORD` | Yes | — | Password for Redis authentication. Set this to any strong value; the Redis container reads it from the same `.env` file. |

---

## Database Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SURREALDB_URL` | No | `ws://surrealdb:8000/rpc` | SurrealDB WebSocket connection URL. The default points to the surrealdb container on the internal Docker network. Change only if using an external SurrealDB instance. |
| `SURREALDB_NAMESPACE` | No | `novacortex` | SurrealDB namespace used to isolate this NovaCortex installation from other applications on the same SurrealDB instance. |
| `SURREALDB_DATABASE` | No | `production` | SurrealDB database name within the namespace. Change to `development` or a project name if running multiple instances on the same SurrealDB. |
| `QDRANT_URL` | No | `http://qdrant:6333` | Qdrant HTTP base URL. The default points to the qdrant container. Change if using Qdrant Cloud or an external Qdrant instance. |
| `QDRANT_API_KEY` | No | — | Qdrant API key. Required if your Qdrant instance has authentication enabled (e.g., Qdrant Cloud always requires this). Leave empty for local unauthenticated instances. |
| `QDRANT_COLLECTION` | No | `memories` | Name of the Qdrant collection used to store memory embeddings. The API creates this collection on first use if it does not exist. |
| `QDRANT_VECTOR_SIZE` | No | `1536` | Embedding vector dimension. Must match the output dimension of your embedding model. `1536` is correct for OpenAI `text-embedding-3-small` and `text-embedding-ada-002`. Use `3072` for `text-embedding-3-large`. Changing this after the collection is created requires deleting and recreating the collection. |

---

## Authentication and Security Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_EXPIRES_IN` | No | `7d` | Token expiry duration. Accepts duration strings: `7d` (7 days), `30d` (30 days), `1h` (1 hour), `90d` (90 days). Shorter values improve security; longer values reduce re-authentication frequency for agents. |
| `CORS_ORIGINS` | No | `*` | Allowed CORS origins for the API, comma-separated. In production, set this to your web UI origin: `https://memory.example.com`. The wildcard `*` is acceptable in development. |

---

## AI Provider Variables

At least one AI provider key is required for vector embedding generation. Without embeddings, memories are stored and retrievable by filter but vector search returns no results.

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | No* | — | OpenAI API key. Required if using any OpenAI model for embeddings or memory processing. Obtain at [platform.openai.com](https://platform.openai.com). |
| `OPENAI_BASE_URL` | No | `https://api.openai.com/v1` | OpenAI-compatible API base URL. Point at a local server (e.g. Ollama or LiteLLM) for fully-local embeddings. |
| `EMBEDDING_MODEL` | No | `text-embedding-3-small` | The embedding model to use for generating memory vectors. Supported values: `text-embedding-3-small` (1536d, OpenAI), `text-embedding-3-large` (3072d, OpenAI), `text-embedding-ada-002` (1536d, OpenAI, legacy). Ensure `QDRANT_VECTOR_SIZE` matches the model's output dimension. |

*Embeddings (and therefore semantic search) require an embeddings provider: set `OPENAI_API_KEY` (OpenAI) or point `OPENAI_BASE_URL` at a local OpenAI-compatible server. Without one, search falls back to local substring matching. `ANTHROPIC_API_KEY` is **not** an embeddings provider (Anthropic offers no embeddings API).

---

## Runtime Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `production` | Node.js environment. Use `production` for deployed instances and `development` for local development. Affects logging verbosity, error detail in API responses, and Express optimizations. |
| `PORT` | No | `3001` | TCP port the API server listens on inside the container. Change if you have a port conflict. |
| `LOG_LEVEL` | No | `info` | Logging verbosity. Options: `debug` (very verbose, includes SQL queries), `info` (normal operational logs), `warn` (warnings and errors only), `error` (errors only). Use `debug` to diagnose startup issues. |
| `DEBUG` | No | `false` | Set to `true` to enable additional verbose debug output including full request/response bodies. Do not use in production — may log sensitive content. |

---

## Traefik and SSL Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ACME_EMAIL` | Production | — | Email address registered with Let's Encrypt for SSL certificate notifications and renewal warnings. Required when deploying with a public domain. |
| `CLOUDFLARE_EMAIL` | No | — | Cloudflare account email. Required only if using Cloudflare DNS challenge for wildcard SSL certificates (instead of HTTP challenge). |
| `CLOUDFLARE_API_KEY` | No | — | Cloudflare Global API Key. Required only for DNS challenge SSL. Find it in the Cloudflare dashboard under **My Profile → API Tokens**. |

---

## Backup Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `S3_BUCKET` | No | — | AWS S3 bucket name for uploading backup archives. If not set, backups are stored locally in `./backups/` only. Example: `my-novacortex-backups`. |
| `RETENTION_DAYS` | No | `30` | Number of days to retain local backup archives before deletion. Applies to local backups only; S3 lifecycle policies control cloud retention separately. |

---

## Observability Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SENTRY_DSN` | No | — | Sentry Data Source Name for error tracking and performance monitoring. When set, all unhandled exceptions and slow transactions are reported to your Sentry project. |
| `SLACK_WEBHOOK_URL` | No | — | Slack Incoming Webhook URL. When set, the health check script posts alerts to this webhook when services go unhealthy. |

---

## License Variable

| Variable | Required | Default | Description |
|---|---|---|---|
| `LICENSE_KEY` | No | — | Enterprise or Pro license key. When set, the API validates the key on startup and enables licensed features (higher namespace limits, federation for Pro, custom API URL for Enterprise). The key is a signed JWT and is validated locally without a network call. |

---

## Next.js Variables

These variables are read by the Next.js web UI at build time. They must be set before building the Docker image or running `next build`.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_TELEMETRY_DISABLED` | No | `1` | Set to `1` to disable Next.js anonymous usage telemetry. Enabled by default in the `.env.example`. |
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:3001` | The public URL of the NovaCortex API. Used by the web UI to make API calls from the browser. Set to your API's public URL in production (e.g., `https://memory.example.com/api` or `https://api.memory.example.com`). |

---

## Example Production `.env`

```bash
# === REQUIRED ===
DOMAIN=memory.example.com
ACME_EMAIL=admin@example.com
SURREALDB_USER=novacortex
SURREALDB_PASS=V3ryStr0ngP4ssw0rd!
JWT_SECRET=YourBase64EncodedJWTSecretOfAtLeast64Characters==
NEXTAUTH_SECRET=YourBase64EncodedNextAuthSecret32Chars==
REDIS_PASSWORD=AnotherStr0ngPassword!

# === AI PROVIDERS ===
OPENAI_API_KEY=sk-proj-...
EMBEDDING_MODEL=text-embedding-3-small

# === DATABASE (optional overrides) ===
SURREALDB_NAMESPACE=novacortex
SURREALDB_DATABASE=production
QDRANT_VECTOR_SIZE=1536

# === RUNTIME ===
NODE_ENV=production
LOG_LEVEL=info
CORS_ORIGINS=https://memory.example.com

# === BACKUP ===
S3_BUCKET=my-novacortex-backups
RETENTION_DAYS=30

# === OBSERVABILITY ===
SENTRY_DSN=https://abc123@sentry.io/123456
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../...

# === NEXT.JS ===
NEXT_TELEMETRY_DISABLED=1
NEXT_PUBLIC_API_URL=https://memory.example.com/api
```

---

## Secrets Management

Never commit `.env` to version control. Add `.env` to your `.gitignore` (it is already included in the NovaCortex `.gitignore`).

For production, consider using a secrets manager instead of a flat `.env` file:

- **Docker Secrets**: Mount secrets as files; reference with `_FILE` suffix variables (Docker Compose supports this natively for some images)
- **HashiCorp Vault**: Use the Vault agent sidecar to inject secrets at runtime
- **AWS Secrets Manager**: Use the AWS CLI in an init container to fetch and export secrets before the API starts
- **Doppler**: Drop-in `.env` replacement with access control and audit logging
