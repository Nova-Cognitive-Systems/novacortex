# LongMemEval_S results

NovaCortex evaluated on [LongMemEval](https://arxiv.org/abs/2410.10813) (ICLR 2025),
the current de-facto standard for agent-memory evaluation — 500 human-curated
questions, each against ~40–60 chat sessions (~115k tokens) of history, across six
categories including knowledge updates, temporal reasoning and abstention.

Dataset: [`longmemeval_s_cleaned`](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned)
(the maintainer's cleaned revision). Harness: [`scripts/benchmark/longmemeval/`](../../scripts/benchmark/longmemeval/)
— fully reproducible, raw per-question outputs published alongside the summaries.

## Headline: retrieval-substrate configuration (full 500 questions)

Verbatim session-decomposed ingestion (turn-level, date-prefixed), **no LLM at
write time**, hybrid (dense + BM25, server-side RRF) retrieval, top-10.
Reader: `gpt-4o-mini` · Judge: `gpt-4o` (fixed, temperature 0). Single run
(2026-07-03), results file: `results-substrate-run1.json`.

| Metric | Value |
|---|---|
| **Accuracy (overall, GPT-4o judge)** | **65.6%** |
| **Session-level retrieval recall@10** | **99.2%** |
| Context tokens per query (avg) | ~2,232 (vs ~115k full-context: **−98%**) |
| Search latency | p50 674 ms · p95 1,282 ms |
| Errors | 1/500 |

Per category:

| Category | n | Accuracy |
|---|---|---|
| single-session-user | 70 | 94.3% |
| single-session-assistant | 56 | 92.9% |
| knowledge-update | 78 | 82.1% |
| multi-session | 133 | 55.6% |
| temporal-reasoning | 133 | 51.1% |
| single-session-preference | 30 | 13.3% |

**How to read this honestly:**

- The **99.2% retrieval recall@10** is the engine's number: the evidence session is
  almost always in the retrieved context. Most remaining answer errors are
  reader-model errors (`gpt-4o-mini`), not retrieval failures.
- With a *mini*-class reader, NovaCortex's 65.6% exceeds the LongMemEval paper's
  **full-context baseline of 60.2% measured with gpt-4o** — a much stronger reader
  over the full 115k-token history.
- Published vendor numbers use different readers and are NOT directly comparable
  (Zep self-reports 71.2% with a gpt-4o reader; mem0 self-reports 94.4 for its 2026
  algorithm; Mastra 94.87% with gpt-5-mini). We do not run competitors ourselves.
- `single-session-preference` is a known weak spot of plain retrieval + a naive
  reading prompt (the question asks the model to *adopt* a preference, not recall a
  fact); the LongMemEval paper reports the same pattern for RAG baselines.
- Single run; multi-run mean±std planned as CI budget allows.

## Intelligence configuration (LLM extraction + append-only resolution)

The intelligence layer distills history into discrete facts at ingestion time
(`gpt-4o-mini` extractor, typed `supersedes`/`contradicts` edges, `invalidatedAt`).

**Knowledge-update category, full run (all 78 questions, 2026-07-05),
results file: `results-intelligence-knowledge-update.json`:**

| Metric | Intelligence config | Substrate config (same category) |
|---|---|---|
| Accuracy (GPT-4o judge) | **75.6%** | 82.1% |
| Session-level retrieval recall@10 | **100%** | 99.2% (overall) |
| Context tokens per query (avg) | **~356** | ~2,232 |
| Errors | 1/78 (transient fetch, counted as wrong) | 1/500 |

How to read this honestly: the distilled-facts store achieves **perfect
evidence recall** on this category at **~6× fewer context tokens** than verbatim
retrieval (~320× fewer than full context) — the remaining accuracy gap to the
substrate (−6.5 pts) is NOT a retrieval problem but detail loss in fact
distillation (the reader sometimes lacks a nuance the verbatim turn carried).
That is a targeted, improvable extraction-prompt surface, and exactly the
operation-level behavior the HaluMem benchmark line of work argues should be
measured. Search latency during this run (p50 ~5.1s) reflects API contention
with the parallel LLM ingestion on a throttled account, not engine latency —
see the substrate run's uncontended 674ms p50.

Published for transparency: our first intelligence-configuration category run
(temporal-reasoning) was **invalidated by API-quota exhaustion mid-run** — most
extraction calls failed with 429s, so its numbers measure an empty wallet, not the
engine, and are not reported here. Two durable fixes came out of it: the extraction
prompt now explicitly enforces **date preservation** in fact content (a defense
against the extraction-loss class that [HaluMem](https://arxiv.org/abs/2511.03506)
shows affects every memory product), and the LLM client now retries transient
429/5xx while failing fast on `insufficient_quota`. Clean category runs will be
published here once completed.

## Reproduce

```bash
curl -L -o longmemeval_s.json \
  https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json
OPENAI_API_KEY=... node scripts/benchmark/longmemeval/run.mjs \
  --data longmemeval_s.json --mode substrate --concurrency 5
```

Total cost of the full 500-question substrate run: ≈ $4 (embeddings + mini reader +
gpt-4o judge).
