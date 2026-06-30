/**
 * Write-Ahead Log (WAL) for MCP write operations.
 *
 * Provides an audit trail for all mutating tool calls and enables poisoning
 * detection by recording every write with a timestamp, tool name, and args.
 * WAL failure must never block the actual operation — errors are silently swallowed.
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface WalEntry {
  timestamp: string;
  tool: string;
  args: unknown;
}

export function getWalPath(): string {
  const dir = join(homedir(), '.novacortex', 'wal');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return join(dir, 'write_log.jsonl');
}

export function walLog(tool: string, args: unknown): void {
  try {
    const entry: WalEntry = {
      timestamp: new Date().toISOString(),
      tool,
      args,
    };
    const path = getWalPath();
    appendFileSync(path, JSON.stringify(entry) + '\n', { mode: 0o600 });
  } catch {
    // WAL failure must not block the actual operation
  }
}
