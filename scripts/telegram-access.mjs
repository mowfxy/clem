// Telegram's early access (docs/DESKTOP.md "Telegram"): who signed up, letting someone in, taking it away.
// Usage: npm run telegram:access -- list | approve <email> | remove <email>
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The SQL for one command, or null when it isn't one. The email is checked before it goes into the SQL. */
export function accessSql(command, email = "") {
  if (command === "list") return "SELECT a.user_id, d.email, datetime(a.requested_at/1000,'unixepoch') AS signed_up, datetime(a.approved_at/1000,'unixepoch') AS let_in FROM telegram_access a LEFT JOIN desktop_activity d ON d.user_id=a.user_id ORDER BY a.approved_at IS NOT NULL, a.requested_at;";
  const e = email.toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+$/.test(e)) return null;
  const who = `SELECT user_id FROM desktop_activity WHERE lower(email)='${e}'`, at = "CAST(strftime('%s','now') AS INTEGER)*1000";
  if (command === "approve") return `INSERT INTO telegram_access(user_id,requested_at,approved_at) SELECT user_id,${at},${at} FROM desktop_activity WHERE lower(email)='${e}' ON CONFLICT(user_id) DO UPDATE SET approved_at=COALESCE(approved_at,excluded.approved_at);`;
  if (command === "remove") return ["telegram_access", "telegram_links", "telegram_inbox", "telegram_pairings"].map((t) => `DELETE FROM ${t} WHERE user_id IN (${who});`).join("\n");
  return null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, email] = process.argv.slice(2), sql = accessSql(command, email);
  if (!sql) { console.error("Usage: npm run telegram:access -- list | approve <email> | remove <email>"); process.exit(1); }
  // Changes go through a file, so no shell reads the email; a listing needs --command to print its rows and has no input.
  const dir = mkdtempSync(join(tmpdir(), "clem-tg-")), file = join(dir, "access.sql");
  try {
    writeFileSync(file, sql);
    const r = spawnSync(`npx wrangler d1 execute clem-workspaces --remote ${command === "list" ? `--command "${sql}"` : `--file "${file}"`}`, { stdio: "inherit", shell: true });
    process.exitCode = r.status ?? 1;
    if (!process.exitCode && command !== "list") console.log("Check with `npm run telegram:access -- list`: an email Clem hasn't seen changes nothing.");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
