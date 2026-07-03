# @novacortex/claude-code-hook

Capture your Claude Code sessions into [NovaCortex](https://github.com/Nova-Cognitive-Systems/novacortex)
memory. On session end, the hook ships the conversation to `/memories/ingest`,
where NovaCortex's intelligence layer distills it into discrete, typed memories
and resolves conflicts **append-only** (superseded facts get typed edges +
`invalidatedAt` — never deleted). Ingestion is an async job on the server, so
the hook adds no meaningful latency to your session.

Your transcript goes only to **your own** NovaCortex deployment — pair it with
the `local-ai` compose profile and nothing ever leaves your machine.

## Setup

1. Have a NovaCortex deployment with the intelligence layer enabled
   (`LLM_MODEL` set — works with local Ollama).
2. Mint a token with `memories:write`.
3. Add the hook to your Claude Code settings (`~/.claude/settings.json`):

```jsonc
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx -y @novacortex/claude-code-hook",
            "timeout": 30
          }
        ]
      }
    ]
  },
  "env": {
    "NOVACORTEX_URL": "http://localhost:3001",
    "NOVACORTEX_TOKEN": "<token with memories:write>",
    "NOVACORTEX_NAMESPACE": "claude-code"
  }
}
```

At the start of your next session, load what matters in ~150 tokens via the
NovaCortex MCP server: `memory_wakeup { depth: "index" }`, then drill down with
`memory_search` / `memory_recall`.

## Env

| Variable | Default | |
|---|---|---|
| `NOVACORTEX_URL` | `http://localhost:3001` | API base URL |
| `NOVACORTEX_TOKEN` | — | required, `memories:write` scope |
| `NOVACORTEX_NAMESPACE` | `claude-code` | target namespace |
| `NOVACORTEX_MAX_TURNS` | `200` | most-recent transcript turns to send |
