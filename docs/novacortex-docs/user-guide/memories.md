---
title: Memories
description: Creating, browsing, editing, and deleting memories in NovaCortex
---

# Memories

Memories are the fundamental unit of NovaCortex. Every piece of knowledge, event, or process that you want an agent to recall must exist as a memory record.

---

## Memory Types

NovaCortex supports four distinct memory types. Choosing the correct type affects how the Memory Processor applies decay, how the processor prioritizes consolidation, and how downstream agents should interpret the content.

### `episodic`

Episodic memories represent discrete events anchored in time — things that happened. They are the AI equivalent of autobiographical memory.

**Use for**: user interactions, observed events, conversation turns, audit trail entries.

**Examples**:
- "The user asked about deployment options on 2026-04-12 at 14:32 UTC"
- "Agent-007 called the /search endpoint with query 'vector indexing' at 09:00 UTC"
- "An error occurred in the payment processing pipeline at 2026-04-11 03:17 UTC"

Episodic memories are subject to salience decay over time. Working memories (see below) decay much faster, but episodic memories also lose salience gradually unless their decay rate is set to 0.

### `semantic`

Semantic memories represent general knowledge, facts, and concepts — things that are true, independent of when they were observed.

**Use for**: factual knowledge, product documentation, configuration facts, domain concepts.

**Examples**:
- "NovaCortex uses HNSW indexing for sub-millisecond vector search"
- "The production database runs SurrealDB 1.5 with the `novacortex` namespace"
- "Python 3.9 or later is required to use the NovaCortex SDK"

Semantic memories typically have a low decay rate (0.01–0.05) since facts remain relevant indefinitely or until superseded.

### `procedural`

Procedural memories encode how to do something — workflows, runbooks, step-by-step processes.

**Use for**: deployment procedures, troubleshooting guides, repeatable workflows, API usage patterns.

**Examples**:
- "To deploy to production: run `./scripts/deploy.sh deploy` → verify health endpoints → monitor logs for 10 minutes"
- "To rotate the JWT secret: update JWT_SECRET in .env → restart the API container → regenerate all agent tokens"

Procedural memories often reference other memories or documents. Use the `references` relation type to link a procedural memory to the semantic memories it draws from.

### `working`

Working memories are ephemeral, in-context scratchpad entries. They are designed to hold information that is relevant only during the current task or session.

**Use for**: intermediate reasoning steps, temporary calculations, in-progress task state, session context.

**Examples**:
- "Current task: the user wants to export the `ops` namespace as PMF"
- "Draft response: acknowledged the user's question about rate limits"

Working memories have a high decay rate by default (0.5–1.0) and are aggressively decayed by the Memory Processor. After a few processor cycles, their salience drops below the retrieval threshold and they effectively disappear from search results without being explicitly deleted.

---

## Creating a Memory

### Via the UI

Navigate to **Memories** → click **New Memory**. The creation form contains the following fields:

| Field | Type | Required | Description |
|---|---|---|---|
| **Content** | Text area | Yes | The full text of the memory. There is no hard length limit, but shorter, focused memories produce better vector embeddings and more precise search results. |
| **Type** | Select | Yes | One of `episodic`, `semantic`, `procedural`, `working`. |
| **Namespace** | Select | No | Defaults to `default`. Select the namespace this memory should belong to. |
| **Tags** | Tag input | No | Comma-separated labels for filtering. Example: `deployment`, `infrastructure`, `2026`. |
| **Entities** | Tag input | No | Named entities extracted from the content. Example: `SurrealDB`, `Qdrant`, `NovaCortex`. |
| **Signals** | Number list | No | An array of numeric signals associated with the memory. Use for custom relevance scoring. |
| **Confidence** | Slider (0–1) | No | How certain you are that the content is accurate. Default: 1.0. |
| **Salience** | Slider (0–1) | No | How important this memory is right now. Default: 1.0. High-salience memories appear higher in filtered results. |
| **Decay Rate** | Slider (0–1) | No | How quickly salience decreases per processor cycle. Default: 0.1. Use 0 for permanent memories, 0.8–1.0 for very short-lived working memories. |

