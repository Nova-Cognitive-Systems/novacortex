---
title: Roadmap
description: NovaCortex development roadmap — current state, near-term releases, and planned features
---

# NovaCortex Roadmap

This roadmap describes what is shipping now, what is planned next, and the longer-term vision for the NovaCortex platform. It is a living document — priorities may shift based on community feedback.

---

## Current State — v1.0

NovaCortex v1.0 delivers a complete, production-ready AI memory system:

- **Four memory types**: episodic, semantic, procedural, working — each with distinct decay semantics
- **HNSW vector indexing** via Qdrant — sub-millisecond p99 retrieval at scale
- **Namespace isolation** with configurable limits per license tier
- **Force-directed relation graph** with 9 typed edge types and interactive D3 visualization
- **Knowledge Base** with automatic semantic memory generation from TXT, MD, CSV, PDF, and JSON documents
- **Background Memory Processor** — embeddings, relation discovery, salience decay, and experimental consolidation
- **PMF export/import** (RFC PMF-001) — open interchange format with Merkle integrity verification
- **Namespace Federation** (Pro/Enterprise) — transparent cross-namespace reads for multi-agent deployments
- **MCP Server** — native Model Context Protocol support for Claude Desktop, Cursor, and Windsurf
- **Python SDK** (`novacortex-sdk`) — fully typed, sync and async
- **Perl SDK** (`NovaCortex::Client`) — idiomatic Perl with exception objects
- **Docker Compose deployment** — single command from clone to running system
- **Dokploy support** — managed deployment with automatic SSL and rolling updates
- **License tiers** — Unregistered, Free, Pro, Enterprise with cryptographic offline validation

---

## Near-Term — v1.1

Target release: Q3 2026

### PMF Enhancements

- **Binary PMF format** — MessagePack-based binary encoding for PMF exports. Expected size reduction: ~60% compared to JSON PMF. Especially useful for exports that include embeddings (1536-float arrays are verbose in JSON).

- **Differential exports** — export only memories created or updated since a given timestamp:
  ```bash
  GET /memories/export/ops?since=2026-04-11T00:00:00Z
  ```
  Enables efficient incremental backups without re-exporting the entire namespace.

- **Encrypted PMF payloads** — AES-256-GCM encrypted memory content within PMF files (RFC PMF-001 Appendix C). The encryption key is stored separately from the PMF file. Memory IDs, tags, and graph topology remain unencrypted for indexing purposes; only `content` and `embedding` are encrypted.

- **Streaming PMF export** — chunked HTTP response for namespaces with more than 100,000 memories. Eliminates timeout issues for very large exports.

### Webhooks

- **Webhook support** — configure a URL to receive `POST` notifications on memory create, update, delete, and processor run completion. Payload includes the affected memory or run summary.

  ```bash
  PUT /webhooks
  { "url": "https://your-app.com/hooks/memory", "events": ["memory.created", "processor.completed"] }
  ```

### Observability

- **OpenTelemetry integration** — distributed traces and metrics for the API, processor, and all database operations. Compatible with Grafana, Datadog, Honeycomb, and any OTLP-compatible backend. Traces include per-request spans for SurrealDB queries, Qdrant operations, and embedding API calls.

### Unraid Community App

- **One-click Unraid installation** — NovaCortex available in the Unraid Community Applications store. No Docker Compose knowledge required for home lab and self-hosted deployments.

---

## Near-Term — v1.2

Target release: Q4 2026

### RBAC

- **Role-based access control** — read, write, and admin roles per namespace. Current model: a token has global or namespace-scoped permissions. RBAC adds per-namespace role assignments, enabling fine-grained access for teams sharing a NovaCortex instance.

### Audit Log

- **Append-only audit log** — every write operation is recorded: who created/updated/deleted what memory, when, with which token. The audit log is immutable (append-only SurrealDB table) and exportable via API.

  ```bash
  GET /audit?namespace=ops&since=2026-04-01&limit=100
  ```

### Multi-Region HA

- **Federation protocol RFC PMF-003** — defines the wire protocol for primary/replica NovaCortex deployments across multiple regions. Replicas receive memory writes from the primary via an event stream. Reads can be served from any replica. This is the foundation for true high-availability deployments.

### Memory Type Specification

