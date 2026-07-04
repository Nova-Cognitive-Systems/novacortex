/**
 * A LangGraph {@link BaseStore} backed by your self-hosted NovaCortex
 * deployment. Drop it into `graph.compile({ store })` and give LangGraph agents
 * long-term, semantically searchable memory that lives on your own
 * infrastructure.
 *
 * ## Mapping LangGraph's KV store onto NovaCortex
 *
 * NovaCortex is a typed-memory + retrieval engine, not an arbitrary key-value
 * store, so the mapping is deliberately pragmatic (and documented so there are
 * no surprises):
 *
 * - **Namespace** — LangGraph's `string[]` namespace becomes one NovaCortex
 *   namespace string: `[prefix, ...ns].join('__')`, sanitized to
 *   `[a-zA-Z0-9_-]`. A namespace *prefix* search therefore resolves to a single
 *   NovaCortex namespace (NovaCortex has no sub-namespace hierarchy).
 * - **Key** — stored as a tag `lgkey:<key>` so items are findable/overwritable
 *   by key. `put` overwrites the existing item with the same key.
 * - **Value** — the memory `content` is the human-readable text of the value
 *   (`value.content ?? value.text ?? JSON.stringify(value)`), keeping it useful
 *   for semantic search. On read, JSON-object content is `JSON.parse`d back;
 *   anything else round-trips as `{ content: <raw> }`.
 */
import { BaseStore } from '@langchain/langgraph-checkpoint';
import type {
  Item,
  SearchItem,
  Operation,
  OperationResults,
  ListNamespacesOperation,
} from '@langchain/langgraph-checkpoint';
import type { NovaCortexClient, Memory } from '@novacortex/sdk';

const NS_SEP = '__';
const KEY_TAG_PREFIX = 'lgkey:';

export interface NovaCortexStoreOptions {
  /** A configured NovaCortex SDK client (points at your deployment). */
  client: NovaCortexClient;
  /**
   * Prefix prepended to every NovaCortex namespace, keeping LangGraph store data
   * isolated from other memories on the same deployment. @default 'langgraph'
   */
  namespacePrefix?: string;
}

type ListNamespacesInput = {
  prefix?: string[];
  suffix?: string[];
  maxDepth?: number;
  limit?: number;
  offset?: number;
};

type SearchInput = {
  filter?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  query?: string;
};

/** Replace any character outside the NovaCortex namespace charset. */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * LangGraph `BaseStore` implementation persisting to NovaCortex over the REST
 * SDK. Overrides the five concrete access methods directly; {@link batch} fans
 * out to those same methods (never the base-class helpers).
 */
export class NovaCortexStore extends BaseStore {
  private readonly client: NovaCortexClient;
  private readonly namespacePrefix: string;

  constructor(options: NovaCortexStoreOptions) {
    super();
    if (!options?.client) throw new Error('NovaCortexStore requires a `client`');
    this.client = options.client;
    this.namespacePrefix = options.namespacePrefix ?? 'langgraph';
  }

  // ── Namespace mapping ──────────────────────────────────────────────────────

  private toNamespace(ns: string[]): string {
    return sanitize([this.namespacePrefix, ...ns].join(NS_SEP));
  }

  private fromNamespace(nsString: string): string[] {
    const prefix = sanitize(this.namespacePrefix);
    if (nsString === prefix) return [];
    const withSep = prefix + NS_SEP;
    const rest = nsString.startsWith(withSep) ? nsString.slice(withSep.length) : nsString;
    return rest.length ? rest.split(NS_SEP) : [];
  }

  private keyTag(key: string): string {
    return `${KEY_TAG_PREFIX}${key}`;
  }

  // ── Value (de)serialization ────────────────────────────────────────────────

  private serializeValue(value: Record<string, unknown>): string {
    if (typeof value?.['content'] === 'string') return value['content'];
    if (typeof value?.['text'] === 'string') return value['text'] as string;
    return JSON.stringify(value);
  }

