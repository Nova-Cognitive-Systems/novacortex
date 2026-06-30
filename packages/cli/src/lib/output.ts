import kleur from 'kleur';

export function success(message: string, data?: unknown, opts?: { json?: boolean }): void {
  if (opts?.json) {
    const payload: Record<string, unknown> = { ok: true, message };
    if (data !== undefined) payload['data'] = data;
    console.log(JSON.stringify(payload));
    return;
  }
  console.log(kleur.green('✓') + ' ' + message);
}

export function failure(code: string, message: string, hint?: string, opts?: { json?: boolean }): void {
  if (opts?.json) {
    const payload: Record<string, unknown> = { ok: false, error: code, message };
    if (hint) payload['hint'] = hint;
    console.error(JSON.stringify(payload));
    return;
  }
  console.error(kleur.red('✗') + ' ' + message);
  if (hint) console.error(kleur.dim('  ' + hint));
}

export function info(message: string): void {
  console.log(kleur.cyan('→') + ' ' + message);
}

export function warn(message: string): void {
  console.warn(kleur.yellow('⚠') + ' ' + message);
}

export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export interface TableColumn<T> {
  header: string;
  key: keyof T | ((row: T) => string);
  width?: number;
}

export function table(rows: Record<string, unknown>[], columns: string[]): string;
export function table<T extends object>(rows: T[], columns: TableColumn<T>[]): string;
export function table(rows: object[], columns: (string | TableColumn<object>)[]): string {
  if (rows.length === 0) {
    return kleur.dim('(no entries)');
  }

  const cols: Array<{ header: string; key: string | ((row: object) => string); width?: number }> =
    columns.map((c) =>
      typeof c === 'string'
        ? { header: (c as string).charAt(0).toUpperCase() + (c as string).slice(1), key: c as string }
        : (c as TableColumn<object>)
    );

  const getValue = (row: object, col: (typeof cols)[0]): string => {
    if (typeof col.key === 'function') return col.key(row);
    const val = (row as Record<string, unknown>)[col.key];
    if (val === null || val === undefined) return '';
    return String(val);
  };

  const widths = cols.map((col) => {
    const maxData = Math.max(...rows.map((r) => getValue(r, col).length));
    return col.width ?? Math.max(col.header.length, maxData);
  });

  const header = cols.map((col, i) => col.header.padEnd(widths[i]!)).join('  ');
  const separator = widths.map((w) => '─'.repeat(w)).join('  ');
  const dataRows = rows.map((row) =>
    cols.map((col, i) => getValue(row, col).padEnd(widths[i]!)).join('  ')
  );

  return [kleur.bold(header), kleur.dim(separator), ...dataRows].join('\n');
}
