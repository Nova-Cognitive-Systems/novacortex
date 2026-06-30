---
title: Namespaces
description: Namespace isolation in NovaCortex — creating, managing, and understanding limits
---

# Namespaces

Namespaces are isolation contexts for memories. Memories in different namespaces are completely separated by default — an agent operating in one namespace cannot read, search, or list memories from another namespace unless a federation rule explicitly allows it.

Namespaces are the primary mechanism for multi-tenancy, project isolation, and agent segmentation in NovaCortex.

---

## What Namespaces Are For

Use namespaces to separate:

- **Different projects** — `project-alpha`, `project-beta`, `internal-tools`
- **Different agents** — `agent-007`, `agent-planner`, `agent-coder`
- **Different teams** — `team-engineering`, `team-product`, `team-ops`
- **Different tenants** — in a SaaS product, one namespace per customer
- **Shared knowledge** — `shared-docs`, `company-wiki`, `product-specs` (used in combination with federation rules)

All memories are associated with exactly one namespace. A memory cannot belong to multiple namespaces simultaneously — use relations or federation to link knowledge across namespaces.

---

## The Default Namespace

The `default` namespace is created automatically when NovaCortex first starts. It is present in every installation and cannot be deleted. Memories created without an explicit namespace are assigned to `default`.

The `default` namespace counts against your namespace limit. If you are on the Unregistered tier (1 namespace), `default` is your only namespace.

---

## Creating a Namespace

### Via the UI

Navigate to **Namespaces** → click **New Namespace**.

Enter a namespace name. Names must be:
- Lowercase letters (a–z), numbers (0–9), and hyphens (`-`) only
- At least 2 characters long
- At most 64 characters long
- Unique — no two namespaces can have the same name
- Not equal to any reserved name: `default`, `system`, `admin`

Click **Create**. The namespace is available immediately for memory creation and API calls.

### Via the API

```bash
curl -X POST http://localhost:3001/namespaces \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"name": "project-alpha"}'
```

See [API Reference — Namespaces](../api-reference/namespaces.md) for the full specification.

---

## Namespace Limits by Tier

The number of namespaces you can create is determined by your license tier:

| Tier | Max Namespaces | Notes |
|---|---|---|
| Unregistered | 1 | Only the `default` namespace; additional namespace creation is blocked |
| Free | 3 | Includes `default`; you can create 2 additional namespaces |
| Pro | 10 | Includes `default`; you can create 9 additional namespaces |
| Enterprise | Unlimited | No restriction |

When you attempt to create a namespace that would exceed your limit, the API returns:

```json
HTTP 403 Forbidden
{ "error": "Namespace limit reached for your tier", "code": "NAMESPACE_LIMIT_REACHED" }
```

Existing namespaces and their memories are unaffected by hitting the limit — you simply cannot create new ones until you either delete an existing namespace or upgrade your license.

Your current namespace count and limit are shown on:
- The **Namespaces** page (top summary bar)
- **Settings** → **License** card

---

## Using Namespaces in API Calls

### In the request body

For endpoints that create or list memories, pass `namespace` in the JSON body:

```bash
curl -X POST http://localhost:3001/memories \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"content": "...", "type": "semantic", "namespace": "project-alpha"}'
```

### As a query parameter

For list and search endpoints, pass `namespace` as a query parameter:

```bash
curl "http://localhost:3001/memories?namespace=project-alpha&limit=20" \
  -H "Authorization: Bearer nc_pat_..."
```

### In the URL path

For single-memory endpoints, the namespace is part of the URL path:

```bash
# GET /memories/:namespace/:id
curl http://localhost:3001/memories/project-alpha/memory:abc123 \
  -H "Authorization: Bearer nc_pat_..."
```

### Agent namespace claims

When you create an agent token with a `namespaceClaim`, that token can only operate within the claimed namespace. Attempts to access other namespaces return 403.

```bash
# Creating an agent token with namespace claim
curl -X POST http://localhost:3001/tokens \
  -H "Authorization: Bearer nc_pat_admin_token" \
  -H "Content-Type: application/json" \
  -d '{
    "template": "agent",
    "name": "agent-alpha-key",
    "agentId": "agent-001",
    "namespaceClaim": "project-alpha"
  }'
```

This agent can only read and write memories in the `project-alpha` namespace, regardless of what namespace is passed in the request body.

---

## Deleting a Namespace

Navigate to **Namespaces** → click the **Delete** button on the namespace row.

Namespaces with memories cannot be deleted. Before deleting a namespace, you must delete all memories in it. You can do this by:
1. Going to **Memories**, filtering by namespace, and deleting all memories
2. Using the API to batch-delete: list all memories in the namespace and delete each one

Once the namespace is empty, deletion succeeds.

The `default` namespace is protected and cannot be deleted, even when empty.

---

## Namespace Federation

Pro and Enterprise licenses support federation rules, which allow an agent to transparently read from multiple namespaces using a single namespace-scoped token.

For example, an agent with `primaryNamespace: "team-a"` can be granted `readableNamespaces: ["shared-docs"]`. When that agent searches memories, results from both `team-a` and `shared-docs` are returned, with namespace metadata preserved on each result.

Federation is configured per-agent, not per-namespace. See [Enterprise — Federation](../enterprise/federation.md) and [API Reference — Federation](../api-reference/federation.md) for full details.
