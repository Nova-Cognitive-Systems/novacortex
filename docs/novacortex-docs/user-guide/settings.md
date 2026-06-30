---
title: Settings
description: Configuration, export, import, and system statistics in the NovaCortex Settings page
---

# Settings

The Settings page (`/settings`) is the central management hub for your NovaCortex installation. It contains panels for license management, API token administration, API configuration, export/import, and system statistics.

---

## License Card

The License card shows the current tier and its limits at a glance.

| Field | Description |
|---|---|
| **Tier** | One of: Unregistered, Free, Pro, Enterprise |
| **Namespaces** | `used / limit` — e.g., "3 / 10" for a Pro installation with 3 namespaces |
| **Federation** | Enabled (Pro/Enterprise) or Disabled (Free/Unregistered) |
| **Custom API URL** | Enabled (Enterprise only) or Disabled |

### Activating a License

To activate a Pro or Enterprise license:

1. Enter your `LICENSE_KEY` in the input field
2. Click **Activate**
3. The API validates the key immediately (no network call — validation is cryptographic)
4. If valid, the tier updates and the page reflects the new limits
5. Alternatively, set the `LICENSE_KEY` environment variable in `.env` and restart the API container — the key is read on startup and cached for 24 hours

If you enter an invalid key, the card shows an error: `Invalid license key — please check and try again`. If your key has expired, the tier reverts to Unregistered until you provide a renewed key.

---

## Access Tokens Panel

The Access Tokens panel is the full token management interface. For complete documentation on creating, viewing, and revoking tokens, see [User Guide — Agents and Keys](./agents-and-keys.md).

Quick reference:
- **New Token** button → opens the token creation dialog
- **Token list** → shows all active tokens with name, template, prefix, agent ID, namespace, created date, last used
- **Revoke** (cross icon) → immediately revokes the token — irreversible
- **Federation Rules** tab (on each agent token row) → configure cross-namespace read access for Pro/Enterprise (see [Enterprise — Federation](../enterprise/federation.md))

---

## API Configuration

The API Configuration panel allows you to view and update the API base URL used by the web application.

| Field | Description |
|---|---|
| **Current API URL** | The URL the web UI is currently using for all API calls |
| **Base URL input** | Field to enter a new API URL (Enterprise only for custom URL) |
| **Save & Reload** button | Saves the URL to localStorage and triggers a page reload to apply it |
| **Reset to Default** button | Clears the custom URL from localStorage and reverts to the build-time default |

**Who can change the API URL**: On Free and Pro tiers, the API URL is fixed to the `NEXT_PUBLIC_API_URL` build-time value and the input field is read-only. On Enterprise, the field is editable.

**Effect of changing the URL**: The custom URL is stored in the browser's localStorage. It affects only the current browser session on the current device. Other users and other browsers continue to use the build-time default. This is by design — it supports Enterprise scenarios where different operators route to different API endpoints.

For the full guide on custom API URL use cases, see [Enterprise — Custom API URL](../enterprise/custom-api-url.md).

---

## Export

The Export panel allows you to download a complete snapshot of any namespace's memories.

### Export Steps

1. **Select namespace** — choose from the dropdown of all accessible namespaces
2. **Format** — select the export format:
   - **JSON** — standard JSON array of memory objects; easily parsed by any language
   - **PMF** — Portable Memory Format; includes graph topology, integrity verification, and optional embeddings; recommended for cross-system migration and archival
3. **Include embeddings** — toggle to include the raw float vectors in the export file. Adds approximately 4 KB per memory (1536 floats × 4 bytes each). Enable when you need to restore the index without re-generating embeddings. Disable when you only need the text data.
4. Click **Export** — the browser begins downloading the file immediately

Export files are generated synchronously for namespaces with up to 10,000 memories. For larger namespaces, the API streams the response. Very large exports (>100,000 memories) may time out in the browser — use the API directly for those:

```bash
curl -o export.json \
  "http://localhost:3001/memories/export/my-namespace?embeddings=false" \
  -H "Authorization: Bearer nc_pat_..."
```

### Export File Naming

Files are named automatically:
- JSON: `novacortex-export-<namespace>-<YYYY-MM-DD>.json`
- PMF: `novacortex-export-<namespace>-<YYYY-MM-DD>.pmf.json`

---

## Import

The Import panel allows you to load memories from a previously exported file.

### Import Steps

1. Click **Choose File** or drag a file onto the import zone
2. Accepted formats: `.json` and `.pmf.json`
3. The format is auto-detected based on the file extension and the presence of the `"format": "NCPMF"` field
4. Click **Import**

### Import Behavior

Before writing any records, the importer:
1. Validates the file format and version
2. Verifies the Merkle root and checksum (PMF only) — if verification fails, the import is aborted
3. Checks for duplicate memory IDs — memories whose IDs already exist in the database are skipped (not overwritten)
4. Creates new memories for all non-duplicate records
5. Recreates relations — only for relations where both endpoint memory IDs now exist in the database

### Import Result

After import, a result summary appears:

```
Import complete
  Imported:  142 memories
  Skipped:   8 (already exist)
  Failed:    3

Errors:
  - memory:m_005: unknown type "knowledge" (must be episodic, semantic, procedural, or working)
  - memory:m_018: content is empty
  - relation:r_201: from memory ID does not exist
```

The result is also available in the browser console as a JSON object for programmatic review.

---

## System Statistics Card

The System Statistics card shows live metrics for the NovaCortex installation:

| Metric | Description |
|---|---|
| **Total Memories** | Count of all memory records in SurrealDB across all namespaces |
| **Total Relations** | Count of all typed relation edges in SurrealDB |
| **Total Namespaces** | Count of all namespaces (including `default`) |
| **Qdrant Vector Count** | Number of vector points stored in the Qdrant collection — should equal the number of memories with `embeddingStatus: "completed"` |
| **Redis Memory Usage** | Current memory used by the Redis instance (in MB) |
| **API Uptime** | Time since the API container last started |
| **API Version** | The running API build version |

Click **Refresh Stats** to re-fetch all metrics without reloading the page.

If the Qdrant vector count is significantly lower than the total memory count, it means the embedding queue has not been fully drained. Trigger a processor run from the Processor page to clear the backlog.
