/**
 * Query Sanitizer - Prevents LLM system-prompt contamination in search queries.
 *
 * A contaminated query (where the system prompt is prepended to the user's actual
 * question) silently drops recall from ~90% to ~1%. Four escalating strategies
 * are applied in order to extract the real query from the tail of the input.
 */

export function sanitizeSearchQuery(query: string): string {
  // Strategy 1: short queries are never contaminated
  if (query.length <= 200) return query;

  // Strategy 2: question extraction — find the last sentence ending with "?"
  const questionMatch = query.match(/([^.!?]*\?)(?:[^?]*)$/);
  if (questionMatch && questionMatch[1] !== undefined) {
    const q = questionMatch[1].trim();
    if (q.length >= 10) return q;
  }

  // Strategy 3: tail sentence extraction — system prompts are prepended,
  // so the actual query is the last complete sentence
  const sentences = query.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  if (sentences.length >= 2) {
    const tail = sentences[sentences.length - 1]!.trim();
    if (tail.length >= 10) return tail;
  }

  // Strategy 4: tail truncation — last 500 chars as fallback
  return query.slice(-500).trim();
}
