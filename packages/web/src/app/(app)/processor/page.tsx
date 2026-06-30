"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Cpu,
  Play,
  RefreshCw,
  Clock,
  Zap,
  AlertCircle,
  Check,
  Timer,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { fetchApi } from "@/lib/api";

interface ProcessorStats {
  lastRun: string | null;
  relationsCreated: number;
  memoriesDecayed: number;
  memoriesConsolidated: number;
  errors: string[];
  config: {
    relationDiscovery: {
      enabled: boolean;
      similarityThreshold: number;
      maxRelationsPerMemory: number;
      runIntervalMinutes: number;
    };
    decayProcessing: {
      enabled: boolean;
      runIntervalMinutes: number;
    };
    consolidation: {
      enabled: boolean;
      similarityThreshold: number;
      minMemoriesForConsolidation: number;
      runIntervalMinutes: number;
    };
  };
}

interface ScheduleConfig {
  mode: string;
  intervalMinutes: number;
  scheduledTime: string;
  onNewMemory: boolean;
}

interface HealthStats {
  stats: {
    totalMemories: number;
    totalVectors: number;
  };
}

export default function ProcessorPage() {
// Processor stats
  const [processorStats, setProcessorStats] = useState<ProcessorStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Schedule config
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);
  const [intervalMinutes, setIntervalMinutes] = useState("60");
  const [scheduledTime, setScheduledTime] = useState("03:00");
  const [onNewMemory, setOnNewMemory] = useState(false);

  // Run Now state
  const [isRunning, setIsRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<string>("");
  const [runSummary, setRunSummary] = useState<string>("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimestampRef = useRef<string | null>(null);

  // Embedding progress
  const [totalMemories, setTotalMemories] = useState(0);
  const [totalVectors, setTotalVectors] = useState(0);

  // Fetch processor stats
  const fetchProcessorStats = useCallback(async () => {
    try {
      const data = await fetchApi<ProcessorStats>('/processor');
      setProcessorStats(data);
      return data;
    } catch (e) {
      console.error("Failed to fetch processor stats:", e);
    }
    return null;
  }, []);

  // Fetch schedule
  const fetchSchedule = useCallback(async () => {
    try {
      const data = await fetchApi<ScheduleConfig>('/processor/schedule');
      setSchedule(data);
      setIntervalMinutes(String(data.intervalMinutes));
      setScheduledTime(data.scheduledTime || "03:00");
      setOnNewMemory(data.onNewMemory);
    } catch (e) {
      console.error("Failed to fetch schedule:", e);
    }
  }, []);

  // Fetch health for embedding progress
  const fetchHealth = useCallback(async () => {
    try {
      const data = await fetchApi<HealthStats>('/health');
      setTotalMemories(data.stats.totalMemories);
      setTotalVectors(data.stats.totalVectors);
    } catch (e) {
      console.error("Failed to fetch health:", e);
    }
  }, []);

  // Initial load
  useEffect(() => {
    const load = async () => {
      setStatsLoading(true);
      await Promise.all([fetchProcessorStats(), fetchSchedule(), fetchHealth()]);
      setStatsLoading(false);
    };
    load();
  }, [fetchProcessorStats, fetchSchedule, fetchHealth]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // Run Now handler
  const handleRunNow = async () => {
    setIsRunning(true);
    setRunProgress("Starting processor...");
    setRunSummary("");

    const startStats = await fetchProcessorStats();
    startTimestampRef.current = startStats?.lastRun || null;
    const startRelations = startStats?.relationsCreated || 0;

    try {
      await fetchApi('/processor/run', {
        method: "POST",
        body: JSON.stringify({ task: "all" }),
      });
    } catch (e) {
      console.error("Failed to trigger processor run:", e);
      setRunProgress("Error: Failed to start processor");
      setIsRunning(false);
      return;
    }

    setRunProgress("Generating embeddings...");

    let pollCount = 0;
    pollingRef.current = setInterval(async () => {
      pollCount++;
      const current = await fetchProcessorStats();
      const currentHealth = await fetchHealth();

      if (!current) return;

      // Show progress phases based on poll count
      if (pollCount <= 3) {
        const vecCount = totalVectors;
        setRunProgress(`Generating embeddings... (${vecCount}/${totalMemories})`);
      } else if (pollCount <= 6) {
        setRunProgress("Discovering relations...");
      }

      // Check if lastRun has changed (newer than when we started)
      const startTime = startTimestampRef.current;
      if (
        current.lastRun &&
        (!startTime || new Date(current.lastRun) > new Date(startTime))
      ) {
        // Run complete
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }

        const newRelations = current.relationsCreated - startRelations;
        setRunProgress("");
        setRunSummary(
          `Complete: ${newRelations} new relations, ${current.memoriesDecayed} decayed, ${current.memoriesConsolidated} consolidated`
        );
        setIsRunning(false);
        await fetchHealth();
      }
    }, 3000);
  };

  // Save schedule
  const saveSchedule = async (updates: Partial<ScheduleConfig>) => {
    try {
      const body = {
        mode: schedule?.mode || "interval",
        intervalMinutes: parseInt(intervalMinutes, 10) || 60,
        scheduledTime,
        onNewMemory,
        ...updates,
      };
      const data = await fetchApi<ScheduleConfig>('/processor/schedule', {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setSchedule(data);
    } catch (e) {
      console.error("Failed to save schedule:", e);
    }
  };

  // Format timestamp
  const formatTimestamp = (ts: string | null) => {
    if (!ts) return "Never";
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  // Embedding progress percentage
  const embeddingPercent =
    totalMemories > 0 ? Math.round((totalVectors / totalMemories) * 100) : 0;

  if (statsLoading) {
    return (
      <div className="container mx-auto p-6 max-w-5xl">
        <div className="flex items-center gap-2 mb-8">
          <Cpu className="h-6 w-6" />
          <h1 className="text-3xl font-bold">Memory Processor</h1>
        </div>
        <div className="text-muted-foreground">Loading processor status...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Cpu className="h-6 w-6" />
        <h1 className="text-3xl font-bold">Memory Processor</h1>
      </div>

      {/* Section 1: Processor Status */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Processor Status</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Relations Created</CardDescription>
              <CardTitle className="text-2xl">
                {processorStats?.relationsCreated ?? 0}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Memories Decayed</CardDescription>
              <CardTitle className="text-2xl">
                {processorStats?.memoriesDecayed ?? 0}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Timer className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Consolidated</CardDescription>
              <CardTitle className="text-2xl">
                {processorStats?.memoriesConsolidated ?? 0}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Last Run</CardDescription>
              <CardTitle className="text-lg">
                {formatTimestamp(processorStats?.lastRun ?? null)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </div>
      </div>

      <Separator />

      {/* Section 2: Scheduler Configuration */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Scheduler Configuration</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Run Now */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Play className="h-4 w-4" />
                Run Now
              </CardTitle>
              <CardDescription>
                Trigger a full processor run immediately
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                onClick={handleRunNow}
                disabled={isRunning}
                className="w-full"
              >
                {isRunning ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Run Processor
                  </>
                )}
              </Button>
              {runProgress && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted rounded-md p-3">
                  <RefreshCw className="h-3 w-3 animate-spin flex-shrink-0" />
                  <span>{runProgress}</span>
                </div>
              )}
              {runSummary && (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950 rounded-md p-3">
                  <Check className="h-3 w-3 flex-shrink-0" />
                  <span>{runSummary}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Interval */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Timer className="h-4 w-4" />
                Interval
              </CardTitle>
              <CardDescription>
                Run the processor on a recurring interval
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="interval-minutes" className="whitespace-nowrap">
                  Every
                </Label>
                <Input
                  id="interval-minutes"
                  type="number"
                  min={1}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(e.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">minutes</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  saveSchedule({
                    mode: "interval",
                    intervalMinutes: parseInt(intervalMinutes, 10) || 60,
                  })
                }
              >
                Save
              </Button>
            </CardContent>
          </Card>

          {/* Scheduled Time */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Scheduled Time
              </CardTitle>
              <CardDescription>
                Run the processor at a specific time daily
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="scheduled-time" className="whitespace-nowrap">
                  Time
                </Label>
                <Input
                  id="scheduled-time"
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  className="w-36"
                />
              </div>
              {schedule?.scheduledTime && (
                <p className="text-sm text-muted-foreground">
                  Next run at:{" "}
                  <span className="font-medium">
                    {schedule.scheduledTime}
                  </span>
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  saveSchedule({ mode: "scheduled", scheduledTime })
                }
              >
                Save
              </Button>
            </CardContent>
          </Card>

          {/* On New Memory */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="h-4 w-4" />
                On New Memory
              </CardTitle>
              <CardDescription>
                Automatically generate embeddings when a memory is created
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Switch
                  id="on-new-memory"
                  checked={onNewMemory}
                  onCheckedChange={(checked) => {
                    setOnNewMemory(checked);
                    saveSchedule({ onNewMemory: checked });
                  }}
                />
                <Label htmlFor="on-new-memory">
                  {onNewMemory ? "Enabled" : "Disabled"}
                </Label>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Separator />

      {/* Section 3: Task Configuration */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Task Configuration</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Relation Discovery */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Relation Discovery</CardTitle>
              <CardDescription>
                Discover semantic relations between memories
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Enabled</Label>
                <Switch
                  checked={
                    processorStats?.config?.relationDiscovery?.enabled ?? false
                  }
                  disabled
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Similarity Threshold
                </span>
                <span className="font-mono">
                  {processorStats?.config?.relationDiscovery
                    ?.similarityThreshold ?? "N/A"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Interval</span>
                <Badge variant="secondary">
                  {processorStats?.config?.relationDiscovery
                    ?.runIntervalMinutes ?? "N/A"}{" "}
                  min
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Decay Processing */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Decay Processing</CardTitle>
              <CardDescription>
                Apply temporal decay to memory salience
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Enabled</Label>
                <Switch
                  checked={
                    processorStats?.config?.decayProcessing?.enabled ?? false
                  }
                  disabled
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Interval</span>
                <Badge variant="secondary">
                  {processorStats?.config?.decayProcessing?.runIntervalMinutes ??
                    "N/A"}{" "}
                  min
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Consolidation */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">Consolidation</CardTitle>
                <Badge variant="outline" className="text-xs">
                  experimental
                </Badge>
              </div>
              <CardDescription>
                Merge similar memories into consolidated entries
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Enabled</Label>
                <Switch
                  checked={
                    processorStats?.config?.consolidation?.enabled ?? false
                  }
                  disabled
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Similarity Threshold
                </span>
                <span className="font-mono">
                  {processorStats?.config?.consolidation
                    ?.similarityThreshold ?? "N/A"}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Separator />

      {/* Section 4: Embedding Progress */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Embedding Progress</h2>
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {totalVectors} / {totalMemories} memories have embeddings
              </span>
              <span className="font-medium">{embeddingPercent}%</span>
            </div>
            <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${embeddingPercent}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Section 5: Recent Errors */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Recent Errors</h2>
        {processorStats?.errors && processorStats.errors.length > 0 ? (
          <div className="space-y-2">
            {processorStats.errors.slice(0, 3).map((error, i) => (
              <Card key={i}>
                <CardContent className="pt-4 pb-4 flex items-start gap-3">
                  <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-destructive">{error}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
              <span className="text-sm text-muted-foreground">
                No recent errors
              </span>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
