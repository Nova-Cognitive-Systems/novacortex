---
title: Portable Memory Format (PMF) Specification
description: RFC PMF-001 — Open interchange format for AI memory snapshots
---

# Portable Memory Format (PMF) — RFC PMF-001

PMF (Portable Memory Format) is an open, JSON-based interchange format for AI memory system snapshots. It encodes memory records, graph topology, optional vector embeddings, integrity verification data, and federation metadata in a single self-describing file.

---

## Motivation

Every AI memory system stores data differently. NovaCortex uses SurrealDB + Qdrant. Other systems use PostgreSQL, SQLite, or proprietary formats. When you migrate, backup, audit, or federate memory data across systems, you need a common schema that any implementation can read.

PMF defines that schema. It is designed to be:
- **Self-describing** — the format version and metadata are in the file header; no out-of-band manifest required
- **Verifiable** — a Merkle tree and CRC32 checksum allow integrity verification without re-reading all data
- **Portable** — any JSON parser can read a PMF file; no binary dependencies
- **Extensible** — implementations can add custom fields without breaking compatibility

---

## Identification

| Property | Value |
|---|---|
| File extension | `.pmf.json` |
| MIME type | `application/vnd.novacortex.pmf+json` |
| Magic field | `"format": "NCPMF"` (top-level) |
| RFC designation | RFC PMF-001 |
| Current version | `"1.0"` |

---

## Top-Level Structure

