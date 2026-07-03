/**
 * MCP Tool Definitions and Handlers
 */

import { z } from 'zod';
import {
  MemoryService,
  MemoryType,
  RelationType,
  LLMService,
  IntelligenceService,
  resolveLLMConfig,
  type Memory,
  type SearchResult,
  type PortableMemory,
} from '@memory-stack/core';
import { SessionManager } from './session-manager.js';
import { sanitizeSearchQuery } from './query-sanitizer.js';
import { walLog } from './wal.js';
import {
  MemoryStoreSchema,
  MemorySearchSchema,
  MemoryRecallSchema,
  MemoryRelateSchema,
  MemoryForgetSchema,
  MemoryExportSchema,
  SessionStartSchema,
  SessionAddTurnSchema,
  SessionGetContextSchema,
  SessionEndSchema,
  MemoryStatusSchema,
  MemoryWakeupSchema,
  MemoryIngestSchema,
  MemoryCurrentSchema,
  MemoryUpdateSchema,
  type MemoryStoreInput,
  type MemorySearchInput,
  type MemoryRecallInput,
  type MemoryRelateInput,
  type MemoryForgetInput,
  type MemoryExportInput,
  type SessionStartInput,
  type SessionAddTurnInput,
  type SessionGetContextInput,
  type SessionEndInput,
  type MemoryStatusInput,
  type MemoryWakeupInput,
  type MemoryIngestInput,
  type MemoryCurrentInput,
  type MemoryUpdateInput,
} from './schemas.js';

// Convert Zod schema to JSON Schema for MCP
function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // Simple conversion for our schemas
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodValue = value as z.ZodType;
      properties[key] = zodFieldToJsonSchema(zodValue);

      // Check if required (not optional and no default)
      if (
        !(zodValue instanceof z.ZodOptional) &&
        !(zodValue instanceof z.ZodDefault)
      ) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  return { type: 'object' };
}

