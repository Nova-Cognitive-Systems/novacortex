---
title: Knowledge Base
description: Uploading and managing documents in NovaCortex Knowledge Base buckets
---

# Knowledge Base

The Knowledge Base allows you to upload documents into named containers called **buckets**. Documents are chunked automatically and can optionally be converted into `semantic` memories, making their content discoverable through vector search alongside hand-authored memories.

---

## Concept: Buckets and Documents

A **bucket** is a named container for documents. Each bucket has:
- A unique name (slug-safe: lowercase letters, numbers, hyphens)
- An optional description
- A **namespace** — all memories generated from documents in this bucket belong to this namespace
- An optional list of **agent IDs** that have read access to the bucket

A **document** is a file uploaded to a bucket. Documents are processed into chunks of approximately 512 tokens each. Chunks preserve paragraph boundaries where possible.

When the **Create Memories** toggle is enabled on a bucket or per-upload, each chunk becomes a `semantic` memory in the bucket's namespace. The memory's tags include `source:knowledge-base` and the document filename (e.g., `source:manual.pdf`). This tagging makes it straightforward to filter for knowledge-base-derived memories separately from agent-authored ones.

---

## Creating a Bucket

Navigate to **Knowledge Base** → click **New Bucket**.

| Field | Required | Description |
|---|---|---|
| **Name** | Yes | Slug-safe identifier (e.g., `product-docs`, `runbooks-2026`). Unique across all buckets. Cannot be changed after creation. |
| **Description** | No | Free-text description of what this bucket contains. Shown in the bucket list. |
| **Namespace** | Yes | The namespace where memories generated from this bucket's documents will be stored. Must be an existing namespace. |
| **Agents with access** | No | List of agent IDs that can read this bucket's documents via the API. Leave empty to allow all tokens with read access. |
| **Create Memories by default** | No | When enabled, every document uploaded to this bucket automatically generates semantic memories from its chunks. Can be overridden per-upload. |

Click **Create Bucket** to save. The bucket appears in the list immediately.

---

## Uploading Documents

### Supported Formats

| Format | Extension | Notes |
|---|---|---|
| Plain text | `.txt` | UTF-8 encoding assumed |
| Markdown | `.md`, `.mdx` | Frontmatter is stripped before chunking |
| CSV | `.csv` | Each row becomes one chunk; header row is prepended to each chunk |
| PDF | `.pdf` | Text extraction only — images and tables are not extracted in v1.0 |
| JSON | `.json` | Flattened key-value pairs; arrays are expanded |

**Maximum file size**: 10 MB per file.

Files exceeding 10 MB or with unsupported extensions are rejected immediately with a 400 error. For large PDFs, consider splitting them before upload.

### Upload Process

1. Navigate to the bucket detail page (click the bucket name in the list)
2. Click **Upload Document** or drag a file onto the upload zone
3. The file picker opens — select one or more files (multi-file upload is supported)
4. For each file, set:
   - **Create Memories** — override the bucket default for this upload only
5. Click **Upload**

The upload is processed asynchronously. The document list shows the new entry with status `processing`. Once chunking and optional memory generation are complete, the status changes to `ready`. If processing fails, the status shows `failed` with an error message.

### Create Memories Toggle

When **Create Memories** is enabled for an upload:

1. The document is split into chunks
2. For each chunk, the API creates a `semantic` memory in the bucket's namespace with:
   - `content`: the chunk text
   - `type`: `semantic`
   - `namespace`: the bucket's namespace
   - `tags`: `["source:knowledge-base", "source:<filename>"]`
   - `confidence`: 1.0
   - `salience`: 0.8
   - `decayRate`: 0.01 (very slow decay — knowledge base content is long-lived)
3. Each memory is queued for embedding generation

---

## Viewing Documents

The bucket detail page shows all documents in the bucket:

| Column | Description |
|---|---|
| **Name** | Original filename |
| **Size** | File size in KB or MB |
| **Type** | Detected MIME type |
| **Uploaded** | Relative timestamp |
| **Chunks** | Number of text chunks the document was split into |
| **Memories** | Number of `semantic` memories linked to this document |
| **Status** | `processing`, `ready`, or `failed` |

Click a document row to open the Document Detail view, which shows:
- Full extracted text content
- All chunks (expandable list)
- Linked memory IDs (click any to jump to the memory detail view)

---

## Deleting Documents

Click the **Delete** button (trash icon) in the document row.

A confirmation dialog appears with options:
- **Delete document only** — removes the document and its chunks from NovaCortex, but leaves any linked memories intact
- **Delete document and linked memories** — removes the document and permanently deletes all `semantic` memories that were generated from its chunks

Choose the option that matches your intent and click **Confirm Delete**.

Deleting a document from a bucket does not affect the bucket itself or other documents in the bucket.

---

## Upload History Tab

The **Upload History** tab on the bucket detail page shows a chronological log of all document uploads to this bucket.

| Column | Description |
|---|---|
| **Filename** | Name of the uploaded file |
| **Uploaded by** | Agent ID or user who performed the upload |
| **Timestamp** | Exact upload time (UTC) |
| **Status** | `processing`, `ready`, or `failed` |
| **Chunks** | Number of chunks generated |
| **Memories created** | Number of semantic memories created (or `—` if Create Memories was disabled) |
| **Error** | Error message if status is `failed` |

The history is append-only. Deleting a document does not remove its history entry. This provides an audit trail of what was uploaded and when.

---

## Deleting a Bucket

Navigate to the bucket list → click the **Delete** button on the bucket row.

A bucket cannot be deleted if it contains documents. Delete all documents first (using the delete-all option on the bucket detail page), then delete the bucket.

The `default` bucket, if one exists, is not protected — it can be deleted normally once empty.

---

## Best Practices

**Organize by audience, not by file type.** Create buckets like `product-manuals`, `ops-runbooks`, `legal-docs`, and `api-reference` — one bucket per logical audience. This makes namespace assignment and agent access control straightforward.

**Keep documents focused.** A 50-page PDF that covers 10 unrelated topics will produce poorly-scoped chunks and noisy memories. Split large documents into focused sub-documents before upload.

**Use Create Memories selectively.** Not every document needs to be in the memory graph. Enable memory generation for reference material you want agents to retrieve; leave it off for raw data files, logs, or ephemeral exports.

**Tag your buckets with namespace conventions.** If you have a `shared-docs` namespace for cross-agent knowledge, create a dedicated bucket that points to that namespace, and point agent-specific buckets at agent namespaces.
