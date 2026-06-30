---
title: SDK Overview
description: Client SDKs for NovaCortex across multiple programming languages
---

# SDK Overview

NovaCortex provides official client SDKs for multiple programming languages. The SDKs wrap the HTTP API with idiomatic, typed interfaces, handle authentication, implement retry logic, and raise structured error types.

---

## Why Use an SDK

Writing raw HTTP calls to the NovaCortex API is straightforward — it is a standard JSON REST API with Bearer token authentication. However, production applications benefit from:

- **Automatic auth injection** — no manual `Authorization: Bearer ...` header on every call
- **Typed error classes** — catch `NotFoundError` specifically instead of checking HTTP status codes
- **Retry on rate limits** — automatic exponential backoff on 429 responses
- **Type hints and autocompletion** — IDE support for request bodies and response fields
- **Response deserialization** — typed objects instead of raw dictionaries/hashes
- **Consistent pagination** — paginated responses abstracted into iterators or lists

---

## Common Patterns Across All SDKs

Every NovaCortex SDK follows these conventions:

### Client Initialization

```python
# Python example
client = NovaCortexClient(
    base_url="https://memory.example.com",
    api_key="nc_pat_..."
)
```

```perl
# Perl example
my $client = NovaCortex::Client->new(
    base_url => 'https://memory.example.com',
    api_key  => 'nc_pat_...',
);
```

### Resource Namespacing

Methods are organized under resource objects:

```
client.memories.create(...)
client.memories.get(...)
client.memories.list(...)
client.relations.create(...)
client.namespaces.list(...)
client.buckets.upload(...)
client.export.json(...)
```

### Error Hierarchy

All SDKs raise errors in a consistent hierarchy:

| Class | HTTP Status | Triggered When |
|---|---|---|
| `NovaCortexError` (base) | Any | Generic API error — catch this as a fallback |
| `AuthError` | 401 | Token is missing, invalid, or expired |
| `ForbiddenError` | 403 | Token lacks permission or tier limit reached |
| `NotFoundError` | 404 | Requested resource does not exist |
| `ConflictError` | 409 | Resource already exists (e.g., duplicate namespace name) |
| `RateLimitError` | 429 | Too many requests — SDK retries automatically before raising |
| `ValidationError` | 400 | Invalid request body — check field values |
| `ServerError` | 500 | API internal error — retry later |

### Automatic Retry

All SDKs implement automatic retry for `429 Too Many Requests` responses:
- Maximum 3 retries
- Exponential backoff: 1s, 2s, 4s
- Maximum wait before giving up: 60 seconds
- On each retry, the `Retry-After` response header is respected if present

### Timeout

Default request timeout: 30 seconds. Configurable per-client and per-request.

---

## Language Support

| Language | Package Name | Registry | Status |
|---|---|---|---|
| Python | `novacortex-sdk` | PyPI | Available |
| Perl | `NovaCortex::Client` | CPAN | Available |
| JavaScript/TypeScript | `@novacortex/sdk` | npm | Planned — v1.1 |
| Go | `github.com/Nova-Cognitive-Systems/novacortex-go` | pkg.go.dev | Planned — v1.2 |
| Ruby | `novacortex-rb` | RubyGems | Planned — v1.2 |
| Java | `com.novacortex:sdk` | Maven Central | Planned — v1.3 |
| PHP | `novacortex/sdk` | Packagist | Planned — v1.3 |
| Rust | `novacortex` | crates.io | Planned — v1.4 |

See [Roadmap](../roadmap.md) for target release versions.

---

## Versioning

SDK versions follow Semantic Versioning (SemVer):
- **Major version** — breaking API changes
- **Minor version** — new features, backward compatible
- **Patch version** — bug fixes

SDK versions are independent of the NovaCortex server version. The `1.x` SDK series is compatible with NovaCortex server `1.x`. If the server introduces breaking API changes in `2.0`, a `2.x` SDK series will be released.

---

## Community SDKs

Third-party SDKs and integrations maintained by the community are listed in the [NovaCortex Awesome List](https://github.com/Nova-Cognitive-Systems/novacortex-awesome). These are not officially supported but may provide bindings for languages not yet on the official roadmap.

To add your SDK to the list, open a pull request against the `novacortex-awesome` repository.

---

## OpenAPI Specification

The NovaCortex API is described by an OpenAPI 3.1 specification available at:

- Local: `http://localhost:3001/openapi.json`
- Production: `https://your-domain.com/api/openapi.json`

You can use the OpenAPI spec to generate client bindings for any language using tools like `openapi-generator` or `oapi-codegen`. Official SDKs are hand-written and optimized for their respective languages — generated clients can serve as a starting point for languages not yet in the official SDK set.
