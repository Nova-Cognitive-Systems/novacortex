---
title: SDK — Python
description: Complete Python SDK reference for NovaCortex
---

# Python SDK

The `novacortex-sdk` package provides a fully-typed, synchronous and asynchronous Python client for the NovaCortex API.

---

## Installation

```bash
pip install novacortex-sdk
```

**Requirements**: Python 3.9 or later. The SDK depends on `httpx` (HTTP client) and `pydantic` (type validation).

```bash
# Install with optional extras
pip install novacortex-sdk[async]   # Includes async client dependencies
pip install novacortex-sdk[dev]     # Includes type stubs and testing utilities
```

---

## Quick Start

```python
from novacortex import NovaCortexClient

client = NovaCortexClient(
    base_url="https://memory.example.com",
    api_key="nc_pat_your_token_here"
)

# Create a memory
memory = client.memories.create(
    content="NovaCortex uses HNSW indexing for sub-millisecond vector search",
    type="semantic",
    namespace="default",
    tags=["architecture", "performance"],
    confidence=0.98
)
print(memory.id)  # memory:01j9xkm2v3p8q4r5s6t7u8v9
```

---

## Client Initialization

### Synchronous Client

```python
from novacortex import NovaCortexClient

client = NovaCortexClient(
    base_url="https://memory.example.com",  # Required
    api_key="nc_pat_...",                   # Required
    timeout=30.0,                           # Optional: request timeout in seconds (default: 30)
    max_retries=3,                          # Optional: retry attempts on 429 (default: 3)
)
```

### Asynchronous Client

```python
from novacortex import AsyncNovaCortexClient

# As an async context manager (recommended)
async with AsyncNovaCortexClient(
    base_url="https://memory.example.com",
    api_key="nc_pat_..."
) as client:
    memory = await client.memories.create(
        content="Async memory creation",
        type="semantic"
    )
```

---

## Memories

### Create

```python
memory = client.memories.create(
    content="The user prefers concise, technical responses",  # Required
    type="semantic",                                          # Required: episodic|semantic|procedural|working
    namespace="user-prefs",                                   # Optional, default: "default"
    tags=["preference", "communication"],                     # Optional
    entities=["User"],                                        # Optional
    signals=[0.9, 0.3],                                       # Optional
    confidence=0.92,                                          # Optional: 0.0–1.0, default: 1.0
    salience=0.85,                                            # Optional: 0.0–1.0, default: 1.0
    decay_rate=0.05,                                          # Optional: 0.0–1.0, default: 0.1
)
```

**Returns**: `Memory` object with all fields populated.

### Get

```python
memory = client.memories.get(
    namespace="user-prefs",
    id="memory:abc123def456",
    include_relations=True  # Optional, default: False
)
print(memory.content)
print(memory.embedding_status)  # "pending" | "completed" | "failed"
```

### Update

```python
updated = client.memories.update(
    namespace="user-prefs",
    id="memory:abc123def456",
    salience=0.5,           # Optional — any metadata field can be updated
    tags=["preference"],    # Optional — replaces the existing tags array
    decay_rate=0.1          # Optional
    # Note: content is immutable and cannot be updated
)
```

### Delete

```python
client.memories.delete(
    namespace="user-prefs",
    id="memory:abc123def456"
)
# Returns None on success; raises NotFoundError if not found
```

### List

```python
result = client.memories.list(
    namespace="user-prefs",                # Optional: filter by namespace
    memory_types=["semantic", "episodic"], # Optional: filter by type(s)
    tags=["preference"],                   # Optional: filter by tag(s)
    min_salience=0.5,                      # Optional: exclude low-salience memories
    limit=20,                              # Optional, default: 20
    offset=0,                              # Optional, default: 0
    search="concise",                      # Optional: text search in content
)
print(result.total)    # Total matching count
print(result.memories) # List[Memory]
```

### Find Similar

```python
similar = client.memories.similar(
    namespace="user-prefs",
    id="memory:abc123def456",
    limit=5,                        # Optional, default: 10
    target_namespace="other-ns",    # Optional: search in a different namespace
    score_threshold=0.75            # Optional, default: 0.7
)
for item in similar.results:
    print(f"{item.score:.2f} — {item.memory.content[:80]}")
```

---

## Search

