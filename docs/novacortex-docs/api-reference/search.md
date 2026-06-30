---
title: API Reference — Search
description: Vector similarity search endpoints
---

# API Reference — Search

NovaCortex supports two modes of vector similarity search:

1. **Raw vector search** (`POST /search`) — you supply a precomputed embedding vector and receive the closest memories
2. **Memory-to-memory similarity** (`GET /memories/:ns/:id/similar`) — you specify an existing memory and the API retrieves its stored embedding to find similar memories

---

## POST /search

Perform a vector similarity search across the Qdrant index. You must supply a vector of the correct dimension (matching `QDRANT_VECTOR_SIZE`, default 1536).

### When to Use

Use `POST /search` when:
- You have a query string that you have already embedded with your own embedding client
- You want to search across a specific namespace or apply type/tag filters
- You are building an agent that embeds user queries and retrieves relevant context

In typical usage, your application generates the embedding for the user's query (using the same embedding model as NovaCortex — e.g., `text-embedding-3-small`), then passes the vector to this endpoint.

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `vector` | float[] | Yes | The query embedding vector. Length must exactly match `QDRANT_VECTOR_SIZE` (default: 1536). |
| `namespace` | string | No | Restrict search to a specific namespace. Omit to search all accessible namespaces. |
| `memoryTypes` | string[] | No | Filter results to specific memory types. Example: `["semantic", "procedural"]` |
| `tags` | string[] | No | Filter results to memories with ALL specified tags. |
| `limit` | integer | No | Maximum results to return. Default: 10. Max: 100. |
| `scoreThreshold` | float | No | Minimum cosine similarity score (0–1). Default: 0.7. Results below this score are excluded. |

### Example Request

```bash
curl -X POST http://localhost:3001/search \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  -d '{
    "vector": [0.012, -0.034, 0.078, 0.091, -0.003, 0.055, ...],
    "namespace": "ops",
    "memoryTypes": ["semantic", "procedural"],
    "limit": 5,
    "scoreThreshold": 0.75
  }'
```

The vector above is illustrative. A real `text-embedding-3-small` vector has 1536 float values.

### Example Response (200 OK)

```json
{
  "results": [
    {
      "memory": {
        "id": "memory:abc123def456",
        "namespace": "ops",
        "content": "The production SurrealDB instance requires 2GB RAM minimum",
        "type": "procedural",
        "tags": ["database", "infrastructure", "requirements"],
        "entities": ["SurrealDB"],
        "signals": [],
        "confidence": 0.98,
        "salience": 0.9,
        "decayRate": 0.02,
        "embeddingStatus": "completed",
        "relations": [],
        "createdAt": "2026-04-12T09:15:00Z",
        "updatedAt": "2026-04-12T09:15:00Z"
      },
      "score": 0.94
    },
    {
      "memory": {
        "id": "memory:def456ghi789",
        "namespace": "ops",
        "content": "Qdrant should be allocated at least 2GB RAM for the HNSW index",
        "type": "semantic",
        "tags": ["infrastructure", "qdrant"],
        "entities": ["Qdrant", "HNSW"],
        "signals": [],
        "confidence": 0.95,
        "salience": 0.85,
        "decayRate": 0.05,
        "embeddingStatus": "completed",
        "relations": [],
        "createdAt": "2026-04-11T14:00:00Z",
        "updatedAt": "2026-04-11T14:00:00Z"
      },
      "score": 0.87
    }
  ],
  "total": 2,
  "took_ms": 2
}
```

### SearchResult Schema

```json
{
  "results": [
    {
      "memory": { /* Full Memory object */ },
      "score": 0.94
    }
  ],
  "total": 5,
  "took_ms": 2
}
```

| Field | Type | Description |
|---|---|---|
| `results` | array | Array of result objects, ordered by descending score |
| `results[].memory` | Memory | Full memory object (same schema as GET /memories response) |
| `results[].score` | float | Cosine similarity score (0–1); higher is more similar |
| `total` | integer | Number of results returned (after threshold filtering) |
| `took_ms` | integer | Time taken for the Qdrant query in milliseconds |

### Generating Query Vectors

NovaCortex generates embeddings automatically for stored memories, but does not embed search queries on your behalf. You must generate the query vector externally.

**Using OpenAI directly**:

```bash
curl https://api.openai.com/v1/embeddings \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "text-embedding-3-small",
    "input": "how much RAM does SurrealDB need"
  }'
```

Extract the `data[0].embedding` array from the response and pass it as the `vector` field in `POST /search`.

**Using the Python SDK with explicit embedding**:

```python
import openai
from novacortex import NovaCortexClient

openai_client = openai.OpenAI(api_key="sk-...")
nc_client = NovaCortexClient(base_url="http://localhost:3001", api_key="nc_pat_...")

query = "how much RAM does SurrealDB need"
embedding_response = openai_client.embeddings.create(
    model="text-embedding-3-small",
    input=query
)
vector = embedding_response.data[0].embedding

results = nc_client.search(vector=vector, namespace="ops", limit=5)
for r in results.results:
    print(f"{r.score:.2f} — {r.memory.content[:80]}")
```

---

## GET /memories/:namespace/:id/similar

Find memories similar to an existing memory. The API retrieves the stored embedding for the specified memory and uses it as the query vector. No external embedding call is required.

For full documentation of this endpoint, see [API Reference — Memories](./memories.md#get-memoriesnamespaceid-similar).

### When to Use

Use `GET /memories/:ns/:id/similar` when:
- You want to expand the context around a known memory
- You are building a "related memories" feature
- You want to find near-duplicates of a specific memory for review
- You do not have access to an embedding client in your current context

### Key Difference from POST /search

| Feature | POST /search | GET /similar |
|---|---|---|
| Vector supplied by | Caller | NovaCortex (from stored embedding) |
| Requires embedding client | Yes | No |
| Cross-namespace search | Yes (`namespace` parameter) | Yes (`targetNamespace` parameter) |
| Source memory needed | No | Yes |

---

## Score Interpretation

| Score Range | Interpretation |
|---|---|
| 0.95–1.00 | Near-identical content — likely duplicate or heavily reworded |
| 0.85–0.95 | Highly similar — same topic, closely related content |
| 0.75–0.85 | Related — same domain or concept, different specifics |
| 0.70–0.75 | Loosely related — may share some vocabulary but different topics |
| < 0.70 | Not returned (below default threshold) |

Adjust `scoreThreshold` based on your use case:
- **Tight threshold (0.85+)**: use when you need high-precision context retrieval and prefer fewer, more relevant results
- **Loose threshold (0.65–0.70)**: use for exploratory search or when you have sparse memory coverage and need broader recall