function zodFieldToJsonSchema(field: z.ZodType): Record<string, unknown> {
  // Handle optional
  if (field instanceof z.ZodOptional) {
    return zodFieldToJsonSchema(field.unwrap());
  }

  // Handle default
  if (field instanceof z.ZodDefault) {
    const inner = zodFieldToJsonSchema(field._def.innerType);
    return { ...inner, default: field._def.defaultValue() };
  }

  // Handle string
  if (field instanceof z.ZodString) {
    return { type: 'string', description: field.description };
  }

  // Handle number
  if (field instanceof z.ZodNumber) {
    return { type: 'number', description: field.description };
  }

  // Handle boolean
  if (field instanceof z.ZodBoolean) {
    return { type: 'boolean', description: field.description };
  }

  // Handle array
  if (field instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodFieldToJsonSchema(field.element),
      description: field.description,
    };
  }

  // Handle enum
  if (field instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: field.options,
      description: field.description,
    };
  }

  // Handle native enum
  if (field instanceof z.ZodNativeEnum) {
    return {
      type: 'string',
      enum: Object.values(field.enum),
      description: field.description,
    };
  }

  // Handle record
  if (field instanceof z.ZodRecord) {
    return {
      type: 'object',
      additionalProperties: true,
      description: field.description,
    };
  }

  // Handle object
  if (field instanceof z.ZodObject) {
    return zodToJsonSchema(field);
  }

  return { type: 'string' };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export class ToolHandler {
  private memoryService: MemoryService;
  private sessionManager: SessionManager;
  private intelligence: IntelligenceService;

  constructor(memoryService: MemoryService) {
    this.memoryService = memoryService;
    // Intelligence layer: active only when LLM_MODEL (+ key/base URL) is set —
    // same env contract as the REST API. Without it, memory_ingest reports
    // unavailable and session_end falls back to the heuristic extraction.
    this.intelligence = new IntelligenceService(memoryService, new LLMService(resolveLLMConfig()));
    this.sessionManager = new SessionManager(memoryService, this.intelligence);
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'memory_store',
        description:
          'Store a new memory. Use for facts, events, procedures, or working context.',
        inputSchema: zodToJsonSchema(MemoryStoreSchema),
      },
      {
        name: 'memory_search',
        description:
          'Search memories using text or semantic similarity. Returns relevant memories.',
        inputSchema: zodToJsonSchema(MemorySearchSchema),
      },
      {
        name: 'memory_recall',
        description: 'Retrieve a specific memory by ID. Can include related memories.',
        inputSchema: zodToJsonSchema(MemoryRecallSchema),
      },
      {
        name: 'memory_relate',
        description:
          'Create a relation between two memories. Relations can be causal, supportive, contradictory, etc.',
        inputSchema: zodToJsonSchema(MemoryRelateSchema),
      },
      {
        name: 'memory_forget',
        description: 'Delete a memory. Use carefully - this is permanent.',
        inputSchema: zodToJsonSchema(MemoryForgetSchema),
      },
      {
        name: 'memory_export',
        description:
          'Export all memories from a namespace as a portable format for backup or migration.',
        inputSchema: zodToJsonSchema(MemoryExportSchema),
      },
      {
        name: 'session_start',
        description:
          'Start a new working memory session. Returns relevant context based on initial query.',
        inputSchema: zodToJsonSchema(SessionStartSchema),
      },
      {
        name: 'session_add_turn',
        description: 'Add a conversation turn to the session. Stores as working memory.',
        inputSchema: zodToJsonSchema(SessionAddTurnSchema),
      },
      {
        name: 'session_get_context',
        description:
          'Get relevant context for a query, including long-term memories and session history.',
        inputSchema: zodToJsonSchema(SessionGetContextSchema),
      },
      {
        name: 'session_end',
        description:
          'End a session, archive important information, and extract semantic memories.',
        inputSchema: zodToJsonSchema(SessionEndSchema),
      },
      {
        name: 'memory_status',
        description:
          'CALL THIS FIRST at session start. Returns the 4-layer memory context (identity + top memories) and the PALACE_PROTOCOL behavioral contract. This is the most important tool — call it before answering any question about past work, projects, or stored knowledge.',
        inputSchema: zodToJsonSchema(MemoryStatusSchema),
      },
      {
        name: 'memory_wakeup',
        description:
          'Load tiered memory context for a specific topic. Returns L1 (top salience) + L2 (topic-filtered) memories combined, capped at ~900 tokens total for efficient context injection.',
        inputSchema: zodToJsonSchema(MemoryWakeupSchema),
      },
      {
        name: 'memory_ingest',
        description:
          'Distill conversation messages into discrete memories automatically (LLM fact extraction + conflict resolution with typed edges). Use instead of memory_store when you have raw conversation turns rather than a curated fact. Requires a configured LLM (LLM_MODEL).',
        inputSchema: zodToJsonSchema(MemoryIngestSchema),
      },
      {
        name: 'memory_current',
        description:
          'Resolve a memory to its CURRENT version by walking the supersedes chain. Use when a recalled fact might be outdated (e.g. it carries an invalidatedAt or a supersedes edge).',
        inputSchema: zodToJsonSchema(MemoryCurrentSchema),
      },
      {
        name: 'memory_update',
        description:
          'Update an existing memory (content, tags, entities, salience). Content changes are re-embedded automatically. Prefer storing a NEW memory + memory_relate(supersedes) when a fact CHANGED — update is for corrections/enrichment of the same fact.',
        inputSchema: zodToJsonSchema(MemoryUpdateSchema),
      },
    ];
  }

  async handleTool(name: string, args: unknown): Promise<ToolResult> {
    try {
      switch (name) {
        case 'memory_store':
          return await this.handleMemoryStore(args);
        case 'memory_search':
          return await this.handleMemorySearch(args);
        case 'memory_recall':
          return await this.handleMemoryRecall(args);
        case 'memory_relate':
          return await this.handleMemoryRelate(args);
        case 'memory_forget':
          return await this.handleMemoryForget(args);
        case 'memory_export':
          return await this.handleMemoryExport(args);
        case 'session_start':
          return await this.handleSessionStart(args);
        case 'session_add_turn':
          return await this.handleSessionAddTurn(args);
        case 'session_get_context':
          return await this.handleSessionGetContext(args);
        case 'session_end':
          return await this.handleSessionEnd(args);
        case 'memory_status':
          return await this.handleMemoryStatus(args);
        case 'memory_wakeup':
          return await this.handleMemoryWakeup(args);
        case 'memory_ingest':
          return await this.handleMemoryIngest(args);
        case 'memory_current':
          return await this.handleMemoryCurrent(args);
        case 'memory_update':
          return await this.handleMemoryUpdate(args);
        default:
          return this.error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(message);
    }
  }

  private async handleMemoryStore(args: unknown): Promise<ToolResult> {
    const input = MemoryStoreSchema.parse(args) as MemoryStoreInput;
    walLog('memory_store', args);

    const memory = await this.memoryService.createMemory({
      content: input.content,
      memoryType: input.memoryType,
      namespace: input.namespace,
      tags: input.tags,
      entities: input.entities,
      signals: input.signals?.map((s) => ({
        ...s,
        extractedAt: new Date(),
      })),
      source: input.source
        ? { ...input.source, timestamp: new Date() }
        : undefined,
      confidence: input.confidence,
      salience: input.salience,
      decayRate: input.decayRate,
      embedding: input.embedding,
    });

    return this.success({
      stored: true,
      id: memory.id.id,
      namespace: memory.id.namespace,
      contentHash: memory.contentHash,
    });
  }

  private async handleMemorySearch(args: unknown): Promise<ToolResult> {
    const input = MemorySearchSchema.parse(args) as MemorySearchInput;
    const sanitizedQuery = sanitizeSearchQuery(input.query);

    let results: SearchResult[];

    if (input.embedding && input.embedding.length > 0) {
      // Caller supplied a pre-computed embedding → direct vector search.
      results = await this.memoryService.vectorSearch({
        vector: input.embedding,
        namespace: input.namespace,
        memoryTypes: input.memoryTypes,
        tags: input.tags,
        limit: input.limit,
        minSalience: input.minSalience,
        scoreThreshold: input.scoreThreshold,
        includeInvalidated: input.includeInvalidated,
        explain: input.explain,
      });
    } else {
      // Plain text query → embed it server-side and run a semantic vector search,
      // transparently falling back to substring search when embeddings are off.
      const search = await this.memoryService.searchByText(sanitizedQuery, {
        namespace: input.namespace,
        memoryTypes: input.memoryTypes,
        tags: input.tags,
        limit: input.limit,
        minSalience: input.minSalience,
        scoreThreshold: input.scoreThreshold,
        includeInvalidated: input.includeInvalidated,
        explain: input.explain,
      });
      results = search.results;
    }

    return this.success({
      count: results.length,
      memories: results.map((r) => ({
        id: r.memory.id.id,
        namespace: r.memory.id.namespace,
        content: r.memory.content,
        type: r.memory.memoryType,
        salience: r.memory.metadata.salience,
        score: r.score,
        tags: r.memory.metadata.tags,
        createdAt: r.memory.createdAt,
        ...(r.memory.invalidatedAt
          ? { invalidatedAt: r.memory.invalidatedAt, hint: 'superseded — resolve via memory_current' }
          : {}),
        ...(r.trace ? { trace: r.trace } : {}),
      })),
    });
  }

  private async handleMemoryRecall(args: unknown): Promise<ToolResult> {
    const input = MemoryRecallSchema.parse(args) as MemoryRecallInput;

    const memory = await this.memoryService.getMemory(
      { id: input.id, namespace: input.namespace },
      input.includeRelations
    );

    if (!memory) {
      return this.error(`Memory not found: ${input.namespace}:${input.id}`);
    }

    return this.success({
      id: memory.id.id,
      namespace: memory.id.namespace,
      content: memory.content,
      type: memory.memoryType,
      metadata: memory.metadata,
      relations: input.includeRelations
        ? memory.relations.map((r) => ({
            id: r.id,
            type: r.relationType,
            to: `${r.toMemory.namespace}:${r.toMemory.id}`,
            strength: r.strength,
          }))
        : undefined,
      createdAt: memory.createdAt,
      accessedAt: memory.accessedAt,
      version: memory.version,
    });
  }

  private async handleMemoryRelate(args: unknown): Promise<ToolResult> {
    const input = MemoryRelateSchema.parse(args) as MemoryRelateInput;
    walLog('memory_relate', args);

    const relation = await this.memoryService.createRelation(
      { id: input.fromId, namespace: input.fromNamespace },
      { id: input.toId, namespace: input.toNamespace },
      input.relationType,
      input.strength,
      input.bidirectional,
      input.metadata || {}
    );

    return this.success({
      created: true,
      relationId: relation.id,
      from: `${input.fromNamespace}:${input.fromId}`,
      to: `${input.toNamespace}:${input.toId}`,
      type: input.relationType,
      bidirectional: input.bidirectional,
    });
  }

  private async handleMemoryForget(args: unknown): Promise<ToolResult> {
    const input = MemoryForgetSchema.parse(args) as MemoryForgetInput;
    walLog('memory_forget', args);

    const deleted = await this.memoryService.deleteMemory({
      id: input.id,
      namespace: input.namespace,
    });

    return this.success({
      deleted,
      id: input.id,
      namespace: input.namespace,
    });
  }

  private async handleMemoryExport(args: unknown): Promise<ToolResult> {
    const input = MemoryExportSchema.parse(args) as MemoryExportInput;

    const exported = await this.memoryService.exportNamespace(input.namespace);

    return this.success({
      formatVersion: exported.formatVersion,
      namespace: input.namespace,
      memoriesCount: exported.memories.length,
      relationsCount: exported.relations.length,
      exportedAt: exported.exportedAt,
      checksum: exported.checksum,
      data: exported, // Full portable format
    });
  }

  private async handleSessionStart(args: unknown): Promise<ToolResult> {
    const input = SessionStartSchema.parse(args) as SessionStartInput;

    const { sessionId, initialContext } =
      await this.sessionManager.startSession({
        sessionId: input.sessionId,
        agentId: input.agentId,
        namespace: input.namespace,
        contextQuery: input.contextQuery,
        contextLimit: input.contextLimit,
      });

    return this.success({
      sessionId,
      started: true,
      initialContext: initialContext.map((r) => ({
        id: r.memory.id.id,
        content: r.memory.content,
        score: r.score,
      })),
    });
  }

  private async handleSessionAddTurn(args: unknown): Promise<ToolResult> {
    const input = SessionAddTurnSchema.parse(args) as SessionAddTurnInput;

    const memory = await this.sessionManager.addTurn(
      input.sessionId,
      input.role,
      input.content,
      input.metadata
    );

    return this.success({
      added: true,
      sessionId: input.sessionId,
      memoryId: memory.id.id,
      role: input.role,
    });
  }

  private async handleSessionGetContext(args: unknown): Promise<ToolResult> {
    const input = SessionGetContextSchema.parse(args) as SessionGetContextInput;

    const { relevantMemories, sessionHistory } =
      await this.sessionManager.getContext(input.sessionId, input.query, {
        limit: input.limit,
        includeSessionHistory: input.includeSessionHistory,
        historyLimit: input.historyLimit,
      });

    return this.success({
      sessionId: input.sessionId,
      relevantMemories: relevantMemories.map((r) => ({
        id: r.memory.id.id,
        content: r.memory.content,
        type: r.memory.memoryType,
        score: r.score,
      })),
      sessionHistory: sessionHistory.map((t) => ({
        role: t.role,
        content: t.content,
        timestamp: t.timestamp,
      })),
    });
  }

  private async handleSessionEnd(args: unknown): Promise<ToolResult> {
    const input = SessionEndSchema.parse(args) as SessionEndInput;

    const { archived, extractedMemoryIds } =
      await this.sessionManager.endSession(input.sessionId, {
        summary: input.summary,
        extractMemories: input.extractMemories,
        archiveNamespace: input.archiveNamespace,
      });

    return this.success({
      sessionId: input.sessionId,
      archived,
      extractedMemoryIds,
      archiveNamespace: input.archiveNamespace,
    });
  }

  private async handleMemoryStatus(args: unknown): Promise<ToolResult> {
    const input = MemoryStatusSchema.parse(args) as MemoryStatusInput;

    // L1: Top-salience memories (capped for token budget)
    const l1Memories = await this.memoryService.searchMemories({
      namespace: input.namespace,
      limit: input.topN,
      minSalience: 3, // Only meaningful memories
    });

    // Format L1 as compact token-efficient summary
    const l1Summary = l1Memories
      .slice(0, input.topN)
      .map(
        (m) =>
          `[${m.memoryType}|sal:${m.metadata.effectiveSalience.toFixed(1)}] ${m.content.slice(0, 200)}`
      )
      .join('\n');

    const PALACE_PROTOCOL = `
=== NOVACORTEX PALACE PROTOCOL ===
1. ON WAKE-UP: You have called memory_status. Review the L1 context below before responding.
2. BEFORE ANSWERING about any past event, project, decision, or stored knowledge: call memory_search FIRST. Never guess from training data.
3. WHEN STORING: Use memory_store for facts, decisions, and important context. Tag with relevant keywords.
4. AFTER SESSIONS: Consider calling memory_store to preserve key decisions and outcomes.
5. WHEN FACTS CHANGE: Use memory_forget on the old fact, memory_store for the new one.
=== END PROTOCOL ===`.trim();

    return this.success({
      protocol: PALACE_PROTOCOL,
      namespace: input.namespace,
      l1Context: {
        description: 'Top-salience memories loaded into context (L1 layer)',
        memoriesLoaded: l1Memories.length,
        memories: l1Memories.map((m) => ({
          id: m.id.id,
          type: m.memoryType,
          salience: m.metadata.effectiveSalience,
          tags: m.metadata.tags,
          content: m.content.slice(0, 300),
          createdAt: m.createdAt,
        })),
      },
      summary: l1Summary || 'No memories found in this namespace yet.',
      instructions: 'Review the protocol above and L1 context. Use memory_search for deeper queries.',
    });
  }

  private async handleMemoryWakeup(args: unknown): Promise<ToolResult> {
    const input = MemoryWakeupSchema.parse(args) as MemoryWakeupInput;

    // L1: Top salience memories (always included)
    const l1 = await this.memoryService.searchMemories({
      namespace: input.namespace,
      limit: 15,
      minSalience: 3,
    });

    // L2: Topic-relevant memories via real retrieval (hybrid/semantic when
    // embeddings are configured, substring otherwise).
    let l2: Memory[] = [];
    if (input.query) {
      const sanitized = sanitizeSearchQuery(input.query);
      const search = await this.memoryService.searchByText(sanitized, {
        namespace: input.namespace,
        limit: 10,
      });
      l2 = search.results.map((r) => r.memory);
    }

    // Combine and deduplicate
    const seen = new Set<string>();
    const combined = [...l1, ...l2].filter((m) => {
      const key = `${m.id.namespace}:${m.id.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Progressive disclosure: 'index' packs one line per memory into a tiny
    // budget (~150 tokens) — the agent drills into anything interesting with
    // memory_recall/memory_search instead of paying for full contents upfront.
    if (input.depth === 'index') {
      const INDEX_BUDGET_CHARS = 640;
      let indexChars = 0;
      const lines: string[] = [];
      for (const m of combined) {
        const gist = m.content.length > 80 ? `${m.content.slice(0, 77)}...` : m.content;
        const line = `${m.id.id.slice(-8)} [${m.memoryType[0]}${Math.round(m.metadata.effectiveSalience)}] ${gist}`;
        if (indexChars + line.length > INDEX_BUDGET_CHARS) break;
        indexChars += line.length;
        lines.push(line);
      }
      return this.success({
        namespace: input.namespace,
        query: input.query,
        depth: 'index',
        totalAvailable: combined.length,
        indexed: lines.length,
        index: lines,
        hint: 'One line per memory: <id-suffix> [<type><salience>] <gist>. Drill down with memory_search (topic) or memory_recall (full id via memory_search).',
      });
    }

    // Enforce ~900 token budget (approx 4 chars/token, ~3600 chars total)
    let totalChars = 0;
    const budgeted = combined.filter((m) => {
      totalChars += m.content.length + 50; // +50 for metadata overhead
      return totalChars <= 3600;
    });

    return this.success({
      namespace: input.namespace,
      query: input.query,
      depth: 'full',
      totalLoaded: budgeted.length,
      l1Count: l1.length,
      l2Count: l2.length,
      memories: budgeted.map((m) => ({
        id: m.id.id,
        type: m.memoryType,
        salience: m.metadata.effectiveSalience,
        tags: m.metadata.tags,
        content: m.content,
        createdAt: m.createdAt,
      })),
    });
  }

  private async handleMemoryIngest(args: unknown): Promise<ToolResult> {
    const input = MemoryIngestSchema.parse(args) as MemoryIngestInput;
    walLog('memory_ingest', args);

    if (!this.intelligence.isEnabled()) {
      return this.error(
        'Intelligence layer disabled: set LLM_MODEL (plus LLM_API_KEY / LLM_BASE_URL for any OpenAI-compatible endpoint, incl. local Ollama). Use memory_store to store curated facts directly.'
      );
    }

    if (input.dryRun) {
      const facts = await this.intelligence.extractFacts(input.messages);
      return this.success({ dryRun: true, count: facts.length, facts });
    }

    const result = await this.intelligence.ingest(input.messages, {
      namespace: input.namespace,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      resolve: input.resolve,
    });

    return this.success({
      ingested: true,
      counts: {
        facts: result.facts.length,
        created: result.created.length,
        duplicates: result.duplicates,
        resolutions: result.resolutions.length,
      },
      created: result.created.map((m) => ({
        id: m.id.id,
        namespace: m.id.namespace,
        type: m.memoryType,
        salience: m.metadata.salience,
        content: m.content,
      })),
      resolutions: result.resolutions,
    });
  }

  private async handleMemoryUpdate(args: unknown): Promise<ToolResult> {
    const input = MemoryUpdateSchema.parse(args) as MemoryUpdateInput;
    walLog('memory_update', args);

    const id = { id: input.id, namespace: input.namespace };
    const updated = await this.memoryService.updateMemory(id, {
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.entities !== undefined ? { entities: input.entities } : {}),
      ...(input.salience !== undefined ? { salience: input.salience } : {}),
    });
    if (!updated) {
      return this.error(`Memory not found: ${input.namespace}:${input.id}`);
    }

    // A content change invalidates the stored vector — re-embed so semantic
    // search keeps matching the NEW text (previously a silent stale-vector gap).
    let reEmbedded = false;
    if (input.content !== undefined) {
      const embedder = this.memoryService.getEmbeddingService();
      if (embedder.isEnabled()) {
        const vector = await embedder.embed(updated.content);
        if (vector) {
          await this.memoryService.storeEmbedding(id, vector);
          reEmbedded = true;
        }
      }
    }

    return this.success({
      updated: true,
      id: updated.id.id,
      namespace: updated.id.namespace,
      version: updated.version,
      reEmbedded,
    });
  }

  private async handleMemoryCurrent(args: unknown): Promise<ToolResult> {
    const input = MemoryCurrentSchema.parse(args) as MemoryCurrentInput;

    const result = await this.memoryService.getCurrentFact({
      id: input.id,
      namespace: input.namespace,
    });
    if (!result) {
      return this.error(`Memory not found: ${input.namespace}:${input.id}`);
    }

    return this.success({
      superseded: result.superseded,
      hops: result.chain.length - 1,
      current: {
        id: result.current.id.id,
        namespace: result.current.id.namespace,
        content: result.current.content,
        createdAt: result.current.createdAt,
      },
      chain: result.chain.map((m) => ({
        id: m.id.id,
        content: m.content,
        invalidatedAt: m.invalidatedAt ?? null,
      })),
    });
  }

  private success(data: unknown): ToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  private error(message: string): ToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
}