```python
# You must provide a precomputed embedding vector
import openai

openai_client = openai.OpenAI(api_key="sk-...")
response = openai_client.embeddings.create(
    model="text-embedding-3-small",
    input="how should the system respond to ambiguous queries"
)
vector = response.data[0].embedding

results = client.search(
    vector=vector,                          # Required: float list, must match QDRANT_VECTOR_SIZE
    namespace="user-prefs",                 # Optional: restrict to namespace
    memory_types=["semantic"],              # Optional
    tags=["preference"],                    # Optional
    limit=5,                               # Optional, default: 10
    score_threshold=0.75,                  # Optional, default: 0.7
)

for item in results.results:
    print(f"Score: {item.score:.3f}")
    print(f"Content: {item.memory.content}")
    print()
```

**Returns**: `SearchResult` with `results: List[SearchResultItem]`, `total: int`, `took_ms: int`.

---

## Relations

### Create

```python
relation = client.relations.create(
    from_memory_id="memory:abc123",   # Required
    from_namespace="user-prefs",      # Required
    to_memory_id="memory:def456",     # Required
    to_namespace="user-prefs",        # Required
    relation_type="supports",         # Required: one of 9 typed values
    strength=0.85,                    # Optional: 0.0–1.0, default: 0.7
    bidirectional=False,              # Optional, default: False
    metadata={"source": "agent"}      # Optional: arbitrary dict
)
print(relation.id)
```

### List for a Memory

```python
relations = client.relations.list(
    namespace="user-prefs",
    memory_id="memory:abc123"
)
print(relations.outgoing)  # List[Relation]
print(relations.incoming)  # List[Relation]
```

### Delete

```python
client.relations.delete(id="relation:xyz789")
```

---

## Namespaces

```python
# List all namespaces
result = client.namespaces.list()
print(result.namespaces)  # List[Namespace]
print(result.tier)        # "free" | "pro" | "enterprise" | "unregistered"
print(result.remaining)   # How many more namespaces can be created

# Create a namespace
ns = client.namespaces.create("project-alpha")
print(ns.name)  # "project-alpha"

# Delete a namespace (must be empty)
client.namespaces.delete("old-project")
```

---

## Export and Import

```python
# Export as JSON (no embeddings)
export_data = client.export.as_json(
    namespace="user-prefs",
    embeddings=False  # Optional, default: False
)
# export_data is a dict — save it to a file
import json
with open("user-prefs-export.json", "w") as f:
    json.dump(export_data, f)

# Export as PMF
pmf_data = client.export.as_pmf(
    namespace="user-prefs",
    embeddings=True,
    node_id="prod-node-1",
    exported_by="admin"
)
with open("user-prefs-export.pmf.json", "w") as f:
    json.dump(pmf_data, f)

# Import from JSON
with open("user-prefs-export.json") as f:
    data = json.load(f)
result = client.import_data.from_json(data)
print(f"Imported: {result.imported}, Skipped: {result.skipped}, Failed: {result.failed}")
if result.errors:
    for err in result.errors:
        print(f"  Error: {err}")

# Import from PMF
with open("user-prefs-export.pmf.json") as f:
    pmf_data = json.load(f)
result = client.import_data.from_pmf(pmf_data)
print(f"Imported: {result.imported}, Merkle verified: {result.merkle_verified}")
```

---

## Knowledge Buckets

```python
# Create a bucket
bucket = client.buckets.create(
    name="product-docs",
    namespace="knowledge",
    description="Product documentation",
    agents=["agent-007"],
    create_memories_by_default=True
)

# Upload a document
doc = client.buckets.upload(
    bucket_id=bucket.id,
    file_path="./manual.pdf",          # Path to the file
    create_memories=True                # Optional: override bucket default
)
print(doc.status)  # "processing"

# List documents
docs = client.buckets.list_documents(
    bucket_id=bucket.id,
    status="ready"    # Optional filter
)
for d in docs.documents:
    print(f"{d.name}: {d.chunk_count} chunks, {d.linked_memory_count} memories")

# Get document detail with chunks
detail = client.buckets.get_document(doc.id)
print(detail.chunks[0])  # First chunk text
print(detail.linked_memory_ids)  # List[str]

# Delete document (keep memories)
client.buckets.delete_document(doc.id)

# Delete document and linked memories
client.buckets.delete_document(doc.id, delete_memories=True)
```

---

## Processor

```python
# Get processor status
status = client.processor.get_status()
print(status.stats.embedding_queue_depth)
print(status.stats.last_run)

# Trigger a run
client.processor.run(task="all")  # all|embeddings|relations|decay|consolidation

# Update schedule
client.processor.update_schedule(
    mode="interval",
    interval_minutes=15,
    similarity_threshold=0.75
)
```

---

## Async Client — Full Example

