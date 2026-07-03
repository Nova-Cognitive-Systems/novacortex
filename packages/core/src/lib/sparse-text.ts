/**
 * Sparse text vectors for hybrid (lexical + semantic) search.
 *
 * Produces BM25-style sparse vectors client-side: tokens are hashed to u32
 * indices, values carry the term-frequency component (saturation + document
 * length normalization). The IDF component is applied SERVER-SIDE by Qdrant
 * (sparse vector `modifier: "idf"`), so no corpus statistics are needed here
 * and scoring adapts to each deployment's own data. Fully deterministic and
 * local — no model, no network.
 */

// Compact English stopword list — enough to keep obvious noise out of the
// index without stemming (IDF handles the rest).
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'while',
  'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'to', 'from', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'have', 'has', 'had', 'having', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'we', 'they', 'them', 'his', 'her', 'their', 'my',
  'your', 'our', 'me', 'him', 'us', 'as', 'so', 'not', 'no', 'nor', 'too',
  'very', 'can', 'will', 'just', 'what', 'which', 'who', 'whom', 'how', 'why',
  'where', 'there', 'here', 'all', 'any', 'both', 'each', 'more', 'most',
  'other', 'some', 'such', 'only', 'own', 'same', 'than', 'up', 'down', 's', 't',
]);

// BM25 term-frequency parameters (classic defaults; avg doc length assumed —
// memories are short factual statements).
const K1 = 1.2;
const B = 0.75;
const ASSUMED_AVG_DOC_LEN = 48;

/** FNV-1a 32-bit hash — deterministic token -> sparse index mapping. */
function fnv1a(token: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Lowercase, strip punctuation, split, drop stopwords and 1-char tokens. */
export function tokenizeForSparse(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\-./:@]+/gu, ' ') // keep word chars + id-ish symbols
    .split(/\s+/)
    .map((t) => t.replace(/^[-./:@]+|[-./:@]+$/g, '')) // trim symbol edges
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export interface SparseVector {
  indices: number[];
  values: number[];
}

/**
 * Build a BM25-TF sparse vector for a text (IDF applied by Qdrant). Returns
 * null when the text yields no indexable tokens.
 */
export function buildSparseVector(text: string): SparseVector | null {
  const tokens = tokenizeForSparse(text);
  if (tokens.length === 0) return null;

  const tf = new Map<number, number>();
  for (const token of tokens) {
    const idx = fnv1a(token);
    tf.set(idx, (tf.get(idx) ?? 0) + 1);
  }

  const lenNorm = K1 * (1 - B + (B * tokens.length) / ASSUMED_AVG_DOC_LEN);
  const indices: number[] = [];
  const values: number[] = [];
  for (const [idx, count] of tf.entries()) {
    indices.push(idx);
    values.push((count * (K1 + 1)) / (count + lenNorm));
  }
  return { indices, values };
}
