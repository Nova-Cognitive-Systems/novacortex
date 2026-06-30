#!/usr/bin/env npx tsx
/**
 * NovaCortex Memory Agent
 *
 * A subagent that connects to NovaCortex and uses it as persistent memory.
 * Supports: store, recall, search, relate, forget, and knowledge base access.
 *
 * Usage:
 *   npx tsx scripts/novacortex-agent.ts store "TypeScript uses structural typing"
 *   npx tsx scripts/novacortex-agent.ts recall <memory-id>
 *   npx tsx scripts/novacortex-agent.ts search --tag deployment
 *   npx tsx scripts/novacortex-agent.ts list
 *   npx tsx scripts/novacortex-agent.ts forget <memory-id>
 *   npx tsx scripts/novacortex-agent.ts relate <from-id> <to-id> related_to
 *   npx tsx scripts/novacortex-agent.ts knowledge list
 *   npx tsx scripts/novacortex-agent.ts knowledge search "query"
 *   npx tsx scripts/novacortex-agent.ts stats
 *   npx tsx scripts/novacortex-agent.ts demo
 *
 * Environment:
 *   NOVACORTEX_URL  - API base URL (default: http://localhost:8080)
 *   NOVACORTEX_KEY  - API key for agent auth
 */

const API_URL = process.env.NOVACORTEX_URL || 'http://localhost:8080';
const API_KEY = process.env.NOVACORTEX_KEY || '';

// ── API Client ──────────────────────────────────────────────────────────

interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

async function api<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
  };

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string>) },
  });

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data: data as T };
}

// ── Memory Types ────────────────────────────────────────────────────────

type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'working';
type RelationType =
  | 'causes' | 'caused_by' | 'related_to' | 'contradicts'
  | 'supports' | 'supersedes' | 'part_of' | 'references'
  | 'temporal_before' | 'temporal_after';

interface MemoryId { id: string; namespace: string }
interface Memory {
  id: MemoryId;
  content: string;
  memoryType: MemoryType;
  metadata: {
    salience: number;
    effectiveSalience: number;
    tags: string[];
    entities: { name: string; type: string; confidence: number }[];
    confidence: number;
  };
  relations: { id: string; relationType: string; toMemory: MemoryId; strength: number }[];
  version: number;
  createdAt: string;
}

// ── Agent Commands ──────────────────────────────────────────────────────

async function getAgentNamespace(): Promise<string> {
  if (!API_KEY) return 'default';
  const res = await api<{ primaryNamespace: string }>('/api-keys/validate/check');
  return res.ok ? res.data.primaryNamespace : 'default';
}

async function store(
  content: string,
  opts: { type?: MemoryType; tags?: string[]; salience?: number } = {}
): Promise<void> {
  const namespace = await getAgentNamespace();
  const res = await api<Memory>('/memories', {
    method: 'POST',
    body: JSON.stringify({
      content,
      memoryType: opts.type || 'semantic',
      namespace,
      tags: opts.tags || [],
      salience: opts.salience ?? 5,
    }),
  });

  if (!res.ok) {
    console.error('Failed to store memory:', res.data);
    process.exit(1);
  }

  const m = res.data;
  console.log(`Stored memory ${m.id.namespace}:${m.id.id}`);
  console.log(`  Type: ${m.memoryType} | Salience: ${m.metadata.salience} | Tags: ${m.metadata.tags.join(', ') || '-'}`);
}

