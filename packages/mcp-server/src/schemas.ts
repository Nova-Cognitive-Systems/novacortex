/**
 * MCP Tool Schemas - Zod definitions for all memory tools
 */

import { z } from 'zod';
import { MemoryType, RelationType } from '@memory-stack/core';

// Base schemas
export const MemoryTypeSchema = z.nativeEnum(MemoryType);
export const RelationTypeSchema = z.nativeEnum(RelationType);

export const EntitySchema = z.object({
  name: z.string(),
  type: z.enum(['person', 'organization', 'location', 'concept', 'event']),
  confidence: z.number().min(0).max(1).default(1),
});

export const SignalSchema = z.object({
  keyword: z.string(),
  weight: z.number().min(0).max(1).default(1),
});

export const SourceSchema = z.object({
  type: z.enum(['conversation', 'document', 'api', 'extraction']).optional(),
  sessionId: z.string().optional(),
  documentId: z.string().optional(),
  agentId: z.string().optional(),
});

// Tool input schemas
export const MemoryStoreSchema = z.object({
  content: z.string().describe('The content to store as a memory'),
  memoryType: MemoryTypeSchema.describe('Type of memory: episodic, semantic, procedural, or working'),
  namespace: z.string().default('default').describe('Namespace to organize memories'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  entities: z.array(EntitySchema).optional().describe('Entities mentioned in the memory'),
  signals: z.array(SignalSchema).optional().describe('Keywords with weights for retrieval'),
  source: SourceSchema.optional().describe('Source information'),
  confidence: z.number().min(0).max(1).default(1).describe('Confidence score'),
  salience: z.number().min(0).max(10).default(5).describe('Importance score (0-10)'),
  decayRate: z.number().min(0).max(1).default(0.1).describe('How fast memory importance decays'),
  embedding: z.array(z.number()).optional().describe('Pre-computed embedding vector'),
});

export const MemorySearchSchema = z.object({
  query: z.string().describe('Search query (text or semantic)'),
  namespace: z.string().optional().describe('Filter by namespace'),
  memoryTypes: z.array(MemoryTypeSchema).optional().describe('Filter by memory types'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  limit: z.number().min(1).max(100).default(10).describe('Max results to return'),
  minSalience: z.number().min(0).max(10).optional().describe('Minimum salience score'),
  embedding: z.array(z.number()).optional().describe('Query embedding for semantic search'),
  scoreThreshold: z.number().min(0).max(1).optional().describe('Minimum similarity score'),
});

export const MemoryRecallSchema = z.object({
  id: z.string().describe('Memory ID'),
  namespace: z.string().default('default').describe('Namespace of the memory'),
  includeRelations: z.boolean().default(false).describe('Include related memories'),
});

export const MemoryRelateSchema = z.object({
  fromId: z.string().describe('Source memory ID'),
  fromNamespace: z.string().default('default').describe('Source memory namespace'),
  toId: z.string().describe('Target memory ID'),
  toNamespace: z.string().default('default').describe('Target memory namespace'),
  relationType: RelationTypeSchema.describe('Type of relation'),
  strength: z.number().min(0).max(1).default(1).describe('Relation strength'),
  bidirectional: z.boolean().default(false).describe('Create reverse relation too'),
  metadata: z.record(z.unknown()).optional().describe('Additional relation metadata'),
});

export const MemoryForgetSchema = z.object({
  id: z.string().describe('Memory ID to delete'),
  namespace: z.string().default('default').describe('Namespace of the memory'),
});

export const MemoryExportSchema = z.object({
  namespace: z.string().describe('Namespace to export'),
});

// Session schemas
export const SessionStartSchema = z.object({
  sessionId: z.string().optional().describe('Custom session ID (auto-generated if not provided)'),
  agentId: z.string().optional().describe('Agent starting the session'),
  namespace: z.string().default('sessions').describe('Namespace for session memories'),
  contextQuery: z.string().optional().describe('Initial query to retrieve relevant context'),
  contextLimit: z.number().default(5).describe('Number of relevant memories to retrieve'),
});

export const SessionAddTurnSchema = z.object({
  sessionId: z.string().describe('Session ID'),
  role: z.enum(['user', 'assistant', 'system']).describe('Who said this'),
  content: z.string().describe('The message content'),
  metadata: z.record(z.unknown()).optional().describe('Additional turn metadata'),
});

export const SessionGetContextSchema = z.object({
  sessionId: z.string().describe('Session ID'),
  query: z.string().describe('Query to find relevant context'),
  limit: z.number().min(1).max(50).default(10).describe('Max memories to retrieve'),
  includeSessionHistory: z.boolean().default(true).describe('Include recent session turns'),
  historyLimit: z.number().default(10).describe('Max session turns to include'),
});

export const SessionEndSchema = z.object({
  sessionId: z.string().describe('Session ID to end'),
  summary: z.string().optional().describe('Summary of the session'),
  extractMemories: z.boolean().default(true).describe('Extract important memories from session'),
  archiveNamespace: z.string().default('archived_sessions').describe('Where to archive session data'),
});

export const MemoryStatusSchema = z.object({
  namespace: z.string().default('default').describe('Namespace to load context for'),
  topN: z.number().min(1).max(50).default(15).describe('Number of top-salience memories to include in L1 context'),
});

export const MemoryWakeupSchema = z.object({
  namespace: z.string().default('default').describe('Namespace to wake up for'),
  query: z.string().optional().describe('Optional topic query to pre-load relevant L2 context'),
});

// Type exports
export type MemoryStoreInput = z.infer<typeof MemoryStoreSchema>;
export type MemorySearchInput = z.infer<typeof MemorySearchSchema>;
export type MemoryRecallInput = z.infer<typeof MemoryRecallSchema>;
export type MemoryRelateInput = z.infer<typeof MemoryRelateSchema>;
export type MemoryForgetInput = z.infer<typeof MemoryForgetSchema>;
export type MemoryExportInput = z.infer<typeof MemoryExportSchema>;
export type SessionStartInput = z.infer<typeof SessionStartSchema>;
export type SessionAddTurnInput = z.infer<typeof SessionAddTurnSchema>;
export type SessionGetContextInput = z.infer<typeof SessionGetContextSchema>;
export type SessionEndInput = z.infer<typeof SessionEndSchema>;
export type MemoryStatusInput = z.infer<typeof MemoryStatusSchema>;
export type MemoryWakeupInput = z.infer<typeof MemoryWakeupSchema>;
