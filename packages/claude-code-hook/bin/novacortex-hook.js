#!/usr/bin/env node
/**
 * Claude Code hook entrypoint: reads the hook event JSON from stdin, ships the
 * session transcript to NovaCortex /memories/ingest, prints a one-line status.
 * Never exits non-zero for capture problems — a memory hiccup must not disturb
 * the coding session.
 */
import { runHook } from '../dist/index.js';

let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', async () => {
  let event = {};
  try {
    event = JSON.parse(input || '{}');
  } catch {
    // no/invalid payload — still attempt with env-only config
  }
  try {
    const result = await runHook(event);
    console.log(`[novacortex-hook] ${result.detail}`);
  } catch (e) {
    console.log(`[novacortex-hook] error: ${e?.message ?? e}`);
  }
  process.exit(0);
});
