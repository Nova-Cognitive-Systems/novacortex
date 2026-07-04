/**
 * `novacortex migrate <source> <file>` — one-command importers from other
 * memory systems into NovaCortex. Your memories survive their roadmap AND ours.
 *
 *   migrate mem0 <get_all.json>        mem0 OSS Memory.get_all() output
 *   migrate claude-mem <items.json>    sqlite3 -json dump of memory_items,
 *                                      or the official export-memories.ts JSON
 *   migrate graphiti <facts.json>      RELATES_TO fact rows (see --help for
 *                                      the Cypher one-liner)
 */
import { Command } from 'commander';
import kleur from 'kleur';
import { readFileSync } from 'node:fs';
import { HttpClient } from '../../client/http.js';
import { resolveActiveProfile } from '../../config/resolve.js';
import { convertMem0, convertClaudeMem, convertGraphiti, type MigratedMemory } from '../../lib/migrations.js';

async function getClient(opts: { profile?: string }): Promise<{ client: HttpClient; namespace: string }> {
  const profile = await resolveActiveProfile(opts.profile);
  return {
    client: new HttpClient({ url: profile.url, token: profile.token }),
    namespace: 'default',
  };
}

const GRAPHITI_CYPHER = `MATCH (a:Entity)-[r:RELATES_TO]->(b:Entity) WHERE r.group_id = $group_id
RETURN r.uuid AS uuid, r.name AS name, r.fact AS fact, a.name AS source_name,
       b.name AS target_name, r.valid_at AS valid_at, r.invalid_at AS invalid_at,
       r.expired_at AS expired_at, r.created_at AS created_at, r.group_id AS group_id`;

async function runMigration(
  source: string,
  memories: MigratedMemory[],
  opts: { namespace?: string; dryRun?: boolean; profile?: string }
): Promise<void> {
  if (memories.length === 0) {
    console.log(kleur.yellow('Nothing to import — no convertible records found.'));
    return;
  }

  if (opts.dryRun) {
    console.log(kleur.bold(`Dry run: ${memories.length} memories would be imported from ${source}.`));
    for (const m of memories.slice(0, 5)) {
      console.log(`  [${m.memoryType}${m.invalidatedAt ? ', superseded' : ''}] ${m.content.slice(0, 100)}${m.content.length > 100 ? '…' : ''}`);
    }
    if (memories.length > 5) console.log(`  … and ${memories.length - 5} more`);
    return;
  }

  const { client, namespace } = await getClient(opts);
  const ns = opts.namespace ?? namespace;
  let imported = 0;
  let invalidated = 0;
  let failed = 0;

  for (const m of memories) {
    try {
      const created = await client.post<{ id: { id: string; namespace: string } }>('/memories', {
        content: m.content,
        memoryType: m.memoryType,
        namespace: ns,
        tags: m.tags,
        salience: m.salience,
      });
      imported++;
      // Preserve bi-temporal history (Graphiti invalid_at/expired_at) via the
      // append-only supersession marker.
      if (m.invalidatedAt) {
        await client.patch(`/memories/${encodeURIComponent(created.id.namespace)}/${encodeURIComponent(created.id.id)}`, {
          invalidatedAt: m.invalidatedAt,
        });
        invalidated++;
      }
      if (imported % 50 === 0) console.log(`  … ${imported}/${memories.length}`);
    } catch (e) {
      failed++;
      if (failed <= 3) console.error(kleur.red(`  failed: ${e instanceof Error ? e.message : e}`));
    }
  }

  console.log(kleur.green('✓') + ` Migrated ${kleur.bold(String(imported))}/${memories.length} memories from ${source} into namespace ${kleur.cyan(ns)}`);
  if (invalidated > 0) console.log(`  ${invalidated} imported as superseded history (invalidatedAt preserved)`);
  if (failed > 0) console.log(kleur.yellow(`  ${failed} failed (exact duplicates are absorbed automatically)`));
  console.log('  Tip: run the background embedding backfill (or wait for the processor) so imports become semantically searchable.');
}

export function registerMigrateCommands(parent: Command): void {
  const migrate = parent
    .command('migrate')
    .description('Import memories from other memory systems (mem0, claude-mem, Graphiti)');

  migrate
    .command('mem0 <file>')
    .description('Import a mem0 OSS export (the JSON from Memory.get_all())')
    .option('--namespace <ns>', 'Target namespace (default: migrated-mem0)', 'migrated-mem0')
    .option('--dry-run', 'Preview without importing')
    .option('--profile <name>', 'CLI profile to use')
    .action(async (file: string, opts) => {
      const memories = convertMem0(JSON.parse(readFileSync(file, 'utf-8')));
      await runMigration('mem0', memories, opts);
    });

  migrate
    .command('claude-mem <file>')
    .description('Import claude-mem data (sqlite3 -json dump of memory_items, or the official export JSON)')
    .addHelpText('after', '\nFull dump one-liner:\n  sqlite3 -json ~/.claude-mem/claude-mem.db "SELECT * FROM memory_items" > items.json')
    .option('--namespace <ns>', 'Target namespace (default: migrated-claude-mem)', 'migrated-claude-mem')
    .option('--dry-run', 'Preview without importing')
    .option('--profile <name>', 'CLI profile to use')
    .action(async (file: string, opts) => {
      const memories = convertClaudeMem(JSON.parse(readFileSync(file, 'utf-8')));
      await runMigration('claude-mem', memories, opts);
    });

  migrate
    .command('graphiti <file>')
    .description('Import Graphiti entity-edge facts (JSON rows from the Cypher dump)')
    .addHelpText('after', `\nDump your facts per group_id with:\n${GRAPHITI_CYPHER}\n(bi-temporal invalid_at/expired_at markers are preserved as NovaCortex invalidatedAt)`)
    .option('--namespace <ns>', 'Target namespace (default: migrated-graphiti)', 'migrated-graphiti')
    .option('--dry-run', 'Preview without importing')
    .option('--profile <name>', 'CLI profile to use')
    .action(async (file: string, opts) => {
      const memories = convertGraphiti(JSON.parse(readFileSync(file, 'utf-8')));
      await runMigration('graphiti', memories, opts);
    });
}
