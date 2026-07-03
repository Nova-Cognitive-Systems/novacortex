/**
 * IntelligenceService — the LLM-driven memory intelligence layer.
 *
 * Two capabilities, both designed small-model-first (strict JSON, one decision
 * per call, few-shot with negative examples) so they work on local Ollama
 * models as well as frontier APIs:
 *
 * 1. EXTRACTION: distill conversation turns into discrete, self-contained
 *    facts (populating memoryType / tags / entities / salience — the schema
 *    fields that previously existed but were never filled).
 *
 * 2. RESOLUTION: compare a new memory against its nearest existing neighbors
 *    and record the relationship as TYPED EDGES. Append-only by contract:
 *    resolution NEVER deletes or rewrites a memory — a superseded fact gets a
 *    `supersedes` edge pointing at it plus an `invalidatedAt` stamp, and stays
 *    queryable as history ("provable memory").
 *
 * The whole layer degrades gracefully: without a configured LLM every method
 * is a no-op returning empty results, and the substrate behaves as before.
 */
import type { MemoryService } from './memory-service.js';
import type { LLMService } from './llm-service.js';
import {
  MemoryType,
  RelationType,
  type Entity,
  type ExtractedFact,
  type IngestMessage,
  type Memory,
  type MemoryId,
  type ResolutionDecision,
  type ResolutionOutcome,
} from '../types/memory.js';

export interface IngestOptions {
  namespace: string;
  sessionId?: string;
  agentId?: string;
  /** Resolve each stored fact against its neighbors (default true). */
  resolve?: boolean;
}

export interface IngestResult {
  facts: ExtractedFact[];
  created: Memory[];
  /** Facts skipped because an identical memory (content hash) already existed. */
  duplicates: number;
  resolutions: ResolutionOutcome[];
}

export interface ResolveOptions {
  /** Max neighbor candidates to judge (default 5). */
  maxCandidates?: number;
  /** Min cosine similarity for a neighbor to be considered (default 0.55). */
  minSimilarity?: number;
}

/** Conversation chunk size per extraction call (chars) — keeps prompts within
 * small-model context windows and JSON outputs short enough to stay valid. */
const EXTRACTION_CHUNK_CHARS = 6000;
/** Per-message cap so one giant paste can't blow past the chunk budget. */
const MESSAGE_CAP_CHARS = 2000;

const VALID_MEMORY_TYPES = new Set(Object.values(MemoryType));
const VALID_ENTITY_TYPES = new Set(['person', 'organization', 'location', 'concept', 'event']);
const VALID_DECISIONS = new Set<ResolutionDecision>([
  'supersedes',
  'contradicts',
  'duplicates',
  'related',
  'none',
]);

const EXTRACTION_SYSTEM_PROMPT = `You extract long-term memories from a conversation for an AI agent's memory store.

Return ONLY a JSON object: {"facts": [...]}. Each fact:
{
  "content": "one self-contained statement, understandable without the conversation",
  "memoryType": "semantic" | "episodic" | "procedural",
  "tags": ["lowercase-topic-tags"],
  "entities": [{"name": "...", "type": "person|organization|location|concept|event"}],
  "salience": 1-10,
  "confidence": 0.0-1.0
}

Rules:
- Extract stable facts, preferences, decisions, constraints, and how-to knowledge. Resolve pronouns ("I" -> the user, or the speaker's name when given).
- semantic = facts/preferences ("The user prefers dark mode"). episodic = dated events ("On 2026-07-01 the deploy failed"). procedural = how-to/workflow knowledge.
- Include concrete values (names, dates, versions, numbers) in the content.
- salience: 8-10 lasting identity/decisions, 5-7 useful context, 1-4 minor detail.
- Do NOT extract: small talk, questions without answers, speculation, transient state ("compiling right now"), or anything the speaker asked to forget.
- No duplicates within your output. If nothing is worth remembering, return {"facts": []}.

Example input: "user: btw I switched us from Postgres to SurrealDB last week, the ORM was too slow"
Example output: {"facts": [{"content": "The user's project switched from Postgres to SurrealDB (week of the conversation) because the ORM was too slow", "memoryType": "semantic", "tags": ["database", "architecture"], "entities": [{"name": "SurrealDB", "type": "concept"}, {"name": "Postgres", "type": "concept"}], "salience": 8, "confidence": 0.95}]}

Example input: "user: what time is it?  assistant: it's 3pm."
Example output: {"facts": []}`;

