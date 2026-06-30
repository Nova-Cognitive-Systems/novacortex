"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Edit,
  Trash2,
  Clock,
  Tag,
  User,
  Building,
  MapPin,
  Lightbulb,
  Calendar,
  Save,
  X,
  Link as LinkIcon,
} from "lucide-react";
import {
  useMemory,
  useUpdateMemory,
  useDeleteMemory,
  useRelations,
  useSimilarMemories,
} from "@/hooks/use-memories";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import { MemoryType } from "@/types/memory";
import { MemoryCard } from "@/components/memory-card";

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

export default function MemoryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const namespace = decodeURIComponent(params.namespace as string);
  const id = decodeURIComponent(params.id as string);

  const { data: memory, isLoading } = useMemory(namespace, id);
  const { data: relationsData } = useRelations(namespace, id);
  const { data: similarData } = useSimilarMemories(namespace, id);

  const updateMemory = useUpdateMemory();
  const deleteMemory = useDeleteMemory();

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editSalience, setEditSalience] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const handleStartEdit = useCallback(() => {
    if (memory) {
      setEditContent(memory.content);
      setEditSalience(memory.metadata.salience.toString());
      setEditTags([...memory.metadata.tags]);
      setIsEditing(true);
    }
  }, [memory]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditContent("");
    setEditSalience("");
    setEditTags([]);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!memory) return;

    await updateMemory.mutateAsync({
      namespace,
      id,
      input: {
        content: editContent || undefined,
        salience: parseFloat(editSalience) || undefined,
        tags: editTags,
      },
    });

    setIsEditing(false);
  }, [memory, namespace, id, editContent, editSalience, editTags, updateMemory]);

  const handleAddTag = useCallback(() => {
    if (newTag && !editTags.includes(newTag)) {
      setEditTags([...editTags, newTag]);
      setNewTag("");
    }
  }, [newTag, editTags]);

  const handleRemoveTag = useCallback((tag: string) => {
    setEditTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const handleDelete = useCallback(async () => {
    await deleteMemory.mutateAsync({ namespace, id });
    router.push("/memories");
  }, [namespace, id, deleteMemory, router]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!memory) {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 py-20">
        <p className="text-lg text-muted-foreground">Memory not found</p>
        <Link href="/memories">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Memories
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Link href="/memories">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={typeVariants[memory.memoryType]}>
              {memory.memoryType}
            </Badge>
            <span className="text-sm text-muted-foreground truncate">
              {memory.id.namespace}
            </span>
          </div>
          <p className="text-xs lg:text-sm text-muted-foreground truncate">
            ID: {memory.id.id}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isEditing ? (
            <>
              <Button variant="outline" size="sm" onClick={handleCancelEdit}>
                <X className="mr-1 lg:mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Cancel</span>
              </Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={updateMemory.isPending}>
                <Save className="mr-1 lg:mr-2 h-4 w-4" />
                <span className="hidden sm:inline">{updateMemory.isPending ? "Saving..." : "Save"}</span>
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={handleStartEdit}>
                <Edit className="mr-1 lg:mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setIsDeleteOpen(true)}
              >
                <Trash2 className="mr-1 lg:mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Delete</span>
              </Button>
            </>
          )}
        </div>
      </div>

      <Tabs defaultValue="content" className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="content" className="text-xs lg:text-sm">Content</TabsTrigger>
          <TabsTrigger value="metadata" className="text-xs lg:text-sm">Metadata</TabsTrigger>
          <TabsTrigger value="relations" className="text-xs lg:text-sm">
            Relations ({relationsData?.count || 0})
          </TabsTrigger>
          <TabsTrigger value="similar" className="text-xs lg:text-sm">Similar</TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Content</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={10}
                  className="font-mono"
                />
              ) : (
                <p className="whitespace-pre-wrap leading-relaxed">
                  {memory.content}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tags</CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTag())}
                      placeholder="Add tag"
                    />
                    <Button variant="outline" onClick={handleAddTag}>
                      Add
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {editTags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1">
                        <Tag className="h-3 w-3" />
                        {tag}
                        <button onClick={() => handleRemoveTag(tag)}>
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {memory.metadata.tags.length > 0 ? (
                    memory.metadata.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        <Tag className="mr-1 h-3 w-3" />
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No tags</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="metadata" className="space-y-4">
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Scores</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {isEditing ? (
                  <div className="space-y-2">
                    <Label htmlFor="salience">Salience (0-10)</Label>
                    <Input
                      id="salience"
                      type="number"
                      min="0"
                      max="10"
                      step="0.1"
                      value={editSalience}
                      onChange={(e) => setEditSalience(e.target.value)}
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Salience</span>
                      <span className="font-medium">
                        {memory.metadata.salience.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Effective Salience</span>
                      <span className="font-medium">
                        {memory.metadata.effectiveSalience.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Confidence</span>
                      <span className="font-medium">
                        {Math.round(memory.metadata.confidence * 100)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Decay Rate</span>
                      <span className="font-medium">
                        {memory.metadata.decayRate.toFixed(4)}
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Timestamps</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    <Clock className="mr-1 inline h-4 w-4" />
                    Created
                  </span>
                  <span className="font-medium">
                    {formatDate(memory.createdAt)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    <Clock className="mr-1 inline h-4 w-4" />
                    Last Accessed
                  </span>
                  <span className="font-medium">
                    {formatRelativeTime(memory.accessedAt)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Version</span>
                  <span className="font-medium">{memory.version}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Source</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <Badge variant="outline">{memory.metadata.source.type}</Badge>
                </div>
                {memory.metadata.source.sessionId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Session</span>
                    <span className="font-mono text-sm">
                      {memory.metadata.source.sessionId}
                    </span>
                  </div>
                )}
                {memory.metadata.source.agentId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Agent</span>
                    <span className="font-mono text-sm">
                      {memory.metadata.source.agentId}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Entities</CardTitle>
              </CardHeader>
              <CardContent>
                {memory.metadata.entities.length > 0 ? (
                  <div className="space-y-2">
                    {memory.metadata.entities.map((entity, i) => {
                      const Icon = entityIcons[entity.type];
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            <span>{entity.name}</span>
                          </div>
                          <Badge variant="secondary">
                            {Math.round(entity.confidence * 100)}%
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No entities extracted
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="relations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Memory Relations</CardTitle>
            </CardHeader>
            <CardContent>
              {relationsData?.data && relationsData.data.length > 0 ? (
                <div className="space-y-4">
                  {relationsData.data.map((relation) => {
                    const isFrom =
                      relation.fromMemory.namespace === namespace &&
                      relation.fromMemory.id === id;
                    const otherMemory = isFrom
                      ? relation.toMemory
                      : relation.fromMemory;

                    return (
                      <div
                        key={relation.id}
                        className="flex items-center justify-between rounded-lg border p-4"
                      >
                        <div className="flex items-center gap-3">
                          <LinkIcon className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <Badge variant="outline">
                              {relation.relationType}
                            </Badge>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {isFrom ? "To" : "From"}:{" "}
                              {otherMemory.namespace}/{otherMemory.id}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            Strength: {(relation.strength * 100).toFixed(0)}%
                          </p>
                          {relation.bidirectional && (
                            <Badge variant="secondary" className="text-xs">
                              Bidirectional
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No relations found
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="similar" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Similar Memories</CardTitle>
            </CardHeader>
            <CardContent>
              {similarData?.data && similarData.data.length > 0 ? (
                <div className="space-y-4">
                  {similarData.data.map((result) => (
                    <div key={`${result.memory.id.namespace}:${result.memory.id.id}`}>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          Similarity Score
                        </span>
                        <Badge variant="secondary">
                          {result.score ? `${(result.score * 100).toFixed(1)}%` : "N/A"}
                        </Badge>
                      </div>
                      <MemoryCard memory={result.memory} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No similar memories found
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Memory</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this memory? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMemory.isPending}
            >
              {deleteMemory.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
