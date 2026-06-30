---
title: API Reference — Memories
description: Full reference for memory CRUD endpoints
---

# API Reference — Memories

Memories are the core resource of NovaCortex. This page documents all endpoints for creating, reading, updating, deleting, and finding similar memories.

---

## Memory Object Schema

Every memory response follows this schema:

```json
{
  "id": "memory:abc123def456",
  "namespace": "default",
  "content": "NovaCortex uses HNSW indexing for sub-millisecond vector search",
  "type": "semantic",
  "tags": ["vector-search", "architecture"],
  "entities": ["NovaCortex", "HNSW"],
  "signals": [0.8, 0.3],
  "confidence": 0.95,
  "salience": 0.87,
  "decayRate": 0.05,
  "embeddingStatus": "completed",
  "relations": [],
  "createdAt": "2026-04-12T09:00:00Z",
  "updatedAt": "2026-04-12T09:00:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string | SurrealDB record ID in format `memory:<ulid>` |
| `namespace` | string | Namespace this memory belongs to |
| `content` | string | The full text content of the memory |
| `type` | enum | `episodic`, `semantic`, `procedural`, or `working` |
| `tags` | string[] | Array of text labels for filtering |
| `entities` | string[] | Named entities extracted from or associated with the content |
| `signals` | float[] | Custom numeric signals (application-defined semantics) |
| `confidence` | float | 0–1 certainty score |
| `salience` | float | 0–1 importance/relevance score |
| `decayRate` | float | 0–1 rate of salience decay per processor cycle |
| `embeddingStatus` | enum | `pending`, `completed`, or `failed` |
| `relations` | Relation[] | Included when `includeRelations=true`; empty array otherwise |
| `createdAt` | ISO 8601 | Creation timestamp |
| `updatedAt` | ISO 8601 | Last update timestamp |

---

## GET /memories

List memories with optional filtering and pagination.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `namespace` | string | — | Filter to a specific namespace. Omit to return memories across all accessible namespaces. |
| `memoryTypes` | string (CSV) | — | Comma-separated type filter. Example: `semantic,procedural` |
| `tags` | string (CSV) | — | Comma-separated tag filter. Returns memories that have ALL specified tags. Example: `deployment,2026` |
| `limit` | integer | 20 | Maximum records to return (max: 100) |
| `offset` | integer | 0 | Records to skip for pagination |
| `minSalience` | float | 0 | Exclude memories below this salience score |
| `includeRelations` | boolean | false | Include the `relations` array in each memory object |
| `search` | string | — | Substring text filter on memory `content` |
| `sort` | string | `createdAt:desc` | Sort field and direction. Options: `createdAt:asc`, `createdAt:desc`, `salience:desc`, `updatedAt:desc` |

### Example Request

```bash
curl "http://localhost:3001/memories?namespace=default&memoryTypes=semantic&tags=architecture&limit=10" \
  -H "Authorization: Bearer nc_pat_..."
```

### Example Response (200 OK)

```json
{
  "memories": [
    {
      "id": "memory:abc123def456",
      "namespace": "default",
      "content": "NovaCortex uses HNSW indexing for sub-millisecond vector search",
      "type": "semantic",
      "tags": ["architecture", "vector-search"],
      "entities": ["NovaCortex", "HNSW"],
      "signals": [],
      "confidence": 0.95,
      "salience": 0.87,
      "decayRate": 0.05,
      "embeddingStatus": "completed",
      "relations": [],
      "createdAt": "2026-04-12T09:00:00Z",
      "updatedAt": "2026-04-12T09:00:00Z"
    }
  ],
  "total": 1,
  "limit": 10,
  "offset": 0
}
```

---

## GET /memories/:namespace/:id

Get a single memory by its namespace and ID.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `namespace` | string | The memory's namespace |
| `id` | string | The memory ID (include the `memory:` prefix) |

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `includeRelations` | boolean | false | Include all relations (incoming and outgoing) in the response |

### Example Request

```bash
curl "http://localhost:3001/memories/default/memory:abc123def456?includeRelations=true" \
  -H "Authorization: Bearer nc_pat_..."
```

### Example Response (200 OK)

```json
{
  "id": "memory:abc123def456",
  "namespace": "default",
  "content": "NovaCortex uses HNSW indexing for sub-millisecond vector search",
  "type": "semantic",
  "tags": ["architecture", "vector-search"],
  "entities": ["NovaCortex", "HNSW"],
  "signals": [],
  "confidence": 0.95,
  "salience": 0.87,
  "decayRate": 0.05,
  "embeddingStatus": "completed",
  "relations": [
    {
      "id": "relation:xyz789",
      "fromMemoryId": "memory:abc123def456",
      "toMemoryId": "memory:def456ghi789",
      "relationType": "supports",
      "strength": 0.82,
      "bidirectional": false,
      "metadata": {},
      "createdAt": "2026-04-12T09:05:00Z"
    }
  ],
  "createdAt": "2026-04-12T09:00:00Z",
  "updatedAt": "2026-04-12T09:00:00Z"
}
```

### Error Responses

- `404 Not Found` — memory does not exist or is in a different namespace than the token's namespace claim

---

## POST /memories

Create a new memory.

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `content` | string | Yes | Memory text content. Cannot be empty. Immutable after creation. |
| `type` | enum | Yes | `episodic`, `semantic`, `procedural`, or `working` |
| `namespace` | string | No | Target namespace. Defaults to `default`. |
| `tags` | string[] | No | Array of text labels. |
| `entities` | string[] | No | Named entities associated with the content. |
| `signals` | float[] | No | Custom numeric signals. |
| `confidence` | float | No | Certainty score (0–1). Default: `1.0`. |
| `salience` | float | No | Importance score (0–1). Default: `1.0`. |
| `decayRate` | float | No | Decay rate per processor cycle (0–1). Default: `0.1`. |

### Example Request

```bash
curl -X POST http://localhost:3001/memories \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  -d '{
    "content": "The production SurrealDB instance requires 2GB RAM minimum",
    "type": "procedural",
    "namespace": "ops",
    "tags": ["database", "infrastructure", "requirements"],
    "entities": ["SurrealDB"],
    "confidence": 0.98,
    "salience": 0.9,
    "decayRate": 0.02
  }'
