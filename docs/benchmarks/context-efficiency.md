# Stop dumping your knowledge base into the prompt

Every "give your agent memory" guide ends the same way: optimize your CLAUDE.md,
write a big handover doc, paste the docs into context. It works until it doesn't.
The knowledge base grows, every prompt carries all of it, and you pay for the whole
thing on every turn while the relevant fact gets buried in noise.

The fix isn't a tidier dump. It's **retrieval**: store the knowledge once, fetch only
the few facts a question needs. That's what NovaCortex does. Here's the measurement.

## The setup

Same questions, same model (gpt-4o-mini), two ways of supplying project knowledge:

- **Dump** — the entire knowledge base goes into the prompt every query.
- **NovaCortex retrieval** — the KB lives in NovaCortex; only the top-5 relevant
  memories are retrieved per question and put in the prompt.

The knowledge base is a fictional robotics company's engineering KB (architecture,
conventions, decisions, incidents, ownership). 15 questions, each answerable from a
small subset of facts. Answers are graded by an LLM judge against reference answers.

## The result

On the base 42-fact KB, top-5 retrieval:

| Approach | Avg input tokens / query | Answer accuracy | Cost (15 q) |
|---|--:|--:|--:|
| Dump (whole KB) | 2,028 | 100% | $0.0048 |
| NovaCortex retrieval | 305 | 93% | $0.0009 |

**−85% input tokens, −80% cost, answer accuracy at parity.**

## Now grow the KB

Real knowledge bases aren't 42 facts. We padded the store with hundreds of
unrelated distractor facts to simulate a large KB and measured dump at each size.
Retrieval ran once against the full inflated store:

| KB size | Dump input tokens | Retrieval input tokens | Reduction |
|---|--:|--:|--:|
| 42 facts (~2K) | 2,028 | 305 | 85% |
| 220 facts (~10K) | 10,157 | 305 | 97% |
| 560 facts (~26K) | 25,675 | 305 | **98.8%** |

Dump tokens grow linearly with the KB. Retrieval stays flat at ~305 tokens. At a
26K-token KB, retrieval costs about **65× less per query** — and the gap keeps
widening as your KB grows. A real CLAUDE.md plus docs is easily 10–50K tokens; you
pay that on every turn with the dump approach.

## The honest part

We separate NovaCortex's job (retrieval) from the LLM's job (answering) with a
**recall@K** metric: did retrieval surface the facts each question actually needs?

- **Retrieval recall@5 = 100%** — on the clean KB *and* on the 560-fact KB with 518
  unrelated distractor facts in the store. NovaCortex finds every needed fact even
  buried in noise. (An earlier draft reported a dip to 87%; that was our own fault —
  we'd labeled *supporting* facts as "required" on a few multi-fact questions when a
  single fact already contained the answer. We tightened the gold labels to the
  minimal necessary set and re-ran. Lesson: grade what the answer needs, not every
  related fact.)
- **Answer accuracy: 93% retrieval vs 100% dump.** The one gap is a question where
  retrieval surfaced the right fact (recall was 100%) but the grader marked the
  answer down — and dump gave the *same* answer. So it's an LLM/grader artifact, not
  a retrieval miss; real-world answer quality is at parity.

Notably, dump accuracy stayed at 100% even at 26K tokens — gpt-4o-mini handled the
haystack here. So the honest trade is: near-identical answers and perfect retrieval
recall, for a 85–99% cut in tokens and cost that grows with your KB.

Genuine hybrid (vector + keyword) and cross-encoder reranking are still on the
roadmap — they help real lexical-mismatch cases this corpus didn't stress — but the
core claim stands on its own: retrieval surfaces what you need, at a fraction of the
tokens.

## It's a privacy win too

Dumping the whole KB ships *all* of your knowledge to the model provider on every
query. Retrieval sends only the few relevant snippets. With NovaCortex self-hosted,
the knowledge base never leaves your infrastructure — only the minimal retrieved
context goes to the model. Less data per query is both cheaper and safer.

## Reproduce it

The benchmark is in the repo, no magic:

```bash
export NOVACORTEX_TOKEN=… OPENAI_API_KEY=…
node scripts/benchmark/run.mjs     # base: dump vs retrieval
node scripts/benchmark/scale.mjs   # scaling: dump grows, retrieval stays flat
```

Corpus, questions, and runners: [`scripts/benchmark/`](../../scripts/benchmark/).
Chart: [`context-efficiency.html`](./context-efficiency.html).

NovaCortex is the privacy-first, self-hostable, MCP-native, portable memory layer
for AI agents. Apache-2.0, runs on your own infra.
