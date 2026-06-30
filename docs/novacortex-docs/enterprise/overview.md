---
title: Enterprise Overview
description: Pro and Enterprise features in NovaCortex
---

# Enterprise Overview

NovaCortex is available in four tiers: Unregistered, Free, Pro, and Enterprise. Higher tiers unlock features designed for teams, organizations, and large-scale deployments.

---

## Feature Comparison

| Feature | Free | Pro | Enterprise |
|---|---|---|---|
| **Namespaces** | 3 | 10 | Unlimited |
| **Memories per namespace** | Unlimited | Unlimited | Unlimited |
| **Vector search** | Full | Full | Full |
| **Relation graph** | Full | Full | Full |
| **Knowledge base** | Full | Full | Full |
| **PMF export/import** | Full | Full | Full |
| **MCP server** | Full | Full | Full |
| **Memory Processor** | Full | Full | Full |
| **Namespace Federation** | ✗ | ✓ (up to 10 readable namespaces per agent) | ✓ (unlimited) |
| **Custom API URL** | ✗ | ✗ | ✓ |
| **Support** | Community forums | 48h email response | 24h priority support |
| **SLA** | None | Best-effort | 99.5% uptime SLA |
| **License activation** | N/A | `LICENSE_KEY` env var | `LICENSE_KEY` env var |

---

## License Tiers Explained

### Unregistered

The default mode when no `LICENSE_KEY` is set. Suitable for personal projects and initial evaluation.

Restrictions:
- 1 namespace (`default` only — no additional namespaces can be created)
- No federation

All core features (memory CRUD, vector search, graph, knowledge base, PMF, MCP) are fully functional.

### Free

Requires a valid Free license key. Suitable for individual developers and small projects.

Restrictions:
- 3 namespaces (including `default`)
- No federation

Obtain a Free license key at [novacortex.ai/pricing](https://novacortex.ai/pricing) — no payment required.

### Pro

Requires a valid Pro license key. Suitable for small teams, multi-agent deployments, and projects requiring namespace organization.

Features:
- 10 namespaces
- Namespace Federation (up to 10 readable namespaces per agent rule)
- 48h email support

### Enterprise

Requires a valid Enterprise license key. Suitable for organizations, production deployments, and multi-team installations.

Features:
- Unlimited namespaces
- Namespace Federation (unlimited readable namespaces per agent rule)
- Custom API URL configuration
- 24h priority support
- 99.5% uptime SLA (when deployed on supported infrastructure)

Contact [enterprise@novacortex.ai](mailto:enterprise@novacortex.ai) to obtain an Enterprise license.

---

## Activating a License

### Method 1 — Environment Variable (Recommended)

Set the `LICENSE_KEY` environment variable in your `.env` file before starting (or restarting) the API container:

```bash
# In .env
LICENSE_KEY=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

Then restart the API:

```bash
docker compose restart api
```

The license is read and validated on startup. Validation is cryptographic — no network call is made. The license remains valid without internet access.

### Method 2 — Settings UI

Navigate to **Settings** → **License** card. Enter your `LICENSE_KEY` in the input field and click **Activate**. The key is stored and the tier updates immediately. (Internally this calls a configuration endpoint on the API — the key is also persisted to the environment for container restarts.)

---

## Viewing Your Current Tier

Your current tier is displayed in multiple places:
- **Settings** → **License card** — shows tier, namespace count, namespace limit, federation flag
- **Namespaces page** — shows `X / Y namespaces used` in the summary bar
- **`GET /namespaces`** API response — includes the `tier` field

---

## What Happens at the Namespace Limit

When you attempt to create a namespace that would exceed your tier limit:

```json
HTTP 403 Forbidden
{
  "error": "Namespace limit reached for your tier (Pro: 10 namespaces). Delete an existing namespace or upgrade to Enterprise for unlimited namespaces.",
  "code": "NAMESPACE_LIMIT_REACHED"
}
```

**Your existing namespaces and all their memories are completely unaffected.** The limit only prevents creating new namespaces. You can:
- Delete an unused namespace to free up a slot
- Upgrade your license to increase the limit
- Reorganize memories into fewer namespaces

---

## License Validity and Renewal

Licenses are signed JWT tokens issued by Nova Cognitive Systems. Each license contains:
- The tier (free, pro, enterprise)
- The issue date
- The expiry date (annual licenses expire after 365 days)
- A cryptographic signature

Validation happens on API startup and is cached for 24 hours. No internet connection is required for validation at any point.

**Approaching expiry**: The API logs a warning when your license will expire within 30 days. The Settings → License card also displays a warning badge. Contact [enterprise@novacortex.ai](mailto:enterprise@novacortex.ai) or your account manager to renew.

**After expiry**: The system reverts to Unregistered mode (1 namespace limit, no federation). Existing namespaces and memories are preserved — you simply cannot create new namespaces beyond the Unregistered limit until you renew.

---

## Enterprise Support

| Plan | Channel | Response Time |
|---|---|---|
| Free | [GitHub Discussions](https://github.com/Nova-Cognitive-Systems/novacortex/discussions) | Community (best-effort) |
| Pro | [support@novacortex.ai](mailto:support@novacortex.ai) | 48 hours |
| Enterprise | [enterprise@novacortex.ai](mailto:enterprise@novacortex.ai) | 24 hours |

Enterprise customers also receive access to the private Slack channel for real-time support during business hours.
