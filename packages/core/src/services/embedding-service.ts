/**
 * EmbeddingService — single source of truth for turning text into vectors.
 *
 * Previously the only embedding code lived in the API's background processor and
 * only ever embedded STORED memories. Nothing embedded a search *query*, so the
 * vector index was unreachable through the first-party interfaces (REST / MCP /
 * CLI all fell back to substring matching). This service is shared by the API,
 * the MCP server and the processor so that both sides of search — indexing AND
 * querying — use the exact same model and dimensions.
 */

export interface EmbeddingServiceConfig {
  /** OpenAI (or compatible) API key. Defaults to process.env.OPENAI_API_KEY. */
  apiKey?: string;
  /** Embedding model. Defaults to process.env.EMBEDDING_MODEL or text-embedding-3-small. */
  model?: string;
  /** API base URL (OpenAI-compatible). Defaults to https://api.openai.com/v1. */
  baseUrl?: string;
  /** Max characters of input per item sent to the model. */
  maxInputChars?: number;
}

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MAX_INPUT_CHARS = 8000;

export class EmbeddingService {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxInputChars: number;
  // Small LRU cache for single-text embeddings (search queries repeat often).
  private readonly cache = new Map<string, number[]>();
  private readonly cacheMax = 500;

  constructor(config: EmbeddingServiceConfig = {}) {
    // Use || (not ??) so an EMPTY-STRING env var — e.g. compose's
    // `OPENAI_BASE_URL=${OPENAI_BASE_URL:-}` — falls back to the default instead
    // of producing an invalid URL like "/embeddings".
    this.apiKey = config.apiKey || process.env['OPENAI_API_KEY'] || undefined;
    this.model = config.model || process.env['EMBEDDING_MODEL'] || DEFAULT_MODEL;
    this.baseUrl = (config.baseUrl || process.env['OPENAI_BASE_URL'] || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.maxInputChars = config.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
  }

  /** True when an API key is configured and embeddings can be generated. */
  isEnabled(): boolean {
    return !!this.apiKey;
  }

  /** The model identifier in use (useful for logging / diagnostics). */
  getModel(): string {
    return this.model;
  }

  /**
   * Probe the embedding endpoint with a tiny request and report the actual
   * vector dimension it produces. Used at startup to detect a mismatch between
   * the model's output and the configured Qdrant vector size BEFORE garbage
   * vectors get stored (a wrong dimension makes every upsert fail silently in
   * the background). Distinguishes "disabled" (no key), "unreachable" (endpoint
   * down / model still loading) and "ok".
   */
  async probe(): Promise<
    | { status: 'disabled' }
    | { status: 'unreachable'; error: string }
    | { status: 'ok'; dimension: number }
  > {
    if (!this.apiKey) return { status: 'disabled' };
    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: this.model, input: ['dimension probe'] }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return { status: 'unreachable', error: `embedding endpoint returned ${response.status}` };
      }
      const data = (await response.json()) as { data?: { embedding: number[] }[] };
      const vec = data.data?.[0]?.embedding;
      if (!vec || vec.length === 0) {
        return { status: 'unreachable', error: 'embedding endpoint returned no vector' };
      }
      return { status: 'ok', dimension: vec.length };
    } catch (e) {
      return { status: 'unreachable', error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Embed a single text. Returns null if embeddings are disabled (no key) or the
   * request fails — callers should treat null as "fall back to text search".
   */
  async embed(text: string): Promise<number[] | null> {
    if (!this.apiKey) return null;
    const cacheKey = `${this.model}:${text.slice(0, this.maxInputChars)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.length > 0) {
      // Refresh LRU recency.
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached;
    }
    const [vec] = await this.embedBatch([text]);
    // Treat an empty vector as failure: never cache it (would poison the LRU and
    // would be fed to Qdrant as an invalid query vector).
    if (vec && vec.length > 0) {
      this.cache.set(cacheKey, vec);
      if (this.cache.size > this.cacheMax) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      return vec;
    }
    return null;
  }

  /**
   * Embed a batch of texts in one request. Returns one vector per input (or null
   * for the whole batch on failure / when disabled). Empty input → empty array.
   */
  async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    if (!this.apiKey) return texts.map(() => null);
    if (texts.length === 0) return [];

    const input = texts.map((t) => t.slice(0, this.maxInputChars));

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: this.model, input }),
      });

      if (!response.ok) {
        console.error(`[EmbeddingService] OpenAI returned ${response.status}`);
        return texts.map(() => null);
      }

      const data = (await response.json()) as {
        data?: { embedding: number[]; index: number }[];
      };
      const rows = data.data ?? [];
      // Map back by index to preserve order regardless of API ordering.
      const out: (number[] | null)[] = texts.map(() => null);
      for (const row of rows) {
        if (typeof row.index === 'number' && row.embedding) {
          out[row.index] = row.embedding;
        }
      }
      return out;
    } catch (e) {
      console.error('[EmbeddingService] embed error:', e);
      return texts.map(() => null);
    }
  }
}
