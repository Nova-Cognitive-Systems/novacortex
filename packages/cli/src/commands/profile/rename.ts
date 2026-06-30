import { Command } from 'commander';
import { ProfileStore, defaultConfigPath } from '../../config/profile-store.js';
import { success, failure } from '../../lib/output.js';

export function registerProfileRenameCommand(parent: Command): void {
  parent
    .command('rename <oldName> <newName>')
    .description('Rename a profile')
    .option('--json', 'Machine-readable JSON output')
    .action(async (oldName: string, newName: string, opts: { json?: boolean }) => {
      try {
        const store = new ProfileStore(defaultConfigPath());
        await store.renameProfile(oldName, newName);
        success(`Profile '${oldName}' renamed to '${newName}'`, undefined, { json: opts.json });
      } catch (e) {
        failure('rename_failed', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
        process.exit(1);
      }
    });
}
