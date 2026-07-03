# @novacortex/vercel-ai

Give any [Vercel AI SDK](https://sdk.vercel.ai) model long-term memory backed by
your **own** [NovaCortex](https://github.com/Nova-Cognitive-Systems/novacortex)
deployment. Wrap a model once and every turn gains:

- **Retrieval** — relevant memories from past conversations are pulled with
  NovaCortex's hybrid search and prepended as a system message before
  generation.
- **Capture** — each completed turn is distilled back into memory via
  `/memories/ingest` (an async job on the server — it adds no latency to your
  generation and can never break it).

It's a standard [`LanguageModelV2Middleware`](https://sdk.vercel.ai/docs/ai-sdk-core/middleware),
so it composes with everything else in the AI SDK.

## Install

```bash
npm install @novacortex/vercel-ai @novacortex/sdk ai
```

## Usage

```ts
import { openai } from '@ai-sdk/openai';
import { generateText, wrapLanguageModel } from 'ai';
import { NovaCortexClient } from '@novacortex/sdk';
import { novacortexMemory } from '@novacortex/vercel-ai';

const client = new NovaCortexClient({
  baseUrl: process.env.NOVACORTEX_URL!, // your deployment, e.g. http://localhost:3001
  token: process.env.NOVACORTEX_TOKEN!, // token with memories:read + memories:write
});

const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: novacortexMemory({ client }),
});

const { text } = await generateText({
  model,
  prompt: 'Where did I say I was travelling next month?',
});
```

`generateText`, `streamText`, and their `*Object` variants all work — retrieval
runs in `transformParams`, capture in `wrapGenerate`/`wrapStream`.

## Per-user namespacing

Isolate memory per user (or per tenant, per thread, …) at request time via
`providerOptions.novacortex`. A request-level `namespace` wins over the default;
passing `userId` derives `"<namespace>:<userId>"` automatically:

```ts
await generateText({
  model,
  prompt: userMessage,
  providerOptions: {
    novacortex: {
      userId: 'user_123',       // → namespace "vercel-ai:user_123"
      // namespace: 'team-acme', // …or set the namespace explicitly
      // sessionId: 'thread-9',  // …optionally tag captured turns
    },
  },
});
```

## Options

```ts
novacortexMemory({
  client,                 // NovaCortexClient (required)
  namespace: 'vercel-ai', // default namespace (per-request override wins)
  limit: 5,               // memories retrieved per turn
  retrieve: true,         // prepend relevant memories before generation
  capture: true,          // ingest each turn back into memory (fire-and-forget)
  sessionId: undefined,   // optional session id attached to captured turns
});
```

Retrieval failures degrade silently (the generation proceeds with the original
prompt). Capture is best-effort and swallowed on error — including a `503` when
the server's intelligence layer is disabled — so it never interrupts a
generation.

## Privacy

Nothing leaves infrastructure you control. Prompts, completions, and the
memories derived from them are sent only to the NovaCortex `baseUrl` you
configure. Point it at a self-hosted deployment (pair it with the `local-ai`
compose profile for on-device embeddings + LLM) and your conversation memory
never touches a third party.

## License

Apache-2.0
