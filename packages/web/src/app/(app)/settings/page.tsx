"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Download,
  Upload,
  RefreshCw,
  Key,
  Copy,
  Check,
  Crown,
  Shield,
  Search,
  AlertTriangle,
} from "lucide-react";
import {
  useStats,
  useNamespaces,
  useExportNamespace,
  useImportMemories,
} from "@/hooks/use-memories";
import { AccessTokensPanel } from "@/components/access-tokens-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
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
import type { PortableMemory } from "@/types/memory";
import { getApiBaseUrl, getAuthToken } from "@/lib/api";

export default function SettingsPage() {
  const API_URL = getApiBaseUrl();
  const { data: stats, refetch: refetchStats } = useStats();
  const { data: namespaces } = useNamespaces();

  const exportMutation = useExportNamespace();
  const importMutation = useImportMemories();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedExportNamespace, setSelectedExportNamespace] = useState<string>("");
  const [exportFormat, setExportFormat] = useState<'json' | 'pmf'>('json');
  const [includeEmbeddings, setIncludeEmbeddings] = useState(false);
  const [copiedApiUrl, setCopiedApiUrl] = useState(false);
  const [customApiUrl, setCustomApiUrl] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('novacortex_api_url') || getApiBaseUrl();
    }
    return getApiBaseUrl();
  });
  const [apiUrlSaved, setApiUrlSaved] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; failed: number } | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);

  // License state
  const [licenseInfo, setLicenseInfo] = useState<{
    tier: string;
    maxNamespaces: number;
    hasLicense: boolean;
    features?: { federation: boolean };
  } | null>(null);
  const [licenseKeyInput, setLicenseKeyInput] = useState("");
  const [activating, setActivating] = useState(false);
  const [activationResult, setActivationResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // Search / embeddings status (from the public /health endpoint)
  const [searchStatus, setSearchStatus] = useState<{
    mode: "semantic" | "text";
    embeddings: {
      status: "ok" | "disabled" | "unreachable" | "dimension_mismatch";
      model: string;
      dimension?: number;
      expectedDimension: number;
      error?: string;
    };
  } | null>(null);

  const fetchSearchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/health`);
      if (res.ok) {
        const data = await res.json();
        if (data.search) setSearchStatus(data.search);
      }
    } catch (e) {
      console.error("Failed to fetch search status:", e);
    }
  }, [API_URL]);

  useEffect(() => {
    fetchSearchStatus();
  }, [fetchSearchStatus]);

  // Fetch license info
  const fetchLicenseInfo = useCallback(async () => {
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_URL}/license`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setLicenseInfo({
          tier: data.tier,
          maxNamespaces: data.maxNamespaces,
          hasLicense: data.hasLicense,
          features: data.features,
        });
      }
    } catch (e) {
      console.error("Failed to fetch license info:", e);
    }
  }, []);

  useEffect(() => {
    fetchLicenseInfo();
  }, [fetchLicenseInfo]);

  const handleActivateLicense = useCallback(async () => {
    const key = licenseKeyInput.trim();
    if (!key) return;
    setActivating(true);
    setActivationResult(null);
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_URL}/license/activate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ key }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setActivationResult({ ok: true, message: data.message || "License activated." });
        setLicenseKeyInput("");
        fetchLicenseInfo();
      } else if (res.status === 401 || res.status === 403) {
        setActivationResult({
          ok: false,
          message: "Activation requires an admin token — sign in with your admin token first.",
        });
      } else {
        setActivationResult({
          ok: false,
          message: data.message || data.error || "Invalid license key.",
        });
      }
    } catch {
      setActivationResult({ ok: false, message: "Could not reach the API." });
    } finally {
      setActivating(false);
    }
  }, [licenseKeyInput, API_URL, fetchLicenseInfo]);

  const handleCopyApiUrl = useCallback(async () => {
    await navigator.clipboard.writeText(customApiUrl);
    setCopiedApiUrl(true);
    setTimeout(() => setCopiedApiUrl(false), 2000);
  }, [customApiUrl]);

  const handleSaveApiUrl = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('novacortex_api_url', customApiUrl);
      setApiUrlSaved(true);
      setTimeout(() => setApiUrlSaved(false), 2000);
      // Reload to apply new API URL
      window.location.reload();
    }
  }, [customApiUrl]);

  const handleResetApiUrl = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('novacortex_api_url');
      setCustomApiUrl(API_URL);
      window.location.reload();
    }
  }, []);

  const handleExport = useCallback(async () => {
    if (!selectedExportNamespace) return;

    const data = await exportMutation.mutateAsync({
      namespace: selectedExportNamespace,
      format: exportFormat,
      options: exportFormat === 'pmf' ? { includeEmbeddings } : undefined,
    });

    // Download file
    const isPMF = exportFormat === 'pmf';
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: isPMF ? "application/vnd.novacortex.pmf+json" : "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ext = isPMF ? '.pmf.json' : '.json';
    a.download = `${selectedExportNamespace}-export-${new Date().toISOString().split("T")[0]}${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [selectedExportNamespace, exportFormat, includeEmbeddings, exportMutation]);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text) as PortableMemory;

      // Validate format — accept both PMF (header.magic) and legacy JSON (formatVersion)
      const isPMF = (data as any)?.header?.magic === 'NCPMF';
      const isJSON = (data as any)?.formatVersion === '1.0' && (data as any)?.memories;
      if (!isPMF && !isJSON) {
        alert("Invalid export file format");
        return;
      }

      const result = await importMutation.mutateAsync(data);
      setImportResult(result);
      setIsImportDialogOpen(true);

      // Refresh data
      refetchStats();
    } catch (error) {
      alert("Failed to import: " + (error instanceof Error ? error.message : "Unknown error"));
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold">Settings</h1>
        <p className="text-sm lg:text-base text-muted-foreground">
          Manage your NovaCortex configuration
        </p>
      </div>

      {/* License Card - Full Width at Top */}
      <Card className={licenseInfo?.tier === 'pro' || licenseInfo?.tier === 'enterprise' ? 'border-amber-500/50' : ''} data-hint="license-section">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {licenseInfo?.tier === 'pro' || licenseInfo?.tier === 'enterprise' ? (
              <Crown className="h-5 w-5 text-amber-500" />
            ) : (
              <Shield className="h-5 w-5" />
            )}
            License
            {licenseInfo && (
              <Badge
                variant={
                  licenseInfo.tier === 'pro' || licenseInfo.tier === 'enterprise'
                    ? 'default'
                    : licenseInfo.tier === 'free'
                    ? 'secondary'
                    : 'outline'
                }
                className={licenseInfo.tier === 'pro' ? 'bg-amber-500 hover:bg-amber-600' : ''}
              >
                {licenseInfo.tier.toUpperCase()}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {licenseInfo?.tier === 'unregistered'
              ? 'Unregistered - 1 namespace, no support'
              : licenseInfo?.tier === 'free'
              ? 'Free - 3 namespaces, community support (GitHub issues)'
              : licenseInfo?.tier === 'pro'
              ? 'Pro - 10 namespaces, email support (48h response)'
              : licenseInfo?.tier === 'enterprise'
              ? 'Enterprise - unlimited namespaces, priority support (24h response)'
              : 'Manage your NovaCortex license'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current Plan Info */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border p-3 text-center">
              <p className="text-xs text-muted-foreground">Tier</p>
              <p className="text-lg font-bold capitalize">{licenseInfo?.tier || 'unregistered'}</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-xs text-muted-foreground">Namespaces</p>
              <p className="text-lg font-bold">{licenseInfo?.maxNamespaces || 1}</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-xs text-muted-foreground">Federation</p>
              <p className="text-lg font-bold">
                {licenseInfo?.features?.federation ? (
                  <Check className="h-5 w-5 text-green-500 mx-auto" />
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </p>
            </div>
          </div>


          {/* Activate a key directly from the UI (admin token required) */}
          <div className="space-y-2">
            <Label htmlFor="license-key">Activate a license key</Label>
            <div className="flex gap-2">
              <Input
                id="license-key"
                value={licenseKeyInput}
                onChange={(e) => setLicenseKeyInput(e.target.value)}
                placeholder="nclic...."
                className="font-mono"
                autoComplete="off"
              />
              <Button
                onClick={handleActivateLicense}
                disabled={!licenseKeyInput.trim() || activating}
              >
                {activating ? "Activating..." : "Activate"}
              </Button>
            </div>
            {activationResult && (
              <p
                className={`text-xs ${activationResult.ok ? "text-green-600" : "text-red-600"}`}
              >
                {activationResult.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Alternatively set the <code className="bg-muted px-1 py-0.5 rounded text-xs">LICENSE_KEY</code> environment
              variable (takes precedence on restart).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Search mode / embeddings status — makes a silent substring-fallback visible */}
      <Card
        className={
          searchStatus && searchStatus.mode !== "semantic" ? "border-amber-500/50" : ""
        }
        data-hint="search-status-section"
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Search Mode
            {searchStatus && (
              <Badge variant={searchStatus.mode === "semantic" ? "default" : "destructive"}>
                {searchStatus.mode === "semantic" ? "SEMANTIC" : "SUBSTRING FALLBACK"}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {searchStatus
              ? searchStatus.mode === "semantic"
                ? "Vector search is active — queries are embedded and matched by meaning."
                : "Semantic search is NOT active — queries fall back to plain substring matching."
              : "Checking embedding provider..."}
          </CardDescription>
        </CardHeader>
        {searchStatus && (
          <CardContent className="space-y-3">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground">Embedding Provider</p>
                <p className="text-lg font-bold capitalize">
                  {searchStatus.embeddings.status === "ok"
                    ? "Connected"
                    : searchStatus.embeddings.status.replace("_", " ")}
                </p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground">Model</p>
                <p className="text-lg font-bold font-mono truncate" title={searchStatus.embeddings.model}>
                  {searchStatus.embeddings.model}
                </p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground">Dimension</p>
                <p className="text-lg font-bold">
                  {searchStatus.embeddings.dimension ?? "—"} / {searchStatus.embeddings.expectedDimension}
                </p>
              </div>
            </div>
            {searchStatus.embeddings.status === "disabled" && (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                No embedding provider configured. For fully local semantic search, start the
                stack with the <code className="bg-muted px-1 py-0.5 rounded">local-ai</code> compose
                profile, or set <code className="bg-muted px-1 py-0.5 rounded">OPENAI_API_KEY</code> (and
                optionally <code className="bg-muted px-1 py-0.5 rounded">OPENAI_BASE_URL</code> for any
                OpenAI-compatible server).
              </p>
            )}
            {searchStatus.embeddings.status === "unreachable" && (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                Embedding endpoint unreachable{searchStatus.embeddings.error ? `: ${searchStatus.embeddings.error}` : ""}.
                Search is degraded until it recovers.
              </p>
            )}
            {searchStatus.embeddings.status === "dimension_mismatch" && (
              <p className="flex items-start gap-2 text-xs text-red-600">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {searchStatus.embeddings.error}
              </p>
            )}
            <Button variant="outline" size="sm" onClick={() => fetchSearchStatus()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Re-check
            </Button>
          </CardContent>
        )}
      </Card>

      <AccessTokensPanel />

      <div className="grid gap-4 lg:gap-6 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              API Configuration
            </CardTitle>
            <CardDescription>
              Connect your applications to NovaCortex
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-url">API Base URL</Label>
              <div className="flex gap-2">
                <Input
                  id="api-url"
                  value={customApiUrl}
                  onChange={(e) => setCustomApiUrl(e.target.value)}
                  readOnly={licenseInfo?.tier !== 'enterprise'}
                  className="font-mono"
                  placeholder="http://localhost:8080"
                />
                <Button variant="outline" size="icon" onClick={handleCopyApiUrl}>
                  {copiedApiUrl ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {licenseInfo?.tier === 'enterprise' && (
                <div className="flex gap-2 mt-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleSaveApiUrl}
                    disabled={customApiUrl === localStorage.getItem('novacortex_api_url') || customApiUrl === API_URL}
                  >
                    {apiUrlSaved ? (
                      <>
                        <Check className="h-4 w-4 mr-1" />
                        Saved
                      </>
                    ) : (
                      "Save & Reload"
                    )}
                  </Button>
                  {customApiUrl !== API_URL && (
                    <Button variant="outline" size="sm" onClick={handleResetApiUrl}>
                      Reset to Default
                    </Button>
                  )}
                </div>
              )}
              {licenseInfo?.tier !== 'enterprise' && (
                <p className="text-xs text-muted-foreground">
                  <Crown className="h-3 w-3 inline mr-1 text-amber-500" />
                  Enterprise feature: Custom API URL for distributed deployments
                </p>
              )}
            </div>
            <Separator />
            <div className="space-y-2">
              <Label>Endpoints</Label>
              <div className="space-y-1 rounded-lg border p-3 text-sm font-mono">
                <p>GET /health - Health check</p>
                <p>GET /stats - Statistics</p>
                <p>GET /memories - List memories</p>
                <p>POST /memories - Create memory</p>
                <p>POST /search - Vector search</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-hint="export-section">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Export Data
            </CardTitle>
            <CardDescription>
              Export memories from a namespace
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="export-namespace">Select Namespace</Label>
              <Select
                value={selectedExportNamespace}
                onValueChange={setSelectedExportNamespace}
              >
                <SelectTrigger id="export-namespace">
                  <SelectValue placeholder="Choose namespace" />
                </SelectTrigger>
                <SelectContent>
                  {namespaces?.map((ns) => (
                    <SelectItem key={ns} value={ns}>
                      {ns} ({stats?.byNamespace?.[ns] || 0} memories)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="export-format">Format</Label>
              <Select
                value={exportFormat}
                onValueChange={(v) => setExportFormat(v as 'json' | 'pmf')}
              >
                <SelectTrigger id="export-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">
                    JSON (Standard)
                  </SelectItem>
                  <SelectItem value="pmf">
                    PMF (Portable Memory Format)
                  </SelectItem>
                </SelectContent>
              </Select>
              {exportFormat === 'pmf' && (
                <p className="text-xs text-muted-foreground">
                  PMF includes graph topology, integrity checksums, and federation metadata
                </p>
              )}
            </div>
            {exportFormat === 'pmf' && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Include Embeddings</p>
                  <p className="text-xs text-muted-foreground">
                    Larger file size, but preserves semantic vectors
                  </p>
                </div>
                <Switch
                  checked={includeEmbeddings}
                  onCheckedChange={setIncludeEmbeddings}
                />
              </div>
            )}
            <Button
              className="w-full"
              onClick={handleExport}
              disabled={!selectedExportNamespace || exportMutation.isPending}
            >
              <Download className="mr-2 h-4 w-4" />
              {exportMutation.isPending ? "Exporting..." : `Export as ${exportFormat.toUpperCase()}`}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Data
            </CardTitle>
            <CardDescription>
              Import memories from an exported JSON file
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-dashed p-8 text-center">
              <Upload className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
              <p className="mb-2 text-sm text-muted-foreground">
                Drop a JSON export file here or click to browse
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                variant="outline"
                onClick={handleImportClick}
                disabled={importMutation.isPending}
              >
                {importMutation.isPending ? "Importing..." : "Select File"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Only files exported from NovaCortex in the v1.0 format are
              supported.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Statistics</CardTitle>
            <CardDescription>Overview of your memory system</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Total Memories</p>
                <p className="text-2xl font-bold">
                  {stats?.total?.toLocaleString() || 0}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Namespaces</p>
                <p className="text-2xl font-bold">
                  {Object.keys(stats?.byNamespace || {}).length}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Memory Types</p>
                <p className="text-2xl font-bold">
                  {Object.keys(stats?.byType || {}).length}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Recent Activity</p>
                <p className="text-2xl font-bold">
                  {(stats?.recentActivity?.created || 0) +
                    (stats?.recentActivity?.updated || 0)}
                </p>
              </div>
            </div>
            <div className="mt-4">
              <Button variant="outline" onClick={() => refetchStats()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh Statistics
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Complete</DialogTitle>
            <DialogDescription>
              The import operation has finished.
            </DialogDescription>
          </DialogHeader>
          {importResult && (
            <div className="space-y-4">
              <div className="rounded-lg border p-4">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Successfully imported</span>
                  <span className="font-medium text-green-600">
                    {importResult.imported}
                  </span>
                </div>
                {importResult.failed > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Failed</span>
                    <span className="font-medium text-red-600">
                      {importResult.failed}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setIsImportDialogOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
