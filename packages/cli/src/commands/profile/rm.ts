import { Command } from 'commander';
import { ProfileStore, defaultConfigPath } from '../../config/profile-store.js';
import { success, failure } from '../../lib/output.js';

export function registerProfileRmCommand(parent: Command): void {
  parent
    .command('rm <name>')
    .description('Delete a profile from local config')
    .option('--force', 'Delete even if it is the active profile')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string, opts: { force?: boolean; json?: boolean }) => {
      try {
        const store = new ProfileStore(defaultConfigPath());
        await store.deleteProfile(name, opts.force ?? false);
        success(`Profile '${name}' removed`, undefined, { json: opts.json });
      } catch (e) {
        failure('rm_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
        process.exit(1);
      }
    });
}
