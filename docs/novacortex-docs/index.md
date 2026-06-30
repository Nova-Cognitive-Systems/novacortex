---
title: NovaCortex Documentation
description: Complete reference for the NovaCortex AI Memory System
---

# NovaCortex

**NovaCortex** is a self-hosted, graph-native AI memory layer for autonomous agents and applications. It provides persistent, typed memory with vector search, namespace isolation, relation graphs, and a portable open standard for memory interchange.

Built on a modern, composable stack — Next.js for the web interface, Node.js/Express for the API, SurrealDB for graph-native primary storage, Qdrant for vector indexing, and Redis for caching and rate limiting — NovaCortex stores and serves all memory data entirely within your own infrastructure. Semantic search is optional and off by default; enabling it with `OPENAI_API_KEY` sends memory text to OpenAI to compute embeddings. For fully-local operation, point `OPENAI_BASE_URL` at an OpenAI-compatible local server (e.g. Ollama or LiteLLM).

## Architecture

```
Internet
    │
Traefik (reverse proxy, SSL)
    │           │
  Web         API
(Next.js)  (Express)
              │
    ┌─────────┼─────────┐
    │         │         │
SurrealDB  Qdrant    Redis
(primary)  (vector)  (cache)
```

Traefik handles SSL termination and routes traffic to the Next.js web application and the Express API. The API owns all business logic and communicates with three backend services: SurrealDB for primary storage and graph traversal, Qdrant for HNSW vector indexing and similarity search, and Redis for token caching, rate limiting, and short-lived state.

## Feature Summary

| Feature | Description |
|---|---|
| Memory Types | episodic, semantic, procedural, working |
| Vector Search | HNSW indexing via Qdrant, sub-millisecond p99 |
| Namespaces | Isolated memory contexts per agent or project |
| Relation Graph | Typed edges between memories with strength scores |
| Knowledge Base | Document buckets with automatic memory generation |
| Processor | Background relation discovery, decay, consolidation |
| PMF Export | Portable Memory Format — open RFC-001 standard |
| Federation | Cross-namespace memory sharing for multi-agent setups |
| MCP Server | Native Model Context Protocol integration |

## License Tiers

| Feature | Unregistered | Free | Pro | Enterprise |
|---|---|---|---|---|
| Namespaces | 1 | 3 | 10 | Unlimited |
| Federation | ✗ | ✗ | ✓ | ✓ |
| Custom API URL | ✗ | ✗ | ✗ | ✓ |
| Support | Community | Community | 48h email | 24h priority |

Tier is determined by the `LICENSE_KEY` environment variable. Without a key the system runs in **Unregistered** mode. Free and higher tiers require a valid license key obtained from [novacortex.ai](https://novacortex.ai).

## Core Concepts

### Memories

A memory is the fundamental unit of storage in NovaCortex. Every memory has:

- **content** — the raw text of the memory
- **type** — one of `episodic`, `semantic`, `procedural`, or `working`
- **namespace** — the isolation context the memory belongs to
- **tags** and **entities** — for filtering and entity extraction
- **confidence** and **salience** — floating-point scores (0–1) representing certainty and importance
- **decayRate** — how quickly salience decreases over time (higher = faster decay)
- **embeddingStatus** — whether the vector embedding has been generated (`pending`, `completed`, `failed`)

### Namespaces

Namespaces provide hard isolation between memory contexts. An agent operating in namespace `project-a` cannot read memories from namespace `project-b` unless a federation rule explicitly permits it. The `default` namespace is created automatically and cannot be deleted.

### Relations

Relations are typed, weighted edges between memories. Each relation has a `relationType` (e.g., `causes`, `supports`, `contradicts`) and a `strength` score from 0 to 1. Relations can be bidirectional. The Memory Processor discovers and creates relations automatically based on vector similarity.

### Vector Search

When a memory is created, the API queues it for embedding generation. Once the embedding is stored in Qdrant, the memory is searchable via cosine similarity. The `/search` endpoint accepts a raw vector and returns the closest memories across any namespace.

### Knowledge Base

Buckets are named containers for uploaded documents (TXT, MD, CSV, PDF, JSON). When the **Create Memories** option is enabled, each document chunk is converted into a `semantic` memory in the bucket's namespace, making document content retrievable through vector search.

### Memory Processor

The processor is a background service that runs periodically or on-demand. It handles:
1. Generating embeddings for new memories
2. Discovering semantic relations via cosine similarity
3. Applying salience decay to working memories
4. Consolidating near-duplicate memories (experimental)

### PMF — Portable Memory Format

PMF (RFC PMF-001) is an open, JSON-based interchange format for exporting and importing memory snapshots. It includes graph topology, optional vector embeddings, Merkle-tree integrity verification, and federation metadata. PMF files use the `.pmf.json` extension.

### MCP Server

NovaCortex ships with a Model Context Protocol server (`packages/mcp-server`) that exposes memory tools directly to MCP-compatible clients such as Claude Desktop and Cursor. Agents can store, recall, search, and relate memories without writing HTTP calls.

## Quick Links

- [5-Minute Quickstart](./quickstart.md)
- [Full Installation Guide](./installation.md)
- [Configuration Reference](./configuration.md)
- [User Guide — Dashboard](./user-guide/dashboard.md)
- [User Guide — Memories](./user-guide/memories.md)
- [User Guide — Knowledge Base](./user-guide/knowledge-base.md)
- [User Guide — Graph View](./user-guide/graph-view.md)
- [User Guide — Namespaces](./user-guide/namespaces.md)
- [User Guide — Agents and Keys](./user-guide/agents-and-keys.md)
- [User Guide — Processor](./user-guide/processor.md)
- [User Guide — Settings](./user-guide/settings.md)
- [API Reference — Overview](./api-reference/overview.md)
- [API Reference — Authentication](./api-reference/authentication.md)
- [API Reference — Memories](./api-reference/memories.md)
- [API Reference — Search](./api-reference/search.md)
- [API Reference — Relations](./api-reference/relations.md)
- [API Reference — Namespaces](./api-reference/namespaces.md)
- [API Reference — Tokens](./api-reference/tokens.md)
- [API Reference — Export/Import](./api-reference/export-import.md)
- [API Reference — Processor](./api-reference/processor.md)
- [API Reference — Knowledge](./api-reference/knowledge.md)
- [API Reference — Federation](./api-reference/federation.md)
- [Enterprise — Overview](./enterprise/overview.md)
- [Enterprise — Licensing](./enterprise/licensing.md)
- [Enterprise — Federation](./enterprise/federation.md)
- [Enterprise — Custom API URL](./enterprise/custom-api-url.md)
- [SDK — Overview](./sdk/overview.md)
- [SDK — Python](./sdk/python.md)
- [SDK — Perl](./sdk/perl.md)
- [PMF Format Specification](./formats/pmf.md)
- [Roadmap](./roadmap.md)
