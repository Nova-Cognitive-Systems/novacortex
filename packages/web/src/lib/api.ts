import type {
  Memory,
  MemoryStats,
  SearchOptions,
  SearchResult,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemoryRelation,
  RelationType,
  PortableMemory,
} from "@/types/memory";
import { MemoryType } from "@/types/memory";
import { fetchWithRetry, ApiError as FetchApiError, isOffline, waitForOnline } from "./fetch-with-retry";

/** Read the admin token from localStorage (browser only). */
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('novacortex_token');
}

/** Clear the admin token from localStorage. */
export function clearAuthToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('novacortex_token');
}

export const getApiBaseUrl = () => {
  if (typeof window !== 'undefined') {
    const customUrl = localStorage.getItem('novacortex_api_url');
    // Only use custom URL if it looks valid (not empty, not localhost:8080 fallback)
    if (customUrl && customUrl !== '/api/v1' && !customUrl.includes('localhost:8080')) {
      return customUrl;
    }
    return '/api/v1';
  }
  return process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
};

// Re-export ApiError for backward compatibility
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public retryable?: boolean
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Default retry configuration for API calls
 */
const DEFAULT_RETRY_OPTIONS = {
  maxRetries: 1,
  initialDelayMs: 300,
  maxDelayMs: 2000,
  timeoutMs: 10000,
  onRetry: (attempt: number, error: Error, delayMs: number) => {
    console.warn(`[API] Request failed (attempt ${attempt}), retrying in ${delayMs}ms:`, error.message);
  },
};

/**
 * Options for API requests
 */
interface ApiRequestOptions extends RequestInit {
  /** Skip retry logic for this request */
  noRetry?: boolean;
  /** Custom timeout in ms */
  timeoutMs?: number;
}

export async function fetchApi<T>(
  endpoint: string,
  options?: ApiRequestOptions
): Promise<T> {
  // Wait for online if currently offline
  if (isOffline()) {
    console.warn('[API] Currently offline, waiting for connection...');
    await waitForOnline();
  }

  const url = `${getApiBaseUrl()}${endpoint}`;
  const { noRetry, timeoutMs, ...fetchOptions } = options || {};

  try {
    if (noRetry) {
      // Direct fetch without retry
      const authToken = getAuthToken();
      const response = await fetch(url, {
        ...fetchOptions,
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          ...fetchOptions?.headers,
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Unknown error" }));

        if (response.status === 401 && typeof window !== 'undefined') {
          if (window.location.pathname !== '/login') {
            clearAuthToken();
            window.location.href = '/login';
          }
        }

        throw new ApiError(
          response.status,
          error.error || error.message || "Request failed",
          error.code,
          error.retryable
        );
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return response.json();
    }

    // Fetch with retry
    const authToken = getAuthToken();
    return await fetchWithRetry<T>(
      url,
      {
        ...fetchOptions,
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          ...fetchOptions?.headers,
        },
      },
      {
        ...DEFAULT_RETRY_OPTIONS,
        timeoutMs: timeoutMs ?? DEFAULT_RETRY_OPTIONS.timeoutMs,
      }
    );
  } catch (error) {
    // Convert FetchApiError to our ApiError for consistency
    if (error instanceof FetchApiError) {
      if (error.status === 401 && typeof window !== 'undefined') {
        if (window.location.pathname !== '/login') {
          clearAuthToken();
          window.location.href = '/login';
        }
      }
      throw new ApiError(error.status, error.message, error.code, error.retryable);
    }

    // Handle network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new ApiError(
        0,
        'Network error: Unable to reach the server',
        'NETWORK_ERROR',
        true
      );
    }

    throw error;
  }
}

// Health & Stats
export async function getHealth(): Promise<{
  status: string;
  timestamp: string;
  stats: { totalMemories: number; totalVectors: number; namespaces: (string | null)[] };
}> {
  return fetchApi("/health");
}

export async function getStats(): Promise<MemoryStats> {
  // Fetch stats directly from API
  const rawStats = await fetchApi<{
    total?: number;
    byType?: Record<string, number>;
    byNamespace?: Record<string, number>;
    recentActivity?: { created: number; accessed?: number; updated: number };
  }>("/stats");

  // Ensure default namespace is always present in byNamespace
  const byNamespace = rawStats.byNamespace ?? {};
  if (!byNamespace["default"]) {
    byNamespace["default"] = 0;
  }

  return {
    total: rawStats.total ?? 0,
    byType: (rawStats.byType ?? {}) as Record<MemoryType, number>,
    byNamespace,
    recentActivity: {
      created: rawStats.recentActivity?.created ?? 0,
      accessed: rawStats.recentActivity?.accessed ?? 0,
      updated: rawStats.recentActivity?.updated ?? 0,
    },
  };
}

// Memories
export async function getMemories(
  options?: SearchOptions
): Promise<{ data: Memory[]; count: number }> {
  const params = new URLSearchParams();
  if (options?.namespace) params.set("namespace", options.namespace);
  if (options?.memoryTypes) {
    options.memoryTypes.forEach((t) => params.append("memoryTypes", t));
  }
  if (options?.tags) {
    options.tags.forEach((t) => params.append("tags", t));
  }
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));
  if (options?.minSalience) params.set("minSalience", String(options.minSalience));
  if (options?.includeRelations) params.set("includeRelations", "true");

  const query = params.toString();
  return fetchApi(`/memories${query ? `?${query}` : ""}`);
}

