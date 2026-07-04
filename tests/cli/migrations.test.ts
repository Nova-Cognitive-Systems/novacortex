/**
 * Migration converters — sample records match the formats verified against
 * the 2026 sources (mem0 get_all, claude-mem v13 memory_items, Graphiti
 * RELATES_TO fact rows).
 */
import { describe, it, expect } from 'vitest';
import { convertMem0, convertClaudeMem, convertGraphiti } from '../../packages/cli/src/lib/migrations.js';

describe('convertMem0', () => {
  const sample = {
    results: [
      {
        id: '0b3f2e6c-1111',
        memory: 'Prefers dark mode; uses VS Code',
        hash: 'a3f5c9d2',
        metadata: { topic: 'preferences' },
        created_at: '2026-06-14T10:32:00.123456-07:00',
        updated_at: null,
        user_id: 'alice',
        agent_id: 'assistant-1',
        run_id: 'session-42',
      },
      { id: 'x', memory: '', created_at: 'x' }, // empty — dropped
    ],
  };

  it('maps memory text and flattened scoping ids to tags', () => {
    const out = convertMem0(sample);
    expect(out.length).toBe(1);
    expect(out[0]!.content).toBe('Prefers dark mode; uses VS Code');
    expect(out[0]!.memoryType).toBe('semantic');
    expect(out[0]!.tags).toEqual(['migrated:mem0', 'user:alice', 'agent:assistant-1', 'run:session-42']);
  });

  it('accepts a bare array too', () => {
    expect(convertMem0([{ memory: 'fact' }]).length).toBe(1);
  });
});

describe('convertClaudeMem', () => {
  const row = {
    id: 'mi-1',
    project_id: 'novacortex',
    kind: 'observation',
    type: 'decision',
    title: 'Switched to SurrealDB',
    subtitle: 'ORM was too slow',
    narrative: 'The team migrated the memory store from Postgres to SurrealDB.',
    facts: '["Postgres was replaced","SurrealDB is the new store"]',
    concepts: '["database","architecture"]',
    created_at_epoch: 1751500000000,
    updated_at_epoch: 1751500000000,
  };

  it('joins title/subtitle/narrative/facts and parses JSON-in-TEXT arrays', () => {
    const out = convertClaudeMem([row]);
    expect(out.length).toBe(1);
    expect(out[0]!.content).toContain('Switched to SurrealDB');
    expect(out[0]!.content).toContain('- Postgres was replaced');
    expect(out[0]!.tags).toContain('migrated:claude-mem');
    expect(out[0]!.tags).toContain('database');
    expect(out[0]!.tags).toContain('project:novacortex');
    expect(out[0]!.tags).toContain('decision');
    expect(out[0]!.memoryType).toBe('semantic');
  });

  it('maps summaries to episodic and supports the official export shape', () => {
    const out = convertClaudeMem({ observations: [row], summaries: [{ ...row, title: 'Session recap' }] });
    expect(out.length).toBe(2);
    expect(out[1]!.memoryType).toBe('episodic');
  });
});

describe('convertGraphiti', () => {
  const fact = {
    uuid: 'c1d2',
    name: 'WORKS_AT',
    fact: 'Alice works at TechCorp as a senior engineer',
    source_name: 'Alice',
    target_name: 'TechCorp',
    valid_at: '2026-01-05T00:00:00Z',
    invalid_at: null,
    expired_at: null,
    created_at: '2026-01-05T10:12:00Z',
    group_id: 'user-alice',
  };

  it('uses the fact as content and preserves relation/entity/group tags', () => {
    const out = convertGraphiti([fact]);
    expect(out.length).toBe(1);
    expect(out[0]!.content).toBe('Alice works at TechCorp as a senior engineer');
    expect(out[0]!.tags).toEqual(
      expect.arrayContaining(['migrated:graphiti', 'works_at', 'group:user-alice', 'entity:alice', 'entity:techcorp'])
    );
    expect(out[0]!.invalidatedAt).toBeUndefined();
  });

  it('preserves bi-temporal invalidation as invalidatedAt', () => {
    const out = convertGraphiti([{ ...fact, invalid_at: '2026-03-01T00:00:00Z' }]);
    expect(out[0]!.invalidatedAt).toBe('2026-03-01T00:00:00Z');
    const expired = convertGraphiti([{ ...fact, expired_at: '2026-04-01T00:00:00Z' }]);
    expect(expired[0]!.invalidatedAt).toBe('2026-04-01T00:00:00Z');
  });
});
