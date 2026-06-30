---
title: API Reference — Tokens
description: Creating, listing, and revoking API tokens
---

# API Reference — Tokens

Token management endpoints allow administrators to create, list, and revoke API tokens programmatically. All token management operations require a token with the `admin-full` template.

---

## Token Metadata Schema

The token list endpoint returns metadata objects — never the token string itself after initial creation.

```json
{
  "id": "token:abc123xyz789",
  "name": "agent-007-project-alpha",
  "template": "agent",
  "agentId": "agent-007",
  "namespaceClaim": "project-alpha",
  "prefix": "nc_pat_7x9q2m",
  "createdAt": "2026-04-12T09:00:00Z",
  "lastUsed": "2026-04-12T14:32:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string | SurrealDB record ID in format `token:<ulid>` |
| `name` | string | Human-readable label |
| `template` | enum | `admin-full`, `admin-readonly`, `agent`, or `knowledge-ingest` |
| `agentId` | string | Agent identifier, if set |
| `namespaceClaim` | string | Namespace restriction, if set (agent template only) |
| `prefix` | string | First 12 characters of the token for identification |
| `createdAt` | ISO 8601 | Creation timestamp |
| `lastUsed` | ISO 8601 | Timestamp of most recent authenticated request; `null` if never used |

---

## GET /tokens

List all tokens. Returns metadata only — the full token string is never returned after initial creation.

### Example Request

```bash
curl http://localhost:3001/tokens \
  -H "Authorization: Bearer nc_pat_admin_token"
```

### Example Response (200 OK)

```json
{
  "tokens": [
    {
      "id": "token:abc123xyz789",
      "name": "agent-007-project-alpha",
      "template": "agent",
      "agentId": "agent-007",
      "namespaceClaim": "project-alpha",
      "prefix": "nc_pat_7x9q2m",
      "createdAt": "2026-04-12T09:00:00Z",
      "lastUsed": "2026-04-12T14:32:00Z"
    },
    {
      "id": "token:def456uvw012",
      "name": "ci-pipeline-read",
      "template": "admin-readonly",
      "agentId": null,
      "namespaceClaim": null,
      "prefix": "nc_pat_3y8a1k",
      "createdAt": "2026-04-10T07:00:00Z",
      "lastUsed": "2026-04-12T08:00:00Z"
    }
  ],
  "total": 2
}
```

---

## POST /tokens

Create a new API token. The full token string (`nc_pat_...`) is returned only in this response. Store it securely.

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `template` | enum | Yes | Permission template: `admin-full`, `admin-readonly`, `agent`, or `knowledge-ingest` |
| `name` | string | Yes | Human-readable label. 2–64 characters. Used only for display. |
| `agentId` | string | No | Identifier for the agent this token is issued to. Stored in metadata; used by federation rules for lookup. |
| `namespaceClaim` | string | No | Namespace restriction. Required when `template` is `agent` and you want to scope the token to a specific namespace. Must be an existing namespace name. |

### Example Request — Admin Token

```bash
curl -X POST http://localhost:3001/tokens \
  -H "Authorization: Bearer nc_pat_admin_token" \
  -H "Content-Type: application/json" \
  -d '{
    "template": "admin-readonly",
    "name": "ci-pipeline-read"
  }'
```

### Example Request — Agent Token with Namespace Claim

```bash
curl -X POST http://localhost:3001/tokens \
  -H "Authorization: Bearer nc_pat_admin_token" \
  -H "Content-Type: application/json" \
  -d '{
    "template": "agent",
    "name": "agent-007-project-alpha",
    "agentId": "agent-007",
    "namespaceClaim": "project-alpha"
  }'
```

### Example Request — Knowledge Ingest Token

```bash
curl -X POST http://localhost:3001/tokens \
  -H "Authorization: Bearer nc_pat_admin_token" \
  -H "Content-Type: application/json" \
  -d '{
    "template": "knowledge-ingest",
    "name": "docs-pipeline-ingest"
  }'
```

### Example Response (201 Created)

```json
{
  "token": "nc_pat_7x9q2mTzRpXwYvZuSqPoNmLkJhIgFeDcBa",
  "record": {
    "id": "token:abc123xyz789",
    "name": "agent-007-project-alpha",
    "template": "agent",
    "agentId": "agent-007",
    "namespaceClaim": "project-alpha",
    "prefix": "nc_pat_7x9q2m",
    "createdAt": "2026-04-12T09:00:00Z",
    "lastUsed": null
  }
}
```

**Important**: The `token` field in the response is the only time the full token value is returned. Copy it immediately. If you lose it, you must create a new token — there is no way to retrieve the original value.

### Error Responses

- `400 Bad Request` — invalid template, empty name, or `namespaceClaim` references a namespace that does not exist
- `409 Conflict` — a token with this name already exists (names are unique)

---

## DELETE /tokens/:id

Revoke a token immediately. All subsequent requests using the revoked token receive `401 Unauthorized`.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `id` | string | The token record ID (format: `token:abc123xyz789`) |

### Example Request

```bash
curl -X DELETE http://localhost:3001/tokens/token:abc123xyz789 \
  -H "Authorization: Bearer nc_pat_admin_token"
```

### Response (204 No Content)

No response body.

### Notes

- Revocation takes effect immediately. There is no grace period.
- Revoked tokens cannot be restored. Create a new token with the same name if needed.
- An administrator cannot revoke their own currently-in-use token via this endpoint (the request itself would be authenticated with that token, so revocation is blocked). Use a different admin token or revoke from the web UI.
- The `prefix` of the revoked token is retained in the system logs for audit purposes.

### Error Responses

- `404 Not Found` — token does not exist or was already revoked

---

## Token Naming Conventions

Consistent naming makes the token list readable and simplifies audit:

| Pattern | Example | Use Case |
|---|---|---|
| `<agent>-<env>` | `agent-007-prod` | Agent in a specific environment |
| `<team>-<role>` | `team-ops-admin` | Human team member |
| `<pipeline>-<action>` | `ci-deploy-readonly` | CI/CD pipeline |
| `<service>-<action>` | `monitor-health-read` | Monitoring service |
| `<integration>-<version>` | `zapier-integration-v2` | Third-party integration |
