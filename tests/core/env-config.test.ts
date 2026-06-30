/**
 * Unit tests for the shared env → config resolution.
 *
 * Guards the regression where the API and MCP server resolved SurrealDB/Qdrant
 * config with different env-var names and defaults, so they silently used
 * different namespaces / collections.
 */
import { describe, it, expect } from 'vitest';
import { resolveSurrealConfig, resolveQdrantConfig, CONFIG_DEFAULTS } from '@memory-stack/core';

describe('resolveSurrealConfig', () => {
  it('uses unified defaults when nothing is set', () => {
    const c = resolveSurrealConfig({});
    expect(c.namespace).toBe(CONFIG_DEFAULTS.surrealNamespace);
    expect(c.database).toBe(CONFIG_DEFAULTS.surrealDatabase);
    expect(c.url).toBe(CONFIG_DEFAULTS.surrealUrl);
    expect(c.url).toMatch(/\/rpc$/);
  });

  it('honors the long form SURREALDB_NAMESPACE / SURREALDB_DATABASE (compose names)', () => {
    const c = resolveSurrealConfig({
      SURREALDB_NAMESPACE: 'novacortex',
      SURREALDB_DATABASE: 'production',
    });
    expect(c.namespace).toBe('novacortex');
    expect(c.database).toBe('production');
  });

  it('falls back to the short form SURREALDB_NS / SURREALDB_DB', () => {
    const c = resolveSurrealConfig({ SURREALDB_NS: 'ns1', SURREALDB_DB: 'db1' });
    expect(c.namespace).toBe('ns1');
    expect(c.database).toBe('db1');
  });

  it('prefers the long form when both are present', () => {
    const c = resolveSurrealConfig({
      SURREALDB_NAMESPACE: 'long',
      SURREALDB_NS: 'short',
      SURREALDB_DATABASE: 'longdb',
      SURREALDB_DB: 'shortdb',
    });
    expect(c.namespace).toBe('long');
    expect(c.database).toBe('longdb');
  });
});

describe('resolveQdrantConfig', () => {
  it('defaults the collection to the unified "memories" (matches the API)', () => {
    const c = resolveQdrantConfig({});
    expect(c.collectionName).toBe(CONFIG_DEFAULTS.qdrantCollection);
    expect(c.collectionName).toBe('memories');
    expect(c.vectorSize).toBe(1536);
  });

  it('omits apiKey when not provided', () => {
    const c = resolveQdrantConfig({});
    expect('apiKey' in c).toBe(false);
  });

  it('respects QDRANT_COLLECTION and QDRANT_VECTOR_SIZE overrides', () => {
    const c = resolveQdrantConfig({ QDRANT_COLLECTION: 'custom', QDRANT_VECTOR_SIZE: '768' });
    expect(c.collectionName).toBe('custom');
    expect(c.vectorSize).toBe(768);
  });
});
