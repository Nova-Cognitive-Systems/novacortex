import { Command } from 'commander';
import { HttpClient } from '../../../client/http.js';
import type { CreateTokenRequest, CreateTokenResponse } from '../../../client/types.js';
import { resolveActiveProfile } from '../../../config/resolve.js';
import { success, failure } from '../../../lib/output.js';
import { CliError } from '../../../lib/errors.js';

export function registerTokensCreateCommand(parent: Command): void {
  parent
    .command('create')
    .description('Create a new token from a template')
    .requiredOption('--template <template>', 'admin-full | admin-readonly | agent | knowledge-ingest')
    .requiredOption('--name <name>', 'Human-readable name for the token')
    .option('--agent-id <id>', 'Required for agent template')
    .option('--namespace <ns>', 'Namespace claim (required for agent template)')
    .option('--profile <name>', 'Profile to use')
    .option('--json', 'Machine-readable JSON output')
    .action(
      async (opts: {
        template: string;
        name: string;
        agentId?: string;
        namespace?: string;
        profile?: string;
        json?: boolean;
      }) => {
        try {
          const profile = await resolveActiveProfile(opts.profile);
          const client = new HttpClient({
            url: profile.url,
            token: profile.token,
            userAgent: 'novacortex/1.0.0',
          });
          const body: CreateTokenRequest = {
            template: opts.template as CreateTokenRequest['template'],
            name: opts.name,
            agentId: opts.agentId,
            namespaceClaim: opts.namespace,
          };
          const response = await client.post<CreateTokenResponse>('/tokens', body);
          success(
            `Token created: ${response.record.name} (${response.record.id})`,
            { token: response.token, record: response.record, note: 'Copy the token now — it will not be shown again.' },
            { json: opts.json }
          );
        } catch (e) {
          if (e instanceof CliError) {
            failure(e.code, e.message, undefined, { json: opts.json });
            process.exit(e.exitCode);
          }
          failure('create_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
          process.exit(1);
        }
      }
    );
}
