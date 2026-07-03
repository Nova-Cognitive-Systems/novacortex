/**
 * RerankService — optional cross-encoder reranking stage for search.
 *
 * Speaks the de-facto /rerank contract (HuggingFace Text Embeddings Inference,
 * also emitted by Jina/Cohere-compatible servers): POST {query, texts[]} ->
 * [{index, score}] (or {results: [{index, relevance_score}]}). Works with a
 * fully-local TEI sidecar (e.g. BAAI/bge-reranker or Qwen3-Reranker) — the
 * privacy-first path — or any hosted endpoint.
 *
 * Same contract as the other services: unconfigured = disabled = no-op, and
 * any failure degrades to the unreranked order (never breaks search).
 */

export interface RerankServiceConfig {
  /** Rerank endpoint base URL (e.g. http://reranker:8080). Unset = disabled. */
  url?: string;
  /** Optional model name forwarded to the endpoint. */
  model?: string;
  /** Optional bearer key. */
  apiKey?: string;
  /** Request timeout in ms (default 10000). */
  timeoutMs?: number;
}

interface RerankResult {
  index: number;
  score: number;
}

export class RerankService {
  private readonly url: string | undefined;
  private readonly model: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(config: RerankServiceConfig = {}) {
    this.url = (config.url || process.env['RERANK_URL'] || '').replace(/\/+$/, '') || undefined;
    this.model = config.model || process.env['RERANK_MODEL'] || undefined;
    this.apiKey = config.apiKey || process.env['RERANK_API_KEY'] || undefined;
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  isEnabled(): boolean {
    return !!this.url;
  }

  /**
   * Score texts against the query. Returns per-input scores aligned by index,
   * or null when disabled / on any failure (callers keep the original order).
   */
  async rerank(query: string, texts: string[]): Promise<number[] | null> {
    if (!this.url || texts.length === 0) return null;
    try {
      const endpoint = this.url.endsWith('/rerank') ? this.url : `${this.url}/rerank`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          query,
          texts,
          // TEI ignores unknown fields; Cohere/Jina-style servers use these.
          ...(this.model ? { model: this.model } : {}),
          documents: texts,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        console.error(`[RerankService] endpoint returned ${response.status}`);
        return null;
      }
      const data = (await response.json()) as unknown;

      // TEI shape: [{index, score}]; Cohere/Jina shape: {results:[{index, relevance_score}]}
      const rows: RerankResult[] = Array.isArray(data)
        ? (data as Array<{ index: number; score: number }>).map((r) => ({ index: r.index, score: r.score }))
        : Array.isArray((data as { results?: unknown }).results)
          ? ((data as { results: Array<{ index: number; relevance_score?: number; score?: number }> }).results).map(
              (r) => ({ index: r.index, score: r.relevance_score ?? r.score ?? 0 })
            )
          : [];

      if (rows.length === 0) return null;
      const scores = new Array<number>(texts.length).fill(0);
      for (const row of rows) {
        if (typeof row.index === 'number' && row.index >= 0 && row.index < texts.length) {
          scores[row.index] = row.score;
        }
      }
      return scores;
    } catch (e) {
      console.error('[RerankService] rerank error:', e instanceof Error ? e.message : e);
      return null;
    }
  }
}
