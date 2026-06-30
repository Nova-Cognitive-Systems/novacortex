/**
 * WebhookService — register HTTP endpoints that receive POSTs when memories
 * change (or the processor completes). Roadmap v1.1.
 *
 * Persistence mirrors TokenService (SurrealLike `webhooks` table). Deliveries are
 * fire-and-forget, HMAC-signed (per-webhook secret), and retried with backoff so
 * a slow/failing subscriber never blocks the API request path.
 */
import crypto from 'crypto';
import { Surreal } from 'surrealdb';

export type WebhookEvent =
  | 'memory.created'
  | 'memory.updated'
  | 'memory.deleted'
  | 'processor.completed';

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  'memory.created',
  'memory.updated',
  'memory.deleted',
  'processor.completed',
];

export interface WebhookRecord {
  webhookId: string;
  url: string;
  events: WebhookEvent[];
  /** Present only at creation time in the response; stored for signing. */
  secret?: string;
  active: boolean;
  createdAt: string;
}

export interface SurrealDBConfig {
  url: string;
  user: string;
  pass: string;
  namespace: string;
  database: string;
}

export interface SurrealLike {
  query<T = unknown>(sql: string, params?: Record<string, unknown>): Promise<T>;
}

export interface RegisterWebhookInput {
  url: string;
  events: WebhookEvent[];
  secret?: string;
  active?: boolean;
}

export interface WebhookServiceOptions {
  fetch?: typeof fetch;
  maxAttempts?: number;
  timeoutMs?: number;
  /** Base backoff between delivery retries (ms); doubles each attempt. */
  backoffMs?: number;
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function signPayload(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export class WebhookService {
  private db: SurrealLike | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly backoffMs: number;
  /** Tracks in-flight deliveries so tests (and graceful shutdown) can await them. */
  private readonly inflight = new Set<Promise<void>>();

  constructor(db?: SurrealLike, opts: WebhookServiceOptions = {}) {
    if (db) this.db = db;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.backoffMs = opts.backoffMs ?? 250;
  }

  /** Await all in-flight deliveries (used by tests). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.inflight]);
  }

  async connect(cfg: SurrealDBConfig): Promise<void> {
    if (!this.db) {
      const real = new Surreal();
      let wsUrl = cfg.url.replace(/^http/, 'ws');
      if (!/\/rpc\/?$/.test(wsUrl)) {
        wsUrl = `${wsUrl.replace(/\/+$/, '')}/rpc`;
      }
      await real.connect(new URL(wsUrl), {
        versionCheck: false,
        namespace: cfg.namespace,
        database: cfg.database,
        authentication: { username: cfg.user, password: cfg.pass },
      });
      this.db = real as unknown as SurrealLike;
    }
    await this.initSchema();
  }

  private async initSchema(): Promise<void> {
    if (!this.db) return;
    await this.db.query('DEFINE TABLE IF NOT EXISTS webhooks SCHEMALESS;');
  }

  private requireDb(): SurrealLike {
    if (!this.db) throw new Error('WebhookService not connected — call connect() first');
    return this.db;
  }

  async register(input: RegisterWebhookInput): Promise<WebhookRecord> {
    if (!isHttpUrl(input.url)) throw new Error('webhook url must be a valid http(s) URL');
    if (!Array.isArray(input.events) || input.events.length === 0) {
      throw new Error('at least one event is required');
    }
    const invalid = input.events.filter((e) => !WEBHOOK_EVENTS.includes(e));
    if (invalid.length) throw new Error(`unknown event(s): ${invalid.join(', ')}`);

    const record: WebhookRecord = {
      webhookId: `wh_${crypto.randomBytes(12).toString('hex')}`,
      url: input.url,
      events: input.events,
      secret: input.secret ?? `whsec_${crypto.randomBytes(24).toString('hex')}`,
      active: input.active ?? true,
      createdAt: new Date().toISOString(),
    };

    await this.requireDb().query(
      'CREATE webhooks SET webhookId = $webhookId, url = $url, events = $events, secret = $secret, active = $active, createdAt = $createdAt',
      { ...record }
    );
    return record;
  }

  async list(): Promise<WebhookRecord[]> {
    const rows = await this.requireDb().query<WebhookRecord[][]>('SELECT * FROM webhooks');
    const list = rows?.[0] ?? [];
    // Never leak secrets when listing.
    return list.map(({ secret: _secret, ...rest }) => rest as WebhookRecord);
  }

  async get(webhookId: string): Promise<WebhookRecord | null> {
    const rows = await this.requireDb().query<WebhookRecord[][]>(
      'SELECT * FROM webhooks WHERE webhookId = $webhookId LIMIT 1',
      { webhookId }
    );
    return rows?.[0]?.[0] ?? null;
  }

  async remove(webhookId: string): Promise<boolean> {
    const existing = await this.get(webhookId);
    if (!existing) return false;
    await this.requireDb().query('DELETE FROM webhooks WHERE webhookId = $webhookId', { webhookId });
    return true;
  }

  /**
   * Emit an event to all active webhooks subscribed to it. Resolves once
   * deliveries are dispatched; each delivery runs (and retries) independently in
   * the background so the caller is never blocked.
   */
  async emit(event: WebhookEvent, data: unknown): Promise<void> {
    if (!this.db) return;
    let rows: WebhookRecord[][];
    try {
      rows = await this.db.query<WebhookRecord[][]>('SELECT * FROM webhooks');
    } catch {
      return;
    }
    const targets = (rows?.[0] ?? []).filter((w) => w.active && w.events.includes(event));
    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data });

    for (const wh of targets) {
      const p = this.deliver(wh, event, body).finally(() => this.inflight.delete(p));
      this.inflight.add(p);
    }
  }

  private async deliver(wh: WebhookRecord, event: WebhookEvent, body: string): Promise<void> {
    const signature = wh.secret ? signPayload(wh.secret, body) : '';
    const deliveryId = `whd_${crypto.randomBytes(8).toString('hex')}`;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(wh.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'NovaCortex-Webhooks',
            'X-NovaCortex-Event': event,
            'X-NovaCortex-Delivery': deliveryId,
            ...(signature ? { 'X-NovaCortex-Signature': `sha256=${signature}` } : {}),
          },
          body,
          signal: controller.signal,
        });
        if (res.ok) return;
      } catch {
        // network error / timeout — fall through to retry
      } finally {
        clearTimeout(timer);
      }
      if (attempt < this.maxAttempts) {
        await new Promise((r) => setTimeout(r, this.backoffMs * 2 ** (attempt - 1)));
      }
    }
    console.error(`[Webhooks] delivery to ${wh.url} failed after ${this.maxAttempts} attempts`);
  }
}

/** Module-level singleton wired by the API at startup (mirrors getProcessor). */
let instance: WebhookService | null = null;
export function setWebhookService(svc: WebhookService): void {
  instance = svc;
}
export function getWebhookService(): WebhookService | null {
  return instance;
}
