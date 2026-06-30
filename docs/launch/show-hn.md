# Show HN draft

## Title (pick one, ≤ 80 chars)

1. `Show HN: NovaCortex – self-hostable, privacy-first memory for AI agents`
2. `Show HN: Stop dumping your KB into context – self-hosted agent memory`
3. `Show HN: NovaCortex – open-source agent memory, your data never leaves your box`

Recommended: **#1** (says what it is + the wedge in one line). Lead the first
comment with the benchmark.

## URL

`https://github.com/Nova-Cognitive-Systems/novacortex`

## First comment (author context)

Hi HN — I built NovaCortex, an open-source (Apache-2.0), self-hostable memory layer
for AI agents. It gives agents a persistent, queryable memory: typed memories +
a relation graph, semantic + text retrieval, a knowledge base, and a native MCP
server (so Claude/Cursor can use it directly), plus REST, TypeScript/Python SDKs
and a CLI. One `docker compose up` runs the whole stack on your own box.

Why I built it: most "give your agent memory" advice boils down to "optimize your
CLAUDE.md" or "paste your docs/KB into context." That works until the KB grows —
then you pay for the whole thing on every turn, it eats the context window, and the
relevant fact gets buried. Support bots get slow for the same reason. The fix isn't
a tidier dump; it's retrieval: store it once, fetch only what a question needs.

So I measured it instead of just claiming it. Same questions, same model, two ways
to supply the knowledge — dump the whole KB vs NovaCortex top-5 retrieval:

- ~2K-token KB: −85% input tokens, accuracy at parity.
- ~26K-token KB (hundreds of distractor facts): −98.8% input tokens, ~65× cheaper
  per query. Dump tokens grow linearly; retrieval stays flat at ~305 tokens.
- Retrieval recall@5 = 100% even with 518 unrelated facts in the store — it finds
  the needed facts; the rare answer miss is an LLM/grader artifact that hits the
  dump baseline equally.

It's fully reproducible (`node scripts/benchmark/run.mjs`), and I wrote up the
method + the honest caveats (including a labeling mistake I caught and fixed):
[benchmark write-up + chart].

What makes it different from Mem0/Zep (both great, both cloud-first): NovaCortex is
**privacy-first and self-hosted** — the knowledge base never leaves your
infrastructure, and retrieval sends *less* of your data to the model provider per
query than dumping does. Plus a **portable open format** (PMF — JSON, binary, or
AES-256-GCM encrypted, with integrity hashes) so there's no lock-in: export the
whole graph and walk away.

Honest about the rough edges:
- Free tier is fully self-hostable; Pro (federation + higher limits) is an
  ed25519-signed license. Stripe checkout isn't wired yet — Pro access is by request
  for now.
- Semantic search needs an embeddings endpoint (OpenAI, or any OpenAI-compatible
  local one like Ollama/LiteLLM); without it, it falls back to text search.
- Hybrid (vector + keyword) and cross-encoder reranking are on the roadmap for
  harder lexical-mismatch retrieval.

I'd love feedback from people building agents: does the self-host + privacy angle
matter to you, or is managed cloud the only thing you'd actually adopt? And what
would you need before you'd trust a memory layer with your project's knowledge?

## Notes for posting

- Post Tue–Thu, ~8–10am ET. Be around to answer comments for the first 2–3 hours.
- Make GHCR images public first so `docker compose up` works for visitors.
- Have the benchmark chart + the live `/benchmark` page ready to link.