const RESOLUTION_SYSTEM_PROMPT = `You compare a NEW memory against one EXISTING memory from an AI agent's store and classify their relationship.

Return ONLY a JSON object: {"decision": "...", "reason": "one short sentence"}.

Decisions (pick exactly one):
- "supersedes": the NEW memory is the current version of the same fact — the EXISTING one is outdated ("prefers tabs" -> "prefers spaces now").
- "contradicts": they conflict but you cannot tell which is current (no temporal cue).
- "duplicates": same fact, merely reworded.
- "related": same topic, but different facts that can both be true.
- "none": unrelated.

Rules:
- Judge ONLY the two statements given. Do not invent context.
- "supersedes" requires the SAME underlying fact/preference changing value, with the NEW one being newer or explicitly marked as a change. Different aspects of a topic are "related", not "supersedes".
- When unsure between "contradicts" and "supersedes", choose "contradicts".
- When unsure at all, choose "none".

Example: NEW "The user's favorite editor is Neovim (switched from VS Code)" vs EXISTING "The user's favorite editor is VS Code" -> {"decision": "supersedes", "reason": "Same preference; the new memory explicitly marks the switch."}
Example: NEW "The API rate limit is 100 req/min" vs EXISTING "The API rate limit is 1000 req/min" -> {"decision": "contradicts", "reason": "Same fact with conflicting values and no cue which is current."}
Example: NEW "The user lives in Berlin" vs EXISTING "The user works at a bank" -> {"decision": "none", "reason": "Unrelated facts."}`;

function isFactArray(parsed: unknown): parsed is { facts: unknown[] } {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    Array.isArray((parsed as { facts?: unknown }).facts)
  );
}

function isDecision(parsed: unknown): parsed is { decision: string; reason?: string } {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    typeof (parsed as { decision?: unknown }).decision === 'string'
  );
}