```

### Example Response (201 Created)

```json
{
  "id": "memory:01j9xkm2v3p8q4r5s6t7u8v9",
  "namespace": "ops",
  "content": "The production SurrealDB instance requires 2GB RAM minimum",
  "type": "procedural",
  "tags": ["database", "infrastructure", "requirements"],
  "entities": ["SurrealDB"],
  "signals": [],
  "confidence": 0.98,
  "salience": 0.9,
  "decayRate": 0.02,
  "embeddingStatus": "pending",
  "relations": [],
  "createdAt": "2026-04-12T09:15:00Z",
  "updatedAt": "2026-04-12T09:15:00Z"
}
```

Note that `embeddingStatus` is `"pending"` immediately after creation. The Memory Processor generates the embedding asynchronously. The memory is immediately retrievable via list and GET endpoints, but will not appear in vector search results until the embedding is completed.

### Error Responses

- `400 Bad Request` — missing required field, empty content, invalid type, or invalid decayRate/confidence/salience range
- `403 Forbidden` — token's namespace claim does not match the target namespace

---

## PATCH /memories/:namespace/:id

Update memory metadata. Content is immutable and cannot be updated.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `namespace` | string | The memory's namespace |
| `id` | string | The memory ID |

### Request Body

All fields are optional. Omit fields you do not want to change.

| Field | Type | Description |
|---|---|---|
| `type` | enum | New memory type |
| `namespace` | string | Move the memory to a different namespace |
| `tags` | string[] | Replace the tags array entirely |
| `entities` | string[] | Replace the entities array entirely |
| `signals` | float[] | Replace the signals array entirely |
| `confidence` | float | New confidence score (0–1) |
| `salience` | float | New salience score (0–1) |
| `decayRate` | float | New decay rate (0–1) |

### Example Request

```bash
curl -X PATCH http://localhost:3001/memories/ops/memory:01j9xkm2v3p8q4r5s6t7u8v9 \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  -d '{
    "salience": 0.5,
    "tags": ["database", "infrastructure", "requirements", "reviewed"]
  }'
```

### Example Response (200 OK)

Returns the updated memory object with all fields.

### Error Responses

- `400 Bad Request` — attempted to update `content`, or invalid field values
- `404 Not Found` — memory does not exist

---

## DELETE /memories/:namespace/:id

Delete a memory and cascade-delete all relations involving it.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `namespace` | string | The memory's namespace |
| `id` | string | The memory ID |

### Example Request

```bash
curl -X DELETE http://localhost:3001/memories/ops/memory:01j9xkm2v3p8q4r5s6t7u8v9 \
  -H "Authorization: Bearer nc_pat_..."
```

### Response (204 No Content)

No response body. The corresponding Qdrant vector point is removed asynchronously on the next processor run.

---

## GET /memories/:namespace/:id/similar

Find memories that are semantically similar to the specified memory. This endpoint handles vector retrieval internally — you do not need to supply a vector.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `namespace` | string | The source memory's namespace |
| `id` | string | The source memory ID |

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 10 | Maximum similar memories to return |
| `targetNamespace` | string | Same as source | Search in a different namespace |
| `scoreThreshold` | float | 0.7 | Minimum cosine similarity score |

### Example Request

```bash
curl "http://localhost:3001/memories/ops/memory:01j9xkm2v3p8q4r5s6t7u8v9/similar?limit=5" \
  -H "Authorization: Bearer nc_pat_..."
```

### Example Response (200 OK)

```json
{
  "results": [
    {
      "memory": {
        "id": "memory:def456ghi789",
        "namespace": "ops",
        "content": "SurrealDB 1.5 requires at least 1.5GB RAM for stable operation",
        "type": "semantic",
        "tags": ["database", "infrastructure"],
        "embeddingStatus": "completed"
      },
      "score": 0.94
    },
    {
      "memory": {
        "id": "memory:ghi789jkl012",
        "namespace": "ops",
        "content": "Qdrant is configured with 2GB memory limit in docker-compose.yml",
        "type": "semantic",
        "tags": ["infrastructure", "qdrant"],
        "embeddingStatus": "completed"
      },
      "score": 0.81
    }
  ],
  "total": 2,
  "took_ms": 3
}
```

### Error Responses

- `404 Not Found` — source memory does not exist
- `400 Bad Request` — source memory has `embeddingStatus: "pending"` or `"failed"` — embedding must be completed before similarity search is possible
