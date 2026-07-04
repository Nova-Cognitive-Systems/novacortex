# @novacortex/langgraph

A [LangGraph](https://langchain-ai.github.io/langgraphjs/) `BaseStore` backed by
your **own** [NovaCortex](https://github.com/Nova-Cognitive-Systems/novacortex)
deployment. Give LangGraph agents long-term, semantically searchable memory
that lives entirely on your own infrastructure — drop it into
`graph.compile({ store })` and read/write it from any node via `config.store`.

## Install

```bash
npm install @novacortex/langgraph @novacortex/sdk @langchain/langgraph @langchain/langgraph-checkpoint
```

## Usage

```ts
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { NovaCortexClient } from '@novacortex/sdk';
import { NovaCortexStore } from '@novacortex/langgraph';

const client = new NovaCortexClient({
  baseUrl: process.env.NOVACORTEX_URL!, // your deployment, e.g. http://localhost:3001
  token: process.env.NOVACORTEX_TOKEN!, // token with memories:read + memories:write
});

const store = new NovaCortexStore({ client });

const graph = new StateGraph(MessagesAnnotation)
  .addNode('respond', async (state, config) => {
    const store = config.store!;
    const userId = config.configurable?.userId ?? 'anon';

    // Write a memory.
    await store.put(['memories', userId], 'fav-language', { content: 'Prefers TypeScript' });

    // Semantic search over this user's memories.
    const hits = await store.search(['memories', userId], {
      query: 'what languages does the user like?',
      limit: 5,
    });

    // …use `hits` to ground the model's response…
    return {};
  })
  .addEdge('__start__', 'respond')
  .compile({ store }); // ← attach the store here
```

Inside a node the store is available as `config.store` (the runtime injects the
one you passed to `compile`).

### Import-path caveat

`BaseStore` comes from **`@langchain/langgraph`** (re-exported) or
**`@langchain/langgraph-checkpoint`** (its home). Do **not** import it from
`@langchain/core/stores` — that is a different, unrelated `BaseStore`. This
package extends the checkpoint one:

```ts
import { BaseStore } from '@langchain/langgraph-checkpoint'; // ✅
// import { BaseStore } from '@langchain/core/stores';        // ❌ wrong class
```

## How LangGraph's KV store maps onto NovaCortex

NovaCortex is a typed-memory + retrieval engine, not an arbitrary key-value
store, so the mapping is deliberately pragmatic:

| LangGraph | NovaCortex |
|---|---|
| `namespace: string[]` | one namespace string `[prefix, ...ns].join('__')`, sanitized to `[a-zA-Z0-9_-]` |
| `key` | a tag `lgkey:<key>` (makes items findable and overwritable by key) |
| `value` | memory `content` = `value.content ?? value.text ?? JSON.stringify(value)` — kept human-readable so semantic search works |

On read, JSON-object content is `JSON.parse`d back into the value; anything else
round-trips as `{ content: <raw> }`. `put` overwrites the item with the same key
(update in place). `search({ query })` runs NovaCortex hybrid search; without a
query it lists the namespace. Because each LangGraph namespace collapses to a
single NovaCortex namespace (NovaCortex has no sub-namespace hierarchy), a
`search`/`listNamespaces` *prefix* resolves to that exact namespace.

### Constructor options

```ts
new NovaCortexStore({
  client,                    // NovaCortexClient (required)
  namespacePrefix: 'langgraph', // prepended to every namespace to isolate store data
});
```

## Privacy

Every read and write goes only to the NovaCortex `baseUrl` you configure. Point
it at a self-hosted deployment and your agents' memory never leaves your own
infrastructure.

## License

Apache-2.0
