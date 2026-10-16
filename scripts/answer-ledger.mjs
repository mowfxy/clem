// Prints what Mowr's answers cost on this PC, per AI, from the ledger desktop/answer-ledger.ts keeps (counts only).
// Usage: npm run ledger [-- --last 200] [-- --file path/to/answers.jsonl]
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readLedger, summarizeLedger, LEDGER_FILE } from "../desktop/answer-ledger.ts";

const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const file = option("--file") || join(process.env.APPDATA || join(process.env.HOME || "", ".config"), "mowr-desktop", "logs", LEDGER_FILE);
const last = Number(option("--last")) || 0;
const text = await readFile(file, "utf8").catch(() => "");
let entries = readLedger(text);
if (last) entries = entries.slice(-last);
if (!entries.length) { console.log(`No answers recorded yet in ${file}.`); process.exit(0); }
console.log(`${entries.length} answers from ${new Date(entries[0].at).toISOString().slice(0, 16)} to ${new Date(entries.at(-1).at).toISOString().slice(0, 16)} (${file})`);
console.table(summarizeLedger(entries));
