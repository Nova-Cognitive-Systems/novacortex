import { Command } from 'commander';
import { ProfileStore, defaultConfigPath } from '../config/profile-store.js';
import type { SetupExchangeResponse } from '../client/types.js';
import { success, failure } from '../lib/output.js';
import { CliError } from '../lib/errors.js';

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Exchange a bootstrap code for an admin token (first-run self-hosted setup)')
    .requiredOption('--url <url>', 'NovaCortex API base URL (e.g. http://localhost:3001)')
    .requiredOption('--code <code>', 'Bootstrap code from the server logs (nc_boot_...)')
    .option('--profile <name>', 'Profile name to create or overwrite', 'default')
    .option('--json', 'Emit machine-readable JSON output')
    .action(async (opts: { url: string; code: string; profile: string; json?: boolean }) => {
      try {
        const response = await (async () => {
          const res = await fetch(`${opts.url.replace(/\/$/, '')}/setup/exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: opts.code }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
            throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
          }
          return (await res.json()) as SetupExchangeResponse;
        })();

        const store = new ProfileStore(defaultConfigPath());
        await store.upsertProfile(
          {
            name: opts.profile,
            url: opts.url,
            token: response.token,
            kind: 'selfhosted',
            createdAt: new Date().toISOString(),
            lastUsedAt: new Date().toISOString(),
            serverInfo: {
              version: response.whoami.server.version,
              scopes: response.whoami.scopes,
              tokenName: response.whoami.name,
            },
          },
          true
        );

        success(
          `Setup complete. Logged in as '${response.whoami.name}' on ${opts.url} (profile: ${opts.profile})`,
          { scopes: response.whoami.scopes },
          { json: opts.json }
        );
      } catch (e) {
        if (e instanceof CliError) {
          failure(e.code, e.message, undefined, { json: opts.json });
          process.exit(e.exitCode);
        }
        failure('setup_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
        process.exit(6);
      }
    });
}
