/**
 * In-memory SurrealDB-like stub for unit tests.
 * Supports the subset of queries TokenService uses.
 */
export class FakeSurreal {
  private tables: Map<string, Map<string, Record<string, unknown>>> = new Map();
  private idCounter = 0;

  async connect(): Promise<void> {}

  async query<T = unknown>(sql: string, params?: Record<string, unknown>): Promise<T> {
    const trimmed = sql.trim();

    if (/DEFINE TABLE|DEFINE FIELD|DEFINE INDEX|BEGIN|COMMIT|CANCEL/i.test(trimmed)) {
      return [[]] as unknown as T;
    }

    // CREATE tokens SET ...
    const createMatch = trimmed.match(/^CREATE\s+(\w+)\s+SET/i);
    if (createMatch) {
      const table = createMatch[1]!;
      const rows = this.tables.get(table) ?? new Map();
      this.idCounter += 1;
      const id = `${table}:${this.idCounter}`;
      rows.set(id, { id, ...(params ?? {}) });
      this.tables.set(table, rows);
      return [[{ id, ...(params ?? {}) }]] as unknown as T;
    }

    // SELECT * FROM <table> [WHERE ...]
    const selectMatch = trimmed.match(/^SELECT\s+.*\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?/i);
    if (selectMatch) {
      const table = selectMatch[1]!;
      const whereClause = selectMatch[2];
      const rows = Array.from(this.tables.get(table)?.values() ?? []);
      if (!whereClause) return [rows] as unknown as T;
      const filtered = rows.filter((r) => matchesWhere(r, whereClause, params ?? {}));
      return [filtered] as unknown as T;
    }

    // UPDATE <table> SET ... WHERE ...
    const updateMatch = trimmed.match(/^UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
    if (updateMatch) {
      const table = updateMatch[1]!;
      const setClause = updateMatch[2]!;
      const whereClause = updateMatch[3];
      const rows = this.tables.get(table) ?? new Map();
      const matching = Array.from(rows.values()).filter((r) =>
        whereClause ? matchesWhere(r, whereClause, params ?? {}) : true
      );
      for (const row of matching) {
        applySet(row, setClause, params ?? {});
      }
      return [matching] as unknown as T;
    }

    // DELETE FROM <table> WHERE ...
    const deleteMatch = trimmed.match(/^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?/i);
    if (deleteMatch) {
      const table = deleteMatch[1]!;
      const whereClause = deleteMatch[2];
      const rows = this.tables.get(table) ?? new Map();
      if (!whereClause) {
        rows.clear();
        return [[]] as unknown as T;
      }
      for (const [id, row] of rows.entries()) {
        if (matchesWhere(row, whereClause, params ?? {})) rows.delete(id);
      }
      return [[]] as unknown as T;
    }

    return [[]] as unknown as T;
  }

  /** Test introspection — not part of Surreal client API. */
  _getTable(name: string): Array<Record<string, unknown>> {
    return Array.from(this.tables.get(name)?.values() ?? []);
  }

  _seed(table: string, row: Record<string, unknown>): void {
    const rows = this.tables.get(table) ?? new Map();
    const id = (row['id'] as string) ?? `${table}:${++this.idCounter}`;
    rows.set(id, { ...row, id });
    this.tables.set(table, rows);
  }

  _clear(): void {
    this.tables.clear();
    this.idCounter = 0;
  }
}

function matchesWhere(row: Record<string, unknown>, clause: string, params: Record<string, unknown>): boolean {
  // Support a tiny subset: `field = $param`, `field IS NULL`, combined with AND
  const parts = clause.split(/\s+AND\s+/i);
  return parts.every((part) => {
    const isNullMatch = part.match(/(\w+)\s+IS\s+NULL/i);
    if (isNullMatch) return row[isNullMatch[1]!] == null;
    const eqMatch = part.match(/(\w+)\s*=\s*\$(\w+)/);
    if (eqMatch) return row[eqMatch[1]!] === params[eqMatch[2]!];
    // Comparisons like `expiresAt > now` or `revokedAt IS NULL` beyond our subset: accept (true)
    return true;
  });
}

function applySet(row: Record<string, unknown>, clause: string, params: Record<string, unknown>): void {
  const assignments = clause.split(',').map((s) => s.trim());
  for (const assign of assignments) {
    const match = assign.match(/(\w+)\s*=\s*\$(\w+)/);
    if (match) row[match[1]!] = params[match[2]!];
  }
}
