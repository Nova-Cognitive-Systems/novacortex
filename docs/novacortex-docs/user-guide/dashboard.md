---
title: Dashboard
description: Overview of the NovaCortex web dashboard
---

# Dashboard

The dashboard is the home screen of the NovaCortex web UI. It provides an at-a-glance view of your memory system's health, recent activity, and quick navigation to all major features.

---

## Stats Cards

The top row of the dashboard displays four summary cards that refresh automatically on page load. Click the **Refresh** button (top-right) to update them without reloading the page.

### Total Memories

The count of all memory records across all namespaces you have access to. For agents scoped to a specific namespace, this shows only memories in that namespace.

### Total Relations

The count of all typed edges between memories. This number grows as the Memory Processor discovers semantic relationships and as you manually create relations in the Graph View.

### Total Namespaces

The count of namespaces in the system, including the `default` namespace. The card also shows the limit for your current license tier. If you are approaching the limit, the card displays a warning indicator.

### Processing Jobs

The number of memories currently queued for embedding generation. A non-zero queue means the Memory Processor has pending work. Under normal conditions with embeddings enabled, this queue drains within seconds of new memories being created. A persistently growing queue may indicate that your embedding provider is unavailable or rate-limited.

---

## Health Badge

The health badge appears in the top-right area of the dashboard header and reflects the current state of all backend services.

| Badge | Color | Meaning |
|---|---|---|
| `Healthy` | Green | SurrealDB, Qdrant, and Redis are all connected and responding within normal latency |
| `Degraded` | Yellow | At least one service is responding but with elevated latency, or experiencing intermittent connectivity |
| `Unhealthy` | Red | At least one service is unreachable or returning errors |

### Investigating a degraded or unhealthy state

1. Click the badge to open the **Service Monitor** panel (see below)
2. Identify which service is affected
3. On your server, run: `docker compose logs -f <service>` to view logs
4. Check resource usage: `docker stats`
5. Run the health check script: `./scripts/health-check.sh full`

If SurrealDB is unhealthy, memories cannot be read or written. If Qdrant is unhealthy, vector search and similar-memory lookup are unavailable but basic memory CRUD still works. If Redis is unhealthy, rate limiting and caching are disabled but the API continues to function.

---

## Recent Memories Widget

The Recent Memories widget shows the five most recently created memories across all accessible namespaces, in reverse-chronological order.

Each row displays:
- **Content preview** — first 120 characters of the memory content
- **Type badge** — color-coded: episodic (blue), semantic (purple), procedural (orange), working (gray)
- **Namespace** — the namespace the memory belongs to
- **Created at** — relative timestamp (e.g., "3 minutes ago")
- **Embedding status** — a small indicator: pending (clock icon), completed (check icon), failed (warning icon)

Click any row to open the memory detail view on the Memories page. The detail view shows all metadata, the full content, linked relations, and the raw JSON representation.

---

## Service Monitor

The Service Monitor panel shows the real-time connection state and latency of each backend service.

| Column | Description |
|---|---|
| Service | SurrealDB, Qdrant, or Redis |
| Status | Connected / Disconnected / Degraded |
| Latency | Round-trip time for a test query in milliseconds |
| Last Checked | Timestamp of the most recent health probe |

The API probes each service every 30 seconds and caches the result in Redis (or in-process memory if Redis is unavailable). The dashboard fetches cached health data via `GET /health` on page load and on each manual refresh.

Latency thresholds:
- **Green** — < 10 ms
- **Yellow** — 10–100 ms
- **Red** — > 100 ms or timeout

---

## Quick Actions

The Quick Actions section provides shortcuts to common operations:

| Action | Destination |
|---|---|
| **New Memory** | Opens the Create Memory dialog inline on the dashboard |
| **Explore Graph** | Navigates to the Graph View at `/graph` |
| **Manage Namespaces** | Navigates to Namespaces at `/namespaces` |
| **Settings** | Navigates to Settings at `/settings` |
| **Upload Documents** | Navigates to Knowledge Base at `/knowledge` |
| **Run Processor** | Triggers an immediate processor run via `POST /processor/run` — a confirmation toast appears when queued |

---

## Search Bar

The search bar at the top of the dashboard performs a text-based filter search across memory content and tags. Typing a query and pressing Enter redirects you to:

```
/memories?search=your+query+here
```

On the Memories page, the search term is applied as a case-insensitive substring filter on the `content` field. This is a metadata filter search — not a vector similarity search. For semantic (vector) search, use the Search page at `/search` or the API directly.

---

## Refresh Button

The Refresh button (circular arrow icon, top-right) re-fetches all dashboard data — stats cards, health badge, Service Monitor, and Recent Memories — without performing a full browser page reload. Use it after triggering a processor run or creating new memories to see updated counts immediately.

The dashboard does not auto-refresh on a timer to avoid unnecessary API load in deployments with many concurrent users.
