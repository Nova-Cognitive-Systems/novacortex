/**
 * Deterministic temporal normalization for text queries — no LLM, no locale
 * service. Recognizes a small, unambiguous set of English time expressions and
 * maps them to a createdAfter filter (benchmark temporal categories punish
 * engines that ignore these cues entirely). Anything it does not positively
 * recognize is left untouched.
 */

export interface ParsedTemporal {
  /** Lower bound derived from the expression (inclusive). */
  createdAfter?: Date;
  /** The query with the recognized expression removed (never empty). */
  cleaned: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface Rule {
  pattern: RegExp;
  since: (now: Date, match: RegExpMatchArray) => Date;
}

const startOfDay = (d: Date): Date => {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
};

const RULES: Rule[] = [
  { pattern: /\btoday\b/i, since: (now) => startOfDay(now) },
  { pattern: /\byesterday\b/i, since: (now) => new Date(startOfDay(now).getTime() - DAY_MS) },
  { pattern: /\b(?:in the |within the )?last (\d{1,3}) days?\b/i, since: (now, m) => new Date(now.getTime() - parseInt(m[1]!, 10) * DAY_MS) },
  { pattern: /\b(\d{1,3}) days? ago\b/i, since: (now, m) => new Date(now.getTime() - parseInt(m[1]!, 10) * DAY_MS) },
  { pattern: /\b(?:in the |within the )?last week\b/i, since: (now) => new Date(now.getTime() - 7 * DAY_MS) },
  { pattern: /\b(?:in the |within the )?past week\b/i, since: (now) => new Date(now.getTime() - 7 * DAY_MS) },
  { pattern: /\bthis week\b/i, since: (now) => new Date(startOfDay(now).getTime() - ((now.getDay() + 6) % 7) * DAY_MS) },
  { pattern: /\b(?:in the |within the )?last month\b/i, since: (now) => new Date(now.getTime() - 30 * DAY_MS) },
  { pattern: /\b(?:in the |within the )?past month\b/i, since: (now) => new Date(now.getTime() - 30 * DAY_MS) },
  { pattern: /\bthis month\b/i, since: (now) => new Date(now.getFullYear(), now.getMonth(), 1) },
  { pattern: /\b(?:in the |within the )?last year\b/i, since: (now) => new Date(now.getTime() - 365 * DAY_MS) },
  { pattern: /\brecently\b/i, since: (now) => new Date(now.getTime() - 14 * DAY_MS) },
];

/**
 * Extract a temporal lower bound from a query. Returns the original query
 * unchanged when no expression is recognized. Only the FIRST match is applied.
 */
export function parseTemporalQuery(query: string, now: Date = new Date()): ParsedTemporal {
  for (const rule of RULES) {
    const match = query.match(rule.pattern);
    if (match) {
      const cleaned = query.replace(rule.pattern, ' ').replace(/\s+/g, ' ').trim();
      return {
        createdAfter: rule.since(now, match),
        // Never hand back an empty query — keep the original if stripping ate it.
        cleaned: cleaned.length > 0 ? cleaned : query,
      };
    }
  }
  return { cleaned: query };
}
