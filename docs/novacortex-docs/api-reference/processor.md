---
title: API Reference — Processor
description: Processor status, triggering, and schedule configuration endpoints
---

# API Reference — Processor

The Processor API provides endpoints to inspect the Memory Processor's status, trigger immediate runs, and configure the schedule.

---

## ProcessorStats Schema

```json
{
  "stats": {
    "relationsCreated": 14,
    "decayed": 8,
    "consolidated": 0,
    "lastRun": "2026-04-12T08:45:00Z",
    "embeddingQueueDepth": 3
  },
  "config": {
    "mode": "interval",
    "intervalMinutes": 15,
    "scheduledTime": null,
    "onNewMemory": false,
    "similarityThreshold": 0.7,
    "maxRelationsPerMemory": 10,
    "decayEnabled": true,
    "decayFactorMultiplier": 1.0,
    "consolidationEnabled": false,
    "consolidationThreshold": 0.97
  }
}
```

---

## GET /processor

Get the current processor stats and configuration.

### Example Request

```bash
curl http://localhost:3001/processor \
  -H "Authorization: Bearer nc_pat_..."
```

### Example Response (200 OK)

```json
{
  "stats": {
    "relationsCreated": 14,
    "decayed": 8,
    "consolidated": 0,
    "lastRun": "2026-04-12T08:45:00Z",
    "embeddingQueueDepth": 3
  },
  "config": {
    "mode": "interval",
    "intervalMinutes": 15,
    "scheduledTime": null,
    "onNewMemory": false,
    "similarityThreshold": 0.7,
    "maxRelationsPerMemory": 10,
    "decayEnabled": true,
    "decayFactorMultiplier": 1.0,
    "consolidationEnabled": false,
    "consolidationThreshold": 0.97
  }
}
```

| Field | Type | Description |
|---|---|---|
| `stats.relationsCreated` | integer | Relations created in the most recent completed run |
| `stats.decayed` | integer | Memories whose salience was updated in the most recent run |
| `stats.consolidated` | integer | Memories merged in the most recent run (0 if consolidation is disabled) |
| `stats.lastRun` | ISO 8601 | Timestamp of the most recently completed processor run; `null` if the processor has never run |
| `stats.embeddingQueueDepth` | integer | Current count of memories with `embeddingStatus: "pending"` |
| `config.mode` | enum | Current schedule mode: `off`, `interval`, `scheduled`, or `onNewMemory` |
| `config.intervalMinutes` | integer | Interval in minutes (applies when `mode` is `interval`) |
| `config.scheduledTime` | string | UTC time string in `HH:MM` format (applies when `mode` is `scheduled`); null otherwise |
| `config.onNewMemory` | boolean | Whether the processor triggers after each memory write (applies when `mode` is `onNewMemory`) |
| `config.similarityThreshold` | float | Minimum cosine similarity for relation discovery |
| `config.maxRelationsPerMemory` | integer | Maximum outgoing relations the processor creates per memory |
| `config.decayEnabled` | boolean | Whether salience decay is applied |
| `config.decayFactorMultiplier` | float | Global multiplier applied to each memory's decayRate |
| `config.consolidationEnabled` | boolean | Whether near-duplicate consolidation is active |
| `config.consolidationThreshold` | float | Cosine similarity threshold for consolidation |

---

## POST /processor/run

Trigger an immediate one-shot processor run. The run is queued asynchronously — the endpoint returns immediately without waiting for the run to complete.

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `task` | enum | No | Which task to run. Options: `embeddings`, `relations`, `decay`, `consolidation`, `all`. Default: `all`. |

Use specific tasks to run only part of the processor pipeline:

- `embeddings` — generate embeddings for pending memories only (fastest)
- `relations` — discover relations only (requires embeddings to exist)
- `decay` — apply salience decay only
- `consolidation` — merge near-duplicates only (experimental)
- `all` — run all tasks in order (default)

### Example Requests

```bash
# Run all tasks
curl -X POST http://localhost:3001/processor/run \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"task": "all"}'

# Run embeddings only (fast, to unblock search ASAP)
curl -X POST http://localhost:3001/processor/run \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"task": "embeddings"}'
```

### Response (200 OK)

```json
{ "queued": true }
```

To monitor completion, poll `GET /processor` and watch for the `stats.lastRun` timestamp to update.

---

## GET /processor/schedule

Get the current processor schedule configuration.

### Example Request

```bash
curl http://localhost:3001/processor/schedule \
  -H "Authorization: Bearer nc_pat_..."
```

### Example Response (200 OK)

```json
{
  "mode": "interval",
  "intervalMinutes": 15,
  "scheduledTime": null,
  "onNewMemory": false
}
```

---

## PUT /processor/schedule

Update the processor schedule configuration. All fields are optional — only provided fields are updated.

### Request Body

| Field | Type | Description |
|---|---|---|
| `mode` | enum | Schedule mode: `off`, `interval`, `scheduled`, or `onNewMemory` |
| `intervalMinutes` | integer | Minutes between runs (minimum: 5). Used when `mode` is `interval`. |
| `scheduledTime` | string | UTC time in `HH:MM` format for once-daily runs (e.g., `"02:30"`). Used when `mode` is `scheduled`. |
| `onNewMemory` | boolean | Trigger after each memory write. Used when `mode` is `onNewMemory`. |
| `similarityThreshold` | float | Cosine similarity threshold for relation discovery (0–1) |
| `maxRelationsPerMemory` | integer | Maximum relations created per memory per run (1–100) |
| `decayEnabled` | boolean | Enable or disable salience decay |
| `decayFactorMultiplier` | float | Global decay rate multiplier (0.1–10.0) |
| `consolidationEnabled` | boolean | Enable or disable memory consolidation (experimental) |
| `consolidationThreshold` | float | Cosine similarity threshold for consolidation (0.9–1.0) |

### Example Request — Switch to Interval Mode

```bash
curl -X PUT http://localhost:3001/processor/schedule \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "interval",
    "intervalMinutes": 30,
    "similarityThreshold": 0.75
  }'
```

### Example Request — Enable Scheduled Mode

```bash
curl -X PUT http://localhost:3001/processor/schedule \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "scheduled",
    "scheduledTime": "02:30"
  }'
```

### Example Request — Disable Processor

```bash
curl -X PUT http://localhost:3001/processor/schedule \
  -H "Authorization: Bearer nc_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"mode": "off"}'
```

### Response (200 OK)

Returns the updated schedule configuration object in the same format as `GET /processor/schedule`.

### Error Responses

- `400 Bad Request` — `intervalMinutes` is less than 5, `scheduledTime` is not in `HH:MM` format, or `mode` is an unrecognized value
