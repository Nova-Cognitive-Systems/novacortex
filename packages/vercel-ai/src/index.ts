/**
 * NovaCortex memory middleware for the Vercel AI SDK.
 *
 * Wrap any language model with `wrapLanguageModel({ model, middleware })` and
 * every turn gains long-term memory backed by your **own** NovaCortex
 * deployment: relevant past memories are retrieved and prepended as a system
 * message before generation, and each completed turn is captured back into
 * memory (async, fire-and-forget — it never adds latency to or breaks a
 * generation).
 *
 * ## Why no dependency on `ai` / `@ai-sdk/provider`?
 *
 * The AI SDK middleware contract is described here **structurally** rather than
 * imported. That keeps this adapter dependency-free and forward-compatible
 * across AI SDK v5/v6/v7 — those versions only differ in the optional
 * `middlewareVersion` discriminator, not in the call/stream shape this adapter
 * relies on. SDK-internal values we don't own are typed as `unknown`/narrow
 * records; our own public API (`NovaCortexMemoryOptions`) stays strictly typed.
 */
import type { NovaCortexClient } from '@novacortex/sdk';

// ── Structural mirror of the AI SDK LanguageModelV2 middleware surface ───────
// Only the fields this adapter reads are described; everything else is passed
// through opaquely.

interface PromptPart {
  type?: string;
  text?: string;
  [k: string]: unknown;
}

interface PromptMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | PromptPart[];
  [k: string]: unknown;
}

interface LanguageModelCallOptions {
  prompt: PromptMessage[];
  providerOptions?: Record<string, Record<string, unknown>>;
  providerMetadata?: Record<string, Record<string, unknown>>;
  [k: string]: unknown;
}

interface ContentPart {
  type: string;
  text?: string;
  [k: string]: unknown;
}

interface GenerateResult {
  content: ContentPart[];
  [k: string]: unknown;
}

interface StreamPart {
  type: string;
  /** AI SDK ≥5 uses `delta`; earlier previews used `textDelta`. Handle both. */
  delta?: string;
  textDelta?: string;
  [k: string]: unknown;
}

interface StreamResult {
  stream: ReadableStream<StreamPart>;
  [k: string]: unknown;
}

interface MiddlewareCall {
  type: 'generate' | 'stream';
  params: LanguageModelCallOptions;
  model: unknown;
}

interface WrapCall {
  doGenerate: () => PromiseLike<GenerateResult>;
  doStream: () => PromiseLike<StreamResult>;
  params: LanguageModelCallOptions;
  model: unknown;
}

/**
 * Structural equivalent of the AI SDK's `LanguageModelV2Middleware`. The return
 * value of {@link novacortexMemory} satisfies this and can be passed straight to
 * `wrapLanguageModel`.
 */
