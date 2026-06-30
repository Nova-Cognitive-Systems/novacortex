---
title: API Reference — Knowledge Base
description: Bucket and document management endpoints
---

# API Reference — Knowledge Base

The Knowledge Base API manages document buckets and uploaded documents. Documents are chunked and optionally converted to semantic memories.

---

## Bucket Object Schema

```json
{
  "id": "bucket:abc123",
  "name": "product-docs",
  "description": "User-facing product documentation",
  "namespace": "knowledge",
  "agents": ["agent-007", "agent-planner"],
  "createMemoriesByDefault": true,
  "documentCount": 12,
  "createdAt": "2026-04-10T08:00:00Z"
}
```

## Document Object Schema

```json
{
  "id": "doc:xyz789",
  "bucketId": "bucket:abc123",
  "name": "deployment-guide.pdf",
  "size": 2048576,
  "mimeType": "application/pdf",
  "status": "ready",
  "chunkCount": 34,
  "linkedMemoryCount": 34,
  "uploadedBy": "admin",
  "uploadedAt": "2026-04-12T09:00:00Z"
}
```

---

## GET /buckets

List all buckets with their document counts.

### Example Request

```bash
curl http://localhost:3001/buckets \
  -H "Authorization: Bearer nc_pat_..."
```

### Example Response (200 OK)

```json
{
  "buckets": [
    {
      "id": "bucket:abc123",
      "name": "product-docs",
      "description": "User-facing product documentation",
      "namespace": "knowledge",
      "agents": ["agent-007"],
      "createMemoriesByDefault": true,
      "documentCount": 12,
      "createdAt": "2026-04-10T08:00:00Z"
    }
  ],
  "total": 1
}
```

---

## POST /buckets

Create a new bucket.

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Slug-safe bucket name (lowercase, numbers, hyphens). Unique across all buckets. |
| `description` | string | No | Free-text description shown in the UI. |
| `namespace` | string | Yes | Target namespace for memories generated from this bucket's documents. Must be an existing namespace. |
| `agents` | string[] | No | Agent IDs that have read access to this bucket's documents. Empty array means all tokens can access. |
| `createMemoriesByDefault` | boolean | No | Default setting for the Create Memories option on document uploads. Default: `false`. |

### Example Request

```bash
curl -X POST http://localhost:3001/buckets \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "runbooks",
    "description": "Operations runbooks and incident playbooks",
    "namespace": "ops",
    "agents": ["agent-007", "agent-ops"],
    "createMemoriesByDefault": true
  }'
```

### Example Response (201 Created)

Returns the created bucket object.

### Error Responses

- `400 Bad Request` — invalid name slug or namespace does not exist
- `409 Conflict` — a bucket with this name already exists

---

## DELETE /buckets/:id

Delete a bucket. The bucket must contain no documents.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | The bucket ID (format: `bucket:abc123`) |

### Example Request

```bash
curl -X DELETE http://localhost:3001/buckets/bucket:abc123 \
  -H "Authorization: Bearer nc_pat_..."
```

### Response (204 No Content)

### Error Responses

- `400 Bad Request` with code `BUCKET_NOT_EMPTY` — delete all documents in the bucket first
- `404 Not Found` — bucket does not exist

---

## GET /buckets/:id/documents

List all documents in a bucket.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | The bucket ID |

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 20 | Maximum documents to return |
| `offset` | integer | 0 | Documents to skip |
| `status` | string | — | Filter by status: `processing`, `ready`, or `failed` |

### Example Request

```bash
curl "http://localhost:3001/buckets/bucket:abc123/documents?status=ready&limit=10" \
  -H "Authorization: Bearer nc_pat_..."
```

### Example Response (200 OK)

```json
{
  "documents": [
    {
      "id": "doc:xyz789",
      "bucketId": "bucket:abc123",
      "name": "deployment-guide.pdf",
      "size": 2048576,
      "mimeType": "application/pdf",
      "status": "ready",
      "chunkCount": 34,
      "linkedMemoryCount": 34,
      "uploadedBy": "admin",
      "uploadedAt": "2026-04-12T09:00:00Z"
    }
  ],
  "total": 1,
  "limit": 10,
  "offset": 0
}
```

---

## POST /buckets/:id/upload

