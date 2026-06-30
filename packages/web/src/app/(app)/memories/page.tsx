"use client";

import { useState, useMemo, useCallback, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Plus, Filter, X } from "lucide-react";
import { useMemories, useNamespaces, useCreateMemory } from "@/hooks/use-memories";
import { MemoryList } from "@/components/memory-list";
import { SearchBar } from "@/components/search-bar";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MemoryType } from "@/types/memory";
import type { SearchOptions } from "@/types/memory";

const ITEMS_PER_PAGE = 20;

function MemoriesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get("search") || "";
  const showNewDialog = searchParams.get("new") === "true";

  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [selectedType, setSelectedType] = useState<MemoryType | "all">("all");
  const [selectedNamespace, setSelectedNamespace] = useState<string>("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [page, setPage] = useState(0);
  const [isCreateOpen, setIsCreateOpen] = useState(showNewDialog);

  // New memory form state
  const [newContent, setNewContent] = useState("");
  const [newType, setNewType] = useState<MemoryType>(MemoryType.SEMANTIC);
  const [newNamespace, setNewNamespace] = useState("default");
  const [newTags, setNewTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [newSalience, setNewSalience] = useState("5");

  const { data: namespaces } = useNamespaces();
  const createMemory = useCreateMemory();

  const searchOptions: SearchOptions = useMemo(() => {
    const options: SearchOptions = {
      limit: ITEMS_PER_PAGE,
      offset: page * ITEMS_PER_PAGE,
      includeRelations: false,
    };
    if (selectedType !== "all") {
      options.memoryTypes = [selectedType];
    }
    if (selectedNamespace !== "all") {
      options.namespace = selectedNamespace;
    }
    if (selectedTags.length > 0) {
      options.tags = selectedTags;
    }
    return options;
  }, [selectedType, selectedNamespace, selectedTags, page]);

  const { data, isLoading, refetch } = useMemories(searchOptions);

  // Filter by search query client-side for now
  const filteredMemories = useMemo(() => {
    if (!data?.data || !searchQuery) return data?.data || [];
    const query = searchQuery.toLowerCase();
    return data.data.filter(
      (m) =>
        m.content.toLowerCase().includes(query) ||
        m.metadata.tags.some((t) => t.toLowerCase().includes(query))
    );
  }, [data?.data, searchQuery]);

  const handleAddTag = useCallback(() => {
    if (tagInput && !selectedTags.includes(tagInput)) {
      setSelectedTags([...selectedTags, tagInput]);
      setTagInput("");
    }
  }, [tagInput, selectedTags]);

  const handleRemoveTag = useCallback((tag: string) => {
    setSelectedTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const handleAddNewTag = useCallback(() => {
    if (newTagInput && !newTags.includes(newTagInput)) {
      setNewTags([...newTags, newTagInput]);
      setNewTagInput("");
    }
  }, [newTagInput, newTags]);

  const handleRemoveNewTag = useCallback((tag: string) => {
    setNewTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const handleCreateMemory = useCallback(async () => {
    if (!newContent.trim()) return;

    try {
      await createMemory.mutateAsync({
        content: newContent,
        memoryType: newType,
        namespace: newNamespace || "default",
        tags: newTags,
        salience: parseFloat(newSalience) || 5,
      });

      // Reset form only on success
      setNewContent("");
      setNewType(MemoryType.SEMANTIC);
      setNewNamespace("default");
      setNewTags([]);
      setNewSalience("5");
      setIsCreateOpen(false);

      // Remove ?new=true from URL if present
      if (showNewDialog) {
        router.push("/memories");
      }
    } catch (error) {
      // Error is handled by react-query, dialog stays open
      console.error("Failed to create memory:", error);
    }
  }, [newContent, newType, newNamespace, newTags, newSalience, createMemory, router, showNewDialog]);

  useEffect(() => {
    if (showNewDialog) {
      setIsCreateOpen(true);
    }
  }, [showNewDialog]);

  const handleCloseCreate = () => {
    setIsCreateOpen(false);
    if (showNewDialog) {
      router.push("/memories");
    }
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold">Memories</h1>
          <p className="text-sm lg:text-base text-muted-foreground">
            Browse and manage your memories
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" />
          New Memory
        </Button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-4" data-hint="memory-filters">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search memories..."
          className="w-full lg:max-w-md"
        />

        <div className="grid grid-cols-2 gap-2 lg:flex lg:gap-4">
          <Select
            value={selectedType}
            onValueChange={(v) => setSelectedType(v as MemoryType | "all")}
          >
            <SelectTrigger className="w-full lg:w-40" data-hint="type-filter">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.values(MemoryType).map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedNamespace} onValueChange={setSelectedNamespace}>
            <SelectTrigger className="w-full lg:w-40" data-hint="namespace-filter">
              <SelectValue placeholder="Namespace" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Namespaces</SelectItem>
              {namespaces?.map((ns) => (
                <SelectItem key={ns} value={ns}>
                  {ns}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
            placeholder="Filter by tag"
            className="flex-1 lg:w-32"
          />
          <Button variant="outline" size="icon" onClick={handleAddTag}>
            <Filter className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedTags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button onClick={() => handleRemoveTag(tag)}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedTags([])}
          >
            Clear all
          </Button>
        </div>
      )}

      <div data-hint="memory-list">
        <MemoryList memories={filteredMemories} isLoading={isLoading} />
      </div>

      {data && data.count >= ITEMS_PER_PAGE && (
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1}
          </span>
          <Button
            variant="outline"
            disabled={data.count < ITEMS_PER_PAGE}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={handleCloseCreate}>
        <DialogContent className="max-w-[95vw] lg:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Memory</DialogTitle>
            <DialogDescription>
              Add a new memory to your knowledge base
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="content">Content</Label>
              <Textarea
                id="content"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Enter the memory content..."
                rows={5}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="type">Type</Label>
                <Select
                  value={newType}
                  onValueChange={(v) => setNewType(v as MemoryType)}
                >
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(MemoryType).map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="namespace">Namespace</Label>
                <Input
                  id="namespace"
                  value={newNamespace}
                  onChange={(e) => setNewNamespace(e.target.value)}
                  placeholder="default"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="salience">Salience (0-10)</Label>
                <Input
                  id="salience"
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={newSalience}
                  onChange={(e) => setNewSalience(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tags">Tags</Label>
                <div className="flex gap-2">
                  <Input
                    id="tags"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddNewTag())}
                    placeholder="Add tag"
                  />
                  <Button type="button" variant="outline" onClick={handleAddNewTag}>
                    Add
                  </Button>
                </div>
              </div>
            </div>
            {newTags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {newTags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    <button onClick={() => handleRemoveNewTag(tag)}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseCreate}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateMemory}
              disabled={!newContent.trim() || createMemory.isPending}
            >
              {createMemory.isPending ? "Creating..." : "Create Memory"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function MemoriesPage() {
  return (
    <Suspense fallback={<div className="space-y-6"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 w-full" /></div>}>
      <MemoriesPageContent />
    </Suspense>
  );
}
