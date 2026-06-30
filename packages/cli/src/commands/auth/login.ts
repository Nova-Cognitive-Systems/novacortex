import { Command } from 'commander';
import prompts from 'prompts';
import { HttpClient } from '../../client/http.js';
import { ProfileStore, defaultConfigPath } from '../../config/profile-store.js';
import type { WhoamiResponse } from '../../client/types.js';
import type { ProfileKind } from '../../config/schema.js';
import { success, failure } from '../../lib/output.js';
import { CliError } from '../../lib/errors.js';

export function registerLoginCommand(parent: Command): void {
  parent
    .command('login')
    .description('Log into a NovaCortex server with an access token')
    .requiredOption('--url <url>', 'NovaCortex API base URL')
    .option('--token <token>', 'Access token (if omitted, prompts interactively)')
    .option('--profile <name>', 'Profile name', 'default')
    .option('--kind <kind>', 'selfhosted | saas', 'selfhosted')
    .option('--json', 'Machine-readable JSON output')
    .action(
      async (opts: { url: string; token?: string; profile: string; kind: string; json?: boolean }) => {
        try {
          if (opts.kind === 'saas') {
            throw new Error(
              'SaaS login is not yet available — see the Subsystem D roadmap for details.'
            );
          }
          const kind = opts.kind as ProfileKind;

          let token = opts.token;
          if (!token) {
            const response = await prompts({
              type: 'password',
              name: 'value',
              message: 'Paste your access token:',
            });
            token = response.value as string | undefined;
          }
          if (!token) {
            throw new Error('Token is required');
          }

          const client = new HttpClient({ url: opts.url, token, userAgent: 'novacortex/1.0.0' });
          const whoami = await client.get<WhoamiResponse>('/auth/whoami');

          const store = new ProfileStore(defaultConfigPath());
          await store.upsertProfile(
            {
              name: opts.profile,
              url: opts.url,
              token,
              kind,
              createdAt: new Date().toISOString(),
              lastUsedAt: new Date().toISOString(),
              serverInfo: {
                version: whoami.server.version,
                scopes: whoami.scopes,
                tokenName: whoami.name,
              },
            },
            true
          );

          success(
            `Logged in as '${whoami.name}' on ${opts.url} (profile: ${opts.profile})`,
            { scopes: whoami.scopes },
            { json: opts.json }
          );
        } catch (e) {
          if (e instanceof CliError) {
            failure(e.code, e.message, undefined, { json: opts.json });
            process.exit(e.exitCode);
          }
          failure('login_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
          process.exit(3);
        }
      }
    );
}
