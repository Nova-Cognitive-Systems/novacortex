import type { Express, Request, Response } from 'express';
import { requireScopes, tokenService, rateLimit } from '../middleware/auth.js';

export function installAuthRoute(app: Express): void {
  app.get(
    '/auth/whoami',
    rateLimit({ perMinute: 30 }),
    requireScopes(),
    async (req: Request, res: Response) => {
      const tokenId = req.auth!.tokenId;
      const list = await tokenService.list();
      const record = list.find((t) => t.id === tokenId);
      res.status(200).json({
        kind: 'selfhosted',
        name: record?.name ?? 'unknown',
        scopes: req.auth!.scopes,
        expiresAt: record?.expiresAt ?? null,
        server: {
          version: process.env['npm_package_version'] ?? 'dev',
          mode: 'selfhosted',
        },
      });
    }
  );
}
