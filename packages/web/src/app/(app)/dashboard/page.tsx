"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Plus, ArrowRight } from "lucide-react";
import { useStats, useMemories, useHealth } from "@/hooks/use-memories";
import { StatsCards } from "@/components/stats-cards";
import { MemoryList } from "@/components/memory-list";
import { SearchBar } from "@/components/search-bar";
import { ServiceMonitor } from "@/components/service-monitor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default function DashboardPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useStats();
  const { data: healthData, isLoading: healthLoading } = useHealth();
  const { data: memoriesData, isLoading: memoriesLoading } = useMemories({
    limit: 5,
    includeRelations: false,
  });

  const handleSearch = (query: string) => {
    if (query) {
      router.push(`/memories?search=${encodeURIComponent(query)}`);
    }
  };

  return (
    <div className="space-y-6 lg:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold">Dashboard</h1>
          <p className="text-sm lg:text-base text-muted-foreground">
            Overview of your memory system
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant={healthData?.status === "healthy" ? "default" : "destructive"}
            className="h-8"
            data-hint="health-badge"
          >
            {healthLoading ? "Checking..." : healthData?.status || "Unknown"}
          </Badge>
          <Button variant="outline" size="icon" onClick={() => refetchStats()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Link href="/memories?new=true" data-hint="new-memory-btn">
            <Button className="w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              New Memory
            </Button>
          </Link>
        </div>
      </div>

      <SearchBar
        value={searchQuery}
        onChange={setSearchQuery}
        onSearch={handleSearch}
        placeholder="Search all memories..."
        className="w-full lg:max-w-xl"
      />

      <StatsCards stats={stats} isLoading={statsLoading} />

      <div className="grid gap-4 lg:gap-6 grid-cols-1 lg:grid-cols-2">
        <Card data-hint="recent-memories">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent Memories</CardTitle>
            <Link href="/memories">
              <Button variant="ghost" size="sm">
                View All
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <MemoryList
              memories={memoriesData?.data || []}
              isLoading={memoriesLoading}
            />
          </CardContent>
        </Card>

        <div className="space-y-4 lg:space-y-6">
          <ServiceMonitor />
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Link href="/memories?new=true" className="block">
                <Button variant="outline" className="w-full justify-start">
                  <Plus className="mr-2 h-4 w-4 text-[#ff5600]" />
                  Create New Memory
                </Button>
              </Link>
              <Link href="/graph" className="block">
                <Button variant="outline" className="w-full justify-start">
                  <ArrowRight className="mr-2 h-4 w-4 text-[#ff5600]" />
                  Explore Graph View
                </Button>
              </Link>
              <Link href="/settings" className="block">
                <Button variant="outline" className="w-full justify-start">
                  <ArrowRight className="mr-2 h-4 w-4 text-[#ff5600]" />
                  Manage Settings
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
