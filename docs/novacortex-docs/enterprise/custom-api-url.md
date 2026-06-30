---
title: Custom API URL
description: Configuring a custom API base URL in NovaCortex Enterprise
---

# Custom API URL (Enterprise)

Enterprise installations can configure a custom API base URL directly from the web UI. This is useful when the API and web interface are served from different hosts, in multi-region setups, or when blue/green API deployments require routing to a specific instance.

---

## What It Is

By default, the NovaCortex web application communicates with the API at the URL set during the Docker build via the `NEXT_PUBLIC_API_URL` build argument. For most installations, this is `http://localhost:3001` in development or `https://memory.example.com/api` in production.

The Custom API URL feature allows you to override this default from within the Settings UI, on a per-browser basis, without rebuilding the Docker image or restarting any containers.

---

## Use Cases

**API on a separate subdomain from the web UI**

If your web UI is at `https://app.memory.company.com` and your API is at `https://api.memory.company.com`, the build-time `NEXT_PUBLIC_API_URL` handles this for standard deployments. The Custom API URL is useful when this URL needs to change post-deployment without a rebuild.

**Blue/green API deployment**

You are deploying a new API version alongside the current one. Before switching the load balancer, you want to test the new API against the live web UI by pointing a specific operator's browser to the new API host. Set the Custom API URL for your session without affecting other users.

**Multi-region deployments**

You have API instances in `us-east` and `eu-west`. Operators in each region can point their web UI to the nearest API instance for lower latency, while the default URL routes to the primary region.

**Split traffic testing**

Route 10% of operator sessions to a new API version by manually setting the Custom API URL for a subset of users during a staged rollout.

**Debugging a specific API instance**

In a horizontally scaled API deployment, you want to target a specific API pod for debugging. Set the Custom API URL to that pod's direct address, bypassing the load balancer.

---

## How to Set a Custom API URL

1. Navigate to **Settings** → **API Configuration**
2. In the **Base URL** input field, enter the full API URL including the protocol:
   - Example: `https://api.memory.company.com`
   - Example: `http://api-instance-2.internal:3001`
3. Click **Save & Reload**

The web application saves the URL to `localStorage` under the key `novacortex_api_url` and performs a full page reload. After reload, all API calls from your browser use the new URL.

---

## How to Reset to the Default URL

1. Navigate to **Settings** → **API Configuration**
2. Click **Reset to Default**
3. Click **Save & Reload**

The custom URL is cleared from `localStorage`. The application reverts to using `NEXT_PUBLIC_API_URL` (the build-time default) for all API calls.

---

## Scope and Persistence

The custom URL is stored in the browser's `localStorage`. It is:

- **Browser-local** — only affects the browser where it was set
- **User-local** — other users logged in from other browsers are unaffected
- **Persistent across sessions** — the URL is retained until explicitly reset or `localStorage` is cleared (e.g., clearing browser data)
- **Per-tab** — a new browser tab opens with the same custom URL because `localStorage` is shared within the origin

This scoping is intentional. It allows individual operators to test different API targets without affecting other operators or production traffic.

---

## Availability by Tier

| Tier | Custom API URL |
|---|---|
| Unregistered | Not available — Base URL input is read-only |
| Free | Not available — Base URL input is read-only |
| Pro | Not available — Base URL input is read-only |
| Enterprise | Available — Base URL input is editable |

On Free and Pro tiers, the **API Configuration** section is visible in Settings but the input field is read-only, displaying the build-time default. An upgrade prompt is shown alongside the field.

---

## Technical Notes

### CORS Configuration

If you set the Custom API URL to a different origin than the web UI, ensure that the API's `CORS_ORIGINS` environment variable includes the web UI's origin:

```bash
CORS_ORIGINS=https://app.memory.company.com,https://staging-app.memory.company.com
```

Without this, the browser will block cross-origin requests from the web UI to the API.

### SSL Certificate Requirements

If the Custom API URL uses HTTPS, the target API must have a valid SSL certificate trusted by the browser. Self-signed certificates cause browser warnings and may block requests in strict security contexts.

### Authentication Token Compatibility

The API token (`nc_pat_...`) is sent in the `Authorization` header to whatever URL is configured. The target API must have the same token records in its database for authentication to succeed. Tokens are stored in SurrealDB — if you point to a different API instance that shares the same SurrealDB, existing tokens will work. If the target API uses a different database, you will need to create tokens there.

### No Server-Side Effect

Changing the Custom API URL has no effect on the server. It only changes where the browser sends requests. The API does not know or care that a client has configured a custom URL.
