---
title: API Reference — Overview
description: Complete endpoint listing, base URL, error format, and status codes for the NovaCortex API
---

# API Reference — Overview

The NovaCortex API is an HTTP/JSON REST API served by the Express application in `packages/api/`. All requests must include a valid Bearer token in the `Authorization` header.

---

## Base URL

| Environment | Base URL |
|---|---|
| Development | `http://localhost:3001` |
| Production (same host) | `https://your-domain.com/api` |
| Production (separate API host) | `https://api.your-domain.com` |

**Note on path prefixes**: The current release serves all endpoints at the API root without a `/v1` prefix. For example, the memories endpoint is `http://localhost:3001/memories`, not `http://localhost:3001/v1/memories`. Future major versions may introduce a `/v2` prefix; the `/v1` prefix is reserved but not currently active.

---

## Authentication

All endpoints (except health probes) require authentication. Include your API token in the `Authorization` header:

```
Authorization: Bearer nc_pat_your_token_here
```

See [API Reference — Authentication](./authentication.md) for full details on token types, templates, and scope.

---

## Endpoint Reference

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Full health check — returns status of all backend services with latency |
| GET | `/health/ready` | Readiness probe — returns 200 only when all services are connected |
| GET | `/health/live` | Liveness probe — returns 200 if the API process is alive |

### Memories

| Method | Path | Description |
|---|---|---|
| GET | `/memories` | List memories with filtering, pagination, and sorting |
| POST | `/memories` | Create a new memory |
| GET | `/memories/:ns/:id` | Get a single memory by namespace and ID |
| PATCH | `/memories/:ns/:id` | Update memory metadata (content is immutable) |
| DELETE | `/memories/:ns/:id` | Delete a memory and its relations |
| GET | `/memories/:ns/:id/similar` | Find semantically similar memories using stored embedding |

### Search

| Method | Path | Description |
|---|---|---|
| POST | `/search` | Vector similarity search — supply a raw embedding vector |

### Relations

| Method | Path | Description |
|---|---|---|
| GET | `/memories/:ns/:id/relations` | Get all relations (incoming and outgoing) for a memory |
| POST | `/memories/relations` | Create a typed relation between two memories |
| DELETE | `/memories/relations/:id` | Delete a relation by ID |

### Namespaces

| Method | Path | Description |
|---|---|---|
| GET | `/namespaces` | List all namespaces with counts and tier limit information |
| POST | `/namespaces` | Create a new namespace |
| DELETE | `/namespaces/:name` | Delete an empty namespace |

### Tokens

| Method | Path | Description |
|---|---|---|
| GET | `/tokens` | List all tokens (metadata only — no token strings) |
| POST | `/tokens` | Create a new API token |
| DELETE | `/tokens/:id` | Revoke a token immediately |

### Export and Import

| Method | Path | Description |
|---|---|---|
| GET | `/memories/export/:ns` | Export all memories in a namespace as JSON |
| GET | `/memories/export/:ns/pmf` | Export all memories in a namespace as PMF |
| POST | `/memories/import` | Import memories from a JSON export |
| POST | `/memories/import/pmf` | Import memories from a PMF export |

### Processor

| Method | Path | Description |
|---|---|---|
| GET | `/processor` | Get processor stats and current task configuration |
| POST | `/processor/run` | Trigger an immediate processor run |
| GET | `/processor/schedule` | Get current processor schedule configuration |
| PUT | `/processor/schedule` | Update processor schedule configuration |

### Knowledge Base

| Method | Path | Description |
|---|---|---|
| GET | `/buckets` | List all buckets |
| POST | `/buckets` | Create a new bucket |
| DELETE | `/buckets/:id` | Delete an empty bucket |
| GET | `/buckets/:id/documents` | List documents in a bucket |
| POST | `/buckets/:id/upload` | Upload a document to a bucket |
| GET | `/buckets/:id/history` | Get upload history for a bucket |
| GET | `/knowledge/:id` | Get full document detail with chunks and linked memory IDs |
| DELETE | `/knowledge/:id` | Delete a document (optionally its linked memories) |

