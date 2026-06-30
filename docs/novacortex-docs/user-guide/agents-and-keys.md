---
title: Agents and API Keys
description: Managing API tokens and integrating agents with NovaCortex
---

# Agents and API Keys

NovaCortex uses API tokens (personal access tokens) to authenticate all API requests. Tokens are created with a **template** that determines their permissions and scope. Each token can optionally be linked to an agent identity and a specific namespace.

---

## Token Concepts

### Token Prefix

All NovaCortex tokens use a fixed prefix to make them easy to identify in logs and version control scanners:

| Prefix | Type | Description |
|---|---|---|
| `nc_pat_` | Personal Access Token | The primary token type. Created via UI or API. |
| `nc_boot_` | Bootstrap Code | One-time use. Generated on first startup. Exchanged for a session via `POST /setup/exchange`. |

### Templates

Templates define the permission set and scope of a token:

| Template | Read | Write | Admin Operations | Scope |
|---|---|---|---|---|
| `admin-full` | All namespaces | All namespaces | Yes (tokens, namespaces, processor) | All namespaces |
| `admin-readonly` | All namespaces | None | No | All namespaces |
| `agent` | Claimed namespace only | Claimed namespace only | No | `namespaceClaim` only |
| `knowledge-ingest` | None | Upload to buckets only | No | Bucket upload only |

- **admin-full**: Use for human administrators, CI/CD pipelines, and integration tests. Do not give this template to autonomous agents in production.
- **admin-readonly**: Use for monitoring dashboards, audit tools, and read-only exports.
- **agent**: Use for autonomous agents. Scope the token to the agent's namespace via `namespaceClaim`. The token's `agentId` is used by federation rules to determine cross-namespace access.
- **knowledge-ingest**: Use for pipelines that only upload documents to knowledge base buckets. Cannot read memories or manage tokens.

---

## Creating a Token

### Via the UI

1. Navigate to **Settings** → **Access Tokens**
2. Click **New Token**
3. Fill in the form:

| Field | Required | Description |
|---|---|---|
| **Name** | Yes | Human-readable label for this token. Shown in the token list. Example: `deploy-agent-prod`. |
| **Template** | Yes | Select the permission level (see table above). |
| **Agent ID** | No | Identifier for the agent this token belongs to. Used by federation rules. Example: `agent-007`. |
| **Namespace Claim** | `agent` template only | The namespace this token is scoped to. The token can only operate within this namespace. |

4. Click **Create**
5. **Copy the token immediately.** The full `nc_pat_...` string is shown only once. Close the dialog without copying and you will need to create a new token.

### Via the API

```bash
curl -X POST http://localhost:3001/tokens \
  -H "Authorization: Bearer nc_pat_admin_full_token" \
  -H "Content-Type: application/json" \
  -d '{
    "template": "agent",
    "name": "agent-007-prod",
    "agentId": "agent-007",
    "namespaceClaim": "project-alpha"
  }'
```

Response:

```json
{
  "token": "nc_pat_7x9q2mTzRp....",
  "record": {
    "id": "token:abc123",
    "name": "agent-007-prod",
    "template": "agent",
    "agentId": "agent-007",
    "namespaceClaim": "project-alpha",
    "createdAt": "2026-04-12T09:00:00Z"
  }
}
```

---

## Viewing Active Tokens

Navigate to **Settings** → **Access Tokens** to see the token list.

| Column | Description |
|---|---|
| **Name** | The token's human-readable label |
| **Template** | Permission level |
| **Prefix** | The first 12 characters of the token (e.g., `nc_pat_7x9q2m`) |
| **Agent ID** | Associated agent identifier, if any |
| **Namespace** | Namespace claim, if any |
| **Created** | Creation timestamp |
| **Last Used** | Timestamp of the most recent authenticated request using this token |

The full token value is never shown after creation. Only the prefix is stored in the database for display purposes.

---

## Revoking a Token

Click the **Revoke** button (cross icon) in the token row.

A confirmation dialog appears. Click **Confirm Revoke** to proceed. Revocation takes effect immediately — any in-flight request using the token at the moment of revocation may succeed (if the token was already validated in the request pipeline) but all subsequent requests will receive `401 Unauthorized`.

Revocation is permanent. You cannot restore a revoked token. Create a new token if you need to re-enable access.

---

## MCP Integration

NovaCortex ships with a Model Context Protocol (MCP) server in `packages/mcp-server/`. This allows MCP-compatible AI clients (Claude Desktop, Cursor, Windsurf, and others) to call NovaCortex memory tools directly during inference.

### Installing the MCP Server

The MCP server is a Node.js package. It is included in the NovaCortex repository and does not need to be installed separately.

Build it alongside the rest of the project:

```bash
docker compose exec api npm run build --workspace=packages/mcp-server
```

Or run it directly from the repository on the host:

```bash
node packages/mcp-server/bin/mcp-server.js
```

### Configuring Claude Desktop

Add the following to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "novacortex": {
      "command": "node",
      "args": ["/path/to/novacortex/packages/mcp-server/bin/mcp-server.js"],
      "env": {
        "MEMORY_API_KEY": "nc_pat_your_agent_token_here",
        "MEMORY_API_URL": "http://localhost:3001"
      }
    }
  }
}
```

Replace `/path/to/novacortex` with the absolute path to your NovaCortex repository. Replace `nc_pat_your_agent_token_here` with an `agent` template token.

Restart Claude Desktop after saving the configuration. In a new conversation, ask Claude to recall a memory or store something — it will use the MCP tools to communicate with NovaCortex.

### Configuring Cursor

In Cursor's settings, navigate to **Features** → **MCP Servers** → **Add Server**, and paste:

```json
{
  "name": "novacortex",
  "command": "node",
  "args": ["/path/to/novacortex/packages/mcp-server/bin/mcp-server.js"],
  "env": {
    "MEMORY_API_KEY": "nc_pat_your_agent_token_here",
    "MEMORY_API_URL": "http://localhost:3001"
  }
}
```

### Available MCP Tools

The MCP server exposes the following tools to clients:

| Tool | Description |
|---|---|
| `memory_store` | Create a new memory |
| `memory_recall` | Get a memory by ID |
| `memory_search` | Vector similarity search |
| `memory_relate` | Create a relation between two memories |
| `memory_forget` | Delete a memory |
| `memory_export` | Export a namespace as JSON |
| `memory_status` | Get processor status and queue depth |
| `memory_wakeup` | Trigger the Memory Processor |
| `session_start` | Begin a named session context |
| `session_add_turn` | Append a turn to the current session |
| `session_get_context` | Retrieve session context for injection into prompts |
| `session_end` | End and archive a session |

---

## Namespace Federation

Pro and Enterprise licenses support federation rules that allow an agent token to read from multiple namespaces transparently.

To configure federation for an agent:

1. Navigate to **Settings** → **Access Tokens**
2. Click the agent token row to expand it
3. Click the **Federation Rules** tab
4. Click **Add Rule** → select the readable namespaces from the dropdown
5. Click **Save**

From the agent's perspective, search and list results will include memories from all readable namespaces with no additional configuration. Each result includes a `namespace` field so the agent can distinguish the source.

For the full federation guide, see [Enterprise — Federation](../enterprise/federation.md).
