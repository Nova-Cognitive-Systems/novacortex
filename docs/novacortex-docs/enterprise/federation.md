---
title: Federation
description: Cross-namespace memory sharing for multi-agent deployments
---

# Federation

Namespace Federation allows agents to transparently read from multiple namespaces using a single API token scoped to their primary namespace. It is available on Pro and Enterprise licenses.

---

## What Federation Is

In a standard NovaCortex setup, a namespace-scoped agent token can only access memories in its own namespace. Federation lifts this restriction selectively: you define, per agent, which additional namespaces it may read from.

The result is transparent multi-namespace memory retrieval. The agent makes a single API call — `GET /memories`, `POST /search`, or `GET /memories/:ns/:id/similar` — and receives results from all its federated namespaces merged into one response. The agent does not need to know which namespace any given memory came from (though the `namespace` field is always included in each result).

---

## When to Use Federation

Federation solves the problem of shared knowledge in multi-agent systems. Common use cases:

**Shared knowledge base**: A `shared-docs` namespace contains curated product documentation. Multiple agents each have their own namespace but need read access to `shared-docs`. Federation rules grant each agent read access without copying memories into every namespace.

**Company-wide facts**: A `global-facts` namespace holds institutional knowledge (company mission, product values, API contracts). All agents federate this namespace so they share a consistent worldview.

**Project + global knowledge**: An agent working on `project-alpha` needs access to `project-alpha` memories (its own namespace) plus `shared-research` and `global-context` namespaces. A single federation rule provides this.

**Hierarchical knowledge**: Team-level namespaces federate into a department namespace, which federates into a company namespace. Agents retrieve relevant context from multiple levels in one call.

---

## When Not to Use Federation

**Write isolation is not needed**: Federation is read-only. Agents can only write to their primary namespace. If you need an agent to write to multiple namespaces, it needs multiple tokens — one per namespace.

**Single-agent projects**: If you only have one agent and one namespace, federation adds no value.

**You want strict isolation**: If regulatory requirements demand that agent A never sees any data from agent B's namespace, do not create federation rules between them.

---

## Creating Federation Rules via the UI

1. Navigate to **Settings** → **Access Tokens**
2. Find the agent token in the list and click its row to expand it
3. Click the **Federation Rules** tab
4. Click **Add Rule**
5. In the dialog:
   - **Primary Namespace** — auto-filled from the token's `namespaceClaim`
   - **Readable Namespaces** — select from the dropdown of existing namespaces (multi-select)
6. Click **Save**

The rule takes effect immediately. The next API call from that agent includes results from all configured readable namespaces.

To modify a rule, remove it and create a new one (the API replaces the rule on `POST /federation`).

---

## Creating Federation Rules via the API

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

This replaces any existing rule for `agent-007`. See [API Reference — Federation](../api-reference/federation.md) for the full specification.

---

## How Federation Works Internally

When an agent with `agentId: "agent-007"` and `namespaceClaim: "team-a"` makes a request:

1. The API validates the token and extracts `agentId = "agent-007"`
2. The API queries the federation rules table for `agent-007`
3. The rule `readableNamespaces: ["shared-docs", "product-specs"]` is found
4. All queries (memory list, vector search, similarity search) are fanned out in parallel to all four namespaces: `team-a`, `shared-docs`, `product-specs`, `company-wiki`
5. Results are merged and returned with `namespace` preserved per result

The fan-out is parallel — all namespace queries run concurrently. Response time is approximately equal to the slowest single namespace, not the sum.

---

## Limits

| Tier | Max Readable Namespaces per Rule |
|---|---|
| Pro | 10 |
| Enterprise | Unlimited |

An agent's `readableNamespaces` list cannot include its own `primaryNamespace` (that is always included implicitly).

---

## Example: Team Shared Knowledge Pattern

```
Namespaces:
  team-engineering   — engineering agent workspace
  team-product       — product agent workspace
  shared-specs       — product specifications (write by humans only)
  global-context     — company-wide context (write by humans only)

Agents:
  agent-eng:
    token namespaceClaim: team-engineering
    agentId: agent-eng

  agent-product:
    token namespaceClaim: team-product
    agentId: agent-product

Federation rules:
  agent-eng:
    primaryNamespace: team-engineering
    readableNamespaces: [shared-specs, global-context]

  agent-product:
    primaryNamespace: team-product
    readableNamespaces: [shared-specs, global-context]
```

Result:
- `agent-eng` reads from `team-engineering` + `shared-specs` + `global-context`
- `agent-product` reads from `team-product` + `shared-specs` + `global-context`
- Neither agent reads the other team's namespace
- Both agents write only to their own namespace
- Human admins manage content in `shared-specs` and `global-context` using `admin-full` tokens

---

## Deleting Federation Rules

To remove all federation rules for an agent:

```bash
curl -X DELETE http://localhost:3001/federation/agent-007 \
  -H "Authorization: Bearer nc_pat_admin_token"
```

After deletion, the agent reverts to accessing only its primary namespace. No memories or namespaces are affected — only the read access grant is removed.

---

## Security Considerations

Federation grants read access only. Write isolation is maintained unconditionally.

An agent with federation rules for `shared-docs` cannot:
- Create memories in `shared-docs`
- Delete memories in `shared-docs`
- Update memories in `shared-docs`
- List or create tokens
- Manage namespaces

If a readable namespace is deleted, the federation rule silently excludes it from queries. No error is raised. Update the federation rule to remove the deleted namespace for clarity.

Cross-namespace relations are visible if the agent has read access to both endpoint namespaces. Relations where the agent lacks access to one endpoint are excluded from results.
