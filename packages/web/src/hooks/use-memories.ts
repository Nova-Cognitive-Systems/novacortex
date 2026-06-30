"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api";
import type {
  SearchOptions,
  CreateMemoryInput,
  UpdateMemoryInput,
  RelationType,
  PortableMemory,
} from "@/types/memory";
import { useCallback, useState } from "react";

/**
 * OPTIMIZATION: Cache durations to reduce unnecessary API calls
 */
const CACHE_TIMES = {
  stats: 30 * 1000,        // 30 seconds - stats don't change frequently
  health: 5 * 1000,        // 5 seconds - health checks need to be fresh
  memories: 60 * 1000,     // 1 minute - memory list is relatively stable
  memory: 5 * 60 * 1000,   // 5 minutes - individual memories rarely change
  relations: 5 * 60 * 1000, // 5 minutes - relations are stable
  namespaces: 5 * 60 * 1000, // 5 minutes - namespaces rarely change
} as const;

/**
 * Default retry configuration for queries
 */
const DEFAULT_RETRY_CONFIG = {
  retry: 1,
  retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 5000),
};

// Query keys
export const queryKeys = {
  stats: ["stats"] as const,
  health: ["health"] as const,
  memories: (options?: SearchOptions) => ["memories", options] as const,
  memory: (namespace: string, id: string) => ["memory", namespace, id] as const,
  relations: (namespace: string, id: string) => ["relations", namespace, id] as const,
  similar: (namespace: string, id: string) => ["similar", namespace, id] as const,
  namespaces: ["namespaces"] as const,
};

// Stats & Health
export function useStats() {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: api.getStats,
    staleTime: CACHE_TIMES.stats,
    gcTime: 10 * 60 * 1000, // Keep cache 10 min to survive navigation
    refetchInterval: 30000,
    placeholderData: (previousData) => previousData,
    ...DEFAULT_RETRY_CONFIG,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: api.getHealth,
    staleTime: CACHE_TIMES.health,
    gcTime: 10 * 60 * 1000,
    refetchInterval: 10000,
    placeholderData: (previousData) => previousData,
    retry: 1, // Health checks should fail fast
    retryDelay: 1000,
  });
}

/**
 * Hook for checking connection status
 */
export function useConnectionStatus() {
  const health = useHealth();
  const [isRetrying, setIsRetrying] = useState(false);

  const retry = useCallback(async () => {
    setIsRetrying(true);
    try {
      await health.refetch();
    } finally {
      setIsRetrying(false);
    }
  }, [health]);

  return {
    isConnected: health.isSuccess,
    isLoading: health.isLoading || isRetrying,
    isError: health.isError,
    error: health.error,
    retry,
    lastCheck: health.dataUpdatedAt ? new Date(health.dataUpdatedAt) : null,
  };
}

// Memories
export function useMemories(options?: SearchOptions) {
  return useQuery({
    queryKey: queryKeys.memories(options),
    queryFn: () => api.getMemories(options),
    staleTime: CACHE_TIMES.memories,
    ...DEFAULT_RETRY_CONFIG,
    // Return empty data on error to prevent UI crashes
    placeholderData: (previousData) => previousData ?? { data: [], count: 0 },
  });
}

export function useMemory(namespace: string, id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.memory(namespace, id),
    queryFn: () => api.getMemory(namespace, id),
    staleTime: CACHE_TIMES.memory,
    enabled,
    ...DEFAULT_RETRY_CONFIG,
  });
}

export function useCreateMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMemoryInput) => api.createMemory(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

export function useUpdateMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      namespace,
      id,
      input,
    }: {
      namespace: string;
      id: string;
      input: UpdateMemoryInput;
    }) => api.updateMemory(namespace, id, input),
    onSuccess: (_, { namespace, id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memory(namespace, id) });
      queryClient.invalidateQueries({ queryKey: ["memories"] });
    },
  });
}

export function useDeleteMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ namespace, id }: { namespace: string; id: string }) =>
      api.deleteMemory(namespace, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

// Relations
export function useRelations(namespace: string, id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.relations(namespace, id),
    queryFn: () => api.getRelations(namespace, id),
    staleTime: CACHE_TIMES.relations,
    enabled,
  });
}

export function useSimilarMemories(namespace: string, id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.similar(namespace, id),
    queryFn: () => api.findSimilar(namespace, id),
    staleTime: CACHE_TIMES.memory,
    enabled,
  });
}

export function useCreateRelation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      fromMemoryId: string;
      fromNamespace: string;
      toMemoryId: string;
      toNamespace: string;
      relationType: RelationType;
      strength?: number;
      bidirectional?: boolean;
    }) => api.createRelation(input),
    onSuccess: (_, { fromNamespace, fromMemoryId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.relations(fromNamespace, fromMemoryId),
      });
    },
  });
}

export function useDeleteRelation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteRelation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["relations"] });
    },
  });
}

// Export/Import
export function useExportNamespace() {
  return useMutation({
    mutationFn: ({
      namespace,
      format = 'json',
      options,
    }: {
      namespace: string;
      format?: api.ExportFormat;
      options?: { includeEmbeddings?: boolean; nodeId?: string; exportedBy?: string };
    }) => api.exportNamespace(namespace, format, options),
  });
}

export function useImportMemories() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: PortableMemory | api.PortableMemoryFormat) => api.importMemories(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

// Namespaces
export function useNamespaces() {
  return useQuery({
    queryKey: queryKeys.namespaces,
    queryFn: api.getNamespaces,
    staleTime: CACHE_TIMES.namespaces,
  });
}
