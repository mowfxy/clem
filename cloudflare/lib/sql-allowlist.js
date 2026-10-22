// The database Worker runs SQL sent by the Clem API (server/d1.ts). It accepts only single SELECT/INSERT/UPDATE/DELETE
// statements over the tables that API uses, so a leaked secret or a compromised API cannot read linked accounts or
// make itself staff (desktop_admins, desktop_owner_grants, provider_links and the rest are refused).
// Keep in step with server/: tests/sql-allowlist.test.ts checks every query the API sends.

/** Tables the API inserts into, updates and deletes from. */
export const writableTables = new Set([
  "clem_users", "clem_credentials", "clem_rate_limits", "clem_workspaces", "clem_scopes", "clem_usage", "clem_files",
  "clem_automations", "clem_security", "clem_email_challenges", "clem_support", "clem_email_log", "clem_email_optout",
  "clem_document_edits", "clem_subscription_sessions", "clem_runtime_budget",
]);
/** Staff email sends are audited (server/staff-emails.ts): the API may add entries, never change or remove them. */
export const insertableTables = new Set([...writableTables, "desktop_audit_log"]);
/** Staff emails also look up a person's address and name; mail retention (server/retention.ts) reads which cases closed. */
export const readableTables = new Set([...insertableTables, "desktop_activity", "desktop_profiles", "clem_support_state"]);

export function allowedStatement(sql) {
  if (typeof sql !== "string" || !sql.trim() || sql.length > 20000) return false;
  // String literals cannot name tables; blank them so their contents are not mistaken for SQL.
  const text = sql.replace(/'(?:[^']|'')*'/g, "''");
  if (/'|;|--|\/\*|["`[]/.test(text.replace(/''/g, ""))) return false;
  const kind = /^\s*(\w+)/.exec(text)?.[1].toUpperCase();
  if (!["SELECT", "INSERT", "UPDATE", "DELETE"].includes(kind)) return false;
  if (/\b(pragma|attach|detach|vacuum|drop|alter|create|reindex|load_extension|sqlite_\w*)\b/i.test(text)) return false;
  // A parenthesised source ("FROM (desktop_admins)") would hide the table name from the checks below: only subqueries.
  if (/\b(FROM|JOIN)\s*\((?!\s*SELECT\b)/i.test(text)) return false;
  // A comma join ("FROM a, b", also after a subquery, NOT INDEXED or an ON/USING constraint) would name a table without
  // FROM or JOIN in front of it, so a comma anywhere in a FROM clause is refused, at every parenthesis depth.
  // WINDOW and RETURNING can also be aliases, so they do not end a FROM clause here (a comma after them is refused too).
  const inFrom = [false];
  for (const [token] of text.matchAll(/\w+|[(),]/g)) {
    if (token === "(") inFrom.push(false);
    else if (token === ")") { inFrom.pop(); if (!inFrom.length) return false; }
    else if (token === ",") { if (inFrom.at(-1)) return false; }
    else if (/^FROM$/i.test(token)) inFrom[inFrom.length - 1] = true;
    else if (/^(WHERE|GROUP|HAVING|ORDER|LIMIT|UNION|INTERSECT|EXCEPT)$/i.test(token)) inFrom[inFrom.length - 1] = false;
  }
  // `x IN table` and the pragma_* table functions read a table without FROM.
  if (/\bIN\s+(?!\()\w+|\bpragma_\w*/i.test(text)) return false;
  if (kind === "DELETE" && !writableTables.has(/^\s*DELETE\s+FROM\s+(\w+)/i.exec(text)?.[1].toLowerCase())) return false;
  for (const [, keyword, name] of text.matchAll(/\b(FROM|INTO|UPDATE|JOIN)\s+(\w+)/gi)) {
    const word = keyword.toUpperCase(), table = name.toLowerCase();
    if (word === "UPDATE" && table === "set") continue; // ON CONFLICT … DO UPDATE SET
    const allowed = word === "FROM" || word === "JOIN" ? readableTables : word === "INTO" ? insertableTables : writableTables;
    if (!allowed.has(table)) return false;
    // Add-only tables: an upsert or INSERT OR REPLACE would change an existing entry.
    if (word === "INTO" && !writableTables.has(table) && /\b(REPLACE|DO\s+UPDATE)\b/i.test(text)) return false;
  }
  return true;
}
