/**
 * NovaCortex Claude Code hook — captures a coding session into memory.
 *
 * Wire it as a SessionEnd (or Stop) hook in Claude Code settings; on each
 * event it reads the session transcript, distills the conversation via
 * NovaCortex's `/memories/ingest` (LLM fact extraction + append-only conflict
 * resolution, async job — adds no latency to your session), and returns.
 *
 * Config via env:
 *   NOVACORTEX_URL        API base (default http://localhost:3001)
 *   NOVACORTEX_TOKEN      bearer token with memories:write (required)
 *   NOVACORTEX_NAMESPACE  target namespace (default "claude-code")
 *   NOVACORTEX_MAX_TURNS  max transcript turns to send (default 200)
 */
import fs from 'fs';

export interface HookEvent {
  session_id?: string;
  transcript_path?: string;
  hook_event_name?: string;
  cwd?: string;
  [key: string]: unknown;
}

export interface IngestMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string;
}

const MESSAGE_CAP_CHARS = 4000;

/** Extract plain text from a Claude transcript content value (string or block array). */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
          return String((block as { text?: unknown }).text ?? '');
        }
        return ''; // tool_use / tool_result / thinking blocks are skipped
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Parse a Claude Code transcript (JSONL) into ingest messages. Defensive: the
 * transcript format carries meta/tool lines we skip; both `{type, message}`
 * and bare `{role, content}` shapes are handled.
 */
export function parseTranscript(jsonl: string, maxTurns = 200): IngestMessage[] {
  const messages: IngestMessage[] = [];
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = entry['type'];
    if (type !== 'user' && type !== 'assistant' && type !== 'human') continue;

    const message = (entry['message'] ?? entry) as Record<string, unknown>;
    const role = (message['role'] ?? type) as string;
    if (role !== 'user' && role !== 'assistant') continue;

    const text = textOf(message['content']).trim();
    if (!text) continue;
    // Skip harness-injected meta content, not real conversation.
    if (text.startsWith('<command-name>') || text.startsWith('<local-command')) continue;
    if (text.startsWith('Caveat: The messages below')) continue;

    messages.push({
      role: role as 'user' | 'assistant',
      content: text.slice(0, MESSAGE_CAP_CHARS),
      ...(typeof entry['timestamp'] === 'string' ? { timestamp: entry['timestamp'] as string } : {}),
    });
  }
  // Keep the most recent turns — the end of a session carries the decisions.
  return messages.slice(-maxTurns);
}

export interface HookResult {
  ok: boolean;
  detail: string;
}

/** Run the hook: read the transcript, ship it to /memories/ingest (async job). */
export async function runHook(
  event: HookEvent,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<HookResult> {
  const token = env['NOVACORTEX_TOKEN'];
  if (!token) return { ok: false, detail: 'NOVACORTEX_TOKEN not set — skipping capture' };

  const transcriptPath = event.transcript_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return { ok: false, detail: 'no transcript to capture' };
  }

  const maxTurns = parseInt(env['NOVACORTEX_MAX_TURNS'] || '200', 10);
  const messages = parseTranscript(fs.readFileSync(transcriptPath, 'utf-8'), maxTurns);
  if (messages.length === 0) return { ok: false, detail: 'transcript has no conversational turns' };

  const baseUrl = (env['NOVACORTEX_URL'] || 'http://localhost:3001').replace(/\/+$/, '');
  const namespace = env['NOVACORTEX_NAMESPACE'] || 'claude-code';

  try {
    const response = await fetchImpl(`${baseUrl}/memories/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        namespace,
        ...(event.session_id ? { sessionId: event.session_id } : {}),
        agentId: 'claude-code',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      return { ok: false, detail: `ingest returned ${response.status}${body.message ? `: ${body.message}` : ''}` };
    }
    const data = (await response.json()) as { jobId?: string };
    return { ok: true, detail: `captured ${messages.length} turns${data.jobId ? ` (job ${data.jobId})` : ''}` };
  } catch (e) {
    return { ok: false, detail: `ingest failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