async function recall(memoryId: string): Promise<void> {
  const namespace = await getAgentNamespace();
  const res = await api<Memory>(`/memories/${namespace}/${memoryId}?includeRelations=true`);

  if (!res.ok) {
    console.error(`Memory not found: ${namespace}:${memoryId}`);
    process.exit(1);
  }

  const m = res.data;
  console.log(`── Memory ${m.id.namespace}:${m.id.id} (v${m.version}) ──`);
  console.log(`Content: ${m.content}`);
  console.log(`Type: ${m.memoryType} | Salience: ${m.metadata.salience} | Confidence: ${m.metadata.confidence}`);
  if (m.metadata.tags.length > 0) console.log(`Tags: ${m.metadata.tags.join(', ')}`);
  if (m.metadata.entities.length > 0) {
    console.log(`Entities: ${m.metadata.entities.map(e => `${e.name} (${e.type})`).join(', ')}`);
  }
  if (m.relations.length > 0) {
    console.log(`Relations:`);
    for (const r of m.relations) {
      console.log(`  → ${r.relationType} → ${r.toMemory.namespace}:${r.toMemory.id} (strength: ${r.strength})`);
    }
  }
  console.log(`Created: ${m.createdAt}`);
}

async function search(opts: { tag?: string; type?: MemoryType; limit?: number } = {}): Promise<void> {
  const namespace = await getAgentNamespace();
  const params = new URLSearchParams({ namespace });
  if (opts.tag) params.append('tags', opts.tag);
  if (opts.type) params.append('memoryTypes', opts.type);
  if (opts.limit) params.set('limit', String(opts.limit));

  const res = await api<{ data: Memory[]; count: number }>(`/memories?${params}`);
  if (!res.ok) {
    console.error('Search failed:', res.data);
    process.exit(1);
  }

  console.log(`Found ${res.data.count} memories:`);
  for (const m of res.data.data) {
    const tags = m.metadata.tags.length > 0 ? ` [${m.metadata.tags.join(', ')}]` : '';
    console.log(`  ${m.id.id.slice(0, 12)}.. | ${m.memoryType.padEnd(10)} | S:${m.metadata.salience} | ${m.content.slice(0, 60)}${m.content.length > 60 ? '...' : ''}${tags}`);
  }
}

async function listMemories(limit = 20): Promise<void> {
  const namespace = await getAgentNamespace();
  const res = await api<{ data: Memory[]; count: number }>(`/memories?namespace=${namespace}&limit=${limit}`);
  if (!res.ok) {
    console.error('List failed:', res.data);
    process.exit(1);
  }

  console.log(`Agent namespace: ${namespace} | ${res.data.count} memories`);
  console.log('─'.repeat(80));
  for (const m of res.data.data) {
    const tags = m.metadata.tags.length > 0 ? ` [${m.metadata.tags.join(', ')}]` : '';
    console.log(`${m.id.id} | ${m.memoryType.padEnd(10)} | S:${m.metadata.salience} | ${m.content.slice(0, 50)}...${tags}`);
  }
}

async function forget(memoryId: string): Promise<void> {
  const namespace = await getAgentNamespace();
  const res = await api(`/memories/${namespace}/${memoryId}`, { method: 'DELETE' });
  if (res.status === 204) {
    console.log(`Forgot memory ${namespace}:${memoryId}`);
  } else {
    console.error(`Failed to forget: ${JSON.stringify(res.data)}`);
  }
}

async function relate(fromId: string, toId: string, type: RelationType, strength = 0.8): Promise<void> {
  const namespace = await getAgentNamespace();
  const res = await api('/memories/relations', {
    method: 'POST',
    body: JSON.stringify({
      fromMemoryId: fromId,
      fromNamespace: namespace,
      toMemoryId: toId,
      toNamespace: namespace,
      relationType: type,
      strength,
      bidirectional: true,
    }),
  });

  if (!res.ok) {
    console.error('Relate failed:', res.data);
    process.exit(1);
  }
  console.log(`Created relation: ${fromId} → ${type} → ${toId} (strength: ${strength})`);
}

async function knowledgeList(): Promise<void> {
  const res = await api<{ documents: { id: string; filename: string; namespace: string; size: number; chunks: number }[] }>('/agent/knowledge');
  if (!res.ok) {
    console.error('Knowledge list failed:', res.data);
    process.exit(1);
  }
  console.log(`Knowledge Base: ${res.data.documents.length} documents`);
  for (const doc of res.data.documents) {
    console.log(`  ${doc.id} | ${doc.filename} | ${doc.namespace} | ${(doc.size / 1024).toFixed(1)}KB | ${doc.chunks} chunks`);
  }
}

