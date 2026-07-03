---
title: Installation Guide
description: Complete installation reference for NovaCortex — development, production, and Dokploy deployments
---

# Installation Guide

This guide covers every deployment scenario: local development, single-server production, and Dokploy-managed deployments. Read the section that matches your target environment.

---

## Repository Structure

```
novacortex/
├── docker-compose.yml               # Supported self-host stack (pinned GHCR images)
├── docker-compose.unraid.yml        # Same stack with Unraid appdata defaults
├── docker-compose.dev.yml           # Development stack (builds from source, hot reload)
├── docker-compose.dokploy.yml       # Dokploy-compatible production compose
├── docker-compose.traefik.yml       # Experimental Traefik/TLS variant (unsupported)
├── .env.example                     # Annotated environment template
├── scripts/
│   ├── deploy.sh                    # Production deployment helper
│   ├── backup.sh                    # Backup and restore
│   └── health-check.sh              # Health verification script
├── packages/
│   ├── api/                         # Express API
│   ├── web/                         # Next.js web UI
│   └── mcp-server/                  # MCP server package
└── docs/                            # This documentation
```

---

## Development Mode

Development mode mounts source code directly into containers and enables hot reload for both the API and the web UI.

### 1. Clone and configure

```bash
git clone https://github.com/Nova-Cognitive-Systems/novacortex
cd novacortex
cp .env.example .env
```

Edit `.env` and set the required values (see [Configuration Reference](./configuration.md)).

### 2. Start the development stack

```bash
docker compose -f docker-compose.dev.yml up
```

The development stack is self-contained (it does not merge with the production compose file). The API runs with `nodemon` watching `packages/api/src`, and the web UI runs with `next dev`. Changes to source files are reflected without restarting containers.

### 3. Useful development commands

```bash
# Tail all logs
docker compose logs -f

# Tail a specific service
docker compose logs -f api

# Open a shell in the API container
docker compose exec api sh

# Restart a single service
docker compose restart api

# Check resource usage
docker stats

# Stop all services (preserve data)
docker compose down

# Stop all services and delete all data volumes
docker compose down -v
```

---

## Production Mode — Direct Docker Compose

For single-server production deployments without a managed platform.

### 1. Generate secrets

Never reuse development secrets in production. Generate strong values:

```bash
# JWT signing secret (64 characters)
openssl rand -base64 64

# NextAuth session secret (32 characters)
openssl rand -base64 32

# SurrealDB password (strong passphrase)
openssl rand -base64 32
```

### 2. Configure environment

```bash
cp .env.example .env
```

Set all required variables in `.env`. At minimum:

```bash
DOMAIN=memory.example.com
ACME_EMAIL=admin@example.com
SURREALDB_USER=novacortex
SURREALDB_PASS=<strong-password>
JWT_SECRET=<64-char-base64>
NEXTAUTH_SECRET=<32-char-base64>
REDIS_PASSWORD=<strong-password>
NODE_ENV=production
```

See [Configuration Reference](./configuration.md) for the full variable list.

### 3. Deploy

```bash
./scripts/deploy.sh deploy
```

The deploy script runs pre-flight checks (Docker version, available disk, required env vars), pulls images, runs any pending database migrations, starts services in dependency order, and verifies all health endpoints before returning.

To deploy manually without the script:

```bash
docker compose pull
docker compose up -d
```

### 4. Verify deployment

```bash
# API health (full)
curl https://memory.example.com/api/health

# Readiness probe
curl https://memory.example.com/api/health/ready

# Liveness probe
curl https://memory.example.com/api/health/live
```

---

## Production Mode — Dokploy

Dokploy is a self-hosted PaaS that manages Docker Compose applications with a web UI, automatic SSL, and rolling deployments.

### 1. Create a new application in Dokploy

In your Dokploy dashboard:
1. Navigate to **Applications** → **New Application**
2. Select **Docker Compose**
3. Set the Git repository to `https://github.com/Nova-Cognitive-Systems/novacortex`
4. Set the Compose file path to `docker-compose.dokploy.yml`

