# @novacortex/sdk

Official TypeScript/JavaScript SDK for [NovaCortex](https://github.com/Nova/novacortex) — the
self-hosted, graph-native AI memory layer.

```bash
npm install @novacortex/sdk
```

## Quick start

```ts
import { NovaCortexClient } from '@novacortex/sdk';

const nc = new NovaCortexClient({
  baseUrl: 'http://localhost:3001',
  token: process.env.NOVACORTEX_TOKEN!,
});

// Store a memory
const memory = await nc.memories.create({
  content: 'The user prefers TypeScript and dark mode.',
  memoryType: 'semantic',
  namespace: 'my-agent',
  tags: ['preference'],
});

// Semantic search — the query is embedded server-side (no client-side embeddings
// needed). Falls back to substring search when embeddings are disabled.
const { data, mode } = await nc.search({
  query: 'what does the user like?',
  namespace: 'my-agent',
  limit: 5,
});
console.log(mode); // 'semantic' | 'text' | 'vector'
for (const r of data) console.log(r.score, r.memory.content);
```

## API

| Call | Description |
| --- | --- |
| `nc.memories.create(input)` | Create a memory |
| `nc.memories.get(ns, id, { includeRelations })` | Fetch by id |
| `nc.memories.list(options)` | List / filter memories |
| `nc.memories.update(ns, id, patch)` | Update a memory |
| `nc.memories.delete(ns, id)` | Delete a memory |
| `nc.memories.similar(ns, id, { limit })` | Find similar memories |
| `nc.memories.relations(ns, id)` | List a memory's relations |
| `nc.search({ query \| vector, ...opts })` | Semantic / vector search |
| `nc.relations.create(input)` / `nc.relations.delete(id)` | Manage relations |
| `nc.namespaces.list() / create(name) / delete(name)` | Manage namespaces |
| `nc.export(ns, { format, embeddings })` / `nc.import(data, { format })` | Portable Memory Format (JSON / PMF) |
| `nc.stats()` / `nc.health()` / `nc.whoami()` | Server info |

## Errors

All failures throw a typed subclass of `NovaCortexError`: `AuthError` (401),
`ForbiddenError` (403), `NotFoundError` (404), `ValidationError` (400/422),
`RateLimitError` (429), `ServerError` (5xx), `ConnectionError` (network).

```ts
import { NotFoundError } from '@novacortex/sdk';

try {
  await nc.memories.get('my-agent', 'missing-id');
} catch (err) {
  if (err instanceof NotFoundError) { /* handle 404 */ }
}
```

## Requirements

Node.js ≥ 18 (uses the global `fetch`). Pass a custom implementation via
`new NovaCortexClient({ ..., fetch })` for older runtimes.

## License

MIT