export class IntelligenceService {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly llm: LLMService
  ) {}

  /** True when an LLM is configured and the intelligence layer is active. */
  isEnabled(): boolean {
    return this.llm.isEnabled();
  }

  getModel(): string | undefined {
    return this.llm.getModel();
  }

  // -------------------------------------------------------------------------
  // Extraction
  // -------------------------------------------------------------------------

  /**
   * Distill conversation messages into discrete facts. Long conversations are
   * chunked; each chunk is one LLM call. Returns [] when the LLM is disabled
   * or extraction fails — never throws for LLM-side problems.
   */
  async extractFacts(messages: IngestMessage[]): Promise<ExtractedFact[]> {
    if (!this.llm.isEnabled() || messages.length === 0) return [];

    const rendered = messages
      .filter((m) => m.content && m.content.trim().length > 0)
      .map((m) => {
        const speaker = m.name ? `${m.role}(${m.name})` : m.role;
        const ts = m.timestamp ? ` [${m.timestamp}]` : '';
        return `${speaker}${ts}: ${m.content.slice(0, MESSAGE_CAP_CHARS)}`;
      });

    // Chunk by character budget, never splitting a single message.
    const chunks: string[][] = [];
    let current: string[] = [];
    let size = 0;
    for (const line of rendered) {
      if (size + line.length > EXTRACTION_CHUNK_CHARS && current.length > 0) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push(line);
      size += line.length;
    }
    if (current.length > 0) chunks.push(current);

    const all: ExtractedFact[] = [];
    const seen = new Set<string>();
    for (const chunk of chunks) {
      const parsed = await this.llm.completeJSON<{ facts: unknown[] }>(
        EXTRACTION_SYSTEM_PROMPT,
        `Conversation:\n${chunk.join('\n')}`,
        isFactArray
      );
      if (!parsed) continue;
      for (const raw of parsed.facts) {
        const fact = this.sanitizeFact(raw);
        if (!fact) continue;
        const key = fact.content.toLowerCase().trim();
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(fact);
      }
    }
    return all;
  }

  /** Validate and clamp one LLM-emitted fact; null when unusable. */
  private sanitizeFact(raw: unknown): ExtractedFact | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const f = raw as Record<string, unknown>;
    const content = typeof f['content'] === 'string' ? f['content'].trim() : '';
    if (content.length < 8 || content.length > 2000) return null;

    const memoryType =
      typeof f['memoryType'] === 'string' && VALID_MEMORY_TYPES.has(f['memoryType'] as MemoryType)
        ? (f['memoryType'] as MemoryType)
        : MemoryType.SEMANTIC;

    const tags = Array.isArray(f['tags'])
      ? (f['tags'] as unknown[])
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim().toLowerCase())
          .slice(0, 10)
      : [];

    const entities: Entity[] = Array.isArray(f['entities'])
      ? (f['entities'] as unknown[])
          .map((e): Entity | null => {
            if (typeof e !== 'object' || e === null) return null;
            const ent = e as Record<string, unknown>;
            const name = typeof ent['name'] === 'string' ? ent['name'].trim() : '';
            const type = typeof ent['type'] === 'string' ? ent['type'] : '';
            if (!name || !VALID_ENTITY_TYPES.has(type)) return null;
            return {
              name,
              type: type as Entity['type'],
              confidence: typeof ent['confidence'] === 'number' ? Math.max(0, Math.min(1, ent['confidence'])) : 0.9,
            };
          })
          .filter((e): e is Entity => e !== null)
          .slice(0, 10)
      : [];

    const salienceRaw = typeof f['salience'] === 'number' ? f['salience'] : 5;
    const salience = Math.max(1, Math.min(10, Math.round(salienceRaw)));
    const confidenceRaw = typeof f['confidence'] === 'number' ? f['confidence'] : 0.8;
    const confidence = Math.max(0, Math.min(1, confidenceRaw));

    return { content, memoryType, tags, entities, salience, confidence };
  }

  // -------------------------------------------------------------------------
  // Ingestion (extract -> store -> embed -> resolve)
  // -------------------------------------------------------------------------

  /**
   * Full pipeline: extract facts from messages, store each as a memory
   * (exact-duplicate creation is absorbed by the content-hash upsert), embed
   * them so they are immediately searchable, then resolve each new memory
   * against its neighbors.
   */
  async ingest(messages: IngestMessage[], opts: IngestOptions): Promise<IngestResult> {
    const facts = await this.extractFacts(messages);
    if (facts.length === 0) {
      return { facts: [], created: [], duplicates: 0, resolutions: [] };
    }

    const embedder = this.memoryService.getEmbeddingService();
    const vectors = embedder.isEnabled()
      ? await embedder.embedBatch(facts.map((f) => f.content))
      : facts.map(() => null);

    const created: Memory[] = [];
    let duplicates = 0;
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i]!;
      // createMemory silently returns the existing row on a content-hash match,
      // so check first to report duplicates honestly (and skip re-resolving them).
      const existing = await this.memoryService.findByContent(fact.content, opts.namespace);
      if (existing) {
        duplicates++;
        continue;
      }
      const memory = await this.memoryService.createMemory({
        content: fact.content,
        memoryType: fact.memoryType,
        namespace: opts.namespace,
        tags: fact.tags,
        entities: fact.entities,
        confidence: fact.confidence,
        salience: fact.salience,
        source: {
          type: 'extraction',
          ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
          ...(opts.agentId ? { agentId: opts.agentId } : {}),
          timestamp: new Date(),
        },
        ...(vectors[i] ? { embedding: vectors[i]! } : {}),
      });
      created.push(memory);
    }

    const resolutions: ResolutionOutcome[] = [];
    if (opts.resolve !== false) {
      for (const memory of created) {
        const outcomes = await this.resolveMemory(memory.id);
        resolutions.push(...outcomes);
      }
    }

    return { facts, created, duplicates, resolutions };
  }

  // -------------------------------------------------------------------------
  // Resolution
  // -------------------------------------------------------------------------

  /**
   * Judge a memory against its nearest neighbors and write typed edges.
   * Append-only: a "supersedes" outcome stamps the LOSING memory's
   * invalidatedAt and links the pair — nothing is deleted or rewritten.
   */
  async resolveMemory(id: MemoryId, opts: ResolveOptions = {}): Promise<ResolutionOutcome[]> {
    if (!this.llm.isEnabled()) return [];

    const memory = await this.memoryService.getMemory(id);
    if (!memory) return [];

    const maxCandidates = opts.maxCandidates ?? 5;
    const minSimilarity = opts.minSimilarity ?? 0.55;

    let similar;
    try {
      similar = await this.memoryService.findSimilar(id, maxCandidates + 1, id.namespace);
    } catch {
      return []; // no embedding stored yet — nothing to resolve against
    }

    const existingRelations = await this.memoryService.getRelations(id);
    const alreadyLinked = new Set(
      existingRelations.flatMap((r) => [
        `${r.fromMemory.namespace}:${r.fromMemory.id}`,
        `${r.toMemory.namespace}:${r.toMemory.id}`,
      ])
    );

    const candidates = similar
      .filter((s) => !(s.memory.id.id === id.id && s.memory.id.namespace === id.namespace))
      .filter((s) => s.memory.id.namespace === id.namespace)
      .filter((s) => (s.score ?? 0) >= minSimilarity)
      .filter((s) => !alreadyLinked.has(`${s.memory.id.namespace}:${s.memory.id.id}`))
      // Never re-judge an already-invalidated fact: its successor is the
      // current truth, and re-superseding history would corrupt the chain.
      .filter((s) => !s.memory.invalidatedAt)
      .slice(0, maxCandidates);

    const outcomes: ResolutionOutcome[] = [];
    for (const candidate of candidates) {
      const outcome = await this.judgePair(memory, candidate.memory, candidate.score ?? 0);
      if (outcome) outcomes.push(outcome);
    }
    return outcomes;
  }

  /** ONE LLM decision for one pair, then apply it as edges/invalidation. */
  private async judgePair(
    memory: Memory,
    candidate: Memory,
    similarity: number
  ): Promise<ResolutionOutcome | null> {
    const parsed = await this.llm.completeJSON<{ decision: string; reason?: string }>(
      RESOLUTION_SYSTEM_PROMPT,
      `NEW memory (created ${memory.createdAt.toISOString()}):\n"${memory.content}"\n\nEXISTING memory (created ${candidate.createdAt.toISOString()}):\n"${candidate.content}"`,
      isDecision
    );
    if (!parsed) return null;

    const decision = (
      VALID_DECISIONS.has(parsed.decision as ResolutionDecision) ? parsed.decision : 'none'
    ) as ResolutionDecision;
    const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 500) : '';
    if (decision === 'none') {
      return { memory: memory.id, candidate: candidate.id, decision, reason };
    }

    const edgeMeta = {
      resolvedBy: 'llm',
      model: this.llm.getModel(),
      reason,
      similarity,
      decidedAt: new Date().toISOString(),
    };

    try {
      switch (decision) {
        case 'supersedes':
          await this.memoryService.createRelation(
            memory.id,
            candidate.id,
            RelationType.SUPERSEDES,
            Math.max(similarity, 0.5),
            false,
            edgeMeta
          );
          // Append-only invalidation: stamp the outdated fact, keep it forever.
          await this.memoryService.updateMemory(candidate.id, { invalidatedAt: new Date() });
          break;
        case 'contradicts':
          await this.memoryService.createRelation(
            memory.id,
            candidate.id,
            RelationType.CONTRADICTS,
            Math.max(similarity, 0.5),
            true,
            edgeMeta
          );
          break;
        case 'duplicates':
          await this.memoryService.createRelation(
            memory.id,
            candidate.id,
            RelationType.SAME_AS,
            Math.max(similarity, 0.5),
            true,
            edgeMeta
          );
          break;
        case 'related':
          await this.memoryService.createRelation(
            memory.id,
            candidate.id,
            RelationType.RELATED_TO,
            Math.max(similarity, 0.5),
            true,
            edgeMeta
          );
          break;
      }
    } catch (e) {
      console.error('[Intelligence] failed to apply resolution edge:', e);
      return null;
    }

    return { memory: memory.id, candidate: candidate.id, decision, reason };
  }
}
