import { Command } from 'commander';
import { HttpClient } from '../../../client/http.js';
import { resolveActiveProfile } from '../../../config/resolve.js';
import { success, failure } from '../../../lib/output.js';
import { CliError } from '../../../lib/errors.js';

export function registerTokensRevokeCommand(parent: Command): void {
  parent
    .command('revoke <id>')
    .description('Revoke a token by id')
    .option('--profile <name>', 'Profile to use')
    .option('--json', 'Machine-readable JSON output')
    .action(async (id: string, opts: { profile?: string; json?: boolean }) => {
      try {
        const profile = await resolveActiveProfile(opts.profile);
        const client = new HttpClient({
          url: profile.url,
          token: profile.token,
          userAgent: 'novacortex/1.0.0',
        });
        await client.delete<void>(`/tokens/${encodeURIComponent(id)}`);
        success(`Token '${id}' revoked`, undefined, { json: opts.json });
      } catch (e) {
        if (e instanceof CliError) {
          failure(e.code, e.message, undefined, { json: opts.json });
          process.exit(e.exitCode);
        }
        failure('revoke_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
        process.exit(1);
      }
    });
}