```python
from novacortex import AsyncNovaCortexClient
import asyncio

async def store_memories_concurrently():
    async with AsyncNovaCortexClient(
        base_url="https://memory.example.com",
        api_key="nc_pat_..."
    ) as client:
        # Create multiple memories concurrently
        tasks = [
            client.memories.create(
                content=f"Memory {i}: concurrent creation test",
                type="episodic",
                namespace="test"
            )
            for i in range(10)
        ]
        memories = await asyncio.gather(*tasks)
        print(f"Created {len(memories)} memories")

        # Search
        vector = [0.01] * 1536  # Placeholder vector
        results = await client.search(vector=vector, namespace="test", limit=5)
        print(f"Found {results.total} results")

asyncio.run(store_memories_concurrently())
```

---

## Error Handling

```python
from novacortex import NovaCortexClient
from novacortex.exceptions import (
    NovaCortexError,
    AuthError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    RateLimitError,
    ValidationError,
    ServerError,
)

client = NovaCortexClient(base_url="...", api_key="...")

try:
    memory = client.memories.get(namespace="default", id="memory:nonexistent")

except NotFoundError:
    print("Memory does not exist")

except AuthError as e:
    print(f"Authentication failed: {e.message}")
    # Regenerate your token

except ForbiddenError as e:
    if e.code == "NAMESPACE_LIMIT_REACHED":
        print("Upgrade your license to create more namespaces")
    else:
        print(f"Access denied: {e.message}")

except RateLimitError as e:
    print(f"Rate limited. Retry after {e.retry_after} seconds")
    # The SDK retries automatically up to max_retries times before raising this

except ValidationError as e:
    print(f"Invalid request: {e.message}")
    print(f"Error code: {e.code}")

except ServerError as e:
    print(f"Server error: {e.message} (status {e.status_code})")

except NovaCortexError as e:
    # Catch-all for any other NovaCortex API error
    print(f"API error {e.status_code}: {e.message} ({e.code})")
```

---

## Complete Method Reference

### `client.memories`

| Method | Parameters | Returns |
|---|---|---|
| `create(**kwargs)` | content, type, namespace, tags, entities, signals, confidence, salience, decay_rate | `Memory` |
| `get(namespace, id, include_relations)` | — | `Memory` |
| `update(namespace, id, **kwargs)` | type, namespace, tags, entities, signals, confidence, salience, decay_rate | `Memory` |
| `delete(namespace, id)` | — | `None` |
| `list(**kwargs)` | namespace, memory_types, tags, min_salience, limit, offset, search | `MemoryList` |
| `similar(namespace, id, **kwargs)` | limit, target_namespace, score_threshold | `SearchResult` |

### `client.relations`

| Method | Parameters | Returns |
|---|---|---|
| `create(**kwargs)` | from_memory_id, from_namespace, to_memory_id, to_namespace, relation_type, strength, bidirectional, metadata | `Relation` |
| `list(namespace, memory_id)` | — | `RelationList` |
| `delete(id)` | — | `None` |

### `client.namespaces`

| Method | Parameters | Returns |
|---|---|---|
| `list()` | — | `NamespaceList` |
| `create(name)` | — | `Namespace` |
| `delete(name)` | — | `None` |

### `client.buckets`

| Method | Parameters | Returns |
|---|---|---|
| `create(**kwargs)` | name, namespace, description, agents, create_memories_by_default | `Bucket` |
| `list()` | — | `BucketList` |
| `delete(bucket_id)` | — | `None` |
| `upload(bucket_id, file_path, create_memories)` | — | `Document` |
| `list_documents(bucket_id, status, limit, offset)` | — | `DocumentList` |
| `get_document(doc_id)` | — | `DocumentDetail` |
| `delete_document(doc_id, delete_memories)` | — | `None` |

### `client.export`

| Method | Parameters | Returns |
|---|---|---|
| `as_json(namespace, embeddings)` | — | `dict` |
| `as_pmf(namespace, embeddings, node_id, exported_by)` | — | `dict` |

### `client.import_data`

| Method | Parameters | Returns |
|---|---|---|
| `from_json(data)` | `dict` | `ImportResult` |
| `from_pmf(data)` | `dict` | `ImportResult` |

### `client.processor`

| Method | Parameters | Returns |
|---|---|---|
| `get_status()` | — | `ProcessorStatus` |
| `run(task)` | `"all"` \| `"embeddings"` \| `"relations"` \| `"decay"` \| `"consolidation"` | `None` |
| `get_schedule()` | — | `ProcessorSchedule` |
| `update_schedule(**kwargs)` | mode, interval_minutes, scheduled_time, similarity_threshold, ... | `ProcessorSchedule` |

### `client.search`

| Method | Parameters | Returns |
|---|---|---|
| `search(vector, **kwargs)` | vector, namespace, memory_types, tags, limit, score_threshold | `SearchResult` |
