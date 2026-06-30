import type { Express, Request, Response } from 'express';
import { requireScopes } from '../middleware/auth.js';
import { WEBHOOK_EVENTS, type WebhookService, type WebhookEvent } from '../services/webhooks.js';

/**
 * Webhook management routes. Admin-scoped (admin:* tokens satisfy these granular
 * scopes). The secret is returned ONLY in the create response — list never
 * exposes it.
 */
export function installWebhookRoutes(app: Express, svc: WebhookService): void {
  app.get('/webhooks', requireScopes('webhooks:read'), async (_req: Request, res: Response) => {
    res.json({ data: await svc.list(), events: WEBHOOK_EVENTS });
  });

  app.put('/webhooks', requireScopes('webhooks:write'), async (req: Request, res: Response) => {
    try {
      const { url, events, secret, active } = (req.body ?? {}) as Record<string, unknown>;
      const wh = await svc.register({
        url: String(url ?? ''),
        events: Array.isArray(events) ? (events as WebhookEvent[]) : [],
        secret: typeof secret === 'string' ? secret : undefined,
        active: typeof active === 'boolean' ? active : undefined,
      });
      res.status(201).json(wh);
    } catch (e) {
      res.status(400).json({ error: 'bad_request', message: e instanceof Error ? e.message : 'invalid' });
    }
  });

  app.delete('/webhooks/:id', requireScopes('webhooks:write'), async (req: Request, res: Response) => {
    const removed = await svc.remove(req.params['id'] as string);
    if (!removed) {
      res.status(404).json({ error: 'not_found', message: 'webhook not found' });
      return;
    }
    res.status(204).send();
  });
}
