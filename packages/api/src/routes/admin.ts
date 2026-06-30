import type { Express, Request, Response } from 'express';
import { requireScopes, tokenService, rateLimit } from '../middleware/auth.js';

export function installAdminRoute(app: Express): void {
  app.post(
    '/admin/migrate',
    rateLimit({ perMinute: 3 }),
    requireScopes('admin:*'),
    async (_req: Request, res: Response) => {
      try {
        const result = await tokenService.migrateFromApiKeys();
        res.status(200).json(result);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'unknown';
        res.status(500).json({ error: 'migration_failed', message });
      }
    }
  );
}
