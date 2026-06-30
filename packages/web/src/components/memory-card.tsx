"use client";

import { memo, useMemo } from "react";
import Link from "next/link";
import { Clock, Tag, User, Building, MapPin, Lightbulb, Calendar } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelativeTime, truncate } from "@/lib/utils";
import type { Memory } from "@/types/memory";
import { MemoryType } from "@/types/memory";

interface MemoryCardProps {
  memory: Memory;
  showNamespace?: boolean;
}

const typeVariants: Record<MemoryType, "episodic" | "semantic" | "procedural" | "working"> = {
  [MemoryType.EPISODIC]: "episodic",
  [MemoryType.SEMANTIC]: "semantic",
  [MemoryType.PROCEDURAL]: "procedural",
  [MemoryType.WORKING]: "working",
};

const entityIcons = {
  person: User,
  organization: Building,
  location: MapPin,
  concept: Lightbulb,
  event: Calendar,
};

/**
 * OPTIMIZATION: Wrapped with React.memo to prevent unnecessary re-renders
 * when parent component re-renders but memory data hasn't changed
 */
export const MemoryCard = memo(function MemoryCard({ memory, showNamespace = true }: MemoryCardProps) {
  // OPTIMIZATION: Memoize computed values
  const href = useMemo(
    () => `/memories/${encodeURIComponent(memory.id.namespace)}/${encodeURIComponent(memory.id.id)}`,
    [memory.id.namespace, memory.id.id]
  );

  const truncatedContent = useMemo(
    () => truncate(memory.content, 200),
    [memory.content]
  );

  const displayedTags = useMemo(
    () => memory.metadata.tags.slice(0, 4),
    [memory.metadata.tags]
  );

  const displayedEntities = useMemo(
    () => memory.metadata.entities.slice(0, 3),
    [memory.metadata.entities]
  );

  const formattedSalience = useMemo(
    () => memory.metadata.salience.toFixed(1),
    [memory.metadata.salience]
  );

  const formattedConfidence = useMemo(
    () => Math.round(memory.metadata.confidence * 100),
    [memory.metadata.confidence]
  );

  return (
    <Link href={href}>
      <Card className="cursor-pointer transition-all hover:border-[#ff5600]">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant={typeVariants[memory.memoryType]}>
                {memory.memoryType}
              </Badge>
              {showNamespace && (
                <span className="text-xs text-muted-foreground">
                  {memory.id.namespace}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(memory.createdAt)}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pb-2">
          <p className="text-sm leading-relaxed">{truncatedContent}</p>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center gap-2 pt-2">
          {displayedTags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              <Tag className="mr-1 h-2.5 w-2.5" />
              {tag}
            </Badge>
          ))}
          {memory.metadata.tags.length > 4 && (
            <span className="text-xs text-muted-foreground">
              +{memory.metadata.tags.length - 4} more
            </span>
          )}
          {displayedEntities.map((entity) => {
            const Icon = entityIcons[entity.type];
            return (
              <Tooltip key={entity.name}>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="text-xs">
                    <Icon className="mr-1 h-2.5 w-2.5" />
                    {entity.name}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  {entity.type} ({Math.round(entity.confidence * 100)}% confidence)
                </TooltipContent>
              </Tooltip>
            );
          })}
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span title="Salience">S: {formattedSalience}</span>
            <span title="Confidence">C: {formattedConfidence}%</span>
          </div>
        </CardFooter>
      </Card>
    </Link>
  );
});
