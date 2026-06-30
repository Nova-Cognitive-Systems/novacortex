"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { RefreshCw, ZoomIn, ZoomOut, Maximize2, Network } from "lucide-react";
import { useMemories, useNamespaces } from "@/hooks/use-memories";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Memory } from "@/types/memory";
import { MemoryType, RelationType } from "@/types/memory";
import { useTheme } from "@/components/theme-provider";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] lg:h-[700px] w-full bg-background rounded-xl animate-pulse flex items-center justify-center">
      <Network className="h-12 w-12 text-muted-foreground/30 animate-pulse" />
    </div>
  ),
});

interface GraphNode {
  id: string;
  name: string;
  type: string;
  namespace: string;
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

const typeColors: Record<string, string> = {
  episodic: "#6366f1",
  semantic: "#10b981",
  procedural: "#a855f7",
  working: "#f59e0b",
};

const relationColors: Record<RelationType, string> = {
  [RelationType.CAUSES]: "#ef4444",
  [RelationType.CAUSED_BY]: "#f97316",
  [RelationType.RELATED_TO]: "#6366f1",
  [RelationType.CONTRADICTS]: "#dc2626",
  [RelationType.SUPPORTS]: "#10b981",
  [RelationType.SUPERSEDES]: "#a855f7",
  [RelationType.PART_OF]: "#06b6d4",
  [RelationType.REFERENCES]: "#94a3b8",
  [RelationType.TEMPORAL_BEFORE]: "#f59e0b",
  [RelationType.TEMPORAL_AFTER]: "#eab308",
};

export default function GraphPage() {
  const router = useRouter();
  const { design } = useTheme();
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const graphBg = design === "dark" ? "#111111" : "#faf9f6";

  const [selectedNamespace, setSelectedNamespace] = useState<string>("all");
  const [selectedType, setSelectedType] = useState<MemoryType | "all">("all");
  const [dimensions, setDimensions] = useState({ width: 800, height: 700 });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const { data: namespaces } = useNamespaces();
  const { data: memoriesData, isLoading, refetch } = useMemories({
    namespace: selectedNamespace !== "all" ? selectedNamespace : undefined,
    memoryTypes: selectedType !== "all" ? [selectedType] : undefined,
    limit: 100,
    includeRelations: true,
  });

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const isMobile = window.innerWidth < 1024;
        setDimensions({
          width: rect.width,
          height: isMobile ? Math.min(450, window.innerHeight - 180) : Math.max(700, window.innerHeight - 240),
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  const graphData = useMemo(() => {
    if (!memoriesData?.data) return { nodes: [], links: [] };

    const nodes: GraphNode[] = memoriesData.data.map((m) => ({
      id: `${m.id.namespace}:${m.id.id}`,
      name: m.content.slice(0, 35) + (m.content.length > 35 ? "..." : ""),
      type: m.memoryType,
      namespace: m.id.namespace,
      memory: m,
      val: Math.max(2, m.metadata.salience),
    }));

    const nodeIds = new Set(nodes.map((n) => n.id));
    const links: GraphLink[] = [];

    memoriesData.data.forEach((m) => {
      if (m.relations) {
        m.relations.forEach((r) => {
          const sourceId = `${r.fromMemory.namespace}:${r.fromMemory.id}`;
          const targetId = `${r.toMemory.namespace}:${r.toMemory.id}`;
          if (nodeIds.has(sourceId) && nodeIds.has(targetId)) {
            const existingLink = links.find(
              (l) =>
                (l.source === sourceId && l.target === targetId) ||
                (l.source === targetId && l.target === sourceId)
            );
            if (!existingLink) {
              links.push({
                source: sourceId,
                target: targetId,
                type: r.relationType,
                strength: r.strength,
              });
            }
          }
        });
      }
    });

    return { nodes, links };
  }, [memoriesData?.data]);

  const handleNodeClick = useCallback(
    (node: any) => {
      setSelectedNode(node as GraphNode);
    },
    []
  );

  const handleNodeDoubleClick = useCallback(
    (node: any) => {
      const graphNode = node as GraphNode;
      router.push(
        `/memories/${encodeURIComponent(graphNode.memory.id.namespace)}/${encodeURIComponent(graphNode.memory.id.id)}`
      );
    },
    [router]
  );

  const handleZoomIn = () => {
    if (graphRef.current) {
      graphRef.current.zoom(graphRef.current.zoom() * 1.5, 300);
    }
  };

  const handleZoomOut = () => {
    if (graphRef.current) {
      graphRef.current.zoom(graphRef.current.zoom() / 1.5, 300);
    }
  };

  const handleFitToView = () => {
    if (graphRef.current) {
      graphRef.current.zoomToFit(400, 60);
    }
  };

  const nodeCanvasObject = useCallback(
    (nodeData: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isDark = design === "dark";
      const node = nodeData as GraphNode;
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      // Guard against NaN/Infinity coordinates (before force layout computes positions)
      if (!isFinite(x) || !isFinite(y)) return;

      const label = node.name;
      const fontSize = Math.max(11 / globalScale, 2);
      const size = Math.max(1, Math.sqrt(node.val) * 5);
      const color = typeColors[node.type] || "#64748b";
      const isSelected = selectedNode?.id === node.id;

      // Glow effect
      ctx.save();
      ctx.shadowBlur = isSelected ? 24 : 12;
      ctx.shadowColor = color;

      // Outer ring for selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(x, y, size + 4 / globalScale, 0, 2 * Math.PI);
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Gradient fill
      const gradient = ctx.createRadialGradient(
        x - size * 0.3, y - size * 0.3, 0,
        x, y, size
      );
      gradient.addColorStop(0, color + "ff");
      gradient.addColorStop(0.7, color + "cc");
      gradient.addColorStop(1, color + "66");

      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Inner highlight dot
      ctx.beginPath();
      ctx.arc(x - size * 0.25, y - size * 0.25, size * 0.2, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fill();

      ctx.restore();

      // Label
      if (globalScale > 0.4) {
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
        const textWidth = ctx.measureText(label).width;
        const padding = 4 / globalScale;
        const labelY = y + size + 4 / globalScale;

        // Rounded label background
        const bgW = textWidth + padding * 2;
        const bgH = fontSize + padding;
        const bgX = x - bgW / 2;
        const bgY = labelY;
        const r = bgH / 2;
        ctx.beginPath();
        ctx.moveTo(bgX + r, bgY);
        ctx.lineTo(bgX + bgW - r, bgY);
        ctx.arc(bgX + bgW - r, bgY + r, r, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(bgX + r, bgY + bgH);
        ctx.arc(bgX + r, bgY + r, r, Math.PI / 2, -Math.PI / 2);
        ctx.closePath();
        ctx.fillStyle = isDark ? "rgba(17,17,17,0.88)" : "rgba(250,249,246,0.92)";
        ctx.fill();

        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.9)" : "rgba(17,17,17,0.9)";
        ctx.fillText(label, x, labelY + padding / 2);
      }
    },
    [selectedNode, design]
  );

  const linkColor = useCallback(
    (link: any) => {
      const color = relationColors[link.type as RelationType] || "#64748b";
      return color + "99"; // semi-transparent
    },
    []
  );

  const linkWidth = useCallback(
    (link: any) => Math.max(0.5, (link.strength || 0.5) * 2),
    []
  );

  useEffect(() => {
    if (graphRef.current) {
      try {
        const charge = graphRef.current.d3Force("charge");
        if (charge) charge.strength(-200);
        const linkForce = graphRef.current.d3Force("link");
        if (linkForce) linkForce.distance(120);
      } catch {
        // Forces not ready yet
      }
    }
  }, [graphData]);

  return (
    <div className="space-y-3 lg:space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#ff5600]/10">
            <Network className="h-5 w-5 text-[#ff5600]" />
          </div>
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Graph View</h1>
            <p className="text-sm text-muted-foreground">
              {graphData.nodes.length} nodes, {graphData.links.length} connections
            </p>
          </div>
        </div>
        <Button variant="outline" size="icon" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Filters + Legend */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={selectedNamespace} onValueChange={setSelectedNamespace}>
          <SelectTrigger className="w-32 lg:w-36">
            <SelectValue placeholder="Namespace" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Namespaces</SelectItem>
            {namespaces?.map((ns) => (
              <SelectItem key={ns} value={ns}>{ns}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedType} onValueChange={(v) => setSelectedType(v as MemoryType | "all")}>
          <SelectTrigger className="w-32 lg:w-36">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {Object.values(MemoryType).map((type) => (
              <SelectItem key={type} value={type}>{type}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Inline legend */}
        <div className="hidden sm:flex items-center gap-3 ml-2">
          {Object.entries(typeColors).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
              <span className="text-xs text-muted-foreground capitalize">{type}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Graph Canvas */}
      <div ref={containerRef} className="relative">
        <div className="rounded-xl overflow-hidden border border-border/50 bg-background">
          {isLoading ? (
            <div className="h-[400px] lg:h-[700px] flex items-center justify-center bg-background">
              <div className="flex flex-col items-center gap-3">
                <RefreshCw className="h-8 w-8 text-[#ff5600]/50 animate-spin" />
                <p className="text-sm text-muted-foreground">Loading graph...</p>
              </div>
            </div>
          ) : graphData.nodes.length === 0 ? (
            <div className="h-[400px] lg:h-[700px] flex items-center justify-center bg-background">
              <div className="flex flex-col items-center gap-3">
                <Network className="h-12 w-12 text-muted-foreground/30" />
                <p className="text-muted-foreground">No memories to visualize</p>
                <p className="text-xs text-muted-foreground/60">Create memories to see the graph</p>
              </div>
            </div>
          ) : (
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              width={dimensions.width}
              height={dimensions.height}
              nodeCanvasObject={nodeCanvasObject}
              linkColor={linkColor}
              linkWidth={linkWidth}
              linkCurvature={0.15}
              linkDirectionalParticles={2}
              linkDirectionalParticleSpeed={0.005}
              linkDirectionalParticleColor={(link: any) => relationColors[link.type as RelationType] || "#64748b"}
              onNodeClick={handleNodeClick}
              onNodeRightClick={handleNodeDoubleClick}
              nodeRelSize={6}
              backgroundColor={graphBg}
              cooldownTicks={80}
              warmupTicks={30}
              onEngineStop={() => {
                if (graphRef.current) {
                  graphRef.current.zoomToFit(400, 60);
                }
              }}
            />
          )}
        </div>

        {/* Floating Zoom Controls */}
        <div className="absolute bottom-4 right-4 flex gap-1.5 bg-background/80 backdrop-blur-sm rounded-lg border border-border/50 p-1.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomOut}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomIn}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleFitToView}>
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Selected Node Overlay */}
        {selectedNode && (
          <div className="absolute top-4 right-4 w-64 bg-background/90 backdrop-blur-sm rounded-lg border border-border/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Badge
                style={{ backgroundColor: typeColors[selectedNode.type], color: "#fff" }}
              >
                {selectedNode.type}
              </Badge>
              <span className="text-xs text-muted-foreground">{selectedNode.namespace}</span>
            </div>
            <p className="text-sm leading-relaxed">{selectedNode.memory.content.slice(0, 120)}...</p>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>Salience: {selectedNode.memory.metadata.salience.toFixed(1)}</div>
              <div>Relations: {selectedNode.memory.relations?.length || 0}</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() =>
                router.push(
                  `/memories/${encodeURIComponent(selectedNode.memory.id.namespace)}/${encodeURIComponent(selectedNode.memory.id.id)}`
                )
              }
            >
              View Details
            </Button>
          </div>
        )}
      </div>

      {/* Mobile legend */}
      <div className="flex sm:hidden flex-wrap items-center gap-3 justify-center">
        {Object.entries(typeColors).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
            <span className="text-xs text-muted-foreground capitalize">{type}</span>
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground/60">
        Click a node to inspect. Right-click to open details.
      </p>
    </div>
  );
}
