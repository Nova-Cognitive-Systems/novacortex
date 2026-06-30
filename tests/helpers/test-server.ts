import express, { type Express } from 'express';
import { TokenService } from '../../packages/api/src/services/token-service.js';
import { FakeSurreal } from './fake-surreal.js';
import { tokenService as singletonTokenService } from '../../packages/api/src/middleware/auth.js';

/**
 * Build a minimal Express app wired to a FakeSurreal-backed TokenService.
 * Mounts the given list of route installers. The singleton tokenService is
 * rebound to the test instance so that middleware using it sees the test DB.
 */
export async function buildTestApp(
  installers: Array<(app: Express) => void>
): Promise<{ app: Express; fake: FakeSurreal; svc: TokenService }> {
  const fake = new FakeSurreal();
  const svc = new TokenService(fake);
  await svc.connect({ url: '', user: '', pass: '', namespace: '', database: '' });

  // Rebind every method of the singleton to the test instance so existing
  // middleware imports still work.
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(svc))) {
    if (key === 'constructor') continue;
    const fn = (svc as unknown as Record<string, unknown>)[key];
    if (typeof fn === 'function') {
      (singletonTokenService as unknown as Record<string, unknown>)[key] = fn.bind(svc);
    }
  }

  const app = express();
  app.use(express.json());
  for (const install of installers) install(app);
  return { app, fake, svc };
}

export async function jsonRequest(
  app: Express,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: unknown }> {
  const server = app.listen(0);
  try {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const parsed = res.status === 204 ? undefined : await res.json().catch(() => undefined);
    return { status: res.status, body: parsed };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
