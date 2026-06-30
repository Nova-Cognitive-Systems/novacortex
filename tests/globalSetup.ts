/**
 * Vitest global setup — runs once before all test files.
 * Creates a fresh admin token via the TokenService (directly into SurrealDB)
 * and exports it so integration tests can authenticate against the live API.
 */
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const TOKEN_FILE = join(tmpdir(), 'novacortex-test-token.txt');

export async function setup(): Promise<void> {
  // Skip if caller already provided a token or no live API is expected
  if (process.env['API_TOKEN'] || process.env['CI_SKIP_LIVE']) return;

  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001';

  // Quick connectivity check — if API isn't up, tests will handle it gracefully
  try {
    const health = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (!health.ok) return;
  } catch {
    return;
  }

  // Try to create a fresh admin token via the TokenService directly in SurrealDB.
  // This avoids needing to consume the one-time bootstrap code.
  try {
    const { TokenService } = await import('../packages/api/src/services/token-service.js');
    const { resolveSurrealConfig } = await import('@memory-stack/core');
    const svc = new TokenService(undefined as never);

    // Resolve via the SAME helper the API uses, so the token is created in the
    // exact namespace/database the running API reads from (TokenService.connect
    // normalizes the /rpc suffix itself).
    await svc.connect(resolveSurrealConfig());

    const { token } = await svc.create({ template: 'admin-full', name: 'vitest-ci' });
    writeFileSync(TOKEN_FILE, token, 'utf8');
    process.env['API_TOKEN'] = token;

    console.log('[globalSetup] Created vitest admin token');
  } catch (err) {
    console.warn('[globalSetup] Could not create test token:', (err as Error).message);
  }
}

export async function teardown(): Promise<void> {
  // Token lives in DB — no explicit cleanup needed
  // Force exit to avoid SurrealDB WebSocket keeping the process alive
  setTimeout(() => process.exit(0), 500).unref();
}
