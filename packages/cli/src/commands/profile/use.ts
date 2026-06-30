import { Command } from 'commander';
import { ProfileStore, defaultConfigPath } from '../../config/profile-store.js';
import { success, failure } from '../../lib/output.js';

export function registerProfileUseCommand(parent: Command): void {
  parent
    .command('use <name>')
    .description('Switch the active profile')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string, opts: { json?: boolean }) => {
      try {
        const store = new ProfileStore(defaultConfigPath());
        await store.setActiveProfile(name);
        success(`Active profile is now '${name}'`, undefined, { json: opts.json });
      } catch (e) {
        failure('profile_not_found', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
        process.exit(2);
      }
    });
}
