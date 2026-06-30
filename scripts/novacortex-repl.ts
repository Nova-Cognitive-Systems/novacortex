#!/usr/bin/env npx tsx
/**
 * NovaCortex Interactive REPL
 * Talk to the memory agent directly.
 *
 * Usage: NOVACORTEX_KEY=sk_... npx tsx scripts/novacortex-repl.ts
 */

import * as readline from 'readline';

const API_URL = process.env.NOVACORTEX_URL || 'http://localhost:8080';
const API_KEY = process.env.NOVACORTEX_KEY || '';

async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      ...(opts.headers as Record<string, string>),
    },
  });
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

let NS = 'default';

async function init() {
  if (API_KEY) {
    try {
      const check = await api<{ primaryNamespace: string }>('/api-keys/validate/check');
      if (check.primaryNamespace) {
        NS = check.primaryNamespace;
      }
    } catch { /* use default */ }
  }
}

function help() {
  console.log(`
  Commands:
    store <text>                 Store a semantic memory
    store:episodic <text>        Store an episodic memory
    store:procedural <text>      Store a procedural memory
    recall <id>                  Get memory by ID (with relations)
    list                         List all memories in your namespace
    search <text>                Client-side content search
    tag <id> <tag1,tag2>         Update tags on a memory
    relate <id1> <id2> [type]   Create relation (default: related_to)
    forget <id>                  Delete a memory
    kb                           List knowledge base documents
    kb search <query>            Search knowledge base
    stats                        Show system stats
    ns                           Show current namespace
    help                         This help
    exit                         Quit
`);
}

async function store(content: string, type = 'semantic') {
  const mem = await api<any>('/memories', {
    method: 'POST',
    body: JSON.stringify({ content, memoryType: type, namespace: NS, salience: 5 }),
  });
  console.log(`  ✓ Stored ${mem.id.id} (${type})`);
  return mem;
}

async function recall(id: string) {
  const mem = await api<any>(`/memories/${NS}/${id}?includeRelations=true`);
  if (mem.error) { console.log(`  ✗ ${mem.error}`); return; }
  console.log(`  ┌─ ${mem.id.namespace}:${mem.id.id} (v${mem.version})`);
  console.log(`  │ Type: ${mem.memoryType} | Salience: ${mem.metadata.salience}`);
  console.log(`  │ Tags: ${mem.metadata.tags.length > 0 ? mem.metadata.tags.join(', ') : '(none)'}`);
  console.log(`  │ Content: ${mem.content}`);
  if (mem.relations?.length > 0) {
    console.log(`  │ Relations:`);
    for (const r of mem.relations) {
      console.log(`  │   ${r.relationType} → ${r.toMemory.id}`);
    }
  }
  console.log(`  └─ Created: ${new Date(mem.createdAt).toLocaleString()}`);
}

async function list() {
  const res = await api<any>(`/memories?namespace=${NS}&limit=50`);
  console.log(`  ${res.count} memories in namespace "${NS}":`);
  for (const m of res.data) {
    const tags = m.metadata.tags.length > 0 ? ` [${m.metadata.tags.join(',')}]` : '';
    console.log(`  ${m.id.id} | ${m.memoryType.padEnd(10)} | ${m.content.slice(0, 55)}...${tags}`);
  }
}

async function searchContent(query: string) {
  const res = await api<any>(`/memories?namespace=${NS}&limit=100`);
  const q = query.toLowerCase();
  const matches = res.data.filter((m: any) =>
    m.content.toLowerCase().includes(q) ||
    m.metadata.tags.some((t: string) => t.toLowerCase().includes(q))
  );
  console.log(`  ${matches.length} matches for "${query}":`);
  for (const m of matches) {
    console.log(`  ${m.id.id} | ${m.content.slice(0, 65)}...`);
  }
}

