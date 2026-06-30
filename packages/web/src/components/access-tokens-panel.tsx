"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  listTokens,
  createToken,
  revokeToken,
  type TokenSummary,
  type TokenTemplate,
} from "@/lib/api";

const TEMPLATE_LABELS: Record<TokenTemplate, string> = {
  "admin-full": "Full Admin",
  "admin-readonly": "Read-only Admin",
  "agent": "Agent (requires namespace)",
  "knowledge-ingest": "Knowledge Ingest (CI)",
};

export function AccessTokensPanel() {
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState<TokenTemplate>("knowledge-ingest");
  const [newAgentId, setNewAgentId] = useState("");
  const [newNamespace, setNewNamespace] = useState("");
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listTokens();
      setTokens(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate() {
    setError(null);
    if (!newName.trim()) {
      setError("Name is required");
      return;
    }
    if (newTemplate === "agent" && (!newAgentId.trim() || !newNamespace.trim())) {
      setError("Agent template requires an agent id and a namespace");
      return;
    }
    try {
      const result = await createToken({
        template: newTemplate,
        name: newName.trim(),
        agentId: newTemplate === "agent" ? newAgentId.trim() : undefined,
        namespaceClaim: newTemplate === "agent" ? newNamespace.trim() : undefined,
      });
      setRevealedToken(result.token);
      setCreateOpen(false);
      setRevealOpen(true);
      setNewName("");
      setNewAgentId("");
      setNewNamespace("");
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm(`Revoke token ${id}? This cannot be undone.`)) return;
    try {
      await revokeToken(id);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function copyRevealed() {
    if (revealedToken) await navigator.clipboard.writeText(revealedToken);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Access Tokens
              </CardTitle>
              <CardDescription>Create and revoke API tokens for humans, agents, and CI</CardDescription>
            </div>
            <Button onClick={() => setCreateOpen(true)} size="sm">
              <Plus className="mr-1 h-4 w-4" />
              Create Token
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && tokens.length === 0 && (
            <p className="text-sm text-muted-foreground">No tokens yet. Click &quot;Create Token&quot;.</p>
          )}
          {tokens.length > 0 && (
            <div className="space-y-2">
              {tokens.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {t.prefix} · {t.scopes.slice(0, 3).join(", ")}
                      {t.scopes.length > 3 && ` +${t.scopes.length - 3}`}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRevoke(t.id)}
                    aria-label={`Revoke ${t.name}`}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Access Token</DialogTitle>
            <DialogDescription>The token is shown exactly once after creation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tpl">Template</Label>
              <Select value={newTemplate} onValueChange={(v) => setNewTemplate(v as TokenTemplate)}>
                <SelectTrigger id="tpl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TEMPLATE_LABELS) as TokenTemplate[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {TEMPLATE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            {newTemplate === "agent" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="agentId">Agent ID</Label>
                  <Input id="agentId" value={newAgentId} onChange={(e) => setNewAgentId(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ns">Namespace</Label>
                  <Input id="ns" value={newNamespace} onChange={(e) => setNewNamespace(e.target.value)} />
                </div>
              </>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revealOpen} onOpenChange={setRevealOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token Created</DialogTitle>
            <DialogDescription>
              Copy this token now. It will never be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted p-3 font-mono text-sm break-all">
            {revealedToken}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={copyRevealed}>
              <Copy className="mr-1 h-4 w-4" />
              Copy
            </Button>
            <Button
              onClick={() => {
                setRevealOpen(false);
                setRevealedToken(null);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
