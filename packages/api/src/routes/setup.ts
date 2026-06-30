import type { Express, Request, Response } from 'express';
import { tokenService } from '../services/token-service.js';
import { rateLimit } from '../middleware/auth.js';

export function installSetupRoute(app: Express): void {
  app.post('/setup/exchange', rateLimit({ perMinute: 5 }), async (req: Request, res: Response) => {
    const { code } = (req.body ?? {}) as { code?: string };
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'bad_request', message: 'code required' });
      return;
    }
    try {
      const { token, record } = await tokenService.exchangeBootstrapCode(code);
      res.status(200).json({
        token,
        whoami: {
          kind: 'selfhosted',
          name: record.name,
          scopes: record.scopes,
          server: { version: process.env['npm_package_version'] ?? 'dev', mode: 'selfhosted' },
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown';
      res.status(401).json({ error: message });
    }
  });
}