async function main() {
  await init();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => new Promise<string>(resolve => rl.question(`\x1b[36mnovacortex[${NS}]>\x1b[0m `, resolve));

  console.log(`\x1b[1mNovaCortex Interactive Agent\x1b[0m`);
  console.log(`  API: ${API_URL}`);
  console.log(`  Namespace: ${NS}`);
  console.log(`  Key: ${API_KEY ? API_KEY.slice(0, 12) + '...' : '(none)'}`);
  console.log(`  Type "help" for commands.\n`);

  while (true) {
    const input = (await prompt()).trim();
    if (!input) continue;

    const [cmd, ...rest] = input.split(' ');
    const arg = rest.join(' ');

    try {
      switch (cmd) {
        case 'store':
          if (!arg) { console.log('  Usage: store <text>'); break; }
          await store(arg);
          break;
        case 'store:episodic':
          if (!arg) { console.log('  Usage: store:episodic <text>'); break; }
          await store(arg, 'episodic');
          break;
        case 'store:procedural':
          if (!arg) { console.log('  Usage: store:procedural <text>'); break; }
          await store(arg, 'procedural');
          break;
        case 'recall':
          if (!arg) { console.log('  Usage: recall <id>'); break; }
          await recall(arg);
          break;
        case 'list':
          await list();
          break;
        case 'search':
          if (!arg) { console.log('  Usage: search <query>'); break; }
          await searchContent(arg);
          break;
        case 'tag': {
          const [id, tags] = arg.split(' ');
          if (!id || !tags) { console.log('  Usage: tag <id> <tag1,tag2>'); break; }
          await api(`/memories/${NS}/${id}`, {
            method: 'PATCH', body: JSON.stringify({ tags: tags.split(',') }),
          });
          console.log(`  ✓ Tags updated on ${id}`);
          break;
        }
        case 'relate': {
          const parts = arg.split(' ');
          if (parts.length < 2) { console.log('  Usage: relate <id1> <id2> [type]'); break; }
          const [id1, id2, relType] = parts;
          await api('/memories/relations', {
            method: 'POST',
            body: JSON.stringify({
              fromMemoryId: id1, fromNamespace: NS,
              toMemoryId: id2, toNamespace: NS,
              relationType: relType || 'related_to', strength: 0.8, bidirectional: true,
            }),
          });
          console.log(`  ✓ ${id1} ↔ ${id2} (${relType || 'related_to'})`);
          break;
        }
        case 'forget':
          if (!arg) { console.log('  Usage: forget <id>'); break; }
          await api(`/memories/${NS}/${arg}`, { method: 'DELETE' });
          console.log(`  ✓ Forgotten ${arg}`);
          break;
        case 'kb':
          if (rest[0] === 'search') {
            const q = rest.slice(1).join(' ');
            if (!q) { console.log('  Usage: kb search <query>'); break; }
            const sr = await api<any>(`/agent/knowledge/search?q=${encodeURIComponent(q)}`);
            console.log(`  ${sr.totalMatches} matches:`);
            for (const r of sr.results) {
              console.log(`  ${r.filename}:`);
              for (const m of r.matches) console.log(`    ${m.preview}`);
            }
          } else {
            const docs = await api<any>('/agent/knowledge');
            console.log(`  ${docs.documents.length} documents:`);
            for (const d of docs.documents) {
              console.log(`  ${d.id} | ${d.filename} | ${d.chunks} chunks`);
            }
          }
          break;
        case 'stats': {
          const s = await api<any>('/stats');
          console.log(`  Total: ${s.total} | Namespace "${NS}": ${s.byNamespace[NS] || 0}`);
          console.log(`  Types: ${Object.entries(s.byType).map(([t, c]) => `${t}:${c}`).join(', ')}`);
          break;
        }
        case 'ns':
          console.log(`  Namespace: ${NS}`);
          break;
        case 'help':
          help();
          break;
        case 'exit':
        case 'quit':
        case 'q':
          console.log('  Bye!');
          rl.close();
          process.exit(0);
        default:
          console.log(`  Unknown command: ${cmd}. Type "help" for commands.`);
      }
    } catch (e: any) {
      console.log(`  ✗ Error: ${e.message}`);
    }
  }
}

main();
