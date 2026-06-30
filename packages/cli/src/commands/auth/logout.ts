import { Command } from 'commander';
import { ProfileStore, defaultConfigPath } from '../../config/profile-store.js';
import { success, failure } from '../../lib/output.js';

export function registerLogoutCommand(parent: Command): void {
  parent
    .command('logout')
    .description('Remove a profile from local config (does not revoke on the server)')
    .option('--profile <name>', 'Profile name (defaults to the active profile)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { profile?: string; json?: boolean }) => {
      try {
        const store = new ProfileStore(defaultConfigPath());
        const cfg = await store.read();
        const name = opts.profile ?? cfg.activeProfile;
        if (!name || !cfg.profiles[name]) {
          failure('profile_not_found', `No profile '${name ?? '(active)'}' to log out from`, undefined, {
            json: opts.json,
          });
          process.exit(2);
          return;
        }
        await store.deleteProfile(name, true);
        success(`Logged out from profile '${name}'`, undefined, { json: opts.json });
      } catch (e) {
        failure('logout_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
        process.exit(1);
      }
    });
}
