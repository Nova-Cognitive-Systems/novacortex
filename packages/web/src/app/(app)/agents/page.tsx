"use client";

import { useState, useCallback, useEffect } from "react";
import {
  KeyRound,
  Plus,
  Trash2,
  RefreshCw,
  Copy,
  Check,
  Network,
  Shield,
  Crown,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchApi } from "@/lib/api";

interface AgentToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  agentId?: string;
  namespaceClaim?: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

interface FederationRule {
  agentId: string;
  primaryNamespace: string;
  readableNamespaces: string[];
}

export default function AgentsPage() {
// Namespaces
  const [namespaces, setNamespaces] = useState<string[]>([]);

  // Agent tokens state
  const [apiKeys, setApiKeys] = useState<AgentToken[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [apiKeysError, setApiKeysError] = useState<string | null>(null);
  const [newKeyAgentId, setNewKeyAgentId] = useState("");
  const [newKeyNamespace, setNewKeyNamespace] = useState("default");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Federation state
  const [federationEnabled, setFederationEnabled] = useState(false);
  const [federationTier, setFederationTier] = useState<string>("");
  const [federationConfigs, setFederationConfigs] = useState<FederationRule[]>(
    []
  );
  const [federationLoading, setFederationLoading] = useState(false);
  const [federationError, setFederationError] = useState<string | null>(null);
  const [newAgentId, setNewAgentId] = useState("");
  const [newPrimaryNamespace, setNewPrimaryNamespace] = useState("default");
  const [newReadableNamespaces, setNewReadableNamespaces] = useState<string[]>(
    []
  );
  const [editingAgent, setEditingAgent] = useState<string | null>(null);

  // ── Fetch helpers ──

  const fetchNamespaces = useCallback(async () => {
    try {
      const data = await fetchApi<{ data: string[] }>('/namespaces');
      const ns = Array.isArray(data.data) ? data.data : [];
      if (!ns.includes("default")) ns.unshift("default");
      setNamespaces(ns.sort());
    } catch {
      /* ignore */
    }
  }, []);

  const fetchApiKeys = useCallback(async () => {
    try {
      const tokens = await fetchApi<AgentToken[]>('/tokens');
      // Show only non-revoked agent tokens
      setApiKeys(tokens.filter((t) => t.prefix === 'nc_pat' && t.agentId && !t.revokedAt));
    } catch {
      /* ignore */
    }
  }, []);

  const fetchFederationStatus = useCallback(async () => {
    try {
      const statusData = await fetchApi<{ enabled: boolean; tier?: string }>('/federation/status');
      setFederationEnabled(statusData.enabled);
      setFederationTier(statusData.tier || "");

      const configsData = await fetchApi<{ configs: unknown }>('/federation');
      const configs = configsData.configs;
      if (Array.isArray(configs)) {
        setFederationConfigs(configs);
      } else if (configs && typeof configs === "object") {
        setFederationConfigs(Object.values(configs));
      } else {
        setFederationConfigs([]);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchNamespaces();
    fetchApiKeys();
    fetchFederationStatus();
  }, [fetchNamespaces, fetchApiKeys, fetchFederationStatus]);

  // ── API Key handlers ──

  const handleCreateApiKey = async () => {
    if (!newKeyAgentId.trim() || !newKeyNamespace.trim()) {
      setApiKeysError("Agent ID and namespace are required");
      return;
    }

    setApiKeysLoading(true);
    setApiKeysError(null);

    try {
      const data = await fetchApi<{ token: string }>('/tokens', {
        method: "POST",
        body: JSON.stringify({
          template: 'agent',
          name: newKeyAgentId.trim(),
          agentId: newKeyAgentId.trim(),
          namespaceClaim: newKeyNamespace.trim(),
        }),
      });

      setCreatedKey(data.token);
      setShowKeyDialog(true);

      setNewKeyAgentId("");
      setNewKeyNamespace("default");
      fetchApiKeys();
    } catch (e) {
      setApiKeysError(e instanceof Error ? e.message : "Failed to create agent token");
    } finally {
      setApiKeysLoading(false);
    }
  };

  const handleDeleteApiKey = async (tokenId: string, agentId: string) => {
    if (!confirm(`Revoke token for ${agentId}? This cannot be undone.`)) return;

    try {
      await fetchApi(`/tokens/${encodeURIComponent(tokenId)}`, { method: "DELETE" });
      fetchApiKeys();
    } catch {
      setApiKeysError("Failed to revoke token");
    }
  };

  const copyKeyToClipboard = async (key: string) => {
    await navigator.clipboard.writeText(key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  // ── Federation handlers ──

  const handleCreateFederationRule = async () => {
    if (!newAgentId.trim()) {
      setFederationError("Agent ID is required");
      return;
    }

    setFederationLoading(true);
    setFederationError(null);

    try {
      await fetchApi('/federation', {
        method: "POST",
        body: JSON.stringify({
          agentId: newAgentId.trim(),
          primaryNamespace: newPrimaryNamespace,
          readableNamespaces: newReadableNamespaces,
        }),
      });
      setNewAgentId("");
      setNewPrimaryNamespace("default");
      setNewReadableNamespaces([]);
      fetchFederationStatus();
    } catch (e) {
      setFederationError(e instanceof Error ? e.message : "Network error");
    }
    setFederationLoading(false);
  };

  const handleDeleteFederationRule = async (agentId: string) => {
    if (!confirm(`Delete federation rule for agent "${agentId}"?`)) return;

    setFederationLoading(true);
    setFederationError(null);

    try {
      await fetchApi(`/federation/${encodeURIComponent(agentId)}`, { method: "DELETE" });
      fetchFederationStatus();
    } catch (e) {
      setFederationError(e instanceof Error ? e.message : "Network error");
    }
    setFederationLoading(false);
  };

  const toggleReadableNamespace = (ns: string) => {
    setNewReadableNamespaces((prev) =>
      prev.includes(ns) ? prev.filter((n) => n !== ns) : [...prev, ns]
    );
  };

  // ── Render ──

  return (
    <div className="space-y-4 lg:space-y-6">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold">Agents</h1>
        <p className="text-sm lg:text-base text-muted-foreground">
          Manage API keys and namespace federation rules
        </p>
      </div>

      {/* ── API Keys ── */}
      <Card className="border-green-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            API Keys
            <Badge className="bg-green-500 hover:bg-green-600">
              Agent Auth
            </Badge>
          </CardTitle>
          <CardDescription>
            Create API keys for agents to authenticate and access their
            namespaces
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Active keys list */}
          <div className="space-y-3">
            <Label>Active API Keys</Label>
            {apiKeys.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No API keys created yet
              </p>
            ) : (
              <div className="space-y-2">
                {apiKeys.map((token) => (
                  <div
                    key={token.id}
                    className="rounded-lg border p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{token.agentId}</span>
                        {token.namespaceClaim && (
                          <Badge variant="outline" className="text-xs">
                            {token.namespaceClaim}
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className="border-green-500/50 text-green-600"
                        >
                          Active
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        <code className="text-xs bg-muted px-2 py-1 rounded">
                          {token.prefix}…
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteApiKey(token.id, token.agentId ?? token.name)}
                          title="Revoke token"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {token.lastUsedAt && (
                      <p className="text-xs text-muted-foreground">
                        Last used: {new Date(token.lastUsedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Create new key form */}
          <div className="space-y-3">
            <Label>Create New API Key</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label
                  htmlFor="key-agent-id"
                  className="text-xs text-muted-foreground"
                >
                  Agent ID
                </Label>
                <Input
                  id="key-agent-id"
                  placeholder="e.g. my-agent"
                  value={newKeyAgentId}
                  onChange={(e) => setNewKeyAgentId(e.target.value)}
                  disabled={apiKeysLoading}
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="key-namespace"
                  className="text-xs text-muted-foreground"
                >
                  Primary Namespace
                </Label>
                <Select
                  value={newKeyNamespace}
                  onValueChange={setNewKeyNamespace}
                  disabled={apiKeysLoading}
                >
                  <SelectTrigger id="key-namespace">
                    <SelectValue placeholder="Select namespace" />
                  </SelectTrigger>
                  <SelectContent>
                    {namespaces.map((ns) => (
                      <SelectItem key={ns} value={ns}>
                        {ns}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              onClick={handleCreateApiKey}
              disabled={apiKeysLoading || !newKeyAgentId.trim()}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create API Key
            </Button>
          </div>

          {apiKeysError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {apiKeysError}
            </div>
          )}

          <Separator />

          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <strong>Usage in MCP Config:</strong>
            </p>
            <code className="block bg-muted px-2 py-1 rounded text-xs">
              {`"env": { "MEMORY_API_KEY": "sk_..." }`}
            </code>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchApiKeys}
            disabled={apiKeysLoading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </CardContent>
      </Card>

      {/* Key created dialog */}
      <Dialog open={showKeyDialog} onOpenChange={setShowKeyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-green-500" />
              API Key Created
            </DialogTitle>
            <DialogDescription>
              Copy this key now &mdash; it will never be shown again!
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-muted rounded-lg p-4">
              <code className="text-sm break-all select-all">{createdKey}</code>
            </div>
            <Button
              onClick={() => createdKey && copyKeyToClipboard(createdKey)}
              className="w-full"
            >
              {copiedKey ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy to Clipboard
                </>
              )}
            </Button>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setShowKeyDialog(false)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Namespace Federation ── */}
      <Card className={federationEnabled ? "border-cyan-500/50" : ""}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" />
            Namespace Federation
            {federationEnabled ? (
              <Badge className="bg-cyan-500 hover:bg-cyan-600">Enabled</Badge>
            ) : (
              <Badge variant="outline">Pro Feature</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Allow agents to read memories from multiple namespaces
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!federationEnabled ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-start gap-3">
                <Crown className="h-5 w-5 text-amber-500 mt-0.5" />
                <div>
                  <p className="font-medium">Pro Feature</p>
                  <p className="text-sm text-muted-foreground">
                    Federation allows agents to read from multiple namespaces
                    while writing to their primary namespace. Upgrade to Pro to
                    enable cross-namespace memory access.
                  </p>
                  {federationTier && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Current tier:{" "}
                      <Badge variant="secondary" className="ml-1">
                        {federationTier}
                      </Badge>
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Federation rules list */}
              <div className="space-y-3">
                <Label>Configured Agents</Label>
                {federationConfigs.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No federation rules configured yet
                  </p>
                ) : (
                  <div className="space-y-2">
                    {federationConfigs.map((config) => (
                      <div
                        key={config.agentId}
                        className="rounded-lg border p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Shield className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">
                              {config.agentId}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() =>
                              handleDeleteFederationRule(config.agentId)
                            }
                            disabled={federationLoading}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-2 text-sm">
                          <Badge variant="default">
                            {config.primaryNamespace}
                          </Badge>
                          {config.readableNamespaces.map((ns) => (
                            <Badge key={ns} variant="outline">
                              {ns}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              {/* Create new federation rule */}
              <div className="space-y-3">
                <Label>Create Federation Rule</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label
                      htmlFor="fed-agent-id"
                      className="text-xs text-muted-foreground"
                    >
                      Agent ID
                    </Label>
                    <Input
                      id="fed-agent-id"
                      placeholder="e.g. agent-bob"
                      value={newAgentId}
                      onChange={(e) => setNewAgentId(e.target.value)}
                      disabled={federationLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="fed-primary-ns"
                      className="text-xs text-muted-foreground"
                    >
                      Primary Namespace (writes here)
                    </Label>
                    <Select
                      value={newPrimaryNamespace}
                      onValueChange={setNewPrimaryNamespace}
                      disabled={federationLoading}
                    >
                      <SelectTrigger id="fed-primary-ns">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {namespaces.map((ns) => (
                          <SelectItem key={ns} value={ns}>
                            {ns}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Readable Namespaces (can read from)
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {namespaces
                      .filter((ns) => ns !== newPrimaryNamespace)
                      .map((ns) => (
                        <Button
                          key={ns}
                          variant={
                            newReadableNamespaces.includes(ns)
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          onClick={() => toggleReadableNamespace(ns)}
                          disabled={federationLoading}
                        >
                          {newReadableNamespaces.includes(ns) && (
                            <Check className="h-3 w-3 mr-1" />
                          )}
                          {ns}
                        </Button>
                      ))}
                  </div>
                </div>
                <Button
                  onClick={handleCreateFederationRule}
                  disabled={federationLoading || !newAgentId.trim()}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Federation Rule
                </Button>
              </div>

              {federationError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {federationError}
                </div>
              )}

              <Separator />

              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  <strong>How Federation Works:</strong>
                </p>
                <p>
                  - Agent writes memories to its{" "}
                  <strong>primary namespace</strong>
                </p>
                <p>
                  - Agent can read from primary + all{" "}
                  <strong>readable namespaces</strong>
                </p>
                <p>
                  - Use for shared knowledge bases or team collaboration
                </p>
              </div>
            </>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={fetchFederationStatus}
            disabled={federationLoading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