Upload a document to a bucket. Uses multipart form data.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | The bucket ID |

### Form Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | file | Yes | The document file. Max size: 10 MB. Supported types: `.txt`, `.md`, `.mdx`, `.csv`, `.pdf`, `.json`. |
| `createMemories` | boolean | No | Override the bucket's `createMemoriesByDefault` setting for this upload. |

### Example Request

```bash
curl -X POST http://localhost:3001/buckets/bucket:abc123/upload \
  -H "Authorization: Bearer nc_pat_..." \
  -F "file=@./deployment-guide.pdf" \
  -F "createMemories=true"
```

### Example Response (201 Created)

```json
{
  "id": "doc:xyz789",
  "bucketId": "bucket:abc123",
  "name": "deployment-guide.pdf",
  "size": 2048576,
  "mimeType": "application/pdf",
  "status": "processing",
  "chunkCount": 0,
  "linkedMemoryCount": 0,
  "uploadedBy": "agent-007",
  "uploadedAt": "2026-04-12T09:00:00Z"
}
```

The document status is `processing` immediately after upload. The API processes the document asynchronously. Poll `GET /buckets/:id/documents` or `GET /knowledge/:id` to check when status changes to `ready`.

### Error Responses

- `400 Bad Request` with code `FILE_TOO_LARGE` — file exceeds 10 MB
- `400 Bad Request` with code `UNSUPPORTED_FILE_TYPE` — file extension not in allowed list
- `404 Not Found` — bucket does not exist

---

## GET /buckets/:id/history

Get the upload history for a bucket. All uploads are recorded, including deleted documents.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | The bucket ID |

### Example Request

```bash
curl http://localhost:3001/buckets/bucket:abc123/history \
  -H "Authorization: Bearer nc_pat_..."
```

### Example Response (200 OK)

```json
{
  "history": [
    {
      "documentId": "doc:xyz789",
      "name": "deployment-guide.pdf",
      "uploadedBy": "admin",
      "uploadedAt": "2026-04-12T09:00:00Z",
      "status": "ready",
      "chunkCount": 34,
      "memoriesCreated": 34,
      "error": null
    },
    {
      "documentId": "doc:pqr456",
      "name": "bad-file.docx",
      "uploadedBy": "admin",
      "uploadedAt": "2026-04-11T15:00:00Z",
      "status": "failed",
      "chunkCount": 0,
      "memoriesCreated": 0,
      "error": "Unsupported file type: application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    }
  ],
  "total": 2
}
```

---

## GET /knowledge/:id

Get full document details including extracted text content, chunks, and linked memory IDs.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | The document ID (format: `doc:xyz789`) |

### Example Request

```bash
curl http://localhost:3001/knowledge/doc:xyz789 \
  -H "Authorization: Bearer nc_pat_..."
```

### Example Response (200 OK)

```json
{
  "id": "doc:xyz789",
  "bucketId": "bucket:abc123",
  "name": "deployment-guide.pdf",
  "size": 2048576,
  "mimeType": "application/pdf",
  "status": "ready",
  "content": "Full extracted text of the document...",
  "chunks": [
    "Chunk 1: Introduction to deployment...",
    "Chunk 2: Prerequisites and requirements...",
    "Chunk 3: Step-by-step deployment process..."
  ],
  "linkedMemoryIds": [
    "memory:abc001",
    "memory:abc002",
    "memory:abc003"
  ],
  "chunkCount": 34,
  "linkedMemoryCount": 34,
  "uploadedBy": "admin",
  "uploadedAt": "2026-04-12T09:00:00Z"
}
```

---

## DELETE /knowledge/:id

Delete a document. Optionally deletes linked memories.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | The document ID |

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `deleteMemories` | boolean | `false` | When `true`, also permanently deletes all semantic memories linked to this document. |

### Example Requests

```bash
# Delete document, keep linked memories
curl -X DELETE http://localhost:3001/knowledge/doc:xyz789 \
  -H "Authorization: Bearer nc_pat_..."

# Delete document and all linked memories
curl -X DELETE "http://localhost:3001/knowledge/doc:xyz789?deleteMemories=true" \
  -H "Authorization: Bearer nc_pat_..."
```

### Response (204 No Content)

No response body.

### Error Responses

- `404 Not Found` — document does not exist
