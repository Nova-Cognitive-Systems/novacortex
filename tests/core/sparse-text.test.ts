/**
 * Sparse text vectors (BM25-style TF, IDF applied server-side by Qdrant) and
 * the deterministic temporal query parser.
 */
import { describe, it, expect } from 'vitest';
import { buildSparseVector, tokenizeForSparse, parseTemporalQuery } from '@memory-stack/core';

describe('tokenizeForSparse', () => {
  it('lowercases, strips punctuation, drops stopwords and 1-char tokens', () => {
    expect(tokenizeForSparse('The USER prefers Dark-Mode, obviously!')).toEqual([
      'user',
      'prefers',
      'dark-mode',
      'obviously',
    ]);
  });

  it('keeps identifier-ish tokens (versions, paths, error codes)', () => {
    const tokens = tokenizeForSparse('error ECONNREFUSED in v1.2.1 at /api/memories');
    expect(tokens).toContain('econnrefused');
    expect(tokens).toContain('v1.2.1');
    expect(tokens).toContain('api/memories');
  });

  it('returns [] for stopword-only or empty text', () => {
    expect(tokenizeForSparse('the of and')).toEqual([]);
    expect(tokenizeForSparse('')).toEqual([]);
  });
});

describe('buildSparseVector', () => {
  it('is deterministic and aligns indices/values', () => {
    const a = buildSparseVector('qdrant hybrid search with qdrant');
    const b = buildSparseVector('qdrant hybrid search with qdrant');
    expect(a).toEqual(b);
    expect(a!.indices.length).toBe(a!.values.length);
    expect(a!.indices.length).toBe(3); // qdrant, hybrid, search (with = stopword)
    expect(a!.indices.every((i) => Number.isInteger(i) && i >= 0)).toBe(true);
  });

  it('weights repeated terms higher (TF saturation)', () => {
    const single = buildSparseVector('qdrant filler alpha beta gamma')!;
    const repeated = buildSparseVector('qdrant qdrant qdrant filler alpha beta gamma')!;
    const tokenIdx = buildSparseVector('qdrant')!.indices[0]!;
    const w1 = single.values[single.indices.indexOf(tokenIdx)]!;
    const w3 = repeated.values[repeated.indices.indexOf(tokenIdx)]!;
    expect(w3).toBeGreaterThan(w1);
  });

  it('returns null when nothing is indexable', () => {
    expect(buildSparseVector('a of the')).toBeNull();
  });
});

describe('parseTemporalQuery', () => {
  const now = new Date('2026-07-03T12:00:00Z');

  it('maps "yesterday" to the start of the previous day and cleans the query', () => {
    const parsed = parseTemporalQuery('what did I decide yesterday about the deploy', now);
    expect(parsed.createdAfter).toBeDefined();
    // Start-of-day is computed in LOCAL time, so the distance from a fixed UTC
    // "now" varies with the test machine's timezone: 24h..48h is correct.
    const hours = (now.getTime() - parsed.createdAfter!.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(12);
    expect(hours).toBeLessThanOrEqual(48);
    expect(parsed.cleaned).toBe('what did I decide about the deploy');
  });

  it('maps "last N days" and "N days ago"', () => {
    const a = parseTemporalQuery('changes in the last 3 days', now);
    expect(now.getTime() - a.createdAfter!.getTime()).toBe(3 * 24 * 3_600_000);
    const b = parseTemporalQuery('the decision 10 days ago', now);
    expect(now.getTime() - b.createdAfter!.getTime()).toBe(10 * 24 * 3_600_000);
  });

  it('leaves unrecognized queries untouched', () => {
    const parsed = parseTemporalQuery('favorite editor of the user', now);
    expect(parsed.createdAfter).toBeUndefined();
    expect(parsed.cleaned).toBe('favorite editor of the user');
  });

  it('never returns an empty cleaned query', () => {
    const parsed = parseTemporalQuery('yesterday', now);
    expect(parsed.cleaned).toBe('yesterday');
    expect(parsed.createdAfter).toBeDefined();
  });
});
