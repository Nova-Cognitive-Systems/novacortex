---
title: API Reference — Federation
description: Cross-namespace memory federation endpoints (Pro/Enterprise)
---

# API Reference — Federation

Federation allows an agent to transparently read from multiple namespaces using a single namespace-scoped token. It is a Pro and Enterprise feature.

---

## Federation Rule Object Schema

```json
{
  "id": "federation:abc123xyz789",
  "agentId": "agent-007",
  "primaryNamespace": "team-a",
  "readableNamespaces": ["shared-docs", "product-specs"],
  "createdAt": "2026-04-12T09:00:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string | SurrealDB record ID |
| `agentId` | string | The agent ID this rule applies to |
| `primaryNamespace` | string | The agent's home namespace (must match the agent token's `namespaceClaim`) |
| `readableNamespaces` | string[] | Namespaces the agent can read from in addition to its primary namespace |
| `createdAt` | ISO 8601 | When the rule was created |

---

## GET /federation/status

Check whether federation is available for the current license tier.

### Example Request

```bash
curl http://localhost:3001/federation/status \
  -H "Authorization: Bearer nc_pat_..."
```

### Example Response (200 OK) — Pro Tier

```json
{
  "enabled": true,
  "tier": "pro",
  "maxReadableNamespaces": 10
}
```

### Example Response (200 OK) — Unregistered/Free Tier

```json
{
  "enabled": false,
  "tier": "free",
  "maxReadableNamespaces": 0,
  "upgradeRequired": true
}
```

---

## GET /federation

List all federation rules.

### Example Request

```bash
curl http://localhost:3001/federation \
  -H "Authorization: Bearer nc_pat_..."
```

### Example Response (200 OK)

```json
{
  "rules": [
    {
      "id": "federation:abc123xyz789",
      "agentId": "agent-007",
      "primaryNamespace": "team-a",
      "readableNamespaces": ["shared-docs", "product-specs"],
      "createdAt": "2026-04-12T09:00:00Z"
    },
    {
      "id": "federation:def456uvw012",
      "agentId": "agent-008",
      "primaryNamespace": "team-b",
      "readableNamespaces": ["shared-docs"],
      "createdAt": "2026-04-12T09:05:00Z"
    }
  ],
  "total": 2
}
```

---

## POST /federation

Create or update a federation rule for an agent.

If a rule already exists for the specified `agentId`, the existing rule is replaced entirely.

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `agentId` | string | Yes | The agent ID to create the rule for. Must match the `agentId` field on an existing token. |
| `primaryNamespace` | string | Yes | The agent's primary namespace. Must match the `namespaceClaim` on the agent's token. |
| `readableNamespaces` | string[] | Yes | List of additional namespaces the agent can read. All namespaces must exist. Max 10 entries (Pro), unlimited (Enterprise). Cannot include the `primaryNamespace`. |

### Example Request

```bash
curl -X POST http://localhost:3001/federation \
  -H "Authorization: Bearer nc_pat_admin_token" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent-007",
    "primaryNamespace": "team-a",
    "readableNamespaces": ["shared-docs", "product-specs", "company-wiki"]
  }'
```

### Example Response (201 Created)

```json
{
  "id": "federation:abc123xyz789",
  "agentId": "agent-007",
  "primaryNamespace": "team-a",
  "readableNamespaces": ["shared-docs", "product-specs", "company-wiki"],
  "createdAt": "2026-04-12T09:00:00Z"
}
```

### Error Responses

- `400 Bad Request` — a namespace in `readableNamespaces` does not exist, or `readableNamespaces` contains `primaryNamespace`
- `403 Forbidden` with code `FEDERATION_NOT_AVAILABLE` — current tier does not support federation
- `403 Forbidden` with code `FEDERATION_NAMESPACE_LIMIT` — `readableNamespaces` exceeds the tier limit (10 for Pro)

---

## DELETE /federation/:agentId

Delete all federation rules for a specific agent.

### Path Parameters

| Parameter | Type | Description |
|---|---|---|
| `agentId` | string | The agent ID whose rules should be deleted |

### Example Request

```bash
curl -X DELETE http://localhost:3001/federation/agent-007 \
  -H "Authorization: Bearer nc_pat_admin_token"
```

### Response (204 No Content)

No response body. If no rules existed for the agent, this still returns 204.

---

## How Federation Works at Query Time

When an agent with agentId `agent-007` and the rule above performs a search or list:

1. The API looks up the agent's token and extracts `agentId = "agent-007"` and `namespaceClaim = "team-a"`
2. The API queries the federation rules table for `agent-007`
3. The rule `readableNamespaces: ["shared-docs", "product-specs", "company-wiki"]` is found
4. The API queries SurrealDB and Qdrant across all four namespaces: `team-a`, `shared-docs`, `product-specs`, `company-wiki`
5. Results are merged, deduplicated, and returned with the `namespace` field preserved on each memory

The agent receives results from all federated namespaces in a single API response — no additional calls required.

### Write Restrictions

Federation rules only affect read operations (list, get, search, similar). Write operations (create, update, delete memories and relations) are always restricted to the token's `primaryNamespace`. An agent cannot write to a readable namespace unless it has a separate token scoped to that namespace.

### Performance

Federation queries are parallelized internally — all namespaces are queried concurrently. The total response time is approximately equal to the slowest single-namespace query, not the sum of all queries.

---

## Example: Shared Knowledge Base Pattern

A common federation pattern for multi-agent teams:

```
Namespaces:
  team-a         — agent-007's workspace
  team-b         — agent-008's workspace
  shared-docs    — curated knowledge accessible to all agents
  global-facts   — company-wide facts

Federation rules:
  agent-007:
    primaryNamespace: team-a
    readableNamespaces: [shared-docs, global-facts]

  agent-008:
    primaryNamespace: team-b
    readableNamespaces: [shared-docs, global-facts]
```

Result:
- `agent-007` reads from `team-a` + `shared-docs` + `global-facts`
- `agent-008` reads from `team-b` + `shared-docs` + `global-facts`
- Neither agent can read the other's namespace
- Both agents can only write to their own primary namespace
- A human admin creates and updates memories in `shared-docs` and `global-facts`

This pattern enables shared institutional knowledge without sacrificing namespace isolation between agents.
