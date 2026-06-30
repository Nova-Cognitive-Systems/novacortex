import { Command } from 'commander';
import { ProfileStore, defaultConfigPath } from '../../config/profile-store.js';
import { success, table } from '../../lib/output.js';

export function registerProfileListCommand(parent: Command): void {
  parent
    .command('list')
    .description('List all configured profiles')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { json?: boolean }) => {
      const store = new ProfileStore(defaultConfigPath());
      const cfg = await store.read();
      const entries = Object.values(cfg.profiles).map((p) => ({
        name: p.name + (cfg.activeProfile === p.name ? ' (active)' : ''),
        url: p.url,
        kind: p.kind,
      }));
      if (opts.json) {
        console.log(JSON.stringify({ activeProfile: cfg.activeProfile, profiles: entries }));
        return;
      }
      if (entries.length === 0) {
        success('No profiles configured. Run `novacortex auth login` or `novacortex setup` to add one.');
        return;
      }
      console.log(table(entries, ['name', 'url', 'kind']));
    });
}
