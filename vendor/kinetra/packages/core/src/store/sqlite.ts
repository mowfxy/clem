/**
 * Local SQLite store.
 *
 * Thin wrapper around the Node 25 `node:sqlite` module. Falls back to a
 * pure-JS in-memory shim when `node:sqlite` is unavailable so unit tests
 * can run anywhere.
 *
 * The in-memory shim is intentionally minimal but covers the operations
 * Kinetra needs: SELECT with WHERE / ORDER BY / LIMIT / aggregates, INSERT
 * (with INSERT OR REPLACE), UPDATE, DELETE, CREATE TABLE, CREATE INDEX
 * (no-op), DROP TABLE. The WHERE clause supports =, <, >, <=, >=, IS
 * NULL, IS NOT NULL, IN, LIKE, AND, OR.
 */

import { KinetraError } from "../errors.js";

export interface SqliteRunResult { changes: number; lastInsertRowid: number; }

export interface SqliteStmt {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

export interface SqliteDb {
  prepare(sql: string): SqliteStmt;
  exec(sql: string): void;
  close(): void;
  changes(): number;
  transaction?(): () => void;
}

let _moduleLoadAttempted = false;
let _moduleLoadable: boolean | null = null;
let _nodeSqlite: typeof import("node:sqlite") | null = null;

export function isNativeSqliteAvailable(): boolean {
  if (!_moduleLoadAttempted) {
    _moduleLoadAttempted = true;
    try {
      const req = (0, eval)("require") as NodeRequire;
      _nodeSqlite = req("node:sqlite") as typeof import("node:sqlite");
      _moduleLoadable = true;
    } catch {
      _moduleLoadable = false;
    }
  }
  return _moduleLoadable === true && _nodeSqlite !== null;
}

export function openSqlite(path: string): SqliteDb {
  if (!isNativeSqliteAvailable()) {
    return new InMemorySqlite();
  }
  const { DatabaseSync } = _nodeSqlite!;
  return new NodeSqliteAdapter(new DatabaseSync(path));
}

class NodeSqliteAdapter implements SqliteDb {
  private db: {
    prepare(s: string): unknown;
    exec(s: string): void;
    close(): void;
  };
  private lastChanges = 0;
  private lastRowid = 0;
  constructor(db: unknown) { this.db = db as never; }
  prepare(sql: string): SqliteStmt {
    const stmt = (this.db as {
      prepare(s: string): unknown;
    }).prepare(sql) as {
      run(...p: unknown[]): unknown;
      get(...p: unknown[]): unknown;
      all(...p: unknown[]): unknown[];
    };
    const self = this;
    return {
      run(...p: unknown[]) {
        const r = stmt.run(...p) as { changes?: number; lastInsertRowid?: number | bigint };
        self.lastChanges = r.changes ?? 0;
        self.lastRowid = typeof r.lastInsertRowid === "bigint" ? Number(r.lastInsertRowid) : (r.lastInsertRowid ?? 0);
        return { changes: self.lastChanges, lastInsertRowid: self.lastRowid };
      },
      get(...p: unknown[]) { return (stmt.get(...p) as Record<string, unknown> | undefined) ?? undefined; },
      all(...p: unknown[]) { return (stmt.all(...p) as Record<string, unknown>[]) ?? []; },
    };
  }
  exec(sql: string) { (this.db as { exec(s: string): void }).exec(sql); }
  close() { (this.db as { close(): void }).close(); }
  changes(): number { return this.lastChanges; }
}

interface InMemoryTable {
  cols: string[];
  primaryKey: string[];
  rows: Record<string, unknown>[];
}

export class InMemorySqlite implements SqliteDb {
  private tables = new Map<string, InMemoryTable>();
  private lastChanges = 0;
  private lastRowid = 0;
  prepare(sql: string): SqliteStmt {
    return new InMemoryStmt(this, sql);
  }
  exec(sql: string): void {
    for (const stmt of splitSql(sql)) {
      if (stmt.trim().length === 0) continue;
      this.prepare(stmt).run();
    }
  }
  close(): void { /* noop */ }
  changes(): number { return this.lastChanges; }
  internalSetChanges(n: number): void { this.lastChanges = n; }
  internalSetRowid(n: number): void { this.lastRowid = n; }
  internalTable(name: string): InMemoryTable {
    const t = this.tables.get(name);
    if (!t) throw new KinetraError("internal", `unknown table ${name}`);
    return t;
  }
  internalCreate(name: string, cols: string[], primaryKey: string[]): void {
    if (!this.tables.has(name)) this.tables.set(name, { cols, primaryKey, rows: [] });
  }
}
class InMemoryStmt implements SqliteStmt {
  private db: InMemorySqlite;
  private sql: string;
  constructor(db: InMemorySqlite, sql: string) {
    this.db = db;
    this.sql = sql;
  }
  run(...params: unknown[]): SqliteRunResult {
    const parsed = parseSql(this.sql, params);
    this.db.internalSetChanges(0);
    this.db.internalSetRowid(0);
    if (parsed.kind === "create") {
      this.db.internalCreate(parsed.table, parsed.columns, parsed.primaryKey);
      return { changes: 0, lastInsertRowid: 0 };
    }
    if (parsed.kind === "drop" || parsed.kind === "noop") {
      return { changes: 0, lastInsertRowid: 0 };
    }
    if (parsed.kind === "select") {
      return { changes: 0, lastInsertRowid: 0 };
    }
    if (parsed.kind === "insert") {
      const t = this.db.internalTable(parsed.table);
      const newRow: Record<string, unknown> = {};
      for (let i = 0; i < parsed.columns.length; i++) {
        newRow[parsed.columns[i]] = parsed.values[i];
      }
      if (parsed.mode === "replace") {
        if (t.primaryKey.length > 0) {
          const idx = findRowIndex(t, t.primaryKey, newRow);
          if (idx >= 0) {
            t.rows[idx] = newRow;
            this.db.internalSetChanges(1);
            return { changes: 1, lastInsertRowid: idx + 1 };
          }
        }
      }
      t.rows.push(newRow);
      this.db.internalSetChanges(1);
      this.db.internalSetRowid(t.rows.length);
      return { changes: 1, lastInsertRowid: t.rows.length };
    }
    if (parsed.kind === "update") {
      const t = this.db.internalTable(parsed.table);
      const w = parsed.where ?? (() => true);
      let changes = 0;
      for (const r of t.rows) {
        if (w(r)) {
          for (const [k, v] of Object.entries(parsed.assign)) r[k] = v;
          changes++;
        }
      }
      this.db.internalSetChanges(changes);
      return { changes, lastInsertRowid: 0 };
    }
    if (parsed.kind === "delete") {
      const t = this.db.internalTable(parsed.table);
      const w = parsed.where ?? (() => true);
      const before = t.rows.length;
      t.rows = t.rows.filter((r) => !w(r));
      const changes = before - t.rows.length;
      this.db.internalSetChanges(changes);
      return { changes, lastInsertRowid: 0 };
    }
    throw new KinetraError("parse", "Statement not runnable", { sql: this.sql });
  }
  get(...params: unknown[]): Record<string, unknown> | undefined {
    const parsed = parseSql(this.sql, params);
    if (parsed.kind !== "select") throw new KinetraError("parse", "Not a SELECT", { sql: this.sql });
    const t = this.db.internalTable(parsed.table);
    const filtered = t.rows.filter(parsed.where ?? (() => true));
    if (parsed.aggregate) {
      if (parsed.aggregate.kind === "count") {
        if (parsed.groupBy) {
          const map = new Map<string, number>();
          for (const r of filtered) {
            const k = String(r[parsed.groupBy.col] ?? "");
            map.set(k, (map.get(k) ?? 0) + 1);
          }
          const rows = Array.from(map.entries()).map(([k, n]) => ({ [parsed.groupBy.alias]: k, [parsed.aggregate.alias]: n }));
          return sortRowsGeneric(rows, parsed.orderBy)[0];
        }
        const row = { [parsed.aggregate.alias]: filtered.length };
        return sortRowsGeneric([row], parsed.orderBy)[0];
      }
      if (parsed.aggregate.kind === "max") {
        let m: number | null = null;
        for (const r of filtered) {
          const v = Number(r[parsed.aggregate.col]);
          if (Number.isFinite(v) && (m === null || v > m)) m = v;
        }
        const row = { [parsed.aggregate.alias]: m };
        return sortRowsGeneric([row], parsed.orderBy)[0];
      }
    }
    const sorted = sortRowsGeneric(filtered, parsed.orderBy);
    const rows = parsed.limit !== undefined ? sorted.slice(0, parsed.limit) : sorted;
    return rows[0];
  }
  all(...params: unknown[]): Record<string, unknown>[] {
    const parsed = parseSql(this.sql, params);
    if (parsed.kind !== "select") throw new KinetraError("parse", "Not a SELECT", { sql: this.sql });
    const t = this.db.internalTable(parsed.table);
    const filtered = t.rows.filter(parsed.where ?? (() => true));
    if (parsed.aggregate) {
      if (parsed.aggregate.kind === "count") {
        if (parsed.groupBy) {
          const map = new Map<string, number>();
          for (const r of filtered) {
            const k = String(r[parsed.groupBy.col] ?? "");
            map.set(k, (map.get(k) ?? 0) + 1);
          }
          const rows = Array.from(map.entries()).map(([k, n]) => ({ [parsed.groupBy.alias]: k, [parsed.aggregate.alias]: n }));
          const sorted = sortRowsGeneric(rows, parsed.orderBy);
          return parsed.limit !== undefined ? sorted.slice(0, parsed.limit) : rows;
        }
        const row = { [parsed.aggregate.alias]: filtered.length };
        const sorted = sortRowsGeneric([row], parsed.orderBy);
        return parsed.limit !== undefined ? sorted.slice(0, parsed.limit) : sorted;
      }
      if (parsed.aggregate.kind === "max") {
        let m: number | null = null;
        for (const r of filtered) {
          const v = Number(r[parsed.aggregate.col]);
          if (Number.isFinite(v) && (m === null || v > m)) m = v;
        }
        const row = { [parsed.aggregate.alias]: m };
        const sorted = sortRowsGeneric([row], parsed.orderBy);
        return parsed.limit !== undefined ? sorted.slice(0, parsed.limit) : sorted;
      }
    }
    const sorted = sortRowsGeneric(filtered, parsed.orderBy);
    return parsed.limit !== undefined ? sorted.slice(0, parsed.limit) : sorted;
  }
}

function findRowIndex(
  t: InMemoryTable,
  pkCols: string[],
  row: Record<string, unknown>,
): number {
  for (let i = 0; i < t.rows.length; i++) {
    const r = t.rows[i];
    let match = true;
    for (const k of pkCols) {
      if (r[k] !== row[k]) { match = false; break; }
    }
    if (match) return i;
  }
  return -1;
}

type Parsed =
  | { kind: "select"; table: string; where?: (r: Record<string, unknown>) => boolean; orderBy: Array<{ col: string; dir: "ASC" | "DESC" }>; limit?: number; aggregate: { kind: "count" | "max"; alias: string; col: string } | null; groupBy?: { col: string; alias: string } }
  | { kind: "insert"; table: string; columns: string[]; values: unknown[]; mode: "insert" | "replace" }
  | { kind: "update"; table: string; where?: (r: Record<string, unknown>) => boolean; assign: Record<string, unknown> }
  | { kind: "delete"; table: string; where?: (r: Record<string, unknown>) => boolean }
  | { kind: "create"; table: string; columns: string[]; primaryKey: string[] }
  | { kind: "drop"; table: string }
  | { kind: "noop" };

function splitSetAssignments(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") { depth++; buf += c; continue; }
    if (c === ")") { depth--; buf += c; continue; }
    if (c === "," && depth === 0) { out.push(buf); buf = ""; continue; }
    buf += c;
  }
  if (buf.trim().length > 0) out.push(buf);
  return out.map((x) => x.trim());
}