### 2. Set environment variables

In the Dokploy application settings, add all required environment variables from the [Configuration Reference](./configuration.md). Dokploy stores these securely and injects them at deploy time.

### 3. Configure domains

In Dokploy's **Domains** tab:
- Add your primary domain (e.g., `memory.example.com`) pointing to the `web` service on port 3000
- Add your API domain (e.g., `api.memory.example.com`) pointing to the `api` service on port 3001, or configure path-based routing under the same domain

Enable **Auto SSL** to provision Let's Encrypt certificates automatically.

### 4. Deploy

Click **Deploy** in the Dokploy dashboard. Dokploy pulls the compose file from Git, applies your environment variables, and starts the stack. Monitor progress in the **Logs** tab.

---

## Service Reference

### Resource Allocations

| Service | CPU | Memory | Purpose |
|---|---|---|---|
| traefik | 0.5 CPU | 256 MB | Reverse proxy, SSL termination |
| api | 2 CPU | 4 GB | Business logic, background processing |
| web | 1 CPU | 512 MB | Next.js web UI (SSR) |
| surrealdb | 2 CPU | 2 GB | Primary database and graph engine |
| qdrant | 2 CPU | 2 GB | Vector index (HNSW) |
| redis | 0.5 CPU | 384 MB | Cache, rate limiting, session state |

Memory limits are soft recommendations. SurrealDB and Qdrant are the most memory-intensive components; on systems with less than 8 GB RAM, reduce their limits in `docker-compose.yml` and monitor for OOM kills.

### Exposed Ports

| Service | Port | Protocol | Notes |
|---|---|---|---|
| traefik | 80 | HTTP | Redirects to HTTPS in production |
| traefik | 443 | HTTPS | TLS-terminated entry point |
| api | 3001 | HTTP | Direct access (dev) / behind traefik (prod) |
| web | 3000 | HTTP | Direct access (dev) / behind traefik (prod) |
| surrealdb | 8000 | WebSocket/HTTP | Internal only; do not expose publicly |
| qdrant | 6333 | HTTP | Internal only; do not expose publicly |
| redis | 6379 | TCP | Internal only; do not expose publicly |

In production, only traefik ports (80 and 443) should be publicly accessible.

---

## Data Volumes

| Volume | Service | Contents |
|---|---|---|
| `surrealdb-data` | surrealdb | All memory records, relations, namespaces, tokens |
| `qdrant-data` | qdrant | HNSW vector index and collection metadata |
| `redis-data` | redis | RDB snapshots (AOF disabled by default) |
| `traefik-certs` | traefik | Let's Encrypt certificate and account data |

All volumes are managed by Docker and persist across container restarts and upgrades. To inspect volume locations on disk:

```bash
docker volume inspect novacortex_surrealdb-data
```

---

## Network Topology

NovaCortex uses two Docker networks for isolation:

- **novacortex-internal** — connects api, surrealdb, qdrant, and redis. No external access. Database services communicate only on this network.
- **novacortex-external** — connects traefik, api, and web. Traefik routes HTTP/HTTPS traffic to the api and web services.

This separation ensures database services are never directly reachable from outside the Docker host.

---

## Health Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `GET /health` | Full health check — returns status of all backend services |
| `GET /health/ready` | Readiness probe — returns 200 only when all services are connected |
| `GET /health/live` | Liveness probe — returns 200 if the API process is running |
| `GET /api/health` | Routed through Traefik — same as `/health` via public URL |

Full health response:

```json
{
  "status": "healthy",
  "timestamp": "2026-04-12T09:00:00Z",
  "services": {
    "surrealdb": { "status": "connected", "latency_ms": 2 },
    "qdrant": { "status": "connected", "latency_ms": 1 },
    "redis": { "status": "connected", "latency_ms": 0 }
  },
  "uptime_seconds": 86400
}
```

Status values: `healthy` (all services connected), `degraded` (at least one service slow or intermittent), `unhealthy` (at least one service unreachable).

