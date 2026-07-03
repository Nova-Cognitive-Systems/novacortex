# LongMemEval_S — NovaCortex harness

Reproducible [LongMemEval](https://github.com/xiaowu0162/LongMemEval) (ICLR 2025)
evaluation of NovaCortex, using the cleaned dataset
([xiaowu0162/longmemeval-cleaned](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned), MIT).

## Configurations (both fully disclosed)

| Mode | Ingestion | What it measures |
|---|---|---|
| `substrate` | Verbatim, session-decomposed, turn-level, date-prefixed. **No LLM at write time.** | The zero-LLM-tax retrieval substrate: hybrid (dense + BM25 RRF) search over raw history. |
| `intelligence` | Through the intelligence layer: LLM fact extraction + append-only resolution (typed `supersedes`/`contradicts` edges). | The full v1.3 engine, incl. the typed-graph handling of knowledge updates. |

## Methodology / credibility rules

- Dataset: `longmemeval_s_cleaned.json` — 500 human-curated questions, ~40–60
  sessions (~115k tokens) history each, six categories incl. knowledge-update,
  temporal-reasoning and abstention (`*_abs`).
- Reader: `gpt-4o-mini` (fixed, temperature 0). Judge: `gpt-4o` (fixed,
  temperature 0), binary correctness modeled on the official `evaluate_qa.py`
  judge, with the abstention variant for `*_abs` questions.
- Reported per run: overall + per-category accuracy, session-level retrieval
  recall@k, average context tokens per query, search latency p50/p95, and
  reader/judge token usage. Raw per-question records (hypotheses included) are
  persisted next to the summary.
- Each question runs in an isolated namespace of a dedicated SurrealDB
  database + Qdrant collection (created fresh → hybrid retrieval active), and
  is cleaned up afterwards.
- We do NOT run competitors ourselves. Compare against their self-reported
  numbers with links, or run their official harnesses.

## Run

```bash
# dataset (~264 MB)
curl -L -o longmemeval_s.json \
  https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json

npm run dev:db          # SurrealDB + Qdrant
npm run build --workspace=packages/core

# retrieval-substrate configuration (full 500 questions, ≈$5 OpenAI spend)
OPENAI_API_KEY=... node scripts/benchmark/longmemeval/run.mjs \
  --data longmemeval_s.json --mode substrate --concurrency 5

# intelligence configuration
OPENAI_API_KEY=... node scripts/benchmark/longmemeval/run.mjs \
  --data longmemeval_s.json --mode intelligence --llm gpt-4o-mini

# fully local (privacy-path numbers): point everything at Ollama
OPENAI_API_KEY=ollama OPENAI_BASE_URL=http://localhost:11434/v1 \
EMBEDDING_MODEL=nomic-embed-text \
node scripts/benchmark/longmemeval/run.mjs --data longmemeval_s.json \
  --mode intelligence --llm qwen3:8b --reader qwen3:8b
# (judge should stay a fixed frontier model for comparability)
```

Flags: `--subset N`, `--categories a,b`, `--topk` (default 10), `--concurrency`
(default 4), `--reader`, `--judge`, `--llm`, `--resolve false`, `--keep`,
`--collection`, `--out`.