export interface LanguageModelV2Middleware {
  middlewareVersion?: 'v2';
  transformParams?: (options: MiddlewareCall) => PromiseLike<LanguageModelCallOptions>;
  wrapGenerate?: (options: WrapCall) => Promise<GenerateResult>;
  wrapStream?: (options: WrapCall) => PromiseLike<StreamResult>;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface NovaCortexMemoryOptions {
  /** A configured NovaCortex SDK client (points at your deployment). */
  client: NovaCortexClient;
  /**
   * Default namespace memories are stored/retrieved under. A per-request
   * `providerOptions.novacortex.namespace` (or a derived per-user namespace,
   * see `userId` below) takes precedence.
   * @default 'vercel-ai'
   */
  namespace?: string;
  /** How many memories to retrieve and inject per turn. @default 5 */
  limit?: number;
  /**
   * After each generation, capture the turn back into memory via
   * `/memories/ingest` (async job). Failures are swallowed — capture must never
   * break a generation, and is skipped silently when the server intelligence
   * layer is disabled (503). @default true
   */
  capture?: boolean;
  /**
   * Before each generation, retrieve relevant memories and prepend them as a
   * system message. @default true
   */
  retrieve?: boolean;
  /** Optional session id attached to captured turns. */
  sessionId?: string;
}

/** Per-request context read from `providerOptions`/`providerMetadata`. */
interface RequestContext {
  namespace?: string;
  userId?: string;
  sessionId?: string;
}

const MEMORY_PREAMBLE = 'Relevant memories from previous conversations:';

/**
 * Build NovaCortex memory middleware for the Vercel AI SDK.
 *
 * @example
 * ```ts
 * import { wrapLanguageModel } from 'ai';
 * import { novacortexMemory } from '@novacortex/vercel-ai';
 *
 * const model = wrapLanguageModel({
 *   model: openai('gpt-4o'),
 *   middleware: novacortexMemory({ client }),
 * });
 * ```
 */
export function novacortexMemory(options: NovaCortexMemoryOptions): LanguageModelV2Middleware {
  const {
    client,
    namespace: defaultNamespace = 'vercel-ai',
    limit = 5,
    capture = true,
    retrieve = true,
    sessionId,
  } = options;

  function readContext(params: LanguageModelCallOptions): RequestContext {
    const bag =
      (params.providerOptions?.['novacortex'] as Record<string, unknown> | undefined) ??
      (params.providerMetadata?.['novacortex'] as Record<string, unknown> | undefined) ??
      {};
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
    return { namespace: str(bag['namespace']), userId: str(bag['userId']), sessionId: str(bag['sessionId']) };
  }

  function resolveNamespace(ctx: RequestContext): string {
    if (ctx.namespace) return ctx.namespace;
    if (ctx.userId) return `${defaultNamespace}:${ctx.userId}`;
    return defaultNamespace;
  }

  /** Fire-and-forget capture of the just-finished turn. Never throws. */
  function captureTurn(params: LanguageModelCallOptions, assistantText: string): void {
    try {
      const ctx = readContext(params);
      const lastUserText = lastUserMessage(params.prompt);
      if (!lastUserText && !assistantText) return;
      const resolvedSession = ctx.sessionId ?? sessionId;
      void Promise.resolve(
        client.memories.ingest({
          messages: [
            { role: 'user', content: lastUserText },
            { role: 'assistant', content: assistantText },
          ],
          namespace: resolveNamespace(ctx),
          ...(resolvedSession ? { sessionId: resolvedSession } : {}),
        })
      ).catch(() => {
        /* capture is best-effort; swallow (e.g. 503 when intelligence is off) */
      });
    } catch {
      /* capture must never break generation */
    }
  }

  return {
    middlewareVersion: 'v2',

    async transformParams({ params }) {
      if (!retrieve) return params;
      const lastUserText = lastUserMessage(params.prompt);
      if (!lastUserText) return params;
      try {
        const ctx = readContext(params);
        const res = await client.search({ query: lastUserText, namespace: resolveNamespace(ctx), limit });
        const memories = (res?.data ?? [])
          .map((r) => r?.memory?.content)
          .filter((c): c is string => typeof c === 'string' && c.length > 0);
        if (memories.length === 0) return params;
        const systemMessage: PromptMessage = {
          role: 'system',
          content: `${MEMORY_PREAMBLE}\n${memories.map((m) => `- ${m}`).join('\n')}`,
        };
        return { ...params, prompt: [systemMessage, ...params.prompt] };
      } catch {
        // Retrieval must degrade silently — never block a generation.
        return params;
      }
    },

    async wrapGenerate({ doGenerate, params }) {
      const result = await doGenerate();
      if (capture) {
        const assistantText = (result?.content ?? [])
          .filter((p) => p?.type === 'text')
          .map((p) => p.text ?? '')
          .join('');
        captureTurn(params, assistantText);
      }
      return result;
    },

    async wrapStream({ doStream, params }) {
      const { stream, ...rest } = await doStream();
      if (!capture) return { stream, ...rest };

      let assistantText = '';
      const capturing = new TransformStream<StreamPart, StreamPart>({
        transform(chunk, controller) {
          if (chunk?.type === 'text-delta') {
            const delta = chunk.delta ?? chunk.textDelta;
            if (typeof delta === 'string') assistantText += delta;
          }
          controller.enqueue(chunk);
        },
        flush() {
          captureTurn(params, assistantText);
        },
      });

      return { stream: stream.pipeThrough(capturing), ...rest };
    },
  };
}

/** Text of the most recent user message (handles string and parts-array content). */
function lastUserMessage(prompt: PromptMessage[]): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const msg = prompt[i];
    if (msg?.role !== 'user') continue;
    const text = partText(msg.content);
    if (text) return text;
  }
  return '';
}

function partText(content: string | PromptPart[] | undefined): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((p) => p?.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('')
      .trim();
  }
  return '';
}