```json
{
  "format": "NCPMF",
  "version": "1.0",
  "rfc": "RFC PMF-001",
  "header": { ... },
  "memories": [ ... ],
  "relations": [ ... ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `format` | string | Yes | Must be exactly `"NCPMF"`. Identifies the file as a PMF document. |
| `version` | string | Yes | PMF version. Currently `"1.0"`. |
| `rfc` | string | No | The RFC specification this file conforms to. |
| `header` | object | Yes | Metadata about the export. |
| `memories` | array | Yes | Array of memory objects. |
| `relations` | array | Yes | Array of relation objects. |

---

## Header Object

```json
{
  "nodeId": "prod-node-1",
  "exportedBy": "admin",
  "exportedAt": "2026-04-12T09:00:00Z",
  "namespace": "default",
  "memoryCount": 142,
  "relationCount": 89,
  "includesEmbeddings": false,
  "merkleRoot": "3f2a1b7c4d9e0f6a2b8c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4",
  "checksum": 1234567890
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `nodeId` | string | No | Identifier for the originating NovaCortex node. Useful in multi-node deployments to trace the export's origin. |
| `exportedBy` | string | No | Username or agent ID that initiated the export. |
| `exportedAt` | ISO 8601 | Yes | Timestamp when the export was generated. |
| `namespace` | string | Yes | The namespace this export covers. |
| `memoryCount` | integer | Yes | Total number of memory objects in the `memories` array. |
| `relationCount` | integer | Yes | Total number of relation objects in the `relations` array. |
| `includesEmbeddings` | boolean | Yes | Whether memory objects include the `embedding` field. If `false`, all `embedding` values are `null`. |
| `merkleRoot` | string | No | Hex-encoded SHA-256 Merkle root of the memory dataset. See Integrity Verification below. |
| `checksum` | integer | No | CRC32 checksum of the serialized `memories` array. See Integrity Verification below. |

---

## Memory Object

```json
{
  "id": "memory:01j9xkm2v3p8q4r5s6t7u8v9",
  "content": "NovaCortex uses HNSW indexing for sub-millisecond vector search",
  "type": "semantic",
  "namespace": "default",
  "tags": ["architecture", "performance"],
  "entities": ["NovaCortex", "HNSW"],
  "signals": [0.8, 0.3],
  "confidence": 0.95,
  "salience": 0.87,
  "decayRate": 0.05,
  "embedding": null,
  "createdAt": "2026-04-12T09:00:00Z",
  "updatedAt": "2026-04-12T09:00:00Z"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Unique identifier for the memory. Format: `memory:<ulid>`. Used for deduplication during import. |
| `content` | string | Yes | The full text content of the memory. Must not be empty. |
| `type` | enum | Yes | One of: `episodic`, `semantic`, `procedural`, `working`. |
| `namespace` | string | Yes | The namespace this memory belongs to. |
| `tags` | string[] | No | Text labels for filtering. |
| `entities` | string[] | No | Named entities associated with the content. |
| `signals` | float[] | No | Custom numeric signals. |
| `confidence` | float | No | Certainty score (0–1). |
| `salience` | float | No | Importance score (0–1). |
| `decayRate` | float | No | Salience decay rate per processor cycle (0–1). |
| `embedding` | float[] or null | Conditional | Vector embedding. Present and non-null only when `header.includesEmbeddings` is `true`. When present, length must equal the originating system's vector dimension. |
| `createdAt` | ISO 8601 | Yes | Original creation timestamp. Preserved during import. |
| `updatedAt` | ISO 8601 | Yes | Last modification timestamp. |

---

## Relation Object

```json
{
  "id": "relation:01j9xkm2v3p8q4r5s6t7u8v0",
  "fromMemoryId": "memory:01j9xkm2v3p8q4r5s6t7u8v9",
  "toMemoryId": "memory:01j9xkm2v3p8q4r5s6t7u8va",
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

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Unique identifier for the relation. Format: `relation:<ulid>`. |
| `fromMemoryId` | string | Yes | Source memory ID. |
| `toMemoryId` | string | Yes | Target memory ID. |
| `relationType` | enum | Yes | One of: `causes`, `supports`, `contradicts`, `supersedes`, `part_of`, `references`, `temporal_before`, `temporal_after`, `related_to`. |
| `strength` | float | No | Relation strength (0–1). |
| `bidirectional` | boolean | No | Whether the relation is traversable in both directions. |
| `metadata` | object | No | Arbitrary JSON metadata. |
| `createdAt` | ISO 8601 | Yes | When the relation was created. |

Note: Cross-namespace relations (where `fromMemoryId` and `toMemoryId` belong to different namespaces) are valid in PMF but a single PMF file only exports memories from one namespace. Cross-namespace relations that point to memories outside the exported namespace will have dangling target IDs after import.

---

## Complete Example Document

```json
{
  "format": "NCPMF",
  "version": "1.0",
  "rfc": "RFC PMF-001",
  "header": {
    "nodeId": "prod-node-1",
    "exportedBy": "admin",
    "exportedAt": "2026-04-12T09:00:00Z",
    "namespace": "ops",
    "memoryCount": 2,
    "relationCount": 1,
    "includesEmbeddings": false,
    "merkleRoot": "3f2a1b7c4d9e0f6a2b8c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4",
    "checksum": 3897412085
  },
  "memories": [
    {
      "id": "memory:01j9xkm2v3p8q4r5s6t7u8v9",
      "content": "The production SurrealDB instance requires 2GB RAM minimum",
      "type": "procedural",
      "namespace": "ops",
      "tags": ["database", "infrastructure"],
      "entities": ["SurrealDB"],
      "signals": [],
      "confidence": 0.98,
      "salience": 0.9,
      "decayRate": 0.02,
      "embedding": null,
      "createdAt": "2026-04-12T09:15:00Z",
      "updatedAt": "2026-04-12T09:15:00Z"
    },
    {
      "id": "memory:01j9xkm2v3p8q4r5s6t7u8va",
      "content": "Qdrant should be allocated at least 2GB RAM for the HNSW index",
      "type": "semantic",
      "namespace": "ops",
      "tags": ["infrastructure", "qdrant"],
      "entities": ["Qdrant", "HNSW"],
      "signals": [],
      "confidence": 0.95,
      "salience": 0.85,
      "decayRate": 0.05,
      "embedding": null,
      "createdAt": "2026-04-11T14:00:00Z",
      "updatedAt": "2026-04-11T14:00:00Z"
    }
  ],
  "relations": [
    {
      "id": "relation:01j9xkm2v3p8q4r5s6t7u8vb",
      "fromMemoryId": "memory:01j9xkm2v3p8q4r5s6t7u8v9",
      "toMemoryId": "memory:01j9xkm2v3p8q4r5s6t7u8va",
      "relationType": "related_to",
      "strength": 0.87,
      "bidirectional": true,
      "metadata": {
        "source": "processor",
        "similarity": 0.87
      },
      "createdAt": "2026-04-12T09:30:00Z"
    }
  ]
}
```

---

## Integrity Verification

PMF includes two integrity mechanisms: a Merkle tree root hash and a CRC32 checksum. Both are optional but strongly recommended for archival and migration use cases.

### Merkle Root

The Merkle root is a SHA-256 hash that represents the entire dataset in a form that can be verified efficiently.

**Construction algorithm**:

1. For each memory, compute a leaf hash:
   ```
   leaf_i = SHA-256(memory.id + ":" + SHA-256(memory.content))
   ```
   The content hash is computed on the UTF-8 encoded content string.

2. Sort all leaf hashes lexicographically.

3. Build a binary Merkle tree from the sorted leaves:
   - If the number of leaves is odd, duplicate the last leaf.
   - Repeatedly hash adjacent pairs: `node = SHA-256(left || right)` until one root remains.

4. Encode the root hash as a lowercase hex string.

**Verification**: the importing system recomputes the Merkle root using the same algorithm and compares it to `header.merkleRoot`. A mismatch indicates data corruption or tampering.

### CRC32 Checksum

The CRC32 checksum provides a fast, lightweight integrity check:

1. Serialize the `memories` array as compact JSON (no extra whitespace):
   ```
   JSON.stringify(memories)  // or equivalent compact serialization
   ```
2. Compute CRC32 of the UTF-8 encoded string.
3. Store as an unsigned 32-bit integer in `header.checksum`.

CRC32 is fast to compute and verify, making it suitable as a first-pass check before the more expensive Merkle verification.

---

## Import Behavior

Conforming PMF importers must implement the following algorithm:

1. **Parse the JSON** — if parsing fails, abort with a format error.

2. **Check the magic field** — if `format` is not `"NCPMF"`, abort.

3. **Check the version** — if `version` is unknown, abort with an unsupported version error. Importers may support older versions but must not silently misinterpret a newer version.

4. **Verify integrity** — if `header.merkleRoot` is present, compute the Merkle root and compare. If mismatch, abort. If `header.checksum` is present, verify CRC32. If mismatch, abort.

5. **Ensure namespace exists** — create the namespace from `header.namespace` if it does not exist.

6. **Import memories** — for each memory:
   - If a record with the same `id` already exists: skip (do not overwrite).
   - If `content` is empty or `type` is not a valid enum value: record an error, skip.
   - Otherwise: create the memory record.

7. **Import relations** — for each relation:
   - If both `fromMemoryId` and `toMemoryId` exist in the database: create the relation.
   - If either does not exist: skip silently (this handles the case where the from/to memory was skipped in step 6).

8. **Return results** — report `imported`, `skipped`, `failed`, and `errors` counts.

---

## Versioning and Compatibility

PMF follows calendar versioning: major format changes increment the version. An importer that supports PMF 1.0 must reject PMF 2.0 files (or at minimum warn that the version is unsupported). Backward compatibility is not guaranteed across major versions.

Minor additions to existing structures (new optional fields) are considered non-breaking. An importer may ignore unknown fields.

---

## Security Considerations

PMF files may contain sensitive data — memory content can include personal information, credentials, proprietary knowledge, and confidential business data.

**At rest**: Encrypt PMF files using standard file encryption (GPG, age, or filesystem-level encryption). PMF itself does not define an encryption envelope.

**In transit**: Use TLS for any PMF file transfer. The NovaCortex API serves export files over HTTPS when deployed with SSL.

**Access control**: Apply the same access controls to PMF files as to the memories they represent. A PMF export of the `ops` namespace should be accessible only to operators with read access to that namespace.

**Encrypted payload extension**: RFC PMF-001 Appendix C (draft) proposes an encrypted payload extension using AES-256-GCM. In this extension, individual memory `content` fields are encrypted, and the encryption key is stored separately. The extension is not yet implemented in NovaCortex v1.0 but is planned for v1.1. See [Roadmap](../roadmap.md).

---

## Implementing PMF Support

To implement PMF import/export in a third-party system:

1. Generate or parse JSON following the schema in this document.
2. Implement the import algorithm above.
3. Compute the Merkle root and CRC32 for all exports.
4. Use the file extension `.pmf.json` and MIME type `application/vnd.novacortex.pmf+json`.
5. Open a pull request to the NovaCortex repository to list your implementation in the [PMF implementations registry](https://github.com/Nova-Cognitive-Systems/novacortex/blob/main/rfcs/PMF-001-implementations.md).

The PMF RFC is maintained at [github.com/Nova-Cognitive-Systems/novacortex/rfcs/RFC-PMF-001.md](https://github.com/Nova-Cognitive-Systems/novacortex/blob/main/rfcs/RFC-PMF-001.md). Community contributions and amendments are accepted via the RFC process described in the [Roadmap](../roadmap.md).
