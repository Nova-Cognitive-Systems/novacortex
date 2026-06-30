import { Command } from 'commander';
import { HttpClient } from '../../../client/http.js';
import type { TokenSummary } from '../../../client/types.js';
import { resolveActiveProfile } from '../../../config/resolve.js';
import { success, failure, table } from '../../../lib/output.js';
import { CliError } from '../../../lib/errors.js';

export function registerTokensListCommand(parent: Command): void {
  parent
    .command('list')
    .description('List tokens on the server')
    .option('--profile <name>', 'Profile to use')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { profile?: string; json?: boolean }) => {
      try {
        const profile = await resolveActiveProfile(opts.profile);
        const client = new HttpClient({
          url: profile.url,
          token: profile.token,
          userAgent: 'novacortex/1.0.0',
        });
        const list = await client.get<TokenSummary[]>('/tokens');
        if (opts.json) {
          console.log(JSON.stringify(list));
          return;
        }
        if (list.length === 0) {
          success('No tokens found on the server');
          return;
        }
        console.log(table(
          list.map((t) => ({
            id: t.id,
            name: t.name,
            prefix: t.prefix,
            scopes: t.scopes.join(','),
          })),
          ['id', 'name', 'prefix', 'scopes']
        ));
      } catch (e) {
        if (e instanceof CliError) {
          failure(e.code, e.message, undefined, { json: opts.json });
          process.exit(e.exitCode);
        }
        failure('list_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
        process.exit(1);
      }
    });
}
