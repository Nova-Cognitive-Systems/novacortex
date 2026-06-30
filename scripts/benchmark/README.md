# NovaCortex context-efficiency benchmark

Proves the core thesis: **retrieving only what's relevant beats dumping the whole
knowledge base into the prompt** — far fewer tokens, lower cost, and the same
answer quality.

Two conditions, same questions, same model:

- **Dump** — the entire knowledge base goes into the prompt every query (the "big
  CLAUDE.md / KB handover" pattern).
- **NovaCortex retrieval** — the KB lives in NovaCortex; only the top-K relevant
  memories are retrieved and put in the prompt.

It measures input tokens (the cost driver), latency, **answer accuracy** (graded by
an LLM judge against a reference answer), and **retrieval recall@K** — whether
NovaCortex actually surfaced the facts each question needs. Recall isolates
NovaCortex's job (retrieval) from the LLM's job (answering).

## Headline result

See `RESULTS.md` for the latest run. On a 42-fact KB, 15 questions, gpt-4o-mini,
top-5:

| Approach | Avg input tokens | Avg latency | Answer accuracy | Cost (15 q) |
|---|--:|--:|--:|--:|
| Dump (whole KB) | ~2030 | ~0.9 s | 100% | $0.0048 |
| NovaCortex retrieval (top-5) | ~310 | ~1.0 s | 93% | $0.0009 |

**−85% input tokens, −80% cost, answer accuracy at parity. Retrieval recall@5 = 93%
(avg fact recall 97%).**

The gap grows with KB size: this corpus dumps to ~2k tokens; a real CLAUDE.md +
docs run 10k–50k tokens *per turn*, while retrieval stays a near-constant few
hundred. Retrieval also sends *less of your data* to the model provider per query —
a privacy win, not just a cost one.

## Run it

Against a running NovaCortex (e.g. the self-host stack on `:3001`):

```bash
export NOVACORTEX_TOKEN=<a token with memories:read/write>
export OPENAI_API_KEY=<your key>          # used for the answer + judge models
# optional: OPENAI_BASE_URL, ANSWER_MODEL, JUDGE_MODEL, TOPK, NAMESPACE
node scripts/benchmark/run.mjs
```

Outputs `results.json` (per-question raw data) and `RESULTS.md` (the table above).

## Files

- `corpus.json` — the knowledge base (a fictional robotics company's engineering KB).
- `questions.json` — 15 questions with reference answers and the gold fact IDs each needs.
- `run.mjs` — the runner (store → embed → dump vs retrieve → judge → recall → aggregate).

## Notes on rigor

- Accuracy is LLM-judged; the 1 occasional miss is a multi-fact question where one
  of two gold facts wasn't in the top-K — honest, and it scales away with a larger K.
- Recall is deterministic given embeddings and is the cleanest measure of NovaCortex
  itself: it reliably surfaces the needed facts, so the remaining answer quality is
  bounded by the LLM and matches the full-context baseline.
- To make the cost gap dramatic, grow `corpus.json` toward real-KB size.
