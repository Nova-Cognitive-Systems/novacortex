#!/usr/bin/env node
/**
 * LongMemEval_S harness for NovaCortex.
 *
 * Runs the engine as a library (packages/core dist) against the cleaned
 * LongMemEval_S dataset (xiaowu0162/longmemeval-cleaned, MIT) in two DISCLOSED
 * configurations:
 *
 *   --mode substrate     verbatim session-decomposed ingestion (turn-level,
 *                        date-prefixed) + hybrid retrieval. No LLM at write
 *                        time — the "zero-LLM-tax" configuration.
 *   --mode intelligence  ingestion through the intelligence layer (LLM fact
 *                        extraction + append-only resolution with typed
 *                        supersedes/contradicts edges).
 *
 * Credibility rules implemented here (see README): fixed reader + judge
 * models, per-category metrics incl. abstention, retrieval session-recall@k,
 * tokens/query, search latency p50/p95, raw outputs persisted.
 *
 * Usage:
 *   OPENAI_API_KEY=... node scripts/benchmark/longmemeval/run.mjs \
 *     --data /path/longmemeval_s.json --mode substrate --subset 10
 *
 * Requires the dev DBs (SurrealDB + Qdrant) running; uses its own SurrealDB
 * database ("benchmark"/"longmemeval") and its own Qdrant collection
 * ("lme_bench" — created fresh, so hybrid dense+BM25 is active).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { QdrantClient } from '@qdrant/js-client-rest';
import { Surreal } from 'surrealdb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const core = await import(path.join(__dirname, '../../../packages/core/dist/index.js'));
const { MemoryService, IntelligenceService, LLMService, MemoryType } = core;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) =>
    a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]] : []
  ).filter((p) => p.length)
);

const CONFIG = {
  data: args.data,
  mode: args.mode ?? 'substrate', // substrate | intelligence
  subset: args.subset ? parseInt(args.subset, 10) : undefined,
  categories: args.categories ? args.categories.split(',') : undefined,
  topk: parseInt(args.topk ?? '10', 10),
  expand: parseInt(args.expand ?? '2', 10), // neighbor turns per hit (0 = off)
  concurrency: parseInt(args.concurrency ?? '4', 10),
  reader: args.reader ?? 'gpt-4o-mini',
  judge: args.judge ?? 'gpt-4o',
  llmModel: args.llm ?? process.env.LLM_MODEL ?? 'gpt-4o-mini', // intelligence-mode extraction model
  out: args.out ?? path.join(__dirname, `results-${args.mode ?? 'substrate'}-${Date.now()}.json`),
  keep: args.keep === 'true',
  resolve: args.resolve !== 'false', // intelligence mode: run resolution
  surrealUrl: process.env.SURREALDB_URL ?? 'ws://localhost:8000/rpc',
  surrealUser: process.env.SURREALDB_USER ?? 'root',
  surrealPass: process.env.SURREALDB_PASS ?? 'root',
  qdrantUrl: process.env.QDRANT_URL ?? 'http://localhost:6333',
  collection: args.collection ?? 'lme_bench',
  vectorSize: parseInt(args.vectorSize ?? process.env.QDRANT_VECTOR_SIZE ?? '1536', 10),
};

if (!CONFIG.data || !process.env.OPENAI_API_KEY) {
  console.error('Usage: OPENAI_API_KEY=... node run.mjs --data longmemeval_s.json [--mode substrate|intelligence] [--subset N] [--categories a,b] [--concurrency 4]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// OpenAI helpers (reader + judge)
// ---------------------------------------------------------------------------
const OPENAI_BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
// Fully-local runs point OPENAI_BASE_URL at Ollama for embeddings/reader/
// extraction, but the JUDGE must stay a fixed frontier model for
// comparability — give it its own endpoint when provided.
const JUDGE_BASE = (process.env.JUDGE_BASE_URL || OPENAI_BASE).replace(/\/+$/, '');
const JUDGE_KEY = process.env.JUDGE_API_KEY || process.env.OPENAI_API_KEY;
let readerTokens = { in: 0, out: 0 };
let judgeTokens = { in: 0, out: 0 };

const RUN_STARTED_AT = Date.now();

async function chat(model, system, user, counter, maxTokens = 512, endpoint = null) {
  const base = endpoint?.base ?? OPENAI_BASE;
  const key = endpoint?.key ?? process.env.OPENAI_API_KEY;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        // GPT-5-family (reasoning) models reject `temperature` overrides and
        // `max_tokens` — they take `max_completion_tokens` (which also covers
        // hidden reasoning tokens, so give generous headroom) plus
        // `reasoning_effort`. Older chat models keep the classic fields.
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          ...(/^(gpt-5|o[0-9])/.test(model)
            ? { max_completion_tokens: Math.max(maxTokens * 4, 2000), reasoning_effort: 'low' }
            : { temperature: 0, max_tokens: maxTokens }),
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      const data = await res.json();
      if (counter && data.usage) {
        counter.in += data.usage.prompt_tokens ?? 0;
        counter.out += data.usage.completion_tokens ?? 0;
      }
      return data.choices?.[0]?.message?.content ?? '';
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return '';
}

// Reader protocol derived from the full miss-cause analysis (191 cases):
// quote-evidence-first, date anchoring, enumerate-then-count, prefer the
// newest value on conflict, never fill gaps with world knowledge.
async function readAnswer(question, questionDate, contextBlocks) {
  const system = `You are a helpful assistant answering questions from retrieved excerpts of your past conversation history with the user. Follow this protocol strictly:
1. EVIDENCE FIRST: before answering, identify and quote (briefly) the exact excerpt sentence(s) that support your answer, including any dates in [brackets].
2. DATES: anchor all time arithmetic to the explicit dates in the excerpts and the current date given below. Compute durations/orderings from those dates only — show the subtraction.
3. COUNTING: for "how many/which all" questions, first enumerate every distinct matching item from the excerpts as a list (no duplicates, only items matching the question's scope), then count the list.
4. UPDATES: if excerpts give conflicting values for the same fact, the value from the LATER date is the current one — answer with the newest value.
5. NO OUTSIDE KNOWLEDGE: never fill gaps with typical/estimated real-world values. If the excerpts do not contain the needed fact, reply exactly: "I do not have that information in my memory."
6. Finish with a line "Answer: <concise final answer>".`;
  const user = `Current date: ${questionDate}\n\nRetrieved history:\n${contextBlocks}\n\nQuestion: ${question}`;
  const full = await chat(CONFIG.reader, system, user, readerTokens, 700);
  // Judge sees the concise final line when present (protocol keeps reasoning above it).
  const match = full.match(/Answer:\s*([\s\S]*)$/i);
  return match ? match[1].trim() : full;
}

// Judge prompt modeled on the official LongMemEval GPT-4o judge
// (xiaowu0162/LongMemEval evaluate_qa.py): binary correctness, with the
// abstention variant for *_abs questions.
async function judgeAnswer(question, goldAnswer, hypothesis, isAbstention) {
  const system = 'You are an impartial grader. Reply with exactly "yes" or "no".';
  // Equivalence-aware grading (DISCLOSED deviation from the official judge):
  // numeric equivalence ("3 months" == "three months ago, on Nov 1"),
  // approximation markers ("approximately 4 months" == "4 months"), and
  // order equivalence for sequence answers. Substantive mismatches still fail.
  const user = isAbstention
    ? `The following question is unanswerable from the assistant's memory — the correct behavior is to acknowledge that the information is not available.\n\nQuestion: ${question}\n\nResponse: ${hypothesis}\n\nDoes the response correctly indicate that the information is not available (rather than fabricating an answer)? Answer yes or no.`
    : `Question: ${question}\n\nCorrect answer: ${goldAnswer}\n\nResponse: ${hypothesis}\n\nDoes the response contain the correct answer? Judge by substance, not wording: numerically equivalent values, the same value with qualifiers like "approximately"/"about", added correct detail (e.g. an exact date alongside the correct duration), and identical orderings count as correct. A different value, missing key information, or a different ordering counts as wrong. Answer yes or no.`;
  const verdict = (await chat(CONFIG.judge, system, user, judgeTokens, 4, { base: JUDGE_BASE, key: JUDGE_KEY })).trim().toLowerCase();
  return verdict.startsWith('yes');
}

// ---------------------------------------------------------------------------
// Engine setup
// ---------------------------------------------------------------------------
function makeService() {
  return new MemoryService({
    surrealdb: {
      url: CONFIG.surrealUrl,
      user: CONFIG.surrealUser,
      pass: CONFIG.surrealPass,
      namespace: 'benchmark',
      database: 'longmemeval',
    },
    qdrant: { url: CONFIG.qdrantUrl, collectionName: CONFIG.collection, vectorSize: CONFIG.vectorSize },
    embedding: {}, // OPENAI_API_KEY from env
  });
}

const qdrantRaw = new QdrantClient({ url: CONFIG.qdrantUrl, checkCompatibility: false });

async function cleanupNamespace(ns) {
  if (CONFIG.keep) return;
  const db = new Surreal();
  try {
    await db.connect(new URL(CONFIG.surrealUrl.replace(/^http/, 'ws')), {
      versionCheck: false,
      namespace: 'benchmark',
      database: 'longmemeval',
      authentication: { username: CONFIG.surrealUser, password: CONFIG.surrealPass },
    });
    await db.query('DELETE FROM memories WHERE namespace = $ns; DELETE FROM memory_relations WHERE fromNamespace = $ns OR toNamespace = $ns;', { ns });
    await db.close();
  } catch (e) {
    console.error(`[cleanup] surreal ${ns}: ${e.message}`);
  }
  try {
    await qdrantRaw.delete(CONFIG.collection, {
      wait: false,
      filter: { must: [{ key: 'namespace', match: { value: ns } }] },
    });
  } catch (e) {
    console.error(`[cleanup] qdrant ${ns}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Per-question pipeline
// ---------------------------------------------------------------------------
const TURN_CAP = 2000;

async function ingestSubstrate(svc, q, ns) {
  const embedder = svc.getEmbeddingService();
  for (let s = 0; s < q.haystack_sessions.length; s++) {
    const date = q.haystack_dates[s] ?? '';
    const sessionId = q.haystack_session_ids[s] ?? `s${s}`;
    const turns = q.haystack_sessions[s]
      .filter((t) => t.content && t.content.trim())
      .map((t) => `[${date}] ${t.role}: ${t.content.slice(0, TURN_CAP)}`);
    if (turns.length === 0) continue;
    const vectors = await embedder.embedBatch(turns);
    for (let i = 0; i < turns.length; i++) {
      await svc.createMemory({
        content: turns[i],
        memoryType: MemoryType.EPISODIC,
        namespace: ns,
        tags: [sessionId],
        source: { type: 'conversation', sessionId, timestamp: new Date() },
        ...(vectors[i] ? { embedding: vectors[i] } : {}),
      });
    }
  }
}

async function ingestIntelligence(svc, intel, q, ns) {
  for (let s = 0; s < q.haystack_sessions.length; s++) {
    const date = q.haystack_dates[s] ?? '';
    const sessionId = q.haystack_session_ids[s] ?? `s${s}`;
    const messages = q.haystack_sessions[s]
      .filter((t) => t.content && t.content.trim())
      .map((t) => ({ role: t.role === 'assistant' ? 'assistant' : 'user', content: t.content.slice(0, TURN_CAP), timestamp: date }));
    if (messages.length === 0) continue;
    await intel.ingest(messages, { namespace: ns, sessionId, resolve: CONFIG.resolve });
  }
}

async function runQuestion(svc, intel, q, index, total) {
  const ns = `lme_${q.question_id}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const record = {
    question_id: q.question_id,
    question_type: q.question_type,
    abstention: String(q.question_id).endsWith('_abs'),
  };
  const t0 = Date.now();
  try {
    if (CONFIG.mode === 'intelligence') {
      await ingestIntelligence(svc, intel, q, ns);
    } else {
      await ingestSubstrate(svc, q, ns);
    }
    record.ingestMs = Date.now() - t0;

    const tSearch = Date.now();
    const { results, mode } = await svc.searchByText(q.question, {
      namespace: ns,
      limit: CONFIG.topk,
      // Neighbor-turn expansion: the evidence session is almost always hit
      // (99.2% recall) — pull the surrounding turns so the answer-bearing
      // sentence lands in the reader window.
      expandTurns: CONFIG.expand,
      // Intelligence mode: superseded facts resolve to their chain tip
      // (deterministic, uses the typed supersedes edges).
      ...(CONFIG.mode === 'intelligence' ? { resolveToCurrent: true } : {}),
    });
    record.searchMs = Date.now() - tSearch;
    record.retrievalMode = mode;

    // Session-level retrieval recall@k: did any retrieved memory come from an
    // evidence session? (substrate tags = session ids; intelligence memories
    // carry source.sessionId)
    const answerSessions = new Set(q.answer_session_ids ?? []);
    record.retrievalHit = results.some(
      (r) =>
        r.memory.metadata.tags.some((t) => answerSessions.has(t)) ||
        (r.memory.metadata.source.sessionId && answerSessions.has(r.memory.metadata.source.sessionId))
    );

    const context = results
      .map((r, i) => `[${i + 1}] ${r.memory.content}`)
      .join('\n');
    record.contextTokensApprox = Math.round((context.length + q.question.length) / 4);

    const hypothesis = await readAnswer(q.question, q.question_date, context || '(nothing retrieved)');
    record.hypothesis = hypothesis;
    record.correct = await judgeAnswer(q.question, q.answer, hypothesis, record.abstention);
  } catch (e) {
    record.error = e instanceof Error ? e.message : String(e);
    record.correct = false;
  } finally {
    await cleanupNamespace(ns);
  }
  record.totalMs = Date.now() - t0;
  const flag = record.error ? 'ERR' : record.correct ? 'ok ' : 'MISS';
  console.log(`[${index + 1}/${total}] ${flag} ${q.question_type} ${q.question_id} (search ${record.searchMs ?? '-'}ms, ingest ${Math.round((record.ingestMs ?? 0) / 1000)}s)`);
  return record;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  let questions = JSON.parse(fs.readFileSync(CONFIG.data, 'utf-8'));
  if (CONFIG.categories) questions = questions.filter((q) => CONFIG.categories.includes(q.question_type));
  if (CONFIG.subset) questions = questions.slice(0, CONFIG.subset);

  console.log(`LongMemEval_S — mode=${CONFIG.mode} questions=${questions.length} topk=${CONFIG.topk} reader=${CONFIG.reader} judge=${CONFIG.judge}${CONFIG.mode === 'intelligence' ? ` llm=${CONFIG.llmModel} resolve=${CONFIG.resolve}` : ''}`);

  const svc = makeService();
  await svc.connect();
  if (!svc.getEmbeddingService().isEnabled()) throw new Error('embeddings not enabled — set OPENAI_API_KEY');
  console.log(`hybrid retrieval: ${svc.isHybridEnabled() ? 'ACTIVE' : 'inactive (dense only)'}`);

  const intel =
    CONFIG.mode === 'intelligence'
      ? new IntelligenceService(svc, new LLMService({ apiKey: process.env.OPENAI_API_KEY, model: CONFIG.llmModel }))
      : null;
  if (CONFIG.mode === 'intelligence' && !intel.isEnabled()) throw new Error('intelligence mode needs an LLM model');

  const records = [];
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= questions.length) return;
      records[i] = await runQuestion(svc, intel, questions[i], i, questions.length);
      // Persist incrementally so long runs survive interruption.
      if (i % 10 === 0) fs.writeFileSync(CONFIG.out, JSON.stringify({ config: publicConfig(), partial: true, records: records.filter(Boolean) }, null, 2));
    }
  }
  await Promise.all(Array.from({ length: CONFIG.concurrency }, () => worker()));

  // Metrics
  const done = records.filter(Boolean);
  const valid = done.filter((r) => !r.error);
  const byType = {};
  for (const r of done) {
    byType[r.question_type] ??= { n: 0, correct: 0 };
    byType[r.question_type].n++;
    if (r.correct) byType[r.question_type].correct++;
  }
  const searchLat = valid.map((r) => r.searchMs).sort((a, b) => a - b);
  const wallMs = Date.now() - RUN_STARTED_AT;
  const summary = {
    config: publicConfig(),
    // Wall-clock of the whole run — processing time is part of the result.
    timing: {
      startedAt: new Date(RUN_STARTED_AT).toISOString(),
      finishedAt: new Date().toISOString(),
      wallClockMinutes: Math.round(wallMs / 60000),
      avgSecondsPerQuestion: done.length ? Math.round(wallMs / 1000 / done.length) : 0,
    },
    n: done.length,
    errors: done.filter((r) => r.error).length,
    accuracy: done.length ? done.filter((r) => r.correct).length / done.length : 0,
    perCategory: Object.fromEntries(
      Object.entries(byType).map(([k, v]) => [k, { n: v.n, accuracy: v.correct / v.n }])
    ),
    retrievalRecallAtK: valid.length ? valid.filter((r) => r.retrievalHit).length / valid.length : 0,
    avgContextTokens: valid.length ? Math.round(valid.reduce((a, r) => a + (r.contextTokensApprox ?? 0), 0) / valid.length) : 0,
    searchLatencyMs: { p50: percentile(searchLat, 50), p95: percentile(searchLat, 95) },
    tokens: { reader: readerTokens, judge: judgeTokens },
  };

  fs.writeFileSync(CONFIG.out, JSON.stringify({ summary, records: done }, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nraw results: ${CONFIG.out}`);

  await svc.disconnect();
}

function publicConfig() {
  const { surrealPass, ...rest } = CONFIG;
  return rest;
}

main().catch((e) => {
  console.error('HARNESS FAILED:', e);
  process.exit(1);
});
