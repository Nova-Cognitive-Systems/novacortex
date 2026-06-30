"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Upload,
  FileText,
  File,
  Trash2,
  Plus,
  Eye,
  RefreshCw,
  FileSpreadsheet,
  FileCode,
  FolderOpen,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { fetchApi, getAuthToken, getApiBaseUrl } from "@/lib/api";

interface UploadHistoryEntry {
  filename: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy?: string;
  documentId: string;
}

interface KnowledgeBucket {
  id: string;
  name: string;
  description?: string;
  namespace: string;
  agents: string[];
  createdAt: string;
  updatedAt: string;
  documentCount: number;
}

interface KnowledgeDocument {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  chunks: number;
  namespace: string;
  uploadedAt: string;
}

interface DocumentDetail {
  document: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    content: string;
    chunks: string[];
    namespace: string;
    uploadedAt: string;
  };
  memoryIds: string[];
}

export default function KnowledgePage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Buckets state
  const [buckets, setBuckets] = useState<KnowledgeBucket[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<KnowledgeBucket | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [uploadHistory, setUploadHistory] = useState<UploadHistoryEntry[]>([]);

  // Loading states
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create bucket dialog
  const [createBucketOpen, setCreateBucketOpen] = useState(false);
  const [newBucketName, setNewBucketName] = useState("");
  const [newBucketDesc, setNewBucketDesc] = useState("");
  const [newBucketNamespace, setNewBucketNamespace] = useState("default");
  const [newBucketAgents, setNewBucketAgents] = useState<string[]>([]);

  // Available data
  const [namespaces, setNamespaces] = useState<string[]>(["default"]);
  const [knownAgents, setKnownAgents] = useState<string[]>([]);

  // Upload options
  const [createMemories, setCreateMemories] = useState(true);

  // View tabs
  const [activeTab, setActiveTab] = useState<"documents" | "history">("documents");

  // View document dialog
  const [viewDocument, setViewDocument] = useState<DocumentDetail | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);

  // Fetch buckets
  const fetchBuckets = useCallback(async () => {
    try {
      const data = await fetchApi<{ buckets: KnowledgeBucket[] }>('/buckets');
      setBuckets(data.buckets || []);
    } catch (e) {
      console.error("Failed to fetch buckets", e);
    }
  }, []);

  // Fetch namespaces
  const fetchNamespaces = useCallback(async () => {
    try {
      const data = await fetchApi<{ data: string[] }>('/namespaces');
      if (data.data) {
        const others = data.data.filter((n: string) => n && n !== "default");
        setNamespaces(["default", ...others]);
      }
    } catch (e) {
      console.error("Failed to fetch namespaces", e);
    }
  }, []);

  // Fetch agents from tokens
  const fetchAgents = useCallback(async () => {
    try {
      const tokens = await fetchApi<Array<{ agentId?: string; revokedAt?: string }>>('/tokens');
      const agentIds = tokens
        .filter((t) => t.agentId && !t.revokedAt)
        .map((t) => t.agentId as string);
      if (agentIds.length > 0) setKnownAgents(agentIds);
    } catch (e) {
      console.error("Failed to fetch agents", e);
    }
  }, []);

  // Fetch bucket documents
  const fetchBucketDocuments = useCallback(async (bucketId: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<{ documents: KnowledgeDocument[] }>(`/buckets/${bucketId}/documents`);
      setDocuments(data.documents || []);
    } catch (e) {
      setError("Failed to fetch documents");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch upload history
  const fetchUploadHistory = useCallback(async (bucketId: string) => {
    try {
      const data = await fetchApi<{ history: UploadHistoryEntry[] }>(`/buckets/${bucketId}/history`);
      setUploadHistory(data.history || []);
    } catch (e) {
      console.error("Failed to fetch history", e);
    }
  }, []);

  useEffect(() => {
    fetchBuckets();
    fetchNamespaces();
    fetchAgents();
  }, [fetchBuckets, fetchNamespaces, fetchAgents]);

  useEffect(() => {
    if (selectedBucket) {
      fetchBucketDocuments(selectedBucket.id);
      fetchUploadHistory(selectedBucket.id);
    } else {
      setDocuments([]);
      setUploadHistory([]);
    }
  }, [selectedBucket, fetchBucketDocuments, fetchUploadHistory]);

  // Create bucket
  const handleCreateBucket = async () => {
    if (!newBucketName.trim()) return;

    try {
      const data = await fetchApi<{ bucket: KnowledgeBucket }>('/buckets', {
        method: "POST",
        body: JSON.stringify({
          name: newBucketName.trim(),
          description: newBucketDesc.trim() || undefined,
          namespace: newBucketNamespace,
          agents: newBucketAgents,
        }),
      });

      setNewBucketName("");
      setNewBucketDesc("");
      setNewBucketNamespace("default");
      setNewBucketAgents([]);
      setCreateBucketOpen(false);

      await fetchBuckets();
      setSelectedBucket(data.bucket);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create bucket");
    }
  };

  // Delete bucket
  const handleDeleteBucket = async (bucketId: string) => {
    if (!confirm("Delete this bucket? Documents will remain but lose bucket association.")) return;

    try {
      await fetchApi(`/buckets/${bucketId}`, { method: "DELETE" });
      if (selectedBucket?.id === bucketId) {
        setSelectedBucket(null);
      }
      await fetchBuckets();
    } catch (e) {
      setError("Failed to delete bucket");
    }
  };

  // Upload file to bucket
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedBucket) return;

    setUploading(true);
    setUploadFileName(file.name);
    setUploadStatus("Uploading...");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("createMemories", createMemories.toString());

      setUploadStatus(`Uploading ${file.name} (${(file.size / 1024).toFixed(0)} KB)...`);

      const token = getAuthToken();
      const res = await fetch(`${getApiBaseUrl()}/buckets/${selectedBucket.id}/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      setUploadStatus("Processing...");

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      setUploadStatus("Refreshing...");

      // Refresh documents and history
      await fetchBucketDocuments(selectedBucket.id);
      await fetchUploadHistory(selectedBucket.id);
      await fetchBuckets();

      setUploadStatus(null);
      setUploadFileName(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setUploadStatus(null);
      setUploadFileName(null);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // View document
  const handleViewDocument = async (docId: string) => {
    try {
      const data = await fetchApi<DocumentDetail>(`/knowledge/${docId}`);
      setViewDocument(data);
      setViewDialogOpen(true);
    } catch (e) {
      setError("Failed to load document");
    }
  };

  // Delete document
  const handleDeleteDocument = async (docId: string) => {
    if (!confirm("Delete this document?")) return;

    try {
      await fetchApi(`/knowledge/${docId}`, { method: "DELETE" });
      if (selectedBucket) {
        await fetchBucketDocuments(selectedBucket.id);
        await fetchBuckets();
      }
    } catch (e) {
      setError("Failed to delete document");
    }
  };

  // File icon helper
  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes("pdf")) return <FileText className="h-4 w-4 text-red-400" />;
    if (mimeType.includes("csv") || mimeType.includes("spreadsheet"))
      return <FileSpreadsheet className="h-4 w-4 text-green-400" />;
    if (mimeType.includes("json")) return <FileCode className="h-4 w-4 text-yellow-400" />;
    return <File className="h-4 w-4 text-blue-400" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Knowledge Base</h1>
          <p className="text-muted-foreground">
            Organize documents in buckets with predefined agent access
          </p>
        </div>
        <Button onClick={() => setCreateBucketOpen(true)} data-hint="create-bucket-btn">
          <Plus className="h-4 w-4 mr-2" />
          Create Bucket
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-lg p-3">
          {error}
          <Button variant="ghost" size="sm" onClick={() => setError(null)} className="ml-2">
            Dismiss
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Buckets sidebar */}
        <div className="lg:col-span-1 space-y-3" data-hint="bucket-list">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Buckets</h2>
            <Button variant="ghost" size="sm" onClick={fetchBuckets}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {buckets.length === 0 ? (
            <Card className="p-4 text-center text-muted-foreground">
              <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No buckets yet</p>
              <p className="text-xs">Create a bucket to start organizing documents</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {buckets.map((bucket) => (
                <Card
                  key={bucket.id}
                  className={`p-3 cursor-pointer transition-colors ${
                    selectedBucket?.id === bucket.id
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedBucket(bucket)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{bucket.name}</div>
                      {bucket.description && (
                        <p className="text-xs text-muted-foreground truncate">
                          {bucket.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {bucket.namespace}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {bucket.documentCount} docs
                        </span>
                      </div>
                      {bucket.agents.length > 0 && (
                        <div className="flex items-center gap-1 mt-1">
                          <Users className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {bucket.agents.length} agent{bucket.agents.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteBucket(bucket.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="lg:col-span-3">
          {!selectedBucket ? (
            <Card className="p-8 text-center">
              <FolderOpen className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <h3 className="text-lg font-medium mb-2">Select a Bucket</h3>
              <p className="text-muted-foreground mb-4">
                Choose a bucket from the sidebar or create a new one to start uploading documents
              </p>
              <Button onClick={() => setCreateBucketOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Bucket
              </Button>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Bucket header */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <FolderOpen className="h-5 w-5" />
                        {selectedBucket.name}
                      </CardTitle>
                      {selectedBucket.description && (
                        <CardDescription>{selectedBucket.description}</CardDescription>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{selectedBucket.namespace}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center gap-4" data-hint="agent-access">
                    <div>
                      <Label className="text-xs text-muted-foreground">Agents with access</Label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {selectedBucket.agents.length === 0 ? (
                          <span className="text-sm text-muted-foreground">None</span>
                        ) : (
                          selectedBucket.agents.map((agent) => (
                            <Badge key={agent} variant="outline">
                              {agent}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Upload section */}
              <Card data-hint="upload-section">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Upload Document</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleUpload}
                      accept=".txt,.md,.csv,.pdf,.json"
                      className="hidden"
                    />
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="flex-1"
                    >
                      {uploading ? (
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4 mr-2" />
                      )}
                      {uploading ? "Processing..." : "Choose File"}
                    </Button>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="create-memories"
                        checked={createMemories}
                        onCheckedChange={setCreateMemories}
                      />
                      <Label htmlFor="create-memories" className="text-sm cursor-pointer">
                        Create memories
                      </Label>
                    </div>
                  </div>
                  {uploading && uploadStatus && (
                    <div className="flex items-center gap-2 mt-3 p-2 rounded-md bg-muted/50">
                      <RefreshCw className="h-3 w-3 animate-spin text-primary" />
                      <span className="text-sm text-muted-foreground">{uploadStatus}</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    Supports: TXT, MD, CSV, PDF, JSON (max 10MB)
                  </p>
                </CardContent>
              </Card>

              {/* Tabs for Documents / History */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => setActiveTab("documents")}
                        className={`text-base font-semibold pb-1 border-b-2 transition-colors ${
                          activeTab === "documents"
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Documents ({documents.length})
                      </button>
                      <button
                        onClick={() => setActiveTab("history")}
                        className={`text-base font-semibold pb-1 border-b-2 transition-colors ${
                          activeTab === "history"
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Upload History ({uploadHistory.length})
                      </button>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        fetchBucketDocuments(selectedBucket.id);
                        fetchUploadHistory(selectedBucket.id);
                      }}
                      disabled={loading}
                    >
                      <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {activeTab === "documents" ? (
                    <>
                      {documents.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                          <p>No documents in this bucket</p>
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>File</TableHead>
                              <TableHead>Size</TableHead>
                              <TableHead>Chunks</TableHead>
                              <TableHead>Uploaded</TableHead>
                              <TableHead className="w-20"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {documents.map((doc) => (
                              <TableRow key={doc.id}>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    {getFileIcon(doc.mimeType)}
                                    <span className="font-medium truncate max-w-[200px]">
                                      {doc.filename}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell>{formatFileSize(doc.size)}</TableCell>
                                <TableCell>{doc.chunks}</TableCell>
                                <TableCell>
                                  {new Date(doc.uploadedAt).toLocaleDateString()}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleViewDocument(doc.id)}
                                    >
                                      <Eye className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleDeleteDocument(doc.id)}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </>
                  ) : (
                    <>
                      {uploadHistory.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Upload className="h-8 w-8 mx-auto mb-2 opacity-30" />
                          <p>No upload history yet</p>
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>File</TableHead>
                              <TableHead>Size</TableHead>
                              <TableHead>Uploaded At</TableHead>
                              <TableHead>Uploaded By</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {uploadHistory.map((entry, idx) => (
                              <TableRow key={`${entry.documentId}-${idx}`}>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    {getFileIcon(entry.mimeType)}
                                    <span className="font-medium truncate max-w-[200px]">
                                      {entry.filename}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell>{formatFileSize(entry.size)}</TableCell>
                                <TableCell>
                                  {new Date(entry.uploadedAt).toLocaleString()}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline">
                                    {entry.uploadedBy || "unknown"}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Create Bucket Dialog */}
      <Dialog open={createBucketOpen} onOpenChange={setCreateBucketOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Knowledge Bucket</DialogTitle>
            <DialogDescription>
              A bucket is a container for documents with predefined access rules.
              All documents uploaded to this bucket will be accessible by the assigned agents.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bucket-name">Bucket Name</Label>
              <Input
                id="bucket-name"
                placeholder="e.g. product-docs"
                value={newBucketName}
                onChange={(e) => setNewBucketName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bucket-desc">Description (optional)</Label>
              <Input
                id="bucket-desc"
                placeholder="What kind of documents will be stored here?"
                value={newBucketDesc}
                onChange={(e) => setNewBucketDesc(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Namespace</Label>
              <Select value={newBucketNamespace} onValueChange={setNewBucketNamespace}>
                <SelectTrigger>
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

            <div className="space-y-2">
              <Label>Agents with Access</Label>
              <div className="flex flex-wrap gap-1 mb-2">
                {newBucketAgents.map((agent) => (
                  <Badge key={agent} variant="secondary" className="flex items-center gap-1">
                    {agent}
                    <button
                      onClick={() =>
                        setNewBucketAgents(newBucketAgents.filter((a) => a !== agent))
                      }
                      className="ml-1 hover:text-destructive"
                    >
                      &times;
                    </button>
                  </Badge>
                ))}
              </div>
              {knownAgents.length > 0 ? (
                <Select
                  onValueChange={(v) => {
                    if (!newBucketAgents.includes(v)) {
                      setNewBucketAgents([...newBucketAgents, v]);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Add agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {knownAgents
                      .filter((a) => !newBucketAgents.includes(a))
                      .map((agent) => (
                        <SelectItem key={agent} value={agent}>
                          {agent}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No agents configured. Create API keys in Settings first.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateBucketOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateBucket} disabled={!newBucketName.trim()}>
              Create Bucket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Document Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {viewDocument && getFileIcon(viewDocument.document.mimeType)}
              {viewDocument?.document.filename}
            </DialogTitle>
            <DialogDescription>
              {viewDocument && formatFileSize(viewDocument.document.size)} |{" "}
              {viewDocument?.document.chunks.length} chunks |{" "}
              {viewDocument?.memoryIds.length} linked memories
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto">
            <pre className="bg-muted p-4 rounded-lg text-sm whitespace-pre-wrap font-mono">
              {viewDocument?.document.content}
            </pre>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