### Federation (Pro/Enterprise)

| Method | Path | Description |
|---|---|---|
| GET | `/federation/status` | Get federation availability for current tier |
| GET | `/federation` | List all federation rules |
| POST | `/federation` | Create a federation rule for an agent |
| DELETE | `/federation/:agentId` | Delete all federation rules for an agent |

---

## Error Format

All error responses use a consistent JSON structure:

```json
{
  "error": "Human-readable description of the error",
  "code": "MACHINE_READABLE_ERROR_CODE"
}
```

The `error` field is intended for display to developers. The `code` field is a stable identifier for programmatic handling.

### Common Error Codes

| Code | HTTP Status | Description |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid Authorization header |
| `TOKEN_EXPIRED` | 401 | Token has passed its expiry time |
| `FORBIDDEN` | 403 | Token does not have permission for this operation |
| `NAMESPACE_LIMIT_REACHED` | 403 | Creating a new namespace would exceed tier limit |
| `FEDERATION_NOT_AVAILABLE` | 403 | Federation requires Pro or Enterprise license |
| `NOT_FOUND` | 404 | The requested resource does not exist |
| `NAMESPACE_NOT_EMPTY` | 400 | Cannot delete namespace that contains memories |
| `NAMESPACE_PROTECTED` | 403 | Cannot delete the `default` namespace |
| `INVALID_MEMORY_TYPE` | 400 | `type` must be one of: episodic, semantic, procedural, working |
| `INVALID_RELATION_TYPE` | 400 | `relationType` is not a valid relation type |
| `CONTENT_REQUIRED` | 400 | Memory content cannot be empty |
| `CONTENT_IMMUTABLE` | 400 | Memory content cannot be changed after creation |
| `NAMESPACE_SLUG_INVALID` | 400 | Namespace name contains invalid characters |
| `FILE_TOO_LARGE` | 400 | Uploaded file exceeds the 10 MB limit |
| `UNSUPPORTED_FILE_TYPE` | 400 | File extension is not supported |
| `RATE_LIMITED` | 429 | Too many requests — slow down and retry |
| `EMBEDDING_PROVIDER_ERROR` | 500 | The embedding model API returned an error |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## HTTP Status Codes

| Code | Meaning | Used When |
|---|---|---|
| 200 OK | Request succeeded | GET, PATCH, PUT success |
| 201 Created | Resource created | POST that creates a resource |
| 204 No Content | Success, no body | DELETE success |
| 400 Bad Request | Invalid input | Missing required fields, validation failure |
| 401 Unauthorized | Authentication failure | Missing, invalid, or expired token |
| 403 Forbidden | Authorization failure | Token lacks permission, tier limit, protected resource |
| 404 Not Found | Resource missing | Memory, token, bucket, or namespace does not exist |
| 429 Too Many Requests | Rate limit | Retry after the duration in the `Retry-After` header |
| 500 Internal Server Error | Server error | Database errors, embedding provider failures |

---

## Request Content Types

- All `POST`, `PATCH`, and `PUT` requests must send `Content-Type: application/json`, except for document upload endpoints which use `multipart/form-data`.
- All responses are `application/json` unless otherwise noted (export endpoints may return different content types based on the format).

---

## Rate Limiting

The API applies rate limiting per token. Default limits:

| Window | Max Requests |
|---|---|
| 1 minute | 300 |
| 1 hour | 5,000 |

When the limit is exceeded, the API returns `429 Too Many Requests` with a `Retry-After` header indicating the number of seconds until the limit resets.

Rate limit configuration can be adjusted via environment variables (documented in future versions). Contact support for Enterprise rate limit customization.

---

## Pagination

List endpoints use offset-based pagination with the following query parameters:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 20 | Maximum records to return (max: 100) |
| `offset` | integer | 0 | Number of records to skip |

All list responses include a `total` field with the complete count of matching records regardless of pagination, enabling client-side page calculation.

```json
{
  "memories": [...],
  "total": 847,
  "limit": 20,
  "offset": 40
}
```
