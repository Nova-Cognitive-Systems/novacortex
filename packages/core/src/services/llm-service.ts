/**
 * LLMService — single source of truth for chat-completion calls made by the
 * memory intelligence layer (fact extraction, update resolution).
 *
 * Mirrors the EmbeddingService contract: OpenAI-compatible `/chat/completions`
 * over plain fetch, env-driven config, and graceful degradation — when no
 * model/key is configured every call returns null and the engine behaves
 * exactly like the pre-intelligence substrate. Works against any
 * OpenAI-compatible endpoint (OpenAI, Ollama, vLLM, LM Studio, LiteLLM).
 *
 * Privacy note: intelligence is a CONSCIOUS opt-in via LLM_MODEL. An embedding
 * key alone never causes memory content to be sent to a chat model.
 */

export interface LLMServiceConfig {
  /** API key. Defaults to LLM_API_KEY, then OPENAI_API_KEY. */
  apiKey?: string;
  /** Chat model. No default — unset means the intelligence layer is DISABLED. */
  model?: string;
  /** API base URL. Defaults to LLM_BASE_URL, then OPENAI_BASE_URL, then OpenAI. */
  baseUrl?: string;
  /** Max tokens per completion (default 2048). */
  maxTokens?: number;
  /** Request timeout in ms (default 120000 — local models can be slow). */
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TIMEOUT_MS = 120_000;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

export class LLMService {
  private readonly apiKey: string | undefined;
  private readonly model: string | undefined;
  private readonly baseUrl: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(config: LLMServiceConfig = {}) {
    // `||` (not `??`) so empty-string env vars fall through to the next source
    // (compose ships `VAR=${VAR:-}` which yields empty strings when unset).
    this.apiKey =
      config.apiKey || process.env['LLM_API_KEY'] || process.env['OPENAI_API_KEY'] || undefined;
    this.model = config.model || process.env['LLM_MODEL'] || undefined;
    this.baseUrl = (
      config.baseUrl ||
      process.env['LLM_BASE_URL'] ||
      process.env['OPENAI_BASE_URL'] ||
      DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** True when a model AND key are configured and intelligence can run. */
  isEnabled(): boolean {
    return !!this.apiKey && !!this.model;
  }

  /** The model identifier in use (for logging / diagnostics). */
  getModel(): string | undefined {
    return this.model;
  }

  /**
   * Run a completion and return the raw assistant text (null when disabled or
   * on any failure — callers treat null as "intelligence unavailable").
   */
  async complete(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts: { json?: boolean } = {}
  ): Promise<string | null> {
    if (!this.isEnabled()) return null;
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0,
          max_tokens: this.maxTokens,
          // Constrained decoding where supported (OpenAI, Ollama >= 0.5, vLLM):
          // greatly improves strict-JSON reliability on small local models.
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        console.error(`[LLMService] endpoint returned ${response.status}`);
        return null;
      }
      const data = (await response.json()) as ChatCompletionResponse;
      return data.choices?.[0]?.message?.content ?? null;
    } catch (e) {
      console.error('[LLMService] completion error:', e instanceof Error ? e.message : e);
      return null;
    }
  }

  /**
   * Completion that must return a JSON object. Strips code fences, parses, and
   * retries ONCE with an explicit repair instruction on malformed output —
   * small local models occasionally wrap or truncate JSON. Returns null when
   * disabled or when both attempts fail validation.
   */
  async completeJSON<T>(
    system: string,
    user: string,
    validate?: (parsed: unknown) => parsed is T
  ): Promise<T | null> {
    if (!this.isEnabled()) return null;

    const attempt = async (extraInstruction?: string): Promise<T | null> => {
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: system },
        { role: 'user', content: extraInstruction ? `${user}\n\n${extraInstruction}` : user },
      ];
      const raw = await this.complete(messages, { json: true });
      if (!raw) return null;
      const cleaned = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      try {
        const parsed = JSON.parse(cleaned) as unknown;
        if (validate && !validate(parsed)) return null;
        return parsed as T;
      } catch {
        return null;
      }
    };

    const first = await attempt();
    if (first !== null) return first;
    return attempt('Your previous output was not valid JSON. Respond with ONLY a valid JSON object — no prose, no code fences.');
  }
}