- **RFC PMF-002** — formal taxonomy for memory types with sub-types. Proposed sub-types include:
  - `episodic.interaction` — user-agent interaction event
  - `episodic.observation` — observed system state
  - `semantic.fact` — verifiable fact
  - `semantic.belief` — held belief with confidence
  - `procedural.workflow` — multi-step workflow
  - `procedural.decision` — decision tree or rule

---

## SDK Roadmap

| Language | Package | Status | Target Version |
|---|---|---|---|
| Python | `novacortex-sdk` | Available | v1.0 |
| Perl | `NovaCortex::Client` | Available | v1.0 |
| JavaScript/TypeScript | `@novacortex/sdk` | In development | v1.1 |
| Go | `github.com/Nova-Cognitive-Systems/novacortex-go` | Planned | v1.2 |
| Ruby | `novacortex-rb` | Planned | v1.2 |
| Java | `com.novacortex:sdk` | Planned | v1.3 |
| PHP | `novacortex/sdk` | Planned | v1.3 |
| Rust | `novacortex` | Planned | v1.4 |

SDK releases follow the server release cycle where possible. An SDK may be released independently of a server release for bug fixes.

---

## Platform Roadmap

| Feature | Description | Target |
|---|---|---|
| Streaming PMF export | Chunked export for namespaces with >100K memories | v1.1 |
| Binary PMF | MessagePack-encoded PMF, ~60% smaller | v1.1 |
| Encrypted PMF | AES-256-GCM payload encryption (RFC PMF-001 Appendix C) | v1.1 |
| Differential export | Export only memories changed since a timestamp | v1.1 |
| Webhook/event streaming | POST to configurable URL on memory events | v1.1 |
| OpenTelemetry | Distributed traces and metrics for API + processor | v1.1 |
| Unraid Community App | One-click installation via Unraid | v1.1 |
| RBAC | Per-namespace role-based access control | v1.2 |
| Audit log | Immutable append-only write log | v1.2 |
| Multi-region HA | Primary/replica federation protocol (RFC PMF-003) | v1.2 |
| Memory Type Spec | Formal type taxonomy with sub-types (RFC PMF-002) | v1.2 |
| Bulk memory delete | Single-call delete for filtered memory sets | v1.2 |
| Memory versioning | Track edits to memory content over time | v1.3 |
| Scheduled exports | Cron-based automatic namespace exports to S3 | v1.3 |

---

## RFC Process

NovaCortex uses a community RFC process for significant changes to the PMF format, federation protocol, and API contracts.

### How to Propose

1. Open a [GitHub Discussion](https://github.com/Nova-Cognitive-Systems/novacortex/discussions) with the `RFC` label
2. Write a draft RFC using the template in `rfcs/RFC-TEMPLATE.md`
3. Submit a pull request placing your RFC at `rfcs/RFC-PMF-NNN.md` (use the next available number)
4. Community review period: 14 days minimum
5. Maintainer approval — RFC is assigned a permanent number and merged into the repository

### Active RFCs

| RFC | Title | Status |
|---|---|---|
| RFC PMF-001 | Portable Memory Format | Published — v1.0 |
| RFC PMF-002 | Memory Type Specification | Draft — target v1.2 |
| RFC PMF-003 | Federation Protocol | Draft — target v1.2 |
| RFC PMF-001-AppC | Encrypted PMF Payloads | Draft — target v1.1 |

### RFC Principles

- RFCs must be implementation-neutral — they describe behavior, not code
- Backward compatibility must be considered for all changes to published RFCs
- RFCs that introduce breaking changes require a major version increment
- The RFC process is open to all — no affiliation with Nova Cognitive Systems is required

---

## Community and Contributions

NovaCortex is open source under the MIT License. Contributions are welcome:

- **Bug reports**: [GitHub Issues](https://github.com/Nova-Cognitive-Systems/novacortex/issues)
- **Feature requests**: [GitHub Discussions](https://github.com/Nova-Cognitive-Systems/novacortex/discussions)
- **Pull requests**: Follow the contributing guide in `CONTRIBUTING.md`
- **Community SDKs**: List your SDK in the [novacortex-awesome](https://github.com/Nova-Cognitive-Systems/novacortex-awesome) repository
- **RFC proposals**: See the RFC process above