Click **Save** to create the memory. The system creates the record in SurrealDB and queues an embedding generation job. The **Embedding** badge in the detail view will update from `pending` to `completed` once Qdrant stores the vector.

### Via the API

See [API Reference — Memories](../api-reference/memories.md) for the full `POST /memories` specification with curl examples.

---

## Browsing Memories

Navigate to **Memories** to see the full paginated list of memories you have access to.

### Filters

The filter bar at the top of the list supports the following dimensions:

| Filter | Options |
|---|---|
| **Namespace** | Select from available namespaces (defaults to all) |
| **Type** | episodic, semantic, procedural, working (multi-select) |
| **Tags** | Type a tag name — memories with that tag are shown |
| **Min Salience** | Slider — hides memories below the chosen salience score |
| **Search** | Text search — substring match on content |

Filters are combined with AND logic. For example, selecting type `semantic` and tag `deployment` returns only semantic memories that also have the `deployment` tag.

### Sorting

The list can be sorted by:
- **Created At** (default, descending)
- **Salience** (descending)
- **Updated At** (descending)

### Pagination

The list uses cursor-based pagination with a default page size of 20. Use the **Load More** button or the `limit` and `offset` query parameters in the API.

---

## Memory Detail View

Click any memory in the list to open its detail view. The detail view shows:

- **Full content** — the complete memory text without truncation
- **All metadata** — type, namespace, tags, entities, signals, confidence, salience, decay rate
- **Embedding status** — one of:
  - `pending` — embedding job is queued but not yet processed
  - `completed` — vector embedding is stored in Qdrant and the memory is searchable
  - `failed` — embedding generation failed (check that your AI provider key is valid and the embedding queue is not blocked)
- **Relations list** — all incoming and outgoing relations, showing the related memory's content preview, relation type, strength score, and direction
- **Raw JSON** — toggle to see the complete memory record as returned by the API

---

## Editing a Memory

Click the **Edit** button (pencil icon) in the memory detail view or in the list row.

All fields except **content** are editable after creation. Content is immutable because changing it would invalidate the stored embedding. To correct the content of a memory, delete it and create a new one.

Fields you can update via PATCH:
- type
- namespace (moves the memory to a different namespace)
- tags
- entities
- signals
- confidence
- salience
- decayRate

Changes are applied immediately. The memory's `updatedAt` timestamp is updated. Changing namespace does not re-generate the embedding but does move the memory out of its original namespace's vector search results.

---

## Deleting a Memory

Click the **Delete** button (trash icon) in the memory detail view.

A confirmation dialog appears showing:
- The memory's content preview
- The number of relations that will also be deleted

Click **Confirm Delete** to proceed. Deletion is permanent and cascades to all relations involving this memory. The corresponding Qdrant vector point is deleted asynchronously by the next processor run.

Bulk deletion is available via the API by filtering and then calling `DELETE /memories/:namespace/:id` for each result. There is no single-call bulk delete endpoint in v1.0 — this is planned for v1.2.

---

## Embedding Status Details

The embedding lifecycle for a memory is:

1. **Created** — memory is stored in SurrealDB with `embeddingStatus: "pending"`
2. **Queued** — processor picks up the embedding job from the queue
3. **Generated** — the API calls the configured embedding model (e.g., OpenAI `text-embedding-3-small`) with the memory's content
4. **Stored** — the vector is upserted into Qdrant with the memory ID as its point ID
5. **Completed** — `embeddingStatus` is updated to `"completed"` in SurrealDB

If the embedding model call fails (e.g., invalid API key, rate limit, network error), the status is set to `"failed"`. Failed embeddings can be retried by triggering a processor run via `POST /processor/run` — the processor re-queues all memories with `"failed"` status.
