import { Command } from 'commander';
import kleur from 'kleur';
import { HttpClient } from '../../client/http.js';
import { resolveActiveProfile } from '../../config/resolve.js';
import { failure, table, info } from '../../lib/output.js';
import { CliError } from '../../lib/errors.js';
import type { Memory, MemoryListResponse, MemoryType, RelationType, StatsResponse } from '../../client/types.js';

async function getClient(opts: { profile?: string }): Promise<{ client: HttpClient; namespace: string }> {
  const profile = await resolveActiveProfile(opts.profile);
  const client = new HttpClient({ url: profile.url, token: profile.token });
  // Resolve agent namespace from whoami if possible, else 'default'
  let namespace = 'default';
  try {
    const whoami = await client.get<{ namespaceClaim?: string }>('/auth/whoami');
    if (whoami.namespaceClaim) namespace = whoami.namespaceClaim;
  } catch { /* use default */ }
  return { client, namespace };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ── store ──────────────────────────────────────────────────────────────────────

export function registerMemoryStoreCommand(parent: Command): void {
  parent
    .command('store <content...>')
    .description('Store a new memory')
    .option('--type <type>', 'Memory type: semantic|episodic|procedural|working', 'semantic')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--salience <n>', 'Salience score 0–10', '5')
    .option('--namespace <ns>', 'Override namespace')
    .option('--profile <name>', 'CLI profile to use')
    .option('--json', 'JSON output')
    .action(async (contentParts: string[], opts) => {
      try {
        const { client, namespace } = await getClient(opts);
        const content = contentParts.join(' ');
        const mem = await client.post<Memory>('/memories', {
          content,
          memoryType: opts.type as MemoryType,
          namespace: opts.namespace ?? namespace,
          tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : [],
          salience: parseFloat(opts.salience),
        });
        if (opts.json) { console.log(JSON.stringify(mem, null, 2)); return; }
        console.log(kleur.green('✓') + ' Stored ' + kleur.bold(mem.id.id));
        console.log('  Type:      ' + kleur.cyan(mem.memoryType));
        console.log('  Namespace: ' + mem.id.namespace);
        console.log('  Salience:  ' + mem.metadata.salience);
        if (mem.metadata.tags.length > 0)
          console.log('  Tags:      ' + mem.metadata.tags.join(', '));
      } catch (e) {
        handleError(e, opts);
      }
    });
}

// ── recall ─────────────────────────────────────────────────────────────────────

export function registerMemoryRecallCommand(parent: Command): void {
  parent
    .command('recall <id>')
    .description('Get a memory by ID')
    .option('--namespace <ns>', 'Override namespace')
    .option('--profile <name>', 'CLI profile to use')
    .option('--json', 'JSON output')
    .action(async (id: string, opts) => {
      try {
        const { client, namespace } = await getClient(opts);
        const ns = opts.namespace ?? namespace;
        const mem = await client.get<Memory>(`/memories/${ns}/${id}?includeRelations=true`);
        if (opts.json) { console.log(JSON.stringify(mem, null, 2)); return; }
        console.log(kleur.bold(`── ${mem.id.namespace}:${mem.id.id} (v${mem.version}) ──`));
        console.log('Content:   ' + mem.content);
        console.log('Type:      ' + kleur.cyan(mem.memoryType));
        console.log('Salience:  ' + mem.metadata.salience + '  Confidence: ' + Math.round(mem.metadata.confidence * 100) + '%');
        if (mem.metadata.tags.length > 0)
          console.log('Tags:      ' + mem.metadata.tags.join(', '));
        if (mem.metadata.entities.length > 0)
          console.log('Entities:  ' + mem.metadata.entities.map(e => `${e.name} (${e.type})`).join(', '));
        if (mem.relations.length > 0) {
          console.log('Relations:');
          for (const r of mem.relations)
            console.log('  ' + kleur.dim('→') + ` ${r.relationType} → ${r.toMemory.namespace}:${r.toMemory.id} (${r.strength})`);
        }
        console.log('Created:   ' + fmtDate(mem.createdAt));
      } catch (e) {
        handleError(e, opts);
      }
    });
}

// ── list ───────────────────────────────────────────────────────────────────────

export function registerMemoryListCommand(parent: Command): void {
  parent
    .command('list')
    .description('List memories in a namespace')
    .option('--namespace <ns>', 'Override namespace')
    .option('--limit <n>', 'Max results', '20')
    .option('--type <type>', 'Filter by memory type')
    .option('--tag <tag>', 'Filter by tag')
    .option('--profile <name>', 'CLI profile to use')
    .option('--json', 'JSON output')
    .action(async (opts) => {
      try {
        const { client, namespace } = await getClient(opts);
        const ns = opts.namespace ?? namespace;
        const params = new URLSearchParams({ namespace: ns, limit: opts.limit });
        if (opts.type) params.set('memoryTypes', opts.type);
        if (opts.tag) params.set('tags', opts.tag);
        const res = await client.get<MemoryListResponse>(`/memories?${params}`);
        if (opts.json) { console.log(JSON.stringify(res, null, 2)); return; }
        info(`${res.count} memories in namespace "${ns}"`);
        if (res.count === 0) return;
        console.log(table(
          res.data.map(m => ({
            id: m.id.id.slice(0, 14) + '…',
            type: m.memoryType,
            sal: String(m.metadata.salience),
            tags: m.metadata.tags.slice(0, 3).join(',') || '-',
            content: truncate(m.content, 52),
          })),
          [
            { header: 'ID', key: 'id', width: 16 },
            { header: 'Type', key: 'type', width: 10 },
            { header: 'Sal', key: 'sal', width: 4 },
            { header: 'Tags', key: 'tags', width: 20 },
            { header: 'Content', key: 'content' },
          ]
        ));
      } catch (e) {
        handleError(e, opts);
      }
    });
}

// ── search ─────────────────────────────────────────────────────────────────────

export function registerMemorySearchCommand(parent: Command): void {
  parent
    .command('search <query...>')
    .description('Semantic search across memories')
    .option('--namespace <ns>', 'Override namespace')
    .option('--limit <n>', 'Max results', '10')
    .option('--profile <name>', 'CLI profile to use')
    .option('--json', 'JSON output')
    .action(async (queryParts: string[], opts) => {
      try {
        const { client, namespace } = await getClient(opts);
        const ns = opts.namespace ?? namespace;
        const query = queryParts.join(' ');
        const params = new URLSearchParams({ query, namespace: ns, limit: opts.limit });
        const res = await client.get<MemoryListResponse>(`/memories?${params}`);
        if (opts.json) { console.log(JSON.stringify(res, null, 2)); return; }
        info(`${res.count} results for "${query}"`);
        if (res.count === 0) return;
        for (const m of res.data) {
          console.log(
            kleur.dim(m.id.id.slice(0, 12) + '…') + ' ' +
            kleur.cyan(m.memoryType.padEnd(10)) + ' ' +
            truncate(m.content, 70)
          );
        }
      } catch (e) {
        handleError(e, opts);
      }
    });
}

// ── forget ─────────────────────────────────────────────────────────────────────

export function registerMemoryForgetCommand(parent: Command): void {
  parent
    .command('forget <id>')
    .description('Delete a memory by ID')
    .option('--namespace <ns>', 'Override namespace')
    .option('--profile <name>', 'CLI profile to use')
    .option('--yes', 'Skip confirmation')
    .action(async (id: string, opts) => {
      try {
        const { client, namespace } = await getClient(opts);
        const ns = opts.namespace ?? namespace;
        if (!opts.yes) {
          const { createInterface } = await import('readline');
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          const answer = await new Promise<string>(res => rl.question(`Delete ${ns}:${id}? [y/N] `, res));
          rl.close();
          if (answer.toLowerCase() !== 'y') { console.log('Cancelled.'); return; }
        }
        await client.delete(`/memories/${ns}/${id}`);
        console.log(kleur.green('✓') + ` Forgot ${ns}:${id}`);
      } catch (e) {
        handleError(e, opts);
      }
    });
}

// ── relate ─────────────────────────────────────────────────────────────────────

export function registerMemoryRelateCommand(parent: Command): void {
  parent
    .command('relate <from-id> <to-id>')
    .description('Create a relation between two memories')
    .option('--type <type>', 'Relation type (default: related_to)', 'related_to')
    .option('--strength <n>', 'Strength 0–1', '0.8')
    .option('--namespace <ns>', 'Override namespace (both memories)')
    .option('--profile <name>', 'CLI profile to use')
    .option('--json', 'JSON output')
    .action(async (fromId: string, toId: string, opts) => {
      try {
        const { client, namespace } = await getClient(opts);
        const ns = opts.namespace ?? namespace;
        const result = await client.post('/memories/relations', {
          fromMemoryId: fromId, fromNamespace: ns,
          toMemoryId: toId, toNamespace: ns,
          relationType: opts.type as RelationType,
          strength: parseFloat(opts.strength),
          bidirectional: true,
        });
        if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
        console.log(kleur.green('✓') + ` ${fromId} ↔ ${toId} (${opts.type}, strength: ${opts.strength})`);
      } catch (e) {
        handleError(e, opts);
      }
    });
}

// ── stats ──────────────────────────────────────────────────────────────────────

export function registerStatsCommand(parent: Command): void {
  parent
    .command('stats')
    .description('Show memory system statistics')
    .option('--profile <name>', 'CLI profile to use')
    .option('--json', 'JSON output')
    .action(async (opts) => {
      try {
        const { client } = await getClient(opts);
        const stats = await client.get<StatsResponse>('/stats');
        if (opts.json) { console.log(JSON.stringify(stats, null, 2)); return; }
        console.log(kleur.bold('Memory Statistics'));
        console.log('  Total:      ' + kleur.cyan(String(stats.total)));
        console.log('  By type:');
        for (const [type, count] of Object.entries(stats.byType))
          console.log('    ' + type.padEnd(12) + count);
        console.log('  By namespace:');
        for (const [ns, count] of Object.entries(stats.byNamespace))
          console.log('    ' + ns.padEnd(20) + count);
        if (stats.recentActivity) {
          console.log('  Recent (24h): created ' + stats.recentActivity.created +
            ' / updated ' + stats.recentActivity.updated);
        }
      } catch (e) {
        handleError(e, opts);
      }
    });
}

// ── repl ───────────────────────────────────────────────────────────────────────

export function registerReplCommand(parent: Command): void {
  parent
    .command('repl')
    .description('Start an interactive memory REPL session')
    .option('--namespace <ns>', 'Override namespace')
    .option('--profile <name>', 'CLI profile to use')
    .action(async (opts) => {
      try {
        const { client, namespace: autoNs } = await getClient(opts);
        let ns = opts.namespace ?? autoNs;
        const { createInterface } = await import('readline');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const prompt = () => new Promise<string>(res =>
          rl.question(kleur.cyan(`novacortex[${ns}]> `), res));

        console.log(kleur.bold('NovaCortex REPL') + kleur.dim('  type "help" for commands, "exit" to quit'));
        console.log(kleur.dim('  Namespace: ') + ns + '\n');

        while (true) {
          const input = (await prompt()).trim();
          if (!input) continue;
          const [cmd, ...rest] = input.split(' ');
          const arg = rest.join(' ');
          try {
            switch (cmd) {
              case 'help':
                console.log(kleur.dim(`
  store <text>             Store a semantic memory
  store:e <text>           Store an episodic memory
  store:p <text>           Store a procedural memory
  recall <id>              Get memory by ID
  list                     List memories in current namespace
  search <text>            Semantic search
  forget <id>              Delete a memory
  relate <id1> <id2> [t]  Create relation (default: related_to)
  stats                    System statistics
  ns [name]                Show / switch namespace
  exit                     Quit
`)); break;
              case 'store':
              case 'store:e':
              case 'store:p': {
                if (!arg) { console.log(kleur.dim('  Usage: store <text>')); break; }
                const type = cmd === 'store:e' ? 'episodic' : cmd === 'store:p' ? 'procedural' : 'semantic';
                const m = await client.post<Memory>('/memories', { content: arg, memoryType: type, namespace: ns, salience: 5 });
                console.log(kleur.green('  ✓') + ' ' + m.id.id + kleur.dim(' (' + type + ')'));
                break;
              }
              case 'recall': {
                if (!arg) { console.log(kleur.dim('  Usage: recall <id>')); break; }
                const m = await client.get<Memory>(`/memories/${ns}/${arg}?includeRelations=true`);
                console.log('  ' + kleur.bold(m.id.id) + ' v' + m.version);
                console.log('  ' + m.content);
                console.log('  ' + kleur.dim(m.memoryType + ' | S:' + m.metadata.salience + ' | tags: ' + (m.metadata.tags.join(',') || '-')));
                if (m.relations.length > 0)
                  m.relations.forEach(r => console.log(kleur.dim('    → ' + r.relationType + ' → ' + r.toMemory.id)));
                break;
              }
              case 'list': {
                const res = await client.get<MemoryListResponse>(`/memories?namespace=${ns}&limit=30`);
                console.log(kleur.dim(`  ${res.count} memories:`));
                res.data.forEach(m => console.log('  ' + kleur.dim(m.id.id.slice(0, 12) + '…') + ' ' + kleur.cyan(m.memoryType.padEnd(10)) + ' ' + truncate(m.content, 60)));
                break;
              }
              case 'search': {
                if (!arg) { console.log(kleur.dim('  Usage: search <text>')); break; }
                const res = await client.get<MemoryListResponse>(`/memories?query=${encodeURIComponent(arg)}&namespace=${ns}&limit=10`);
                console.log(kleur.dim(`  ${res.count} results:`));
                res.data.forEach(m => console.log('  ' + kleur.dim(m.id.id.slice(0, 12) + '…') + ' ' + truncate(m.content, 70)));
                break;
              }
              case 'forget': {
                if (!arg) { console.log(kleur.dim('  Usage: forget <id>')); break; }
                await client.delete(`/memories/${ns}/${arg}`);
                console.log(kleur.green('  ✓') + ' Forgotten ' + arg);
                break;
              }
              case 'relate': {
                const parts = rest;
                if (parts.length < 2) { console.log(kleur.dim('  Usage: relate <id1> <id2> [type]')); break; }
                await client.post('/memories/relations', {
                  fromMemoryId: parts[0], fromNamespace: ns,
                  toMemoryId: parts[1], toNamespace: ns,
                  relationType: parts[2] ?? 'related_to', strength: 0.8, bidirectional: true,
                });
                console.log(kleur.green('  ✓') + ` ${parts[0]} ↔ ${parts[1]} (${parts[2] ?? 'related_to'})`);
                break;
              }
              case 'stats': {
                const s = await client.get<StatsResponse>('/stats');
                console.log('  Total: ' + s.total + ' | ns "' + ns + '": ' + (s.byNamespace[ns] ?? 0));
                console.log('  ' + Object.entries(s.byType).map(([t, c]) => `${t}:${c}`).join('  '));
                break;
              }
              case 'ns':
                if (rest[0]) { ns = rest[0]; console.log('  Switched to namespace: ' + ns); }
                else console.log('  Namespace: ' + ns);
                break;
              case 'exit':
              case 'quit':
              case 'q':
                console.log(kleur.dim('  Bye!'));
                rl.close();
                return;
              default:
                console.log(kleur.dim(`  Unknown: ${cmd}. Type "help".`));
            }
          } catch (err: any) {
            console.log(kleur.red('  ✗') + ' ' + (err.message ?? String(err)));
          }
        }
      } catch (e) {
        handleError(e, { json: false });
      }
    });
}

// ── export ─────────────────────────────────────────────────────────────────────

export function registerMemoryExportCommand(parent: Command): void {
  parent
    .command('export <namespace>')
    .description('Export memories from a namespace')
    .option('--format <fmt>', 'Export format: json|pmf', 'json')
    .option('--output <path>', 'Output file path')
    .option('--embeddings', 'Include embeddings in export')
    .option('--profile <name>', 'CLI profile to use')
    .action(async (namespace: string, opts) => {
      try {
        const { client } = await getClient(opts);
        const isPmf = opts.format === 'pmf';
        const path = isPmf
          ? `/memories/export/${namespace}/pmf`
          : `/memories/export/${namespace}`;
        const params = new URLSearchParams();
        if (opts.embeddings) params.set('includeEmbeddings', 'true');
        const url = params.size > 0 ? `${path}?${params}` : path;
        const data = await client.get<unknown>(url);

        const defaultName = isPmf ? `${namespace}-export.pmf.json` : `${namespace}-export.json`;
        const outPath = opts.output ?? defaultName;
        const { writeFileSync } = await import('node:fs');
        writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');
        console.log(kleur.green('✓') + ` Exported namespace "${namespace}" → ${outPath}`);
      } catch (e) {
        handleError(e, opts);
      }
    });
}

// ── import ─────────────────────────────────────────────────────────────────────

export function registerMemoryImportCommand(parent: Command): void {
  parent
    .command('import <file>')
    .description('Import memories from a JSON or PMF export file')
    .option('--profile <name>', 'CLI profile to use')
    .action(async (file: string, opts) => {
      try {
        const { readFileSync } = await import('node:fs');
        const raw = readFileSync(file, 'utf-8');
        const data = JSON.parse(raw) as any;

        const { client } = await getClient(opts);
        const isPmf = data?.header?.magic === 'NCPMF';
        const endpoint = isPmf ? '/memories/import/pmf' : '/memories/import';
        const result = await client.post<{ imported: number; skipped: number; errors: number }>(endpoint, data);

        console.log(kleur.green('✓') + ' Import complete');
        console.log('  Imported: ' + kleur.cyan(String(result.imported)));
        console.log('  Skipped:  ' + result.skipped);
        console.log('  Errors:   ' + (result.errors > 0 ? kleur.red(String(result.errors)) : result.errors));
      } catch (e) {
        handleError(e, opts);
      }
    });
}

// ── knowledge upload ───────────────────────────────────────────────────────────

export function registerKnowledgeUploadCommand(parent: Command): void {
  parent
    .command('upload <file>')
    .description('Upload a document to the knowledge base')
    .option('--namespace <ns>', 'Target namespace', 'default')
    .option('--create-memories', 'Automatically create memories from document content')
    .option('--profile <name>', 'CLI profile to use')
    .action(async (file: string, opts) => {
      try {
        const { readFileSync, statSync } = await import('node:fs');
        const { basename } = await import('node:path');
        const profile = await resolveActiveProfile(opts.profile);

        statSync(file); // throws if not found
        const buffer = readFileSync(file);
        const filename = basename(file);

        const boundary = `----NovaCortexBoundary${Date.now()}`;
        const CRLF = '\r\n';

        const fieldPart = (name: string, value: string): Buffer => {
          return Buffer.from(
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
            `${value}${CRLF}`
          );
        };
        const filePart = Buffer.concat([
          Buffer.from(
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
            `Content-Type: application/octet-stream${CRLF}${CRLF}`
          ),
          buffer,
          Buffer.from(CRLF),
        ]);
        const closePart = Buffer.from(`--${boundary}--${CRLF}`);

        const parts: Buffer[] = [
          fieldPart('namespace', opts.namespace ?? 'default'),
        ];
        if (opts.createMemories) parts.push(fieldPart('createMemories', 'true'));
        parts.push(filePart, closePart);

        const body = Buffer.concat(parts);
        const baseUrl = profile.url.replace(/\/$/, '');

        const res = await fetch(`${baseUrl}/knowledge/upload`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${profile.token}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'User-Agent': 'novacortex-cli/1.0.0',
          },
          body,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as any;
          throw new Error(`HTTP ${res.status}: ${err.message ?? err.error ?? res.statusText}`);
        }

        const result = await res.json() as any;
        console.log(kleur.green('✓') + ` Uploaded "${filename}"`);
        console.log('  Document ID: ' + kleur.cyan(result.document?.id ?? result.id ?? '?'));
        if (result.memoriesCreated != null)
          console.log('  Memories created: ' + result.memoriesCreated);
      } catch (e) {
        handleError(e, opts);
      }
    });
}

// ── helpers ────────────────────────────────────────────────────────────────────

function handleError(e: unknown, opts: { json?: boolean }): void {
  if (e instanceof CliError) {
    failure(e.code, e.message, undefined, { json: opts.json });
    process.exit(e.exitCode);
  }
  failure('error', e instanceof Error ? e.message : String(e), undefined, { json: opts.json });
  process.exit(1);
}
