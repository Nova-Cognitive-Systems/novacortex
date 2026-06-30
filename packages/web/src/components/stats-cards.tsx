"use client";

import {
  Brain,
  Database,
  Layers,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { MemoryStats } from "@/types/memory";
import { MemoryType } from "@/types/memory";

interface StatsCardsProps {
  stats?: MemoryStats;
  isLoading?: boolean;
}

const typeColors: Record<MemoryType, string> = {
  [MemoryType.EPISODIC]: "text-blue-500",
  [MemoryType.SEMANTIC]: "text-green-500",
  [MemoryType.PROCEDURAL]: "text-purple-500",
  [MemoryType.WORKING]: "text-orange-500",
};

export function StatsCards({ stats, isLoading }: StatsCardsProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  if (!stats || stats.total === undefined) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  const namespaceCount = Object.keys(stats.byNamespace || {}).length;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-hint="stats-cards">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Memories</CardTitle>
          <Database className="h-4 w-4 text-[#ff5600]" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{(stats.total ?? 0).toLocaleString()}</div>
          <p className="text-xs text-muted-foreground">
            Across {namespaceCount} namespace{namespaceCount !== 1 ? "s" : ""}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">By Type</CardTitle>
          <Layers className="h-4 w-4 text-[#ff5600]" />
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {Object.entries(stats.byType || {}).map(([type, count]) => (
              <div key={type} className="flex items-center justify-between text-sm">
                <span className={typeColors[type as MemoryType] || "text-muted-foreground"}>
                  {type}
                </span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
          <Activity className="h-4 w-4 text-[#ff5600]" />
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Created</span>
              <span className="font-medium">{stats.recentActivity?.created || 0}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Updated</span>
              <span className="font-medium">{stats.recentActivity?.updated || 0}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Accessed</span>
              <span className="font-medium">{stats.recentActivity?.accessed || 0}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Namespaces</CardTitle>
          <Brain className="h-4 w-4 text-[#ff5600]" />
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {Object.entries(stats.byNamespace || {})
              .slice(0, 4)
              .map(([ns, count]) => (
                <div key={ns} className="flex items-center justify-between text-sm">
                  <span className="truncate text-muted-foreground">{ns}</span>
                  <span className="font-medium">{count}</span>
                </div>
              ))}
            {Object.keys(stats.byNamespace || {}).length > 4 && (
              <p className="text-xs text-muted-foreground">
                +{Object.keys(stats.byNamespace || {}).length - 4} more
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
