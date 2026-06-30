import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    environment: 'node',
    // Integration tests share one live API + SurrealDB; running test files in
    // parallel creates artificial write contention. Run them sequentially.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@memory-stack/core': path.resolve(__dirname, '../packages/core/dist/index.js'),
    },
  },
});
