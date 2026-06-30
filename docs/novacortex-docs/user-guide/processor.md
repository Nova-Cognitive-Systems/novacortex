---
title: Memory Processor
description: Configuring and monitoring the NovaCortex background Memory Processor
---

# Memory Processor

The Memory Processor is NovaCortex's background intelligence service. It runs periodically or on-demand to keep the memory graph consistent, well-connected, and relevant. Without the processor, memories are stored and retrievable, but no automatic relations are created, no decay is applied, and no consolidation occurs.

Navigate to **Processor** in the sidebar to view status, configure trigger modes, and run the processor manually.

---

## What the Processor Does

Each processor run performs four distinct tasks in order:

### 1. Embedding Generation

The processor scans SurrealDB for all memories with `embeddingStatus: "pending"` or `embeddingStatus: "failed"`. For each one, it:
1. Calls the configured embedding model (e.g., OpenAI `text-embedding-3-small`) with the memory's content
2. Receives a vector of floats (1536 dimensions for the default model)
3. Upserts the vector into Qdrant with the memory ID as the point ID
4. Updates `embeddingStatus` to `"completed"` in SurrealDB

This is the highest-priority task. Embeddings must exist before relations can be discovered.

### 2. Relation Discovery

After all pending embeddings are generated, the processor queries Qdrant for memory pairs with cosine similarity above the configured threshold (default: 0.7). For each pair:
1. Checks if a relation already exists between the two memories
2. If not, creates a `related_to` relation with `strength` equal to the cosine similarity score
3. Stores the relation in SurrealDB with metadata marking it as processor-generated

The processor only creates `related_to` relations automatically. More specific relation types (`causes`, `supports`, etc.) must be created manually in the Graph View or via the API.

Higher similarity thresholds produce fewer, higher-quality relations. Lower thresholds produce more connections but with more noise. The default of 0.7 is a reasonable starting point for most use cases.

### 3. Salience Decay

The processor applies decay to memories that have a non-zero `decayRate`. For each such memory:

```
new_salience = current_salience * (1 - decayRate)
```

Working memories (typical `decayRate`: 0.5–1.0) lose salience rapidly. A working memory with `decayRate: 0.8` and initial salience 1.0 will have salience 0.2 after one processor run and 0.04 after two runs. These memories effectively become invisible in filtered searches once salience falls below the `minSalience` query parameter.

Memories with `decayRate: 0` never decay. Semantic and procedural memories typically use values of 0.01–0.05 to model very slow forgetting.

### 4. Memory Consolidation (Experimental)

Consolidation is an experimental feature that merges near-duplicate memories. When enabled, the processor identifies pairs of memories where:
- Cosine similarity > 0.97 (very high threshold)
- Same `type`
- Same `namespace`

For qualifying pairs, the processor:
1. Selects the memory with higher salience as the canonical version
2. Copies all relations from the superseded memory to the canonical one
3. Deletes the superseded memory
4. Tags the canonical memory with `consolidated:true`

**Warning**: consolidation irreversibly deletes memories. Enable it only if you are comfortable with potential data loss and have recent backups. It is most appropriate for archival use cases where memory deduplication outweighs the risk of losing nuance.

---

## Status Cards

The Processor page shows five status cards that reflect the results of the most recent completed run:

| Card | Description |
|---|---|
| **Relations Created** | Number of `related_to` relations created in the last run |
| **Memories Decayed** | Number of memories whose salience was updated in the last run |
| **Memories Consolidated** | Number of memories merged in the last run (0 if consolidation is disabled) |
| **Last Run** | Timestamp of the most recent completed processor run |
| **Embedding Queue** | Current number of memories with `embeddingStatus: "pending"` |

The embedding queue depth is the most operationally important metric. If it grows continuously without draining, check that your embedding provider API key is valid and that the provider is not rate-limiting you.

---

## Trigger Modes

The processor can be configured to run in four modes. Select the mode in the **Trigger Configuration** section of the Processor page.

### Off

The processor does not run automatically. You can still trigger it manually with **Run Now**. Use this mode when you want full control over when processing occurs (e.g., off-hours batches only).

### Interval

The processor runs every N minutes. The minimum interval is 5 minutes. Recommended for most installations: every 15–60 minutes.

```
Minimum: 5 minutes
Recommended: 15 minutes (balanced)
High-throughput: 5 minutes (aggressive, higher API cost)
```

### Scheduled Time

The processor runs once per day at a specified UTC time. Use `HH:MM` format (e.g., `02:30` for 2:30 AM UTC). Suitable for low-memory-volume installations where daily processing is sufficient.

### On New Memory

The processor is triggered automatically after each memory write (create or update). This provides the fastest embedding generation and relation discovery but creates the highest load on your embedding provider. Not recommended for high-throughput write workloads.

---

## Running the Processor Manually

Click **Run Now** to trigger an immediate one-shot processor run. The button changes to **Running...** while the run is in progress. When complete, the status cards update with the results.

You can also trigger a run via the API:

```bash
curl -X POST http://localhost:3001/processor/run \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"task": "all"}'
```

Response:

```json
{ "queued": true }
```

---

## Relation Discovery Configuration

In the **Relation Discovery** section:

| Setting | Default | Description |
|---|---|---|
| **Similarity Threshold** | 0.7 | Minimum cosine similarity (0–1) for the processor to create a `related_to` relation. |
| **Max Relations per Memory** | 10 | Maximum number of outgoing `related_to` relations the processor will create for a single memory. Prevents any one memory from becoming an over-connected hub. |

---

## Decay Configuration

In the **Decay** section:

| Setting | Default | Description |
|---|---|---|
| **Enable Decay** | On | Master switch for salience decay. When disabled, no memory salience scores are changed by the processor. |
| **Decay Factor Multiplier** | 1.0 | Global multiplier applied to each memory's `decayRate`. Setting this to 2.0 doubles all decay rates without editing individual memories. Setting it to 0 effectively disables decay without changing the toggle. |

---

## Consolidation Configuration

In the **Consolidation** section:

| Setting | Default | Description |
|---|---|---|
| **Enable Consolidation** | Off | Master switch for memory consolidation. Off by default due to the irreversible nature of merging. |
| **Similarity Threshold** | 0.97 | Cosine similarity above which two memories are considered near-duplicates eligible for merging. |

---

## Embedding Progress

The **Embedding Progress** bar below the status cards shows:
- Queue depth (number of memories awaiting embedding)
- Estimated time to completion (based on rolling average of the last 100 embeddings processed)

The estimate is approximate and does not account for rate limiting or network variability.

---

## Processor Logs

The processor writes structured log entries for each run. To view them:

```bash
docker compose logs api | grep '"source":"processor"'
```

Each log entry includes the task type, duration, result counts, and any errors encountered during the run.
