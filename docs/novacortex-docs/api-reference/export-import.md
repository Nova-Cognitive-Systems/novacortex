---
title: API Reference — Export and Import
description: Exporting and importing memory namespaces in JSON and PMF formats
---

# API Reference — Export and Import

NovaCortex supports exporting entire namespaces to JSON or PMF format and importing them back. This enables backup, migration, cross-system federation, and auditing.

---

## Export Formats

| Format | Extension | Best For |
|---|---|---|
| JSON | `.json` | Simple portability, easy to inspect and parse in any language |
| PMF | `.pmf.json` | Long-term archival, migration between NovaCortex instances, integrity verification |

See the [PMF Format Specification](../formats/pmf.md) for the full PMF schema and integrity verification details.

---

## GET /memories/export/:namespace

Export all memories in a namespace as JSON.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `namespace` | string | The namespace to export |

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `embeddings` | boolean | `false` | Include raw embedding vectors in the export. Adds approximately 4 KB per memory (1536 floats). Enable when you need to restore Qdrant without re-generating embeddings. |

### Example Request

```bash
# Export without embeddings (text data only)
curl -o ops-export.json \
  "http://localhost:3001/memories/export/ops?embeddings=false" \
  -H "Authorization: Bearer nc_pat_..."

# Export with embeddings (for full Qdrant restoration)
curl -o ops-export-with-vectors.json \
  "http://localhost:3001/memories/export/ops?embeddings=true" \
  -H "Authorization: Bearer nc_pat_..."
```

### Response (200 OK)

Content-Type: `application/json`

```json
{
  "namespace": "ops",
  "exportedAt": "2026-04-12T09:00:00Z",
  "memoryCount": 57,
  "memories": [
    {
      "id": "memory:abc123def456",
      "namespace": "ops",
      "content": "The production SurrealDB instance requires 2GB RAM minimum",
      "type": "procedural",
      "tags": ["database", "infrastructure"],
      "entities": ["SurrealDB"],
      "signals": [],
      "confidence": 0.98,
      "salience": 0.9,
      "decayRate": 0.02,
      "embedding": null,
      "createdAt": "2026-04-12T09:15:00Z",
      "updatedAt": "2026-04-12T09:15:00Z"
    }
  ],
  "relations": [
    {
      "id": "relation:xyz789abc123",
      "fromMemoryId": "memory:abc123def456",
      "toMemoryId": "memory:def456ghi789",
      "relationType": "supports",
      "strength": 0.82,
      "bidirectional": false,
      "metadata": {}
    }
  ]
}
```

When `embeddings=true`, the `embedding` field contains a float array instead of `null`.

---

## GET /memories/export/:namespace/pmf

Export all memories in a namespace in Portable Memory Format (PMF). PMF includes integrity verification via Merkle tree and CRC32 checksum.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `namespace` | string | The namespace to export |

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `embeddings` | boolean | `false` | Include raw embedding vectors |
| `nodeId` | string | — | Optional node identifier to embed in the PMF header (useful for multi-node deployments) |
| `exportedBy` | string | — | Optional author/operator name to embed in the header |

### Example Request

```bash
curl -o ops-export.pmf.json \
  "http://localhost:3001/memories/export/ops/pmf?embeddings=false&exportedBy=admin&nodeId=node-prod-1" \
  -H "Authorization: Bearer nc_pat_..."
```

### Response (200 OK)

Content-Type: `application/vnd.novacortex.pmf+json`

The response is a valid PMF document. See [PMF Format Specification](../formats/pmf.md) for the full schema.

---

## POST /memories/import

Import memories from a JSON export file. The request body must be the JSON export content.

### Request

Content-Type: `application/json`

The body must be a valid JSON export document (as produced by `GET /memories/export/:namespace`). The namespace field in the export document determines where memories are imported. If the target namespace does not exist, it is created automatically (subject to tier limits).

### Example Request

```bash
curl -X POST http://localhost:3001/memories/import \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  --data-binary @ops-export.json
```

### Import Response (200 OK)

```json
{
  "imported": 55,
  "skipped": 2,
  "failed": 0,
  "errors": [],
  "namespace": "ops",
  "took_ms": 847
}
```

| Field | Type | Description |
|---|---|---|
| `imported` | integer | Number of memories successfully created |
| `skipped` | integer | Number of memories skipped (already exist with the same ID) |
| `failed` | integer | Number of memories that failed to import |
| `errors` | string[] | Descriptions of each failure |
| `namespace` | string | Target namespace where memories were imported |
| `took_ms` | integer | Total import duration in milliseconds |

---

## POST /memories/import/pmf

Import memories from a PMF file. The request body must be the PMF document content.

### Request

Content-Type: `application/json`

The body must be a valid PMF document with `"format": "NCPMF"` at the top level.

### Example Request

```bash
curl -X POST http://localhost:3001/memories/import/pmf \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  --data-binary @ops-export.pmf.json
```

### Import Response (200 OK)

Same schema as the JSON import response, with two additional fields:

```json
{
  "imported": 55,
  "skipped": 2,
  "failed": 0,
  "errors": [],
  "namespace": "ops",
  "took_ms": 1203,
  "merkleVerified": true,
  "checksumVerified": true
}
```

| Field | Type | Description |
|---|---|---|
| `merkleVerified` | boolean | Whether the PMF Merkle root matched the computed hash |
| `checksumVerified` | boolean | Whether the CRC32 checksum matched |

If `merkleVerified` or `checksumVerified` is `false`, the import is aborted before writing any records and the response includes an error:

```json
{
  "error": "PMF integrity check failed: Merkle root mismatch. The file may have been corrupted or tampered with.",
  "code": "PMF_INTEGRITY_FAILURE"
}
```

---

## Import Behavior

Imports follow a deterministic algorithm:

1. **Validate format** — verify the document structure and (for PMF) the format magic field and version
2. **Verify integrity** — (PMF only) check Merkle root and CRC32; abort if mismatch
3. **Ensure namespace exists** — create the target namespace if it does not exist (subject to tier limit)
4. **Import memories** — for each memory in the document:
   - If a memory with the same ID already exists: skip (increment `skipped` counter)
   - If the memory has an invalid type or missing content: record error (increment `failed` counter)
   - Otherwise: create the memory record (increment `imported` counter)
5. **Import relations** — for each relation in the document:
   - Check that both `fromMemoryId` and `toMemoryId` now exist in the database
   - If both exist: create the relation
   - If either does not exist (was skipped or failed): skip the relation silently

Imports are not transactional. If the process is interrupted midway, memories created before the interruption remain in the database. Re-running the import is safe — duplicate IDs are skipped.

---

## Handling Large Exports

For namespaces with more than 10,000 memories, use streaming-compatible tools:

```bash
# Using curl with a timeout override
curl --max-time 600 -o large-export.json \
  "http://localhost:3001/memories/export/large-namespace?embeddings=false" \
  -H "Authorization: Bearer nc_pat_..."

# Import from a large file
curl --max-time 600 -X POST http://localhost:3001/memories/import \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  --data-binary @large-export.json
```

Streaming PMF export (for namespaces exceeding 100,000 memories) is planned for v1.1. See [Roadmap](../roadmap.md).
