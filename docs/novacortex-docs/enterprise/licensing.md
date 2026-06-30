---
title: Licensing
description: How NovaCortex licensing works, tier limits, and offline activation
---

# Licensing

NovaCortex licenses are signed JWT tokens. Validation is entirely local — no license server, no internet dependency, no telemetry.

---

## How Tiers Work

Your license tier is determined solely by the `LICENSE_KEY` environment variable. The workflow is:

1. You obtain a license key from [novacortex.ai/pricing](https://novacortex.ai/pricing) or from your account manager
2. You set `LICENSE_KEY=<your-key>` in your `.env` file or environment
3. The API reads and validates the key on startup
4. The tier takes effect immediately — namespace limits, federation availability, and Custom API URL access update

Without a `LICENSE_KEY`, the system operates in **Unregistered** mode: one namespace (`default`), no federation, no Custom API URL. All core memory features are fully functional.

---

## License Key Format

A NovaCortex license key is a standard JWT signed with an RSA-256 private key held by Nova Cognitive Systems. The key looks like:

```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsaWNlbnNlIiwidGllciI6InBybyIsImlhdCI6MTc0NDQ0MTIwMCwiZXhwIjoxNzc1OTc3MjAwfQ.YzM4...
```

The API validates the JWT signature against the bundled public key. This means:
- Validation works without any network access
- No license server needs to be reachable
- The key cannot be forged or modified (RSA signature)
- Expired keys are detected via the standard JWT `exp` claim

---

## Setting the License Key

### In `.env`

```bash
# .env
LICENSE_KEY=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

After editing `.env`, restart the API container:

```bash
docker compose restart api
```

The startup log will confirm the tier:

```
api  | License: Pro (valid until 2027-04-12)
api  | Namespaces: up to 10
api  | Federation: enabled
```

### In the Settings UI

Navigate to **Settings** → **License card** → enter the key in the input field → click **Activate**.

The UI sends the key to the API's configuration endpoint, which validates it and stores it persistently. The tier updates immediately without a container restart.

---

## Namespace Limit Enforcement

The namespace limit is enforced at the `POST /namespaces` endpoint. The enforcement logic is:

```
allowed = current_namespace_count < tier_limit
```

If `allowed` is false, the API returns `403 NAMESPACE_LIMIT_REACHED`.

Tier limits:

| Tier | Limit |
|---|---|
| Unregistered | 1 |
| Free | 3 |
| Pro | 10 |
| Enterprise | None (effectively unlimited) |

**Downgrade behavior**: If your license expires and the system reverts to Unregistered (limit: 1), and you have more than 1 namespace, the system does NOT delete any namespaces or memories. It simply prevents creating new namespaces until you renew. Existing namespaces continue to function normally — you can still read and write memories in all of them. Only the creation of additional namespaces is blocked.

---

## Viewing Your License in the UI

Navigate to **Settings** → **License card**. The card shows:

| Field | Description |
|---|---|
| **Tier** | Current tier name (Unregistered, Free, Pro, Enterprise) |
| **Valid Until** | License expiry date |
| **Namespaces** | `current / limit` (e.g., `3 / 10`) |
| **Federation** | Enabled or Disabled |
| **Custom API URL** | Enabled or Disabled |

If the license expires within 30 days, the card displays a yellow warning banner: `Your license expires in X days. Renew at novacortex.ai/account`.

If the license has already expired, the card shows a red banner: `License expired — system operating in Unregistered mode`.

---

## Offline Activation

NovaCortex licensing is fully offline. The license key contains all tier information within the JWT payload, and validation uses a bundled public key — no external service is contacted.

This means NovaCortex can be deployed in:
- Air-gapped networks with no internet access
- Isolated private cloud environments
- Edge deployments without reliable connectivity

The license is cached in Redis (and falls back to in-process memory if Redis is unavailable) for 24 hours to avoid re-parsing the JWT on every request.

---

## License Renewal

Annual licenses expire after 365 days. To renew:

1. Log in to your account at [novacortex.ai/account](https://novacortex.ai/account)
2. Purchase a renewal — you receive a new license key by email
3. Update `LICENSE_KEY` in your `.env` to the new key
4. Restart the API: `docker compose restart api`

Your data is preserved through the renewal process. There is no migration required.

For Enterprise license renewals, contact [enterprise@novacortex.ai](mailto:enterprise@novacortex.ai) — your account manager will issue a new key.

---

## Frequently Asked Questions

**Can I run NovaCortex without a license key?**

Yes. Without a key, NovaCortex runs in Unregistered mode with 1 namespace and no federation. All core memory features (CRUD, vector search, graph, knowledge base, PMF, MCP) are fully functional.

**Does the license key need to be stored securely?**

The license key is not a credential — it does not grant access to any service. It is a signed proof of your entitlement. However, treat it with reasonable care to avoid sharing your license with unauthorized users.

**What happens if I set an invalid or tampered key?**

The API logs a warning: `Invalid license key — falling back to Unregistered mode`. The system continues operating normally in Unregistered mode. Invalid keys do not prevent startup.

**Can I use the same license key on multiple instances?**

Licensing terms vary by tier. Free and Pro licenses are issued per installation. Enterprise licenses may cover multiple installations — check your agreement or contact your account manager.

**Is there a trial period?**

NovaCortex's Unregistered mode is permanently free with full core functionality. Contact [sales@novacortex.ai](mailto:sales@novacortex.ai) for a time-limited Pro or Enterprise trial key.
