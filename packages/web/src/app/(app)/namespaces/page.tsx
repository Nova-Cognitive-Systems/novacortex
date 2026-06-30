"use client";

import { useState, useCallback, useEffect } from "react";
import { FolderTree, Plus, Trash2, RefreshCw, Database } from "lucide-react";
import { useStats, useNamespaces } from "@/hooks/use-memories";
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
import { getApiBaseUrl, getAuthToken } from "@/lib/api";

export default function NamespacesPage() {
  const API_URL = getApiBaseUrl();

  const { data: namespaces, refetch: refetchNamespaces } = useNamespaces();
  const { data: stats } = useStats();

  const [newNamespace, setNewNamespace] = useState("");
  const [namespaceLimit, setNamespaceLimit] = useState<{
    limit: number;
    remaining: number;
    tier?: string;
  } | null>(null);
  const [namespaceLoading, setNamespaceLoading] = useState(false);
  const [namespaceError, setNamespaceError] = useState<string | null>(null);

  const fetchNamespaceLimits = useCallback(async () => {
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_URL}/namespaces`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setNamespaceLimit({
        limit: data.limit,
        remaining: data.remaining,
        tier: data.tier,
      });
    } catch (e) {
      console.error("Failed to fetch namespace limits:", e);
    }
  }, [API_URL]);

  useEffect(() => {
    fetchNamespaceLimits();
  }, [fetchNamespaceLimits]);

  const handleCreateNamespace = async () => {
    if (!newNamespace.trim()) return;

    setNamespaceLoading(true);
    setNamespaceError(null);

    try {
      const token = getAuthToken();
      const res = await fetch(`${API_URL}/namespaces`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: newNamespace.trim() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to create namespace" }));
        setNamespaceError(err.error || "Failed to create namespace");
        setNamespaceLoading(false);
        return;
      }

      setNewNamespace("");
      refetchNamespaces();
      fetchNamespaceLimits();
    } catch {
      setNamespaceError("Network error");
    }
    setNamespaceLoading(false);
  };

  const handleDeleteNamespace = async (name: string) => {
    if (name === "default") {
      setNamespaceError("Cannot delete the default namespace");
      return;
    }

    if (!confirm(`Delete namespace "${name}"? All memories in this namespace will be deleted.`)) {
      return;
    }

    setNamespaceLoading(true);
    setNamespaceError(null);

    try {
      const token = getAuthToken();
      const res = await fetch(`${API_URL}/namespaces/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to delete namespace" }));
        setNamespaceError(err.error || "Failed to delete namespace");
        setNamespaceLoading(false);
        return;
      }

      refetchNamespaces();
      fetchNamespaceLimits();
    } catch {
      setNamespaceError("Network error");
    }
    setNamespaceLoading(false);
  };

  const handleRefresh = () => {
    refetchNamespaces();
    fetchNamespaceLimits();
  };

  return (
    <div className="container mx-auto max-w-2xl space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FolderTree className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Namespaces</h1>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Namespace Management
          </CardTitle>
          <CardDescription>
            Isolate memories per agent or application
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Limit indicator */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Namespace Slots
            </span>
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  namespaceLimit?.remaining === 0 ? "destructive" : "secondary"
                }
              >
                {namespaces?.length || 0} / {namespaceLimit?.limit ?? "..."} namespaces used
              </Badge>
              {namespaceLimit?.tier && (
                <Badge variant="outline">{namespaceLimit.tier}</Badge>
              )}
              {namespaceLimit?.remaining === 0 && (
                <span className="text-xs text-destructive">Limit reached</span>
              )}
            </div>
          </div>

          <Separator />

          {/* Create new namespace */}
          <div className="space-y-2">
            <Label htmlFor="new-namespace">Create Namespace</Label>
            <div className="flex gap-2">
              <Input
                id="new-namespace"
                className="text-base md:text-sm"
                placeholder="e.g. my namespace"
                value={newNamespace}
                onChange={(e) => setNewNamespace(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateNamespace()}
                disabled={namespaceLoading || namespaceLimit?.remaining === 0}
              />
              <Button
                onClick={handleCreateNamespace}
                disabled={
                  namespaceLoading ||
                  !newNamespace.trim() ||
                  namespaceLimit?.remaining === 0
                }
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Error display */}
          {namespaceError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {namespaceError}
            </div>
          )}

          <Separator />

          {/* Namespace list */}
          <div className="space-y-2">
            <Label>Active Namespaces</Label>
            <div className="space-y-2">
              {namespaces && namespaces.length > 0 ? (
                namespaces.map((ns) => (
                  <div
                    key={ns}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{ns}</span>
                      {ns === "default" && (
                        <Badge variant="outline" className="text-xs">
                          protected
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">
                        {stats?.byNamespace?.[ns] || 0} {(stats?.byNamespace?.[ns] || 0) === 1 ? "memory" : "memories"}
                      </Badge>
                      {ns !== "default" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteNamespace(ns)}
                          disabled={namespaceLoading}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No namespaces found
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
