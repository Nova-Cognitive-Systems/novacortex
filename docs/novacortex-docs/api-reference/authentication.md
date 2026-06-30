---
title: API Reference — Authentication
description: Token types, templates, scopes, and the bootstrap exchange flow
---

# API Reference — Authentication

All NovaCortex API endpoints (except health probes) require authentication via a Bearer token.

---

## Bearer Token

Include your token in the `Authorization` header of every request:

```
Authorization: Bearer nc_pat_your_token_here
```

Tokens are validated on each request against the SurrealDB token store (with a Redis cache layer for performance). There is no session state — each request is independently authenticated.

---

## Token Prefixes

| Prefix | Type | Lifetime | Description |
|---|---|---|---|
| `nc_pat_` | Personal Access Token | Until revoked | Standard token type for agents, admins, and integrations |
| `nc_boot_` | Bootstrap Code | 24 hours, one-time use | Generated on first startup; must be exchanged for a session |

---

## Token Templates and Scopes

Every token is created with a template that determines its permissions:

| Template | Read | Write | Admin | Scope |
|---|---|---|---|---|
| `admin-full` | All namespaces | All namespaces | Yes | All namespaces |
| `admin-readonly` | All namespaces | None | No | All namespaces |
| `agent` | Claimed namespace | Claimed namespace | No | `namespaceClaim` value |
| `knowledge-ingest` | None | Bucket upload only | No | `POST /buckets/:id/upload` only |

**Read** includes: GET on memories, relations, namespaces, buckets, documents, processor stats, federation rules.

**Write** includes: POST/PATCH/DELETE on memories, relations, and documents.

**Admin** includes: POST/DELETE on tokens and namespaces; PUT on processor schedule; POST/DELETE on federation rules.

**Scope** — for the `agent` template, the `namespaceClaim` field restricts the token to a single namespace. Any request targeting a different namespace returns `403 Forbidden` regardless of the template's permission level.

---

## Bootstrap Flow

On initial startup, when no admin token exists in the database, NovaCortex generates a one-time bootstrap code and prints it to the API container logs:

```
api  | ============================================================
api  | Bootstrap code: nc_boot_a7f9c2d3e8b1...
api  | This code is valid for 24 hours and can only be used once.
api  | Use it to log in at http://localhost:3000/login
api  | ============================================================
```

The bootstrap code is exchanged for a user session via the web UI login flow. Internally, the login page calls:

```
POST /setup/exchange
Content-Type: application/json

{ "code": "nc_boot_a7f9c2d3e8b1..." }
```

Response:

```json
{
  "session_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at": "2026-04-19T09:00:00Z"
}
```

The session token is a short-lived JWT used only by the web UI. After exchanging the bootstrap code, the system prompts you to create a permanent `admin-full` personal access token. That `nc_pat_` token is what you use for all API and integration access.

The bootstrap code is invalidated immediately after use. If you lose the code before using it (e.g., container restarted), restart the API container — if no admin token exists, a new bootstrap code is generated.

---

## Obtaining a Token Programmatically

If you already have an `admin-full` token, you can create additional tokens via the API:

```bash
# Create an agent token scoped to "project-alpha"
curl -X POST http://localhost:3001/tokens \
  -H "Authorization: Bearer nc_pat_your_admin_full_token" \
  -H "Content-Type: application/json" \
  -d '{
    "template": "agent",
    "name": "agent-007-project-alpha",
    "agentId": "agent-007",
    "namespaceClaim": "project-alpha"
  }'
```

Response:

```json
{
  "token": "nc_pat_7x9q2mTzRp...",
  "record": {
    "id": "token:abc123",
    "name": "agent-007-project-alpha",
    "template": "agent",
    "agentId": "agent-007",
    "namespaceClaim": "project-alpha",
    "createdAt": "2026-04-12T09:00:00Z"
  }
}
```

The `token` string is returned only at creation. Store it securely (in a secrets manager or environment variable). Subsequent calls to `GET /tokens` return only the token's metadata, not the token value.

---

## Token Security Best Practices

**Minimum-privilege principle**: Always use the most restrictive template that satisfies your use case. An autonomous agent that only writes memories to its own namespace should have an `agent` template token with a namespace claim — not an `admin-full` token.

**Rotate tokens regularly**: Even without evidence of compromise, rotating agent tokens quarterly reduces the blast radius of a credential leak.

**Never commit tokens to version control**: Store tokens in environment variables, Docker secrets, or a secrets manager. NovaCortex tokens are flagged by common secret scanners (the `nc_pat_` prefix is registered with GitHub's secret scanning service).

**Use separate tokens per agent**: Do not share tokens between agents. Per-agent tokens allow you to revoke access for a specific agent without affecting others, and the `lastUsed` timestamp helps identify unused or compromised tokens.

**Audit token usage**: Review the `lastUsed` field in the token list regularly. Tokens that have never been used or have not been used recently may be candidates for revocation.

---

## Token Expiry

By default, personal access tokens do not expire (they are valid until explicitly revoked). The `JWT_EXPIRES_IN` environment variable controls the expiry of session tokens issued during the web UI login flow, not `nc_pat_` tokens.

If your security policy requires time-limited tokens, use the `JWT_EXPIRES_IN` variable and set up an automated token rotation pipeline. Future versions (v1.2+) will add native token expiry support to personal access tokens.

---

## Authenticating in the Python SDK

```python
from novacortex import NovaCortexClient

client = NovaCortexClient(
    base_url="https://memory.example.com",
    api_key="nc_pat_..."
)
# The SDK automatically injects Authorization: Bearer nc_pat_... on every request
```

## Authenticating in the Perl SDK

```perl
use NovaCortex::Client;

my $client = NovaCortex::Client->new(
    base_url => 'https://memory.example.com',
    api_key  => 'nc_pat_...',
);
# The SDK automatically injects Authorization: Bearer nc_pat_... on every request
```
