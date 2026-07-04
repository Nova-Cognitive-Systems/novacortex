/**
 * Migration converters: competitor export formats → NovaCortex create-memory
 * inputs. Pure functions (no I/O) so they are unit-testable; the `migrate`
 * CLI commands wrap them.
 *
 * Formats verified against the 2026 sources:
 * - mem0 OSS: Memory.get_all() → {results: [{id, memory, hash, metadata?,
 *   created_at, updated_at, user_id?, agent_id?, run_id?, ...}]}
 *   (user/agent/run ids are FLAT top-level fields; "categories" is
 *   platform-only and intentionally not relied upon).
 * - claude-mem v13: SQLite `memory_items` rows exported via
 *   `sqlite3 -json ~/.claude-mem/claude-mem.db "SELECT * FROM memory_items"`
 *   (facts/concepts/files_* are JSON-in-TEXT; timestamps are epoch ms), or
 *   the official query-scoped export JSON {observations[], summaries[], ...}.
 * - Graphiti: RELATES_TO entity-edge rows dumped per group_id via Cypher —
 *   {uuid, name, fact, source_name, target_name, valid_at, invalid_at,
 *   expired_at, created_at, group_id}. `fact` is the memory unit; bi-temporal
 *   markers are preserved as NovaCortex invalidatedAt.
 */

export interface MigratedMemory {
  content: string;
  memoryType: 'semantic' | 'episodic' | 'procedural' | 'working';
  tags: string[];
  salience: number;
  /** Set when the source marks this fact as superseded/expired (Graphiti). */
  invalidatedAt?: string;
}

const clean = (tag: string): string => tag.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 60);

// ── mem0 ──────────────────────────────────────────────────────────────────────

interface Mem0Item {
  id?: string;
  memory?: string;
  metadata?: Record<string, unknown>;
  user_id?: string;
  agent_id?: string;
  run_id?: string;
  [key: string]: unknown;
}

export function convertMem0(data: unknown): MigratedMemory[] {
  const items: Mem0Item[] = Array.isArray(data)
    ? (data as Mem0Item[])
    : Array.isArray((data as { results?: unknown }).results)
      ? ((data as { results: Mem0Item[] }).results)
      : [];
  const out: MigratedMemory[] = [];
  for (const item of items) {
    const content = typeof item.memory === 'string' ? item.memory.trim() : '';
    if (!content) continue;
    const tags = ['migrated:mem0'];
    if (typeof item.user_id === 'string' && item.user_id) tags.push(`user:${clean(item.user_id)}`);
    if (typeof item.agent_id === 'string' && item.agent_id) tags.push(`agent:${clean(item.agent_id)}`);
    if (typeof item.run_id === 'string' && item.run_id) tags.push(`run:${clean(item.run_id)}`);
    out.push({ content, memoryType: 'semantic', tags, salience: 5 });
  }
  return out;
}

// ── claude-mem ────────────────────────────────────────────────────────────────

interface ClaudeMemItem {
  kind?: string;
  type?: string;
  title?: string;
  subtitle?: string;
  text?: string;
  narrative?: string;
  facts?: string | string[];
  concepts?: string | string[];
  project_id?: string;
  project?: string;
  [key: string]: unknown;
}

function parseJsonArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function convertClaudeMemItem(item: ClaudeMemItem): MigratedMemory | null {
  const parts = [item.title, item.subtitle, item.narrative ?? item.text].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0
  );
  const facts = parseJsonArray(item.facts);
  if (facts.length > 0) parts.push(facts.map((f) => `- ${f}`).join('\n'));
  const content = parts.join('\n').trim();
  if (!content) return null;

  const tags = ['migrated:claude-mem', ...parseJsonArray(item.concepts).map(clean)];
  const project = item.project_id ?? item.project;
  if (typeof project === 'string' && project) tags.push(`project:${clean(project)}`);
  if (typeof item.type === 'string' && item.type) tags.push(clean(item.type));

  return {
    content,
    memoryType: item.kind === 'summary' ? 'episodic' : 'semantic',
    tags: [...new Set(tags)],
    salience: 6,
  };
}

export function convertClaudeMem(data: unknown): MigratedMemory[] {
  // Shape 1: raw `sqlite3 -json` dump of memory_items (array of rows).
  if (Array.isArray(data)) {
    return (data as ClaudeMemItem[]).map(convertClaudeMemItem).filter((m): m is MigratedMemory => !!m);
  }
  // Shape 2: official export-memories.ts JSON (query-scoped).
  const doc = data as { observations?: ClaudeMemItem[]; summaries?: ClaudeMemItem[]; prompts?: ClaudeMemItem[] };
  const rows = [
    ...(doc.observations ?? []),
    ...(doc.summaries ?? []).map((s) => ({ ...s, kind: 'summary' })),
  ];
  return rows.map(convertClaudeMemItem).filter((m): m is MigratedMemory => !!m);
}

// ── Graphiti ─────────────────────────────────────────────────────────────────

interface GraphitiFact {
  uuid?: string;
  name?: string;
  fact?: string;
  source_name?: string;
  target_name?: string;
  valid_at?: string | null;
  invalid_at?: string | null;
  expired_at?: string | null;
  group_id?: string;
  [key: string]: unknown;
}

export function convertGraphiti(data: unknown): MigratedMemory[] {
  const rows: GraphitiFact[] = Array.isArray(data)
    ? (data as GraphitiFact[])
    : Array.isArray((data as { facts?: unknown }).facts)
      ? ((data as { facts: GraphitiFact[] }).facts)
      : [];
  const out: MigratedMemory[] = [];
  for (const row of rows) {
    const content = typeof row.fact === 'string' ? row.fact.trim() : '';
    if (!content) continue;
    const tags = ['migrated:graphiti'];
    if (typeof row.name === 'string' && row.name) tags.push(clean(row.name));
    if (typeof row.group_id === 'string' && row.group_id) tags.push(`group:${clean(row.group_id)}`);
    for (const entity of [row.source_name, row.target_name]) {
      if (typeof entity === 'string' && entity) tags.push(`entity:${clean(entity)}`);
    }
    const invalidated = row.invalid_at ?? row.expired_at ?? undefined;
    out.push({
      content,
      memoryType: 'semantic',
      tags: [...new Set(tags)],
      salience: 5,
      ...(invalidated ? { invalidatedAt: invalidated } : {}),
    });
  }
  return out;
}
