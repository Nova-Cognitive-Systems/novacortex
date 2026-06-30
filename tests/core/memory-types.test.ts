/**
 * Core Memory Types Tests
 * Validates type definitions and enums
 */
import { describe, it, expect } from 'vitest';
import { MemoryType, RelationType } from '@memory-stack/core';

describe('MemoryType enum', () => {
  it('has all expected types', () => {
    expect(MemoryType.EPISODIC).toBe('episodic');
    expect(MemoryType.SEMANTIC).toBe('semantic');
    expect(MemoryType.PROCEDURAL).toBe('procedural');
    expect(MemoryType.WORKING).toBe('working');
  });

  it('has exactly 4 types', () => {
    const types = Object.values(MemoryType);
    expect(types).toHaveLength(4);
  });
});

describe('RelationType enum', () => {
  it('has all expected types', () => {
    expect(RelationType.CAUSES).toBe('causes');
    expect(RelationType.CAUSED_BY).toBe('caused_by');
    expect(RelationType.RELATED_TO).toBe('related_to');
    expect(RelationType.CONTRADICTS).toBe('contradicts');
    expect(RelationType.SUPPORTS).toBe('supports');
    expect(RelationType.SUPERSEDES).toBe('supersedes');
    expect(RelationType.PART_OF).toBe('part_of');
    expect(RelationType.REFERENCES).toBe('references');
    expect(RelationType.TEMPORAL_BEFORE).toBe('temporal_before');
    expect(RelationType.TEMPORAL_AFTER).toBe('temporal_after');
    expect(RelationType.SAME_AS).toBe('same_as');
  });

  it('has exactly 11 types', () => {
    const types = Object.values(RelationType);
    expect(types).toHaveLength(11);
  });
});