async function knowledgeSearch(query: string): Promise<void> {
  const res = await api<{ results: { documentId: string; filename: string; matches: { preview: string }[] }[]; totalMatches: number }>(
    `/agent/knowledge/search?q=${encodeURIComponent(query)}`
  );
  if (!res.ok) {
    console.error('Knowledge search failed:', res.data);
    process.exit(1);
  }
  console.log(`Knowledge search "${query}": ${res.data.totalMatches} matches`);
  for (const r of res.data.results) {
    console.log(`  ${r.filename}:`);
    for (const m of r.matches) {
      console.log(`    ${m.preview}`);
    }
  }
}

async function stats(): Promise<void> {
  const [healthRes, statsRes] = await Promise.all([
    api<{ status: string; stats: { totalMemories: number; totalVectors: number } }>('/health'),
    api<{ total: number; byNamespace: Record<string, number>; byType: Record<string, number> }>('/stats'),
  ]);

  if (!healthRes.ok || !statsRes.ok) {
    console.error('Failed to get stats');
    process.exit(1);
  }

  const namespace = await getAgentNamespace();
  console.log(`NovaCortex Status: ${healthRes.data.status}`);
  console.log(`Agent Namespace: ${namespace}`);
  console.log(`Total Memories: ${statsRes.data.total}`);
  console.log(`Total Vectors: ${healthRes.data.stats.totalVectors}`);
  console.log(`By Type:`);
  for (const [type, count] of Object.entries(statsRes.data.byType)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log(`By Namespace:`);
  for (const [ns, count] of Object.entries(statsRes.data.byNamespace)) {
    console.log(`  ${ns}: ${count}${ns === namespace ? ' ← (agent)' : ''}`);
  }
}

async function demo(): Promise<void> {
  console.log('═══ NovaCortex Memory Agent Demo ═══\n');

  // 1. Store memories
  console.log('1. Storing memories...');
  const namespace = await getAgentNamespace();

  const mem1 = await api<Memory>('/memories', {
    method: 'POST',
    body: JSON.stringify({
      content: 'NovaCortex uses SurrealDB for graph storage and Qdrant for vector search',
      memoryType: 'semantic', namespace, tags: ['architecture', 'databases'], salience: 8,
      entities: [
        { name: 'SurrealDB', type: 'concept', confidence: 0.95 },
        { name: 'Qdrant', type: 'concept', confidence: 0.95 },
      ],
    }),
  });

  const mem2 = await api<Memory>('/memories', {
    method: 'POST',
    body: JSON.stringify({
      content: 'Memory types: episodic (events), semantic (facts), procedural (how-to), working (temp)',
      memoryType: 'procedural', namespace, tags: ['architecture', 'memory-types'], salience: 9,
    }),
  });

  const mem3 = await api<Memory>('/memories', {
    method: 'POST',
    body: JSON.stringify({
      content: 'Successfully deployed NovaCortex locally with all services healthy',
      memoryType: 'episodic', namespace, tags: ['deployment', 'milestone'], salience: 7,
    }),
  });

  console.log(`  Stored: ${mem1.data.id.id} (semantic)`);
  console.log(`  Stored: ${mem2.data.id.id} (procedural)`);
  console.log(`  Stored: ${mem3.data.id.id} (episodic)\n`);

  // 2. Create relations
  console.log('2. Creating relations...');
  await api('/memories/relations', {
    method: 'POST',
    body: JSON.stringify({
      fromMemoryId: mem1.data.id.id, fromNamespace: namespace,
      toMemoryId: mem2.data.id.id, toNamespace: namespace,
      relationType: 'related_to', strength: 0.85, bidirectional: true,
    }),
  });
  await api('/memories/relations', {
    method: 'POST',
    body: JSON.stringify({
      fromMemoryId: mem3.data.id.id, fromNamespace: namespace,
      toMemoryId: mem1.data.id.id, toNamespace: namespace,
      relationType: 'references', strength: 0.7,
    }),
  });
  console.log('  Created: architecture ↔ memory-types (related_to, 0.85)');
  console.log('  Created: deployment → architecture (references, 0.7)\n');

  // 3. Recall with relations
  console.log('3. Recalling memory with relations...');
  const recalled = await api<Memory>(`/memories/${namespace}/${mem1.data.id.id}?includeRelations=true`);
  console.log(`  Content: ${recalled.data.content}`);
  console.log(`  Relations: ${recalled.data.relations.length}`);
  for (const r of recalled.data.relations) {
    console.log(`    → ${r.relationType} → ${r.toMemory.id.slice(0, 12)}...\n`);
  }

  // 4. Search
  console.log('4. Searching by tag...');
  const searchRes = await api<{ data: Memory[]; count: number }>(`/memories?namespace=${namespace}&tags=architecture`);
  console.log(`  Found ${searchRes.data.count} memories tagged "architecture":`);
  for (const m of searchRes.data.data) {
    console.log(`    ${m.memoryType}: ${m.content.slice(0, 60)}...`);
  }
  console.log();

  // 5. Stats
  console.log('5. Agent stats:');
  const agentStats = await api<{ total: number; byNamespace: Record<string, number> }>('/stats');
  console.log(`  Total memories: ${agentStats.data.total}`);
  console.log(`  In agent namespace "${namespace}": ${agentStats.data.byNamespace[namespace] || 0}`);

  console.log('\n═══ Demo Complete ═══');
}

// ── CLI Router ──────────────────────────────────────────────────────────

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === 'help') {
    console.log(`NovaCortex Memory Agent

Commands:
  store <content> [--type semantic|episodic|procedural|working] [--tags t1,t2] [--salience 5]
  recall <memory-id>
  search [--tag name] [--type type] [--limit 20]
  list [limit]
  forget <memory-id>
  relate <from-id> <to-id> <relation-type> [strength]
  knowledge list
  knowledge search <query>
  stats
  demo

Environment:
  NOVACORTEX_URL  API URL (default: http://localhost:8080)
  NOVACORTEX_KEY  API key for agent auth`);
    return;
  }

  // Parse flags
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith('--')) {
      flags[args[i]!.slice(2)] = args[i + 1] || '';
      i++;
    } else {
      positional.push(args[i]!);
    }
  }

  switch (command) {
    case 'store':
      await store(positional.join(' '), {
        type: flags.type as MemoryType,
        tags: flags.tags?.split(','),
        salience: flags.salience ? parseFloat(flags.salience) : undefined,
      });
      break;
    case 'recall':
      await recall(positional[0]!);
      break;
    case 'search':
      await search({ tag: flags.tag, type: flags.type as MemoryType, limit: flags.limit ? parseInt(flags.limit) : undefined });
      break;
    case 'list':
      await listMemories(positional[0] ? parseInt(positional[0]) : 20);
      break;
    case 'forget':
      await forget(positional[0]!);
      break;
    case 'relate':
      await relate(positional[0]!, positional[1]!, positional[2] as RelationType, positional[3] ? parseFloat(positional[3]) : 0.8);
      break;
    case 'knowledge':
      if (positional[0] === 'list') await knowledgeList();
      else if (positional[0] === 'search') await knowledgeSearch(positional.slice(1).join(' '));
      else console.error('Usage: knowledge list | knowledge search <query>');
      break;
    case 'stats':
      await stats();
      break;
    case 'demo':
      await demo();
      break;
    default:
      console.error(`Unknown command: ${command}. Run with 'help' for usage.`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error('Agent error:', e.message);
  process.exit(1);
});