export async function getMemory(
  namespace: string,
  id: string,
  includeRelations = true
): Promise<Memory> {
  return fetchApi(
    `/memories/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}?includeRelations=${includeRelations}`
  );
}

export async function createMemory(input: CreateMemoryInput): Promise<Memory> {
  return fetchApi("/memories", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateMemory(
  namespace: string,
  id: string,
  input: UpdateMemoryInput
): Promise<Memory> {
  return fetchApi(
    `/memories/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  );
}

export async function deleteMemory(
  namespace: string,
  id: string
): Promise<void> {
  return fetchApi(
    `/memories/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

// Search
export async function searchMemories(
  vector: number[],
  options?: Omit<SearchOptions, "vector"> & { scoreThreshold?: number }
): Promise<{ data: SearchResult[]; count: number }> {
  return fetchApi("/search", {
    method: "POST",
    body: JSON.stringify({ vector, ...options }),
  });
}

export async function findSimilar(
  namespace: string,
  id: string,
  limit = 10,
  targetNamespace?: string
): Promise<{ data: SearchResult[]; count: number }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (targetNamespace) params.set("targetNamespace", targetNamespace);
  return fetchApi(
    `/memories/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}/similar?${params}`
  );
}

// Relations
export async function getRelations(
  namespace: string,
  id: string
): Promise<{ data: MemoryRelation[]; count: number }> {
  return fetchApi(
    `/memories/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}/relations`
  );
}

export async function createRelation(input: {
  fromMemoryId: string;
  fromNamespace: string;
  toMemoryId: string;
  toNamespace: string;
  relationType: RelationType;
  strength?: number;
  bidirectional?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<MemoryRelation> {
  return fetchApi("/memories/relations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteRelation(id: string): Promise<void> {
  return fetchApi(`/memories/relations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// Export/Import
export type ExportFormat = 'json' | 'pmf';

export async function exportNamespace(
  namespace: string,
  format: ExportFormat = 'json',
  options?: { includeEmbeddings?: boolean; nodeId?: string; exportedBy?: string }
): Promise<PortableMemory | PortableMemoryFormat> {
  if (format === 'pmf') {
    const params = new URLSearchParams();
    if (options?.includeEmbeddings) params.set('embeddings', 'true');
    if (options?.nodeId) params.set('nodeId', options.nodeId);
    if (options?.exportedBy) params.set('exportedBy', options.exportedBy);
    const query = params.toString();
    return fetchApi(`/memories/export/${encodeURIComponent(namespace)}/pmf${query ? `?${query}` : ''}`);
  }
  return fetchApi(`/memories/export/${encodeURIComponent(namespace)}`);
}

export async function importMemories(
  data: PortableMemory | PortableMemoryFormat
): Promise<{ imported: number; failed: number }> {
  // Detect format by checking for PMF header
  const isPMF = 'header' in data && (data as PortableMemoryFormat).header?.magic === 'NCPMF';
  const endpoint = isPMF ? '/memories/import/pmf' : '/memories/import';

  return fetchApi(endpoint, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// PMF Types (re-exported for convenience)
export interface PortableMemoryFormat {
  header: {
    magic: 'NCPMF';
    version: '1.0';
    created: Date;
    source: {
      namespace: string;
      nodeId?: string;
      exportedBy?: string;
      description?: string;
    };
    integrity: {
      memoryCount: number;
      relationCount: number;
      embeddingDim: number;
      merkleRoot: string;
      checksum: string;
    };
  };
  graph: {
    nodes: number;
    edges: number;
    density: number;
    components: number;
    avgDegree: number;
    hubNodes: string[];
  };
  memories: unknown[];
  relations: unknown[];
}

// ---------- Tokens (Subsystem C) ----------

export type TokenTemplate = 'admin-full' | 'admin-readonly' | 'agent' | 'knowledge-ingest';

export interface TokenSummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  agentId?: string;
  namespaceClaim?: string;
  createdAt: string;
  expiresAt?: string | null;
}

export interface CreateTokenInput {
  template: TokenTemplate;
  name: string;
  agentId?: string;
  namespaceClaim?: string;
}

export interface CreateTokenResult {
  token: string;
  record: TokenSummary;
}

export async function listTokens(): Promise<TokenSummary[]> {
  return fetchApi<TokenSummary[]>('/tokens');
}

export async function createToken(input: CreateTokenInput): Promise<CreateTokenResult> {
  return fetchApi<CreateTokenResult>('/tokens', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function revokeToken(id: string): Promise<void> {
  await fetchApi<void>(`/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// Namespaces
export async function getNamespaces(): Promise<string[]> {
  const response = await fetchApi<{ data: string[]; count: number; limit: number; remaining: number; tier: string }>("/namespaces");

  // Ensure "default" is always included
  const namespaces = new Set(response.data);
  namespaces.add("default");

  return Array.from(namespaces).sort();
}