  private deserializeValue(content: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not JSON — fall through and treat the raw text as `content`.
    }
    return { content };
  }

  private extractKey(memory: Memory): string | undefined {
    const tag = (memory.metadata?.tags ?? []).find((t) => t.startsWith(KEY_TAG_PREFIX));
    return tag ? tag.slice(KEY_TAG_PREFIX.length) : undefined;
  }

  private itemFromMemory(memory: Memory, namespace: string[], score?: number): SearchItem {
    const key = this.extractKey(memory) ?? memory.id.id;
    const createdAt = new Date(memory.createdAt);
    const updatedAt = new Date(memory.updatedAt ?? memory.createdAt);
    const item: SearchItem = {
      value: this.deserializeValue(memory.content),
      key,
      namespace: [...namespace],
      createdAt,
      updatedAt,
    };
    if (score !== undefined) item.score = score;
    return item;
  }

  private async findByKey(namespace: string, key: string): Promise<Memory | undefined> {
    const res = await this.client.memories.list({ namespace, tags: [this.keyTag(key)], limit: 1 });
    return res?.data?.[0];
  }

  // ── BaseStore overrides ────────────────────────────────────────────────────

  override async get(namespace: string[], key: string): Promise<Item | null> {
    const ns = this.toNamespace(namespace);
    const memory = await this.findByKey(ns, key);
    return memory ? this.itemFromMemory(memory, namespace) : null;
  }

  override async put(
    namespace: string[],
    key: string,
    value: Record<string, unknown>,
    _index?: false | string[]
  ): Promise<void> {
    const ns = this.toNamespace(namespace);
    const content = this.serializeValue(value);
    const existing = await this.findByKey(ns, key);
    if (existing) {
      await this.client.memories.update(ns, existing.id.id, { content });
    } else {
      await this.client.memories.create({
        content,
        memoryType: 'semantic',
        namespace: ns,
        tags: [this.keyTag(key)],
      });
    }
  }

  override async delete(namespace: string[], key: string): Promise<void> {
    const ns = this.toNamespace(namespace);
    const memory = await this.findByKey(ns, key);
    if (memory) await this.client.memories.delete(ns, memory.id.id);
  }

  override async search(namespacePrefix: string[], options: SearchInput = {}): Promise<SearchItem[]> {
    const { query, filter, limit, offset } = options;
    const ns = this.toNamespace(namespacePrefix);

    let items: SearchItem[];
    if (query) {
      const res = await this.client.search({ query, namespace: ns, limit });
      items = (res?.data ?? []).map((r) => this.itemFromMemory(r.memory, namespacePrefix, r.score));
    } else {
      const res = await this.client.memories.list({ namespace: ns, limit, offset });
      items = (res?.data ?? []).map((m) => this.itemFromMemory(m, namespacePrefix));
    }

    if (filter && Object.keys(filter).length > 0) {
      items = items.filter((item) => matchesFilter(item.value, filter));
    }
    return items;
  }

  override async listNamespaces(options: ListNamespacesInput = {}): Promise<string[][]> {
    const { prefix, suffix, maxDepth, limit, offset } = options;
    const res = await this.client.namespaces.list();
    const sanitizedPrefix = sanitize(this.namespacePrefix);

    let namespaces = (res?.data ?? [])
      .filter((ns) => ns === sanitizedPrefix || ns.startsWith(sanitizedPrefix + NS_SEP))
      .map((ns) => this.fromNamespace(ns));

    if (prefix?.length) {
      namespaces = namespaces.filter((ns) => prefix.every((seg, i) => ns[i] === seg));
    }
    if (suffix?.length) {
      namespaces = namespaces.filter((ns) =>
        suffix.every((seg, i) => ns[ns.length - suffix.length + i] === seg)
      );
    }
    if (typeof maxDepth === 'number') {
      namespaces = namespaces.map((ns) => ns.slice(0, maxDepth));
    }

    // Truncation can create duplicates — dedupe while preserving order.
    const seen = new Set<string>();
    const deduped: string[][] = [];
    for (const ns of namespaces) {
      const k = JSON.stringify(ns);
      if (!seen.has(k)) {
        seen.add(k);
        deduped.push(ns);
      }
    }

    const start = offset ?? 0;
    const end = typeof limit === 'number' ? start + limit : undefined;
    return deduped.slice(start, end);
  }

  /**
   * Execute a batch of operations. The base class routes `get`/`put`/`delete`/
   * `search`/`listNamespaces` through here by default — we discriminate the op
   * shapes and dispatch to our own overrides so behavior is identical either
   * way. A {@link https://langchain-ai.github.io/langgraphjs/ | PutOperation}
   * with `value === null` is how the base class expresses a delete.
   */
  override async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    const results: unknown[] = [];
    for (const op of operations) {
      if ('value' in op) {
        // PutOperation — `value: null` means delete.
        if (op.value === null) {
          await this.delete(op.namespace, op.key);
        } else {
          await this.put(op.namespace, op.key, op.value, op.index);
        }
        results.push(undefined);
      } else if ('namespacePrefix' in op) {
        results.push(
          await this.search(op.namespacePrefix, {
            query: op.query,
            filter: op.filter,
            limit: op.limit,
            offset: op.offset,
          })
        );
      } else if ('key' in op) {
        results.push(await this.get(op.namespace, op.key));
      } else {
        results.push(await this.listNamespaces(listOptionsFromOperation(op)));
      }
    }
    return results as OperationResults<Op>;
  }
}

/** Best-effort exact-match filter. Operator objects (`{ $gt: … }`) are skipped. */
function matchesFilter(value: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    if (expected !== null && typeof expected === 'object') continue; // operators unsupported
    if (value?.[key] !== expected) return false;
  }
  return true;
}

/** Map a `ListNamespacesOperation` (match conditions) onto `listNamespaces` options. */
function listOptionsFromOperation(op: ListNamespacesOperation): ListNamespacesInput {
  const out: ListNamespacesInput = {};
  for (const cond of op.matchConditions ?? []) {
    const path = cond.path.filter((p): p is string => p !== '*');
    if (cond.matchType === 'prefix') out.prefix = path;
    else if (cond.matchType === 'suffix') out.suffix = path;
  }
  if (typeof op.maxDepth === 'number') out.maxDepth = op.maxDepth;
  if (typeof op.limit === 'number') out.limit = op.limit;
  if (typeof op.offset === 'number') out.offset = op.offset;
  return out;
}
