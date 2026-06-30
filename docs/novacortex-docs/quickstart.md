---
title: 5-Minute Quickstart
description: Get NovaCortex running locally in under five minutes
---

# 5-Minute Quickstart

This guide takes you from zero to a running NovaCortex instance with your first memory stored and searched. The entire setup uses Docker Compose — no local dependencies required beyond Docker itself.

---

## Prerequisites

| Requirement | Minimum Version | Notes |
|---|---|---|
| Docker | 24.0+ | [Install Docker](https://docs.docker.com/get-docker/) |
| Docker Compose | v2.20+ | Included with Docker Desktop |
| Available RAM | 4 GB | 8 GB recommended for comfortable operation |
| Available disk | 10 GB | For SurrealDB and Qdrant data volumes |

Verify your installation:

```bash
docker --version
# Docker version 24.0.7 or later

docker compose version
# Docker Compose version v2.23.0 or later
```

---

## Step 1 — Clone the Repository

```bash
git clone https://github.com/Nova-Cognitive-Systems/novacortex
cd novacortex
```

---

## Step 2 — Configure the Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Open `.env` and set the three required secrets. Every other value has a sensible default for local development.

```bash
# Required — change all three before starting
SURREALDB_USER=novacortex
SURREALDB_PASS=change_me_strong_password
JWT_SECRET=$(openssl rand -base64 64)
NEXTAUTH_SECRET=$(openssl rand -base64 32)

# Optional — add if you want vector embeddings on first run
OPENAI_API_KEY=sk-...
```

If you do not have an OpenAI API key, the system starts without embedding support. Memories are stored and retrievable by filter, but vector search will return empty results until an embedding provider is configured.

---

## Step 3 — Start the Stack

```bash
docker compose up -d
```

Docker pulls the images (approximately 1.5 GB on first run) and starts six containers:

| Container | Port | Role |
|---|---|---|
| traefik | 80, 443 | Reverse proxy |
| api | 3001 | NovaCortex API (Express) |
| web | 3000 | NovaCortex Web UI (Next.js) |
| surrealdb | 8000 | Primary database |
| qdrant | 6333 | Vector index |
| redis | 6379 | Cache and rate limiting |

Watch the containers come up:

```bash
docker compose ps
```

All containers should reach `healthy` status within 60 seconds. If any container shows `unhealthy`, check its logs with `docker compose logs <service>`.

---

## Step 4 — Retrieve the Bootstrap Token

On first start, the API generates a one-time bootstrap code that you use to log in and create your first admin token. Retrieve it from the API logs:

```bash
docker compose logs api | grep nc_boot_
```

You should see a line similar to:

```
api  | Bootstrap code: nc_boot_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Copy this code — it is valid for one use only and expires after 24 hours.

---

## Step 5 — Log In to the Web UI

Open [http://localhost:3000/login](http://localhost:3000/login) in your browser.

Paste the `nc_boot_...` code into the login field and click **Sign In**. The system exchanges the bootstrap code for a session and redirects you to the dashboard.

On your first login you will be prompted to create a permanent admin token. Give it a name (e.g., `admin-key`), select the `admin-full` template, and click **Create**. Copy the `nc_pat_...` value that appears — it is shown only once.

---

## Step 6 — Create Your First Memory via the UI

From the dashboard, click **New Memory** in the Quick Actions section.

Fill in the form:
- **Content**: `NovaCortex stores AI memories persistently`
- **Type**: `semantic`
- **Namespace**: `default`
- **Tags**: `documentation`, `overview`
- **Confidence**: 0.95

Click **Save**. The memory appears in the Recent Memories widget. If an embedding provider is configured, the **Embedding** badge will change from `pending` to `completed` within a few seconds.

---

## Step 7 — Create a Memory via the API

Replace `nc_pat_...` with the token you created in Step 5:

```bash
curl -X POST http://localhost:3001/memories \
  -H "Authorization: Bearer nc_pat_your_admin_token_here" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "NovaCortex stores AI memories persistently",
    "type": "semantic",
    "namespace": "default",
    "tags": ["documentation", "overview"],
    "confidence": 0.95,
    "salience": 0.9
  }'
```

Expected response (HTTP 201):

```json
{
  "id": "memory:abc123def456",
  "namespace": "default",
  "content": "NovaCortex stores AI memories persistently",
  "type": "semantic",
  "tags": ["documentation", "overview"],
  "entities": [],
  "signals": [],
  "confidence": 0.95,
  "salience": 0.9,
  "decayRate": 0.1,
  "embeddingStatus": "pending",
  "relations": [],
  "createdAt": "2026-04-12T09:00:00Z",
  "updatedAt": "2026-04-12T09:00:00Z"
}
```

---

## Step 8 — List Memories

```bash
curl http://localhost:3001/memories?namespace=default \
  -H "Authorization: Bearer nc_pat_your_admin_token_here"
```

Expected response:

```json
{
  "memories": [
    {
      "id": "memory:abc123def456",
      "content": "NovaCortex stores AI memories persistently",
      "type": "semantic",
      ...
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

---

## Step 9 — Run a Vector Search

Vector search requires that at least one memory has a completed embedding. If you configured an `OPENAI_API_KEY`, wait a few seconds after creating the memory and then run the processor to generate embeddings:

```bash
curl -X POST http://localhost:3001/processor/run \
  -H "Authorization: Bearer nc_pat_your_admin_token_here" \
  -H "Content-Type: application/json" \
  -d '{"task": "all"}'
```

Then search using a vector of the same dimension as your embedding model (1536 for `text-embedding-3-small`). In practice, you generate the query vector from your AI client and pass it here. For illustration, the vector below is truncated — your actual vector must have exactly 1536 elements:

```bash
curl -X POST http://localhost:3001/search \
  -H "Authorization: Bearer nc_pat_your_admin_token_here" \
  -H "Content-Type: application/json" \
  -d '{
    "vector": [0.012, -0.034, 0.078, ...],
    "namespace": "default",
    "limit": 5,
    "scoreThreshold": 0.7
  }'
```

Expected response:

```json
{
  "results": [
    {
      "memory": {
        "id": "memory:abc123def456",
        "content": "NovaCortex stores AI memories persistently",
        "type": "semantic"
      },
      "score": 0.94
    }
  ],
  "total": 1,
  "took_ms": 2
}
```

Alternatively, use the `/memories/:ns/:id/similar` endpoint to find memories similar to an existing one — no external vector needed:

```bash
curl "http://localhost:3001/memories/default/memory:abc123def456/similar?limit=5" \
  -H "Authorization: Bearer nc_pat_your_admin_token_here"
```

---

## What's Next

You have a running NovaCortex instance with a memory stored and searched. Here is where to go next:

| Topic | Link |
|---|---|
| Full installation and production hardening | [Installation Guide](./installation.md) |
| All environment variables | [Configuration Reference](./configuration.md) |
| Using the web dashboard | [User Guide — Dashboard](./user-guide/dashboard.md) |
| Creating and managing memories | [User Guide — Memories](./user-guide/memories.md) |
| Knowledge base and document upload | [User Guide — Knowledge Base](./user-guide/knowledge-base.md) |
| Visual relation graph | [User Guide — Graph View](./user-guide/graph-view.md) |
| Creating agent API keys | [User Guide — Agents and Keys](./user-guide/agents-and-keys.md) |
| Complete API reference | [API Reference — Overview](./api-reference/overview.md) |
| Python SDK | [SDK — Python](./sdk/python.md) |
| MCP integration for Claude Desktop | [User Guide — Agents and Keys](./user-guide/agents-and-keys.md) |
