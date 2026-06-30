"use client";

import { useEffect, useRef, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Memory, MemoryRelation } from "@/types/memory";
import { RelationType } from "@/types/memory";

// Dynamic import for react-force-graph-2d to avoid SSR issues
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => <Skeleton className="h-[400px] w-full" />,
});

interface RelationGraphProps {
  memories: Memory[];
  relations: MemoryRelation[];
  onNodeClick?: (memory: Memory) => void;
  width?: number;
  height?: number;
}

interface GraphNode {
  id: string;
  name: string;
  type: string;
  memory: Memory;
  val: number;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
  type: RelationType;
  strength: number;
}

const relationColors: Record<RelationType, string> = {
  [RelationType.CAUSES]: "#ef4444",
  [RelationType.CAUSED_BY]: "#f97316",
  [RelationType.RELATED_TO]: "#3b82f6",
  [RelationType.CONTRADICTS]: "#dc2626",
  [RelationType.SUPPORTS]: "#22c55e",
  [RelationType.SUPERSEDES]: "#8b5cf6",
  [RelationType.PART_OF]: "#06b6d4",
  [RelationType.REFERENCES]: "#64748b",
  [RelationType.TEMPORAL_BEFORE]: "#f59e0b",
  [RelationType.TEMPORAL_AFTER]: "#eab308",
};

const typeColors: Record<string, string> = {
  episodic: "#3b82f6",
  semantic: "#22c55e",
  procedural: "#8b5cf6",
  working: "#f97316",
};

export function RelationGraph({
  memories,
  relations,
  onNodeClick,
  width = 800,
  height = 400,
}: RelationGraphProps) {
  const graphRef = useRef<any>(null);

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = memories.map((m) => ({
      id: `${m.id.namespace}:${m.id.id}`,
      name: m.content.slice(0, 50) + (m.content.length > 50 ? "..." : ""),
      type: m.memoryType,
      memory: m,
      val: m.metadata.salience,
    }));

    const nodeIds = new Set(nodes.map((n) => n.id));

    const links: GraphLink[] = relations
      .filter((r) => {
        const sourceId = `${r.fromMemory.namespace}:${r.fromMemory.id}`;
        const targetId = `${r.toMemory.namespace}:${r.toMemory.id}`;
        return nodeIds.has(sourceId) && nodeIds.has(targetId);
      })
      .map((r) => ({
        source: `${r.fromMemory.namespace}:${r.fromMemory.id}`,
        target: `${r.toMemory.namespace}:${r.toMemory.id}`,
        type: r.relationType,
        strength: r.strength,
      }));

    return { nodes, links };
  }, [memories, relations]);

  const handleNodeClick = useCallback(
    (nodeData: any) => {
      const node = nodeData as GraphNode;
      if (onNodeClick && node.memory) {
        onNodeClick(node.memory);
      }
    },
    [onNodeClick]
  );

  const nodeCanvasObject = useCallback(
    (nodeData: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const node = nodeData as GraphNode;
      const label = node.name;
      const fontSize = 12 / globalScale;
      ctx.font = `${fontSize}px Sans-Serif`;
      const textWidth = ctx.measureText(label).width;
      const size = Math.sqrt(node.val) * 5;

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI, false);
      ctx.fillStyle = typeColors[node.type] || "#64748b";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1 / globalScale;
      ctx.stroke();

      // Label background
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(
        node.x! - textWidth / 2 - 2,
        node.y! + size + 2,
        textWidth + 4,
        fontSize + 2
      );

      // Label text
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, node.x!, node.y! + size + 3);
    },
    []
  );

  const linkCanvasObject = useCallback(
    (link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const start = link.source;
      const end = link.target;

      if (!start.x || !end.x) return;

      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = relationColors[link.type as RelationType] || "#64748b";
      ctx.lineWidth = link.strength * 2;
      ctx.stroke();
    },
    []
  );

  useEffect(() => {
    if (graphRef.current) {
      graphRef.current.d3Force("charge").strength(-200);
      graphRef.current.d3Force("link").distance(100);
    }
  }, []);

  if (memories.length === 0) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-lg border border-dashed">
        <p className="text-sm text-muted-foreground">No memories to visualize</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        width={width}
        height={height}
        nodeCanvasObject={nodeCanvasObject}
        linkCanvasObject={linkCanvasObject}
        onNodeClick={handleNodeClick}
        nodeRelSize={6}
        linkDirectionalParticles={2}
        linkDirectionalParticleSpeed={0.005}
        backgroundColor="transparent"
        cooldownTicks={100}
      />
    </div>
  );
}

export function RelationGraphCard({
  memories,
  relations,
  onNodeClick,
  title = "Memory Relations",
}: RelationGraphProps & { title?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <RelationGraph
          memories={memories}
          relations={relations}
          onNodeClick={onNodeClick}
        />
        <div className="mt-4 flex flex-wrap gap-4">
          <div className="text-sm">
            <span className="font-medium">Node Colors:</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {Object.entries(typeColors).map(([type, color]) => (
                <span key={type} className="flex items-center gap-1">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs">{type}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="text-sm">
            <span className="font-medium">Link Colors:</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {Object.entries(relationColors)
                .slice(0, 5)
                .map(([type, color]) => (
                  <span key={type} className="flex items-center gap-1">
                    <span
                      className="inline-block h-2 w-4"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs">{type.replace("_", " ")}</span>
                  </span>
                ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
