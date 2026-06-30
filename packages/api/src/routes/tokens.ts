import type { Express, Request, Response } from 'express';
import { requireScopes, tokenService, rateLimit } from '../middleware/auth.js';
import type { TokenTemplate } from '../services/token-service.js';

const VALID_TEMPLATES: TokenTemplate[] = ['admin-full', 'admin-readonly', 'agent', 'knowledge-ingest'];

export function installTokensRoute(app: Express): void {
  app.get(
    '/tokens',
    rateLimit({ perMinute: 60 }),
    requireScopes('tokens:read'),
    async (_req: Request, res: Response) => {
      const list = await tokenService.list();
      res.status(200).json(list);
    }
  );

  app.post(
    '/tokens',
    rateLimit({ perMinute: 20 }),
    requireScopes('tokens:write'),
    async (req: Request, res: Response) => {
      const { template, name, agentId, namespaceClaim, expiresAt } =
        (req.body ?? {}) as {
          template?: string;
          name?: string;
          agentId?: string;
          namespaceClaim?: string;
          expiresAt?: string;
        };

      if (!template || !VALID_TEMPLATES.includes(template as TokenTemplate)) {
        res.status(400).json({
          error: 'bad_request',
          message: `template must be one of ${VALID_TEMPLATES.join(', ')}`,
        });
        return;
      }
      if (!name || typeof name !== 'string' || name.length === 0) {
        res.status(400).json({ error: 'bad_request', message: 'name required' });
        return;
      }
      if (template === 'agent' && !agentId) {
        res.status(400).json({ error: 'bad_request', message: 'agentId required for agent template' });
        return;
      }

      try {
        const { token, record } = await tokenService.create({
          template: template as TokenTemplate,
          name,
          agentId,
          namespaceClaim,
          expiresAt: expiresAt ? new Date(expiresAt) : undefined,
          createdBy: req.auth!.tokenId,
        });
        res.status(201).json({
          token,
          record: {
            id: record.id,
            name: record.name,
            prefix: record.prefix,
            scopes: record.scopes,
            agentId: record.agentId,
            namespaceClaim: record.namespaceClaim,
            createdAt: record.createdAt,
            expiresAt: record.expiresAt,
          },
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'unknown';
        res.status(400).json({ error: 'bad_request', message });
      }
    }
  );

  app.delete(
    '/tokens/:id',
    rateLimit({ perMinute: 20 }),
    requireScopes('tokens:write'),
    async (req: Request, res: Response) => {
      const ok = await tokenService.revoke(req.params['id']!, req.auth!.tokenId);
      res.status(ok ? 204 : 404).end();
    }
  );

  app.post(
    '/tokens/:id/revoke',
    rateLimit({ perMinute: 20 }),
    requireScopes('tokens:write'),
    async (req: Request, res: Response) => {
      const ok = await tokenService.revoke(req.params['id']!, req.auth!.tokenId);
      res.status(ok ? 204 : 404).end();
    }
  );
}