function parseSql(sql: string, params: unknown[]): Parsed {
  const norm = sql.trim().replace(/\s+/g, " ");
  const head = norm.split(" ")[0].toUpperCase();
  if (/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(norm)) {
    return { kind: "noop" };
  }
  if (head === "SELECT") {
    const fromMatch = /FROM\s+([\w"]+)/i.exec(norm);
    if (!fromMatch) throw new KinetraError("parse", "SELECT without FROM", { sql });
    const table = fromMatch[1].replace(/"/g, "");
    const orderByMatch = /ORDER\s+BY\s+(.+?)(?=\s+LIMIT\b|;|$)/i.exec(norm);
    const limitMatch = /LIMIT\s+(\d+)/i.exec(norm);
    let stripped = norm;
    if (orderByMatch) stripped = stripped.replace(orderByMatch[0], "");
    if (limitMatch) stripped = stripped.replace(limitMatch[0], "");
    const fromMatch2 = /FROM\s+[\w"]+/i.exec(stripped);
    const whereStart = fromMatch2 ? fromMatch2.index + fromMatch2[0].length : 0;
    const where = extractWhere(stripped, params, 0, whereStart);
    const orderBy = parseOrderBy(orderByMatch ? orderByMatch[1] : null);
    const limit = limitMatch ? Number(limitMatch[1]) : undefined;
    const aggMatch = /(COUNT|MAX)\s*\(\s*(\*|\w+)\s*\)(?:\s+AS\s+([\w"]+))?/i.exec(norm);
    let aggregate: { kind: "count" | "max"; alias: string; col: string } | null = null;
    if (aggMatch) {
      const fn = aggMatch[1].toUpperCase();
      const col = aggMatch[2];
      const alias = (aggMatch[3] || (fn === "MAX" ? "v" : "n")).replace(/"/g, "");
      aggregate = { kind: fn === "MAX" ? "max" : "count", alias, col };
    }
    const groupMatch = /GROUP\s+BY\s+([\w"]+)(?:\s+AS\s+([\w"]+))?/i.exec(stripped);
    const groupBy = groupMatch
      ? { col: groupMatch[1].replace(/"/g, ""), alias: (groupMatch[2] || groupMatch[1]).replace(/"/g, "") }
      : undefined;
    return { kind: "select", table, where, orderBy, limit, aggregate, groupBy };
  }
  if (head === "INSERT") {
    const m = /INSERT(?:\s+OR\s+REPLACE)?\s+INTO\s+([\w"]+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i.exec(norm);
    if (!m) throw new KinetraError("parse", "Bad INSERT", { sql });
    const table = m[1].replace(/"/g, "");
    const columns = splitCols(m[2]);
    const placeholders = countPlaceholders(m[3]);
    if (placeholders !== params.length) {
      throw new KinetraError("internal", "Parameter count mismatch", { expected: placeholders, got: params.length });
    }
    const mode = /INSERT\s+OR\s+REPLACE/i.test(norm) ? "replace" : "insert";
    return { kind: "insert", table, columns, values: params, mode };
  }
  if (head === "UPDATE") {
    const m = /UPDATE\s+([\w"]+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i.exec(norm);
    if (!m) throw new KinetraError("parse", "Bad UPDATE", { sql });
    const table = m[1].replace(/"/g, "");
    const assign: Record<string, unknown> = {};
    const assigns = splitSetAssignments(m[2]);
    let p = 0;
    for (const a of assigns) {
      const eq = a.indexOf("=");
      if (eq < 0) continue;
      const col = a.slice(0, eq).trim();
      const rhs = a.slice(eq + 1).trim();
      if (rhs === "?") { assign[col] = params[p++]; }
      else if (/^-?\d+(?:\.\d+)?$/.test(rhs)) { assign[col] = Number(rhs); }
      else {
        // Consume any `?` placeholders inside function-call or expression RHS so
        // that the WHERE-clause param index stays aligned with the caller's
        // bound params. For unknown expressions (e.g. COALESCE(?, col)) the
        // in-memory shim does not evaluate SQL functions, so it must leave
        // the column unchanged rather than write the literal expression
        // string into the row.
        const placeholders = (rhs.match(/\?/g) || []).length;
        for (let k = 0; k < placeholders; k++) p++;
      }
    }
    const where = m[3] ? extractWhere("SELECT 1 FROM x WHERE " + m[3], params, p) : undefined;
    return { kind: "update", table, where, assign };
  }
  if (head === "DELETE") {
    const m = /DELETE\s+FROM\s+([\w"]+)(?:\s+WHERE\s+(.+))?$/i.exec(norm);
    if (!m) throw new KinetraError("parse", "Bad DELETE", { sql });
    const table = m[1].replace(/"/g, "");
    const where = m[2] ? extractWhere("SELECT 1 FROM x WHERE " + m[2], params, 0) : undefined;
    return { kind: "delete", table, where };
  }
  if (head === "CREATE") {
    const m = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([\w"]+)\s*\((.+)\)\s*$/i.exec(norm);
    if (!m) throw new KinetraError("parse", "Bad CREATE", { sql });
    const table = m[1].replace(/"/g, "");
    const colDefs = splitCols(m[2]);
    const columns: string[] = [];
    const primaryKey: string[] = [];
    for (const cd of colDefs) {
      const parts = cd.split(/\s+/);
      columns.push(parts[0]);
      if (/PRIMARY\s+KEY/i.test(cd)) primaryKey.push(parts[0]);
      const pkInline = /PRIMARY\s+KEY\s*\(([^)]+)\)/i.exec(cd);
      if (pkInline) {
        for (const c of pkInline[1].split(",").map((s) => s.trim().replace(/"/g, ""))) {
          if (!primaryKey.includes(c)) primaryKey.push(c);
        }
      }
    }
    return { kind: "create", table, columns, primaryKey };
  }
  if (head === "DROP") {
    const m = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w"]+)/i.exec(norm);
    if (!m) throw new KinetraError("parse", "Bad DROP", { sql });
    return { kind: "drop", table: m[1].replace(/"/g, "") };
  }
  throw new KinetraError("parse", "Unsupported SQL", { sql });
}

function splitCols(s: string): string[] {
  return s.split(",").map((c) => c.trim().replace(/"/g, ""));
}

function countPlaceholders(s: string): number {
  return (s.match(/\?/g) ?? []).length;
}

function extractWhere(norm: string, params: unknown[], startIdx: number, whereStart?: number): (r: Record<string, unknown>) => boolean {
  const slice = whereStart !== undefined ? norm.slice(whereStart) : norm;
  const m = /WHERE\s+(.+)$/i.exec(slice);
  if (!m) return () => true;
  const cond = m[1].trim();
  const tree = splitWhereClauses(cond);
  return evalWhereTree(tree, params, startIdx).fn;
}

type WhereTreeItem =
  | { op: "AND"; clause: string }
  | { op: "OR" }
  | { op: "GROUP_OPEN" }
  | { op: "GROUP_CLOSE" };

function splitWhereClauses(cond: string): WhereTreeItem[] {
  const out: WhereTreeItem[] = [];
  let depth = 0;
  let inStr = false;
  let buf = "";
  for (let i = 0; i < cond.length; i++) {
    const c = cond[i];
    if (c === "'") inStr = !inStr;
    if (!inStr) {
      if (c === "(") { if (depth === 0) { if (buf.trim().length > 0) { out.push({ op: "AND", clause: buf.trim() }); buf = ""; } out.push({ op: "GROUP_OPEN" }); depth++; continue; } depth++; continue; }
      else if (c === ")") { if (depth === 1) { if (buf.trim().length > 0) { out.push({ op: "AND", clause: buf.trim() }); buf = ""; } out.push({ op: "GROUP_CLOSE" }); depth--; continue; } depth--; }
    }
    if (!inStr && depth <= 1 && /\s/.test(c)) {
      const rest = cond.slice(i);
      const m = /^\s+(AND|OR)\s+/i.exec(rest);
      if (m) {
        if (buf.trim().length > 0) {
          out.push({ op: "AND", clause: buf.trim() });
          buf = "";
        }
        out.push({ op: m[1].toUpperCase() as "OR" | "AND" });
        i += m[0].length - 1;
        continue;
      }
    }
    buf += c;
  }
  if (buf.trim().length > 0) out.push({ op: "AND", clause: buf.trim() });
  return out;
}

function evalWhereTree(tree: WhereTreeItem[], params: unknown[], startIdx: number): { fn: (r: Record<string, unknown>) => boolean; nextIdx: number } {
  // First, parse tree into a sequence of AND-groups separated by ORs.
  // groupFns[i] is a list of test fns ANDed together.
  let p = startIdx;
  const groups: Array<{ fns: Array<(r: Record<string, unknown>) => boolean> }> = [];
  let current: Array<(r: Record<string, unknown>) => boolean> = [];
  let i = 0;
  // strip outer GROUP_OPEN/CLOSE if present
  if (tree.length > 0 && tree[0].op === "GROUP_OPEN" && tree[tree.length - 1].op === "GROUP_CLOSE") {
    tree = tree.slice(1, -1);
  }
  while (i < tree.length) {
    const item = tree[i];
    if (item.op === "AND") {
      if (item.clause === undefined) { i++; continue; }
      const sub = buildConditionTest(item.clause, params, p);
      p = sub.nextIdx;
      current.push(sub.fn);
      i++;
    } else if (item.op === "OR") {
      groups.push({ fns: current });
      current = [];
      i++;
    } else if (item.op === "GROUP_OPEN") {
      // find matching GROUP_CLOSE
      let depth = 1; let j = i + 1;
      while (j < tree.length && depth > 0) {
        if (tree[j].op === "GROUP_OPEN") depth++;
        else if (tree[j].op === "GROUP_CLOSE") depth--;
        if (depth === 0) break;
        j++;
      }
      const sub = evalWhereTree(tree.slice(i + 1, j), params, p);
      p = sub.nextIdx;
      current.push(sub.fn);
      i = j + 1;
    } else {
      i++;
    }
  }
  groups.push({ fns: current });
  return {
    fn: (r) => groups.some((g) => g.fns.every((f) => f(r))),
    nextIdx: p,
  };
}

function buildConditionTest(clause: string, params: unknown[], p: number): { fn: (r: Record<string, unknown>) => boolean; nextIdx: number } {
  const t = clause.trim();
  // IS NULL / IS NOT NULL
  const isNull = /^([\w"]+)\s+IS\s+NULL$/i.exec(t);
  if (isNull) {
    const col = isNull[1].replace(/"/g, "");
    return { fn: (r) => r[col] === null || r[col] === undefined, nextIdx: p };
  }
  const isNotNull = /^([\w"]+)\s+IS\s+NOT\s+NULL$/i.exec(t);
  if (isNotNull) {
    const col = isNotNull[1].replace(/"/g, "");
    return { fn: (r) => r[col] !== null && r[col] !== undefined, nextIdx: p };
  }
  // IN (?, ?, ?)
  const inQ = /^([\w"]+)\s+IN\s*\(([^)]+)\)$/i.exec(t);
  if (inQ) {
    const col = inQ[1].replace(/"/g, "");
    const items = inQ[2].split(",").map((x) => x.trim());
    const values: unknown[] = [];
    for (const item of items) {
      const lit = /^(\d+|'[^']*')$/.exec(item);
      if (lit) {
        values.push(lit[1].startsWith("'") ? lit[1].slice(1, -1) : Number(lit[1]));
      } else if (item === "?") {
        values.push(params[p++]);
      } else {
        throw new KinetraError("parse", "Unsupported WHERE clause", { cond: t });
      }
    }
    return { fn: (r) => values.includes(r[col]), nextIdx: p };
  }
  // LIKE ? / LIKE 'pattern'
  const likeM = /^([\w"]+)\s+LIKE\s+(\?|'[^']*')$/i.exec(t);
  if (likeM) {
    const col = likeM[1].replace(/"/g, "");
    let pat: string;
    if (likeM[2] === "?") {
      pat = String(params[p++]);
    } else {
      pat = likeM[2].slice(1, -1);
    }
    const re = new RegExp("^" + likePatternToRegex(pat) + "$", "i");
    return { fn: (r) => typeof r[col] === "string" && re.test(String(r[col])), nextIdx: p };
  }
  // <, <=, >, >=
  const cmp = /^([\w"]+)\s+(<=|>=|<|>)\s*(\?|'[^']*'|\d+)$/.exec(t);
  if (cmp) {
    const col = cmp[1].replace(/"/g, "");
    const op = cmp[2];
    let rhs: number | string;
    if (cmp[3] === "?") {
      rhs = params[p++] as number | string;
    } else if (cmp[3].startsWith("'")) {
      rhs = cmp[3].slice(1, -1);
    } else {
      rhs = Number(cmp[3]);
    }
    return { fn: (r) => compare(r[col], op, rhs), nextIdx: p };
  }
  // = ? / = literal
  const eq = /^([\w"]+)\s*=\s*\?$/.exec(t);
  if (eq) {
    const col = eq[1].replace(/"/g, "");
    const v = params[p++];
    return { fn: (r) => r[col] === v, nextIdx: p };
  }
  const lit = /^([\w"]+)\s*=\s*(\d+|'[^']*')$/.exec(t);
  if (lit) {
    const col = lit[1].replace(/"/g, "");
    const val = lit[2].startsWith("'") ? lit[2].slice(1, -1) : Number(lit[2]);
    return { fn: (r) => r[col] === val, nextIdx: p };
  }
  throw new KinetraError("parse", "Unsupported WHERE clause", { cond: t });
}

function likePatternToRegex(pat: string): string {
  // Escape regex specials, then translate % -> .*, _ -> .
  return pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
}

function compare(a: unknown, op: string, b: number | string): boolean {
  const an = (typeof a === "number") ? a : (typeof a === "string" && a.trim() !== "" && !isNaN(Number(a)) ? Number(a) : null);
  const bn = (typeof b === "number") ? b : (typeof b === "string" && b.trim() !== "" && !isNaN(Number(b)) ? Number(b) : null);
  if (an !== null && bn !== null) {
    if (op === "<") return an < bn;
    if (op === "<=") return an <= bn;
    if (op === ">") return an > bn;
    if (op === ">=") return an >= bn;
  }
  const as = (a === null || a === undefined) ? "" : String(a);
  const bs = (b === null || b === undefined) ? "" : String(b);
  if (op === "<") return as < bs;
  if (op === "<=") return as <= bs;
  if (op === ">") return as > bs;
  if (op === ">=") return as >= bs;
  return false;
}

function parseOrderBy(text: string | null): Array<{ col: string; dir: "ASC" | "DESC" }> {
  if (!text) return [];
  const out: Array<{ col: string; dir: "ASC" | "DESC" }> = [];
  for (const part of text.split(",")) {
    const m = /^\s*([\w"]+)(?:\s+(ASC|DESC))?\s*$/i.exec(part);
    if (m) {
      out.push({ col: m[1].replace(/"/g, ""), dir: (m[2] || "ASC").toUpperCase() as "ASC" | "DESC" });
    }
  }
  return out;
}

function sortRowsGeneric(rows: Record<string, unknown>[], orderBy: Array<{ col: string; dir: "ASC" | "DESC" }>): Record<string, unknown>[] {
  if (orderBy.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const o of orderBy) {
      const av = a[o.col];
      const bv = b[o.col];
      const an = (av === null || av === undefined) ? null : Number(av);
      const bn = (bv === null || bv === undefined) ? null : Number(bv);
      let cmp = 0;
      if (an !== null && bn !== null && !isNaN(an) && !isNaN(bn)) {
        cmp = an - bn;
      } else {
        const as = (av === null || av === undefined) ? "" : String(av);
        const bs = (bv === null || bv === undefined) ? "" : String(bv);
        cmp = as < bs ? -1 : (as > bs ? 1 : 0);
      }
      if (cmp !== 0) return o.dir === "DESC" ? -cmp : cmp;
    }
    return 0;
  });
}

function splitSql(sql: string): string[] {

  const out: string[] = [];
  let depth = 0;
  let buf = "";
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") inStr = !inStr;
    if (!inStr && c === "(") depth++;
    else if (!inStr && c === ")") depth--;
    if (!inStr && c === ";" && depth === 0) { out.push(buf); buf = ""; continue; }
    buf += c;
  }
  if (buf.trim().length > 0) out.push(buf);
  return out;
}
