import type { CreateMemoryInput } from '@memory-stack/core';
import { MemoryType } from '@memory-stack/core';

export type ChatFormat = 'claude-ai' | 'claude-code-jsonl' | 'chatgpt' | 'auto';

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  memories: CreateMemoryInput[];
}

interface ClaudeAIConversation {
  uuid: string;
  name?: string;
  created_at: string;
  updated_at: string;
  chat_messages: Array<{
    uuid: string;
    sender: 'human' | 'assistant';
    text: string;
    created_at: string;
    attachments?: Array<{ file_name: string; extracted_content: string }>;
  }>;
}

interface ChatGPTConversation {
  id: string;
  title: string;
  create_time: number;
  update_time: number;
  mapping: Record<string, {
    id: string;
    message?: {
      id: string;
      author: { role: 'user' | 'assistant' | 'system' | 'tool' };
      content: { content_type: string; parts: Array<string | null> };
      create_time: number | null;
    };
    parent: string | null;
    children: string[];
  }>;
}

interface ClaudeCodeJSONL {
  type?: string;
  role?: string;
  message?: { role: string; content: string | Array<{ type: string; text?: string }> };
  content?: string | Array<{ type: string; text?: string }>;
  timestamp?: string;
}

function detectFormat(data: unknown): ChatFormat {
  if (Array.isArray(data)) {
    const first = data[0];
    if (first && typeof first === 'object') {
      if ('chat_messages' in first) return 'claude-ai';
      if ('mapping' in first) return 'chatgpt';
    }
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if ('mapping' in (data as object)) return 'chatgpt';
  }
  return 'auto';
}

function extractText(content: string | Array<{ type: string; text?: string }> | null | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter(c => c.type === 'text' && c.text)
    .map(c => c.text!)
    .join('\n');
}

export function importClaudeAI(
  conversations: ClaudeAIConversation[],
  namespace: string = 'imported'
): ImportResult {
  const memories: CreateMemoryInput[] = [];
  let skipped = 0;
  const errors: string[] = [];

  for (const conv of conversations) {
    try {
      for (const msg of conv.chat_messages) {
        if (!msg.text?.trim() && !msg.attachments?.length) {
          skipped++;
          continue;
        }

        let content = msg.text?.trim() || '';

        // Include attachment content
        if (msg.attachments?.length) {
          const attachmentText = msg.attachments
            .filter(a => a.extracted_content)
            .map(a => `[${a.file_name}]: ${a.extracted_content.slice(0, 500)}`)
            .join('\n');
          if (attachmentText) content = content ? `${content}\n${attachmentText}` : attachmentText;
        }

        if (!content || content.length < 10) {
          skipped++;
          continue;
        }

        memories.push({
          content: content.slice(0, 2000),
          memoryType: MemoryType.EPISODIC,
          namespace,
          tags: ['imported', 'claude-ai', msg.sender],
          source: {
            type: 'conversation',
            sessionId: conv.uuid,
            timestamp: new Date(msg.created_at),
          },
          salience: msg.sender === 'assistant' ? 4 : 3,
          confidence: 0.9,
        });
      }
    } catch (err) {
      errors.push(`Conversation ${conv.uuid}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { imported: memories.length, skipped, errors, memories };
}

export function importChatGPT(
  data: ChatGPTConversation | ChatGPTConversation[],
  namespace: string = 'imported'
): ImportResult {
  const conversations = Array.isArray(data) ? data : [data];
  const memories: CreateMemoryInput[] = [];
  let skipped = 0;
  const errors: string[] = [];

  for (const conv of conversations) {
    try {
      // Traverse mapping to get ordered messages
      const nodes = Object.values(conv.mapping);
      const messages = nodes
        .filter(n => n.message?.content?.parts)
        .sort((a, b) => (a.message?.create_time ?? 0) - (b.message?.create_time ?? 0));

      for (const node of messages) {
        const msg = node.message!;
        if (!['user', 'assistant'].includes(msg.author.role)) continue;

        const parts = msg.content.parts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
        const content = parts.join('\n').trim();

        if (!content || content.length < 10) {
          skipped++;
          continue;
        }

        memories.push({
          content: content.slice(0, 2000),
          memoryType: MemoryType.EPISODIC,
          namespace,
          tags: ['imported', 'chatgpt', msg.author.role],
          source: {
            type: 'conversation',
            sessionId: conv.id,
            timestamp: msg.create_time ? new Date(msg.create_time * 1000) : new Date(),
          },
          salience: msg.author.role === 'assistant' ? 4 : 3,
          confidence: 0.9,
        });
      }
    } catch (err) {
      errors.push(`Conversation ${conv.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { imported: memories.length, skipped, errors, memories };
}

export function importClaudeCodeJSONL(
  lines: string[],
  namespace: string = 'imported'
): ImportResult {
  const memories: CreateMemoryInput[] = [];
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (!line) continue;

    try {
      const entry: ClaudeCodeJSONL = JSON.parse(line);

      // Extract message content
      let role: string | undefined;
      let content: string = '';

      if (entry.message) {
        role = entry.message.role;
        content = extractText(entry.message.content);
      } else if (entry.role && entry.content) {
        role = entry.role;
        content = extractText(entry.content);
      }

      if (!role || !['user', 'assistant'].includes(role) || !content || content.length < 10) {
        skipped++;
        continue;
      }

      // Skip context restore markers
      if (content.includes('previous messages') && content.length < 100) {
        skipped++;
        continue;
      }

      const resolvedRole = role as string;
      memories.push({
        content: content.slice(0, 2000),
        memoryType: MemoryType.EPISODIC,
        namespace,
        tags: ['imported', 'claude-code', resolvedRole],
        source: {
          type: 'conversation',
          timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
        },
        salience: resolvedRole === 'assistant' ? 4 : 3,
        confidence: 0.9,
      });
    } catch {
      skipped++; // Silent skip for malformed lines
    }
  }

  return { imported: memories.length, skipped, errors, memories };
}

export function importChat(
  rawData: string,
  format: ChatFormat = 'auto',
  namespace: string = 'imported'
): ImportResult {
  let parsed: unknown;

  try {
    // Try JSON first
    parsed = JSON.parse(rawData);
  } catch {
    // Try JSONL
    const lines = rawData.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      try {
        JSON.parse(lines[0] ?? ''); // Validate first line is JSON
        return importClaudeCodeJSONL(lines, namespace);
      } catch {
        return { imported: 0, skipped: 0, errors: ['Unable to parse input as JSON or JSONL'], memories: [] };
      }
    }
    return { imported: 0, skipped: 0, errors: ['Empty input'], memories: [] };
  }

  // Detect format if auto
  const detectedFormat = format === 'auto' ? detectFormat(parsed) : format;

  switch (detectedFormat) {
    case 'claude-ai':
      return importClaudeAI(parsed as ClaudeAIConversation[], namespace);
    case 'chatgpt':
      return importChatGPT(parsed as ChatGPTConversation | ChatGPTConversation[], namespace);
    default: {
      // Try as JSONL lines
      const lines = rawData.split('\n').filter(l => l.trim());
      return importClaudeCodeJSONL(lines, namespace);
    }
  }
}
