---
title: API Reference — Namespaces
description: Creating, listing, and deleting namespaces
---

# API Reference — Namespaces

Namespaces are isolation contexts for memories. All namespace management operations require a token with admin permissions (`admin-full` template).

---

## Namespace Object Schema

```json
{
  "name": "project-alpha",
  "memoryCount": 342,
  "createdAt": "2026-04-10T08:00:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `name` | string | The namespace slug — unique identifier |
| `memoryCount` | integer | Current number of memories in this namespace |
| `createdAt` | ISO 8601 | When the namespace was created |

---

## GET /namespaces

List all namespaces. Returns tier limit information alongside the namespace list.

### Query Parameters

This endpoint has no query parameters. All accessible namespaces are returned in a single response.

### Example Request

```bash
curl http://localhost:3001/namespaces \
  -H "Authorization: Bearer nc_pat_..."
```

### Example Response (200 OK)

```json
{
  "namespaces": [
    {
      "name": "default",
      "memoryCount": 128,
      "createdAt": "2026-04-01T00:00:00Z"
    },
    {
      "name": "project-alpha",
      "memoryCount": 342,
      "createdAt": "2026-04-10T08:00:00Z"
    },
    {
      "name": "ops",
      "memoryCount": 57,
      "createdAt": "2026-04-11T12:00:00Z"
    }
  ],
  "count": 3,
  "limit": 10,
  "remaining": 7,
  "tier": "pro"
}
```

| Field | Type | Description |
|---|---|---|
| `namespaces` | array | All namespace objects |
| `count` | integer | Current number of namespaces |
| `limit` | integer | Maximum namespaces allowed for the current tier |
| `remaining` | integer | How many more namespaces can be created (`limit - count`) |
| `tier` | string | Current license tier: `unregistered`, `free`, `pro`, or `enterprise` |

For the `enterprise` tier, `limit` is returned as `null` and `remaining` as `null` to indicate no restriction.

---

## POST /namespaces

Create a new namespace.

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | The namespace slug. Must be 2–64 characters. Allowed characters: lowercase a–z, digits 0–9, and hyphens. Must not start or end with a hyphen. Must be unique. Cannot be `default`, `system`, or `admin`. |

### Example Request

```bash
curl -X POST http://localhost:3001/namespaces \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"name": "project-beta"}'
```

### Example Response (201 Created)

```json
{
  "name": "project-beta",
  "memoryCount": 0,
  "createdAt": "2026-04-12T09:30:00Z"
}
```

### Error Responses

- `400 Bad Request` with code `NAMESPACE_SLUG_INVALID` — name contains invalid characters, is too short, too long, or is a reserved name
- `403 Forbidden` with code `NAMESPACE_LIMIT_REACHED` — creating this namespace would exceed the tier limit
- `409 Conflict` — a namespace with this name already exists

### Validation Rules

The following names are explicitly rejected:

- Names containing uppercase letters (use `project-alpha` not `project-Alpha`)
- Names containing spaces or underscores (use hyphens as separators)
- Names starting or ending with a hyphen (`-project` and `project-` are invalid)
- Names shorter than 2 characters
- Names longer than 64 characters
- Reserved names: `default`, `system`, `admin`, `internal`, `api`, `health`, `metrics`

---

## DELETE /namespaces/:name

Delete a namespace. The namespace must be empty (zero memories).

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `name` | string | The namespace slug to delete |

### Example Request

```bash
curl -X DELETE http://localhost:3001/namespaces/project-beta \
  -H "Authorization: Bearer nc_pat_..."
```

### Response (204 No Content)

No response body on success.

### Error Responses

- `400 Bad Request` with code `NAMESPACE_NOT_EMPTY` — the namespace contains memories. Delete all memories in the namespace before deleting it.
- `403 Forbidden` with code `NAMESPACE_PROTECTED` — the namespace is `default` and cannot be deleted.
- `404 Not Found` — namespace does not exist.

### Deleting All Memories in a Namespace

Before deleting a namespace, all memories in it must be deleted. You can list and delete them programmatically:

```bash
# List all memory IDs in the namespace
MEMORIES=$(curl -s "http://localhost:3001/memories?namespace=project-beta&limit=100" \
  -H "Authorization: Bearer nc_pat_..." | jq -r '.memories[].id')

# Delete each one
for ID in $MEMORIES; do
  curl -X DELETE "http://localhost:3001/memories/project-beta/$ID" \
    -H "Authorization: Bearer nc_pat_..."
done

# Now delete the empty namespace
curl -X DELETE http://localhost:3001/namespaces/project-beta \
  -H "Authorization: Bearer nc_pat_..."
```

This pattern works for small to medium namespaces. For very large namespaces, paginate through the memory list before deleting.