---

## Backup and Restore

### Running a backup

```bash
./scripts/backup.sh backup
```

The backup script creates a timestamped archive in `./backups/` and performs:

1. **SurrealDB export** — exports all data via the SurrealDB HTTP export API to a `.surql` file
2. **Qdrant snapshot** — triggers a collection snapshot via the Qdrant API and downloads it
3. **Redis RDB dump** — copies the Redis dump.rdb file from the container
4. **Archive** — combines all exports into a single `.tar.gz` with a manifest

If `S3_BUCKET` is set in your environment, the backup is also uploaded to S3:

```bash
S3_BUCKET=my-backups-bucket ./scripts/backup.sh backup
```

Backup files older than `RETENTION_DAYS` (default: 30) are automatically pruned on each backup run.

### Restoring from backup

Restore individual components by service:

```bash
# Restore SurrealDB
./scripts/backup.sh restore surrealdb ./backups/2026-04-12_090000/surrealdb.surql.gz

# Restore Qdrant
./scripts/backup.sh restore qdrant ./backups/2026-04-12_090000/qdrant-snapshot.tar.gz

# Restore Redis
./scripts/backup.sh restore redis ./backups/2026-04-12_090000/redis-dump.rdb

# Restore everything from an archive
./scripts/backup.sh restore all ./backups/2026-04-12_090000.tar.gz
```

Before restoring, stop the affected service to prevent write conflicts:

```bash
docker compose stop api
./scripts/backup.sh restore surrealdb ./backups/2026-04-12_090000/surrealdb.surql.gz
docker compose start api
```

### Automating backups

Add a cron job on the host:

```bash
# Daily backup at 02:00 UTC
0 2 * * * cd /srv/novacortex && ./scripts/backup.sh backup >> /var/log/novacortex-backup.log 2>&1
```

---

## Upgrading

To upgrade NovaCortex to a new version:

```bash
# Pull the latest image tags
git pull origin main
docker compose pull

# Restart with zero-downtime rolling update (Dokploy handles this automatically)
docker compose up -d --no-deps --build api web

# Verify health after upgrade
curl http://localhost:3001/health
```

---

## Troubleshooting

### Viewing logs

```bash
# All services
docker compose logs -f

# Specific service, last 200 lines
docker compose logs --tail=200 api

# Since a timestamp
docker compose logs --since="2026-04-12T08:00:00" api
```

### Resource monitoring

```bash
# Container CPU and memory usage
docker stats

# Volume disk usage
docker system df -v
```

### Running the health check script

```bash
./scripts/health-check.sh full
```

This script checks all four health endpoints, tests a sample API call, verifies SurrealDB query execution, and reports latency for each service.

### Common Errors

| Error | Likely Cause | Resolution |
|---|---|---|
| `SurrealDB connection refused` | surrealdb container not yet healthy | Wait 30 seconds; check `docker compose logs surrealdb` |
| `Qdrant collection not found` | Collection was not initialized on startup | Run `POST /processor/run` — the API creates the collection on first use |
| `JWT expired` | Client is using a token older than `JWT_EXPIRES_IN` | Generate a new token via `POST /tokens` or re-login |
| `NAMESPACE_LIMIT_REACHED` | You have hit the namespace limit for your tier | Delete an unused namespace or upgrade your license |
| `embed: model not available` | No embedding provider is configured | Add `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` to `.env` and restart the API |
| `429 Too Many Requests` | Rate limit exceeded | Reduce request frequency; check `RATE_LIMIT_*` env vars |
| `Traefik: 502 Bad Gateway` | API or web container is not ready | Check `docker compose ps` and wait for healthy status |
| `Bootstrap code not found in logs` | API already initialized (token was used) | Create a new token by authenticating with your existing admin token |

### Resetting the system

To wipe all data and start fresh (destructive — cannot be undone):

```bash
docker compose down -v
docker compose up -d
```

This deletes all Docker volumes including all memories, relations, tokens, and vector embeddings.
