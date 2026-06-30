/**
 * Session Manager - Working Memory for conversation context
 *
 * OPTIMIZATION: Added session limits and automatic cleanup to prevent memory leaks
 */

import {
  MemoryService,
  MemoryType,
  Memory,
  SearchResult,
  RelationType,
} from '@memory-stack/core';
import { ulid } from 'ulid';

interface SessionTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

interface Session {
  id: string;
  agentId?: string;
  namespace: string;
  turns: SessionTurn[];
  startedAt: Date;
  lastActivityAt: Date;
  contextMemoryIds: string[];
}

// Configuration constants for memory management
const MAX_SESSIONS = 100;
const MAX_TURNS_PER_SESSION = 200;
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private memoryService: MemoryService;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(memoryService: MemoryService) {
    this.memoryService = memoryService;
    // Start periodic cleanup of stale sessions
    this.startCleanupTimer();
  }

  /**
   * OPTIMIZATION: Periodic cleanup of expired sessions to prevent memory leaks
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleSessions();
    }, CLEANUP_INTERVAL_MS);

    // Ensure timer doesn't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private cleanupStaleSessions(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivityAt.getTime() > SESSION_TIMEOUT_MS) {
        toDelete.push(sessionId);
      }
    }

    for (const sessionId of toDelete) {
      this.sessions.delete(sessionId);
    }
  }

  /**
   * OPTIMIZATION: Enforce session limits to prevent unbounded growth
   */
  private enforceSessionLimits(): void {
    if (this.sessions.size >= MAX_SESSIONS) {
      // Remove oldest sessions based on last activity
      const sorted = Array.from(this.sessions.entries())
        .sort((a, b) => a[1].lastActivityAt.getTime() - b[1].lastActivityAt.getTime());

      // Remove oldest 10% of sessions
      const toRemove = Math.ceil(MAX_SESSIONS * 0.1);
      for (let i = 0; i < toRemove && i < sorted.length; i++) {
        this.sessions.delete(sorted[i]![0]);
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
  }

  async startSession(options: {
    sessionId?: string;
    agentId?: string;
    namespace?: string;
    contextQuery?: string;
    contextLimit?: number;
  }): Promise<{
    sessionId: string;
    initialContext: SearchResult[];
  }> {
    const sessionId = options.sessionId || ulid();
    const namespace = options.namespace || 'sessions';

    // Retrieve initial context if query provided
    let initialContext: SearchResult[] = [];
    if (options.contextQuery) {
      const searchResults = await this.memoryService.searchMemories({
        limit: options.contextLimit || 5,
        minSalience: 3,
      });

      initialContext = searchResults.map((memory) => ({
        memory,
        score: memory.metadata.effectiveSalience / 10,
      }));
    }

    // Enforce limits before creating new session
    this.enforceSessionLimits();

    const now = new Date();
    const session: Session = {
      id: sessionId,
      agentId: options.agentId,
      namespace,
      turns: [],
      startedAt: now,
      lastActivityAt: now,
      contextMemoryIds: initialContext.map((r) => r.memory.id.id),
    };

    this.sessions.set(sessionId, session);

    // Store session start as working memory
    await this.memoryService.createMemory({
      content: `Session started: ${sessionId}`,
      memoryType: MemoryType.WORKING,
      namespace,
      tags: ['session', 'start'],
      source: {
        type: 'conversation',
        sessionId,
        agentId: options.agentId,
      },
      salience: 3,
      decayRate: 0.5, // Working memory decays fast
    });

    return { sessionId, initialContext };
  }

  async addTurn(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<Memory> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const now = new Date();
    const turn: SessionTurn = {
      role,
      content,
      timestamp: now,
      metadata,
    };

    // OPTIMIZATION: Enforce turn limits per session
    if (session.turns.length >= MAX_TURNS_PER_SESSION) {
      // Remove oldest 20% of turns to make room
      const toRemove = Math.ceil(MAX_TURNS_PER_SESSION * 0.2);
      session.turns = session.turns.slice(toRemove);
    }

    session.turns.push(turn);
    session.lastActivityAt = now;

    // Store as working memory
    const memory = await this.memoryService.createMemory({
      content: `[${role}]: ${content}`,
      memoryType: MemoryType.WORKING,
      namespace: session.namespace,
      tags: ['session', 'turn', role],
      source: {
        type: 'conversation',
        sessionId,
        agentId: session.agentId,
      },
      salience: role === 'user' ? 5 : 4, // User messages slightly more salient
      decayRate: 0.3,
    });

    return memory;
  }

  async getContext(
    sessionId: string,
    query: string,
    options: {
      limit?: number;
      includeSessionHistory?: boolean;
      historyLimit?: number;
    } = {}
  ): Promise<{
    relevantMemories: SearchResult[];
    sessionHistory: SessionTurn[];
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Update last activity
    session.lastActivityAt = new Date();

    const limit = options.limit || 10;
    const historyLimit = options.historyLimit || 10;
    const includeHistory = options.includeSessionHistory !== false;

    // Search for relevant long-term memories
    const searchResults = await this.memoryService.searchMemories({
      limit,
      memoryTypes: [MemoryType.SEMANTIC, MemoryType.EPISODIC],
      minSalience: 2,
    });

    const relevantMemories: SearchResult[] = searchResults.map((memory) => ({
      memory,
      score: memory.metadata.effectiveSalience / 10,
    }));

    // Get recent session history
    const sessionHistory = includeHistory
      ? session.turns.slice(-historyLimit)
      : [];

    return { relevantMemories, sessionHistory };
  }

  async endSession(
    sessionId: string,
    options: {
      summary?: string;
      extractMemories?: boolean;
      archiveNamespace?: string;
    } = {}
  ): Promise<{
    archived: boolean;
    extractedMemoryIds: string[];
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const archiveNamespace = options.archiveNamespace || 'archived_sessions';
    const extractedMemoryIds: string[] = [];

    // Archive session as episodic memory
    const sessionContent = session.turns
      .map((t) => `[${t.role}]: ${t.content}`)
      .join('\n');

    const sessionSummary =
      options.summary ||
      `Session ${sessionId} with ${session.turns.length} turns`;

    const archiveMemory = await this.memoryService.createMemory({
      content: sessionSummary,
      memoryType: MemoryType.EPISODIC,
      namespace: archiveNamespace,
      tags: ['session', 'archive'],
      source: {
        type: 'conversation',
        sessionId,
        agentId: session.agentId,
      },
      salience: 6,
      decayRate: 0.05, // Slow decay for archived sessions
    });

    extractedMemoryIds.push(archiveMemory.id.id);

    // Extract important memories if requested
    if (options.extractMemories !== false) {
      // Find user messages with potential factual content
      const importantTurns = session.turns.filter(
        (t) => t.role === 'user' && t.content.length > 50
      );

      for (const turn of importantTurns.slice(0, 5)) {
        // Max 5 extractions
        const extracted = await this.memoryService.createMemory({
          content: turn.content,
          memoryType: MemoryType.SEMANTIC,
          namespace: archiveNamespace,
          tags: ['extracted', 'from_session'],
          source: {
            type: 'extraction',
            sessionId,
            agentId: session.agentId,
          },
          salience: 5,
          decayRate: 0.1,
        });

        extractedMemoryIds.push(extracted.id.id);

        // Create relation to archive
        await this.memoryService.createRelation(
          extracted.id,
          archiveMemory.id,
          RelationType.PART_OF,
          0.8
        );
      }
    }

    // Clean up session
    this.sessions.delete(sessionId);

    return {
      archived: true,
      extractedMemoryIds,
    };
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  listActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }
}
