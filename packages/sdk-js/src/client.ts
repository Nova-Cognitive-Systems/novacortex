import {
  AuthError,
  ConnectionError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
  NovaCortexError,
} from './errors.js';
import type {
  ClientOptions,
  CreateMemoryInput,
  CreateRelationInput,
  ListMemoriesOptions,
  ListResponse,
  Memory,
  NamespacesResponse,
  SearchOptions,
  SearchResponse,
  StatsResponse,
  UpdateMemoryInput,
  WhoamiResponse,
} from './types.js';

type QueryValue = string | number | boolean | string[] | undefined;

function buildQuery(params: Record<string, QueryValue>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) sp.append(key, v);
    } else {
      sp.append(key, String(value));
    }
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export class NovaCortexClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number | undefined;
  private readonly userAgent: string;

  readonly memories: MemoriesResource;
  readonly relations: RelationsResource;
  readonly namespaces: NamespacesResource;

  constructor(opts: ClientOptions) {
    if (!opts?.baseUrl) throw new NovaCortexError('baseUrl is required');
    if (!opts?.token) throw new NovaCortexError('token is required');
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new NovaCortexError('No fetch implementation available; pass one via options.fetch');
    }
    this.timeoutMs = opts.timeoutMs;
    this.userAgent = opts.userAgent ?? '@novacortex/sdk';

    this.memories = new MemoriesResource(this);
    this.relations = new RelationsResource(this);
    this.namespaces = new NamespacesResource(this);
  }

  /** @internal */
  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'User-Agent': this.userAgent,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = this.timeoutMs ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller?.signal,
      });
    } catch (err) {
      throw new ConnectionError(
        `Could not reach NovaCortex at ${this.baseUrl}: ${(err as Error).message}`
      );
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) throw this.toError(res.status, parsed);
    return parsed as T;
  }

  private toError(status: number, body: unknown): NovaCortexError {
    const b = (body ?? {}) as { error?: string; message?: string; required?: string[]; granted?: string[] };
    const msg = b.message || b.error || `HTTP ${status}`;
    switch (status) {
      case 401:
        return new AuthError(msg, body);
      case 403:
        return new ForbiddenError(msg, body, b.required, b.granted);
      case 404:
        return new NotFoundError(msg, body);
      case 400:
      case 422:
        return new ValidationError(msg, status, body);
      case 429:
        return new RateLimitError(msg, body);
      default:
        if (status >= 500) return new ServerError(msg, status, body);
        return new NovaCortexError(msg, status, body);
    }
  }

  // ── Top-level convenience ────────────────────────────────────────────────

  /**
   * Semantic / vector search. Pass `{ query }` for a natural-language query
   * (embedded server-side → vector search, with text fallback) or `{ vector }`
   * for a pre-computed embedding.
   */
  async search(
    input: ({ query: string } | { vector: number[] }) & SearchOptions
  ): Promise<SearchResponse> {
    return this.request<SearchResponse>('POST', '/search', input);
  }

  async stats(): Promise<StatsResponse> {
    return this.request<StatsResponse>('GET', '/stats');
  }

  async health(): Promise<{ status: string; [k: string]: unknown }> {
    return this.request('GET', '/health');
  }

  async whoami(): Promise<WhoamiResponse> {
    return this.request<WhoamiResponse>('GET', '/auth/whoami');
  }

  /** Export a namespace as JSON (or PMF when `format: 'pmf'`). */
  async export(
    namespace: string,
    opts: { format?: 'json' | 'pmf'; embeddings?: boolean } = {}
  ): Promise<unknown> {
    const base = `/memories/export/${encodeURIComponent(namespace)}${opts.format === 'pmf' ? '/pmf' : ''}`;
    return this.request('GET', `${base}${buildQuery({ embeddings: opts.embeddings })}`);
  }

  /** Import memories (JSON payload) or a PMF document (`format: 'pmf'`). */
  async import(data: unknown, opts: { format?: 'json' | 'pmf' } = {}): Promise<unknown> {
    return this.request('POST', opts.format === 'pmf' ? '/memories/import/pmf' : '/memories/import', data);
  }
}

class MemoriesResource {
  constructor(private readonly client: NovaCortexClient) {}

  create(input: CreateMemoryInput): Promise<Memory> {
    return this.client.request<Memory>('POST', '/memories', input);
  }

  get(namespace: string, id: string, opts: { includeRelations?: boolean } = {}): Promise<Memory> {
    const q = buildQuery({ includeRelations: opts.includeRelations });
    return this.client.request<Memory>('GET', `/memories/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}${q}`);
  }

  list(opts: ListMemoriesOptions = {}): Promise<ListResponse<Memory>> {
    const q = buildQuery({
      namespace: opts.namespace,
      memoryTypes: opts.memoryTypes,
      tags: opts.tags,
      limit: opts.limit,
      offset: opts.offset,
      minSalience: opts.minSalience,
      query: opts.query,
      includeRelations: opts.includeRelations,
    });
    return this.client.request<ListResponse<Memory>>('GET', `/memories${q}`);
  }

  update(namespace: string, id: string, patch: UpdateMemoryInput): Promise<Memory> {
    return this.client.request<Memory>('PATCH', `/memories/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`, patch);
  }

  delete(namespace: string, id: string): Promise<void> {
    return this.client.request<void>('DELETE', `/memories/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`);
  }

  similar(namespace: string, id: string, opts: { limit?: number } = {}): Promise<SearchResponse> {
    const q = buildQuery({ limit: opts.limit });
    return this.client.request<SearchResponse>('GET', `/memories/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}/similar${q}`);
  }

  relations(namespace: string, id: string): Promise<unknown> {
    return this.client.request('GET', `/memories/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}/relations`);
  }
}

class RelationsResource {
  constructor(private readonly client: NovaCortexClient) {}

  create(input: CreateRelationInput): Promise<unknown> {
    return this.client.request('POST', '/memories/relations', input);
  }

  delete(id: string): Promise<void> {
    return this.client.request<void>('DELETE', `/memories/relations/${encodeURIComponent(id)}`);
  }
}

class NamespacesResource {
  constructor(private readonly client: NovaCortexClient) {}

  list(): Promise<NamespacesResponse> {
    return this.client.request<NamespacesResponse>('GET', '/namespaces');
  }

  create(name: string): Promise<unknown> {
    return this.client.request('POST', '/namespaces', { name });
  }

  delete(name: string): Promise<void> {
    return this.client.request<void>('DELETE', `/namespaces/${encodeURIComponent(name)}`);
  }
}
