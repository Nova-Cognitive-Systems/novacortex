import { Command } from 'commander';
import { ProfileStore, defaultConfigPath } from '../../config/profile-store.js';
import { success, failure } from '../../lib/output.js';

export function registerProfileShowCommand(parent: Command): void {
  parent
    .command('show [name]')
    .description('Print details of a profile (without revealing the token)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string | undefined, opts: { json?: boolean }) => {
      const store = new ProfileStore(defaultConfigPath());
      const cfg = await store.read();
      const target = name ?? cfg.activeProfile;
      const profile = cfg.profiles[target];
      if (!profile) {
        failure('profile_not_found', `Profile '${target}' not found`, undefined, { json: opts.json });
        process.exit(2);
        return;
      }
      const redacted = {
        name: profile.name,
        url: profile.url,
        kind: profile.kind,
        tokenPreview: profile.token.slice(0, 10) + '...' + profile.token.slice(-4),
        createdAt: profile.createdAt,
        lastUsedAt: profile.lastUsedAt,
        serverInfo: profile.serverInfo,
      };
      success(`Profile '${profile.name}'`, redacted, { json: opts.json });
    });
}
