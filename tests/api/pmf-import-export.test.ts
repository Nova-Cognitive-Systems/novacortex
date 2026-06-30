import { describe, it, expect } from 'vitest';

// PMF format detection logic (mirrors settings/page.tsx fix)
function detectFormat(data: unknown): 'pmf' | 'json' | 'unknown' {
  if ((data as any)?.header?.magic === 'NCPMF') return 'pmf';
  if ((data as any)?.formatVersion === '1.0' && (data as any)?.memories) return 'json';
  return 'unknown';
}

describe('PMF format detection', () => {
  it('detects PMF by header.magic', () => {
    const pmf = { header: { magic: 'NCPMF', version: '1.0', exportedAt: '' }, memories: [] };
    expect(detectFormat(pmf)).toBe('pmf');
  });

  it('detects legacy JSON by formatVersion + memories', () => {
    const json = { formatVersion: '1.0', memories: [], exported: 0 };
    expect(detectFormat(json)).toBe('json');
  });

  it('returns unknown for invalid data', () => {
    expect(detectFormat({})).toBe('unknown');
    expect(detectFormat({ formatVersion: '2.0' })).toBe('unknown');
    expect(detectFormat(null)).toBe('unknown');
  });

  it('PMF wins over JSON fields if both present', () => {
    const both = { header: { magic: 'NCPMF' }, formatVersion: '1.0', memories: [] };
    expect(detectFormat(both)).toBe('pmf');
  });
});
