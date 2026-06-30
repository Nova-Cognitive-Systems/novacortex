import {
  InvalidTokenError,
  InsufficientScopeError,
  ServerUnreachableError,
} from '../lib/errors.js';

export interface HttpClientOptions {
  url: string;
  token: string;
  userAgent?: string;
}

interface ErrorBody {
  error?: string;
  message?: string;
  required?: string[];
  granted?: string[];
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly userAgent: string;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.url.replace(/\/$/, '');
    this.token = opts.token;
    this.userAgent = opts.userAgent ?? 'novacortex-cli/1.0.0';
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'User-Agent': this.userAgent,
      'Content-Type': 'application/json',
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (e instanceof TypeError) {
        throw new ServerUnreachableError(`Cannot reach ${this.baseUrl}: ${e.message}`);
      }
      throw e;
    }

    if (res.status === 401) {
      const errorBody = await res.json().catch(() => ({})) as ErrorBody;
      throw new InvalidTokenError(errorBody.message ?? 'Token is invalid or expired');
    }

    if (res.status === 403) {
      const errorBody = await res.json().catch(() => ({})) as ErrorBody;
      throw new InsufficientScopeError(
        errorBody.message ?? 'Insufficient scope',
        errorBody.required ?? [],
        errorBody.granted ?? []
      );
    }

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({})) as ErrorBody;
      throw new Error(`HTTP ${res.status}: ${errorBody.message ?? errorBody.error ?? res.statusText}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }
}
