---
title: API Reference — Relations
description: Creating, listing, and deleting typed memory relations
---

# API Reference — Relations

Relations are typed, weighted edges between memories. They form the graph layer of NovaCortex, allowing agents to navigate from one memory to related knowledge by following typed edges.

---

## Relation Object Schema

```json
{
  "id": "relation:xyz789abc123",
  "fromMemoryId": "memory:abc123def456",
  "fromNamespace": "ops",
  "toMemoryId": "memory:def456ghi789",
  "toNamespace": "ops",
  "relationType": "supports",
  "strength": 0.82,
  "bidirectional": false,
  "metadata": {
    "source": "processor",
    "similarity": 0.82
  },
  "createdAt": "2026-04-12T09:05:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string | SurrealDB record ID in format `relation:<ulid>` |
| `fromMemoryId` | string | The source memory ID |
| `fromNamespace` | string | Namespace of the source memory |
| `toMemoryId` | string | The target memory ID |
| `toNamespace` | string | Namespace of the target memory |
| `relationType` | enum | One of the nine typed relation values |
| `strength` | float | Relation strength from 0 to 1 |
| `bidirectional` | boolean | Whether the relation is traversable in both directions |
| `metadata` | object | Arbitrary JSON metadata |
| `createdAt` | ISO 8601 | When the relation was created |

---

## Relation Types

| Value | Direction | Semantic Meaning |
|---|---|---|
| `causes` | Directed | The source memory directly causes or leads to the condition described in the target. Use for causal chains: A results in B. |
| `supports` | Directed | The source provides evidence, justification, or corroborating context for the target. A strengthens the claim in B. |
| `contradicts` | Bidirectional | The source and target are in conflict or mutual negation. A cannot coexist with B if both are true. |
| `supersedes` | Directed | The source is a newer or corrected version of the target. B is effectively deprecated by A. |
| `part_of` | Directed | The source is a sub-component, detail, or element of the concept in the target. A is a part of B. |
| `references` | Directed | The source cites, quotes, links to, or mentions the target. Weaker than `supports` — citing does not imply agreement with B. |
| `temporal_before` | Directed | The event in the source occurred before the event in the target. Primarily for episodic memories. |
| `temporal_after` | Directed | The event in the source occurred after the event in the target. Primarily for episodic memories. |
| `related_to` | Bidirectional | General semantic similarity. Created automatically by the Memory Processor when cosine similarity is above the threshold but no specific relation type is inferred. |

---

## GET /memories/:namespace/:id/relations

Get all relations for a memory — both incoming (relations where this memory is the target) and outgoing (relations where this memory is the source).

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `namespace` | string | The memory's namespace |
| `id` | string | The memory ID |

### Example Request

```bash
curl http://localhost:3001/memories/ops/memory:abc123def456/relations \
  -H "Authorization: Bearer nc_pat_..."
```

### Example Response (200 OK)

```json
{
  "outgoing": [
    {
      "id": "relation:xyz789abc123",
      "fromMemoryId": "memory:abc123def456",
      "fromNamespace": "ops",
      "toMemoryId": "memory:def456ghi789",
      "toNamespace": "ops",
      "relationType": "supports",
      "strength": 0.82,
      "bidirectional": false,
      "metadata": {},
      "createdAt": "2026-04-12T09:05:00Z"
    }
  ],
  "incoming": [
    {
      "id": "relation:mno123pqr456",
      "fromMemoryId": "memory:ghi789jkl012",
      "fromNamespace": "ops",
      "toMemoryId": "memory:abc123def456",
      "toNamespace": "ops",
      "relationType": "causes",
      "strength": 0.91,
      "bidirectional": false,
      "metadata": { "source": "processor", "similarity": 0.91 },
      "createdAt": "2026-04-12T09:10:00Z"
    }
  ],
  "total": 2
}
```

---

## POST /memories/relations

Create a typed relation between two memories.

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `fromMemoryId` | string | Yes | Source memory ID (include the `memory:` prefix) |
| `fromNamespace` | string | Yes | Namespace of the source memory |
| `toMemoryId` | string | Yes | Target memory ID |
| `toNamespace` | string | Yes | Namespace of the target memory. Can differ from `fromNamespace` for cross-namespace relations. |
| `relationType` | enum | Yes | One of the nine valid relation type values |
| `strength` | float | No | Relation strength (0–1). Default: `0.7`. |
| `bidirectional` | boolean | No | Whether the relation is traversable in both directions. Default: `false`. |
| `metadata` | object | No | Arbitrary JSON object. Use to record custom properties or the reason for the relation. |

### Example Request

```bash
curl -X POST http://localhost:3001/memories/relations \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  -d '{
    "fromMemoryId": "memory:abc123def456",
    "fromNamespace": "ops",
    "toMemoryId": "memory:def456ghi789",
    "toNamespace": "ops",
    "relationType": "supports",
    "strength": 0.85,
    "bidirectional": false,
    "metadata": {
      "createdBy": "human",
      "note": "Both memories corroborate the 2GB RAM requirement"
    }
  }'
```

### Example Response (201 Created)

```json
{
  "id": "relation:stu456vwx789",
  "fromMemoryId": "memory:abc123def456",
  "fromNamespace": "ops",
  "toMemoryId": "memory:def456ghi789",
  "toNamespace": "ops",
  "relationType": "supports",
  "strength": 0.85,
  "bidirectional": false,
  "metadata": {
    "createdBy": "human",
    "note": "Both memories corroborate the 2GB RAM requirement"
  },
  "createdAt": "2026-04-12T09:20:00Z"
}
```

### Error Responses

- `400 Bad Request` — invalid `relationType`, out-of-range `strength`, or missing required fields
- `404 Not Found` — either the source or target memory does not exist
- `409 Conflict` — a relation with the same `fromMemoryId`, `toMemoryId`, and `relationType` already exists

---

## DELETE /memories/relations/:id

Delete a relation by its ID. This removes the edge from the graph but does not affect either memory.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | The relation ID (include the `relation:` prefix) |

### Example Request

```bash
curl -X DELETE http://localhost:3001/memories/relations/relation:stu456vwx789 \
  -H "Authorization: Bearer nc_pat_..."
```

### Response (204 No Content)

No response body.

### Error Responses

- `404 Not Found` — relation does not exist

---

## Cross-Namespace Relations

Relations can span namespaces. The `fromNamespace` and `toNamespace` fields can hold different values:

```json
{
  "fromMemoryId": "memory:abc123",
  "fromNamespace": "team-a",
  "toMemoryId": "memory:def456",
  "toNamespace": "shared-docs",
  "relationType": "references",
  "strength": 0.75
}
```

Cross-namespace relations are subject to access control: a token scoped to `team-a` can create a relation to a memory in `shared-docs` only if it has read access to `shared-docs` (either through an `admin-full` template or a federation rule).

The relation is stored in SurrealDB with both namespace fields preserved. When an agent with federation access queries relations for a memory in `team-a`, it receives cross-namespace relations where it has permission to see both endpoints.
