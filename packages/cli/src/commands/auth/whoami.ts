import { Command } from 'commander';
import { HttpClient } from '../../client/http.js';
import type { WhoamiResponse } from '../../client/types.js';
import { success, failure } from '../../lib/output.js';
import { CliError, NotLoggedInError } from '../../lib/errors.js';
import { resolveActiveProfile } from '../../config/resolve.js';

export function registerWhoamiCommand(parent: Command): void {
  parent
    .command('whoami')
    .description('Show the current profile and server identity')
    .option('--profile <name>', 'Profile name (defaults to the active profile)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { profile?: string; json?: boolean }) => {
      try {
        const profile = await resolveActiveProfile(opts.profile);
        const client = new HttpClient({
          url: profile.url,
          token: profile.token,
          userAgent: 'novacortex/1.0.0',
        });
        const whoami = await client.get<WhoamiResponse>('/auth/whoami');
        success(
          `Profile '${profile.name}' — ${whoami.name} on ${profile.url}`,
          {
            scopes: whoami.scopes,
            server: whoami.server,
            kind: profile.kind,
          },
          { json: opts.json }
        );
      } catch (e) {
        if (e instanceof NotLoggedInError) {
          failure(e.code, e.message, 'Run `novacortex auth login` first.', { json: opts.json });
          process.exit(e.exitCode);
          return;
        }
        if (e instanceof CliError) {
          failure(e.code, e.message, undefined, { json: opts.json });
          process.exit(e.exitCode);
          return;
        }
        failure('whoami_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
        process.exit(1);
      }
    });
}
