"use client";

import { memo, useMemo } from "react";
import { MemoryCard } from "./memory-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Memory } from "@/types/memory";

interface MemoryListProps {
  memories: Memory[];
  isLoading?: boolean;
  showNamespace?: boolean;
}

// OPTIMIZATION: Memoized skeleton component to avoid recreation
const LoadingSkeleton = memo(function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-40 w-full" />
      ))}
    </div>
  );
});

const EmptyState = memo(function EmptyState() {
  return (
    <div className="flex h-40 items-center justify-center rounded-lg border border-dashed">
      <p className="text-sm text-muted-foreground">No memories found</p>
    </div>
  );
});

/**
 * OPTIMIZATION: Wrapped with React.memo to prevent unnecessary re-renders
 */
export const MemoryList = memo(function MemoryList({
  memories,
  isLoading,
  showNamespace = true,
}: MemoryListProps) {
  // OPTIMIZATION: Memoize the memory keys computation
  const memoryItems = useMemo(
    () =>
      memories.map((memory) => ({
        key: `${memory.id.namespace}:${memory.id.id}`,
        memory,
      })),
    [memories]
  );

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (memories.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-4">
      {memoryItems.map(({ key, memory }) => (
        <MemoryCard key={key} memory={memory} showNamespace={showNamespace} />
      ))}
    </div>
  );
});
