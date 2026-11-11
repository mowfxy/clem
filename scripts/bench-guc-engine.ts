// Measures the GUC engine on a large fake GUC (tests/guc-fake.ts): 3 courses × 12 weeks × 14 files (504 materials),
// 3 announcements a week. Reports requests, bytes, time and SQL statements for the initial sync, an unchanged re-sync and
// a check that finds one new file; the hub's hot reads (ms each); EXPLAIN for the hot queries; the DB size after sync.
// Usage: node --experimental-strip-types scripts/bench-guc-engine.ts [--json]
// docs/PERFORMANCE-GUC-VPS.md has the results; tests/guc-perf.test.ts keeps the request counts and statement budgets.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { urls } from "../core/guc/parse.ts";
import { Engine } from "../desktop/engine/index.ts";
import { fakeGuc, fixture, host, noWait } from "../tests/guc-fake.ts";

export const WEEKS = 12, PER_WEEK = 14;
const pad = (n: number) => String(n).padStart(2, "0");
/** One course page in the CMS's markup with `weeks` × `perWeek` files; `extra` adds one more file to the newest week. */
export function bigCourse(id: number, name: string, o: { weeks?: number; perWeek?: number; extra?: boolean } = {}) {
  const weeks = o.weeks ?? WEEKS, per = o.perWeek ?? PER_WEEK;
  const item = (w: number, i: number) => `<div class="card mb-4"><div class="card-body"><div><strong>${i} - Lecture ${w}.${i} (Lecture slides)</strong></div><div><p>Part ${i}</p></div><div><div><a id="download" class="btn btn-primary" download="Lecture ${w}.${i}" href="/Uploads/${id}/64/l-${w}-${i}.pdf">Download</a><input type="button" id="${id}${pad(w)}${pad(i)}" data-contentid="${id}${pad(w)}${pad(i)}" value="Watch" class="d-none" /></div></div></div></div>`;
  const week = (w: number) => {
    const date = new Date(Date.UTC(2026, 8, 5 + 7 * w)).toISOString().slice(0, 10);
    const items = Array.from({ length: per }, (_, i) => item(w, i + 1)).join("");
    const more = o.extra && w === weeks ? `<div class="card mb-4"><div class="card-body"><div><strong>99 - Sheet ${w} (Assignment)</strong></div><div><p>New</p></div><div><div><a id="download" class="btn btn-primary" download="Sheet ${w}" href="/Uploads/${id}/64/sheet-${w}.pdf">Download</a><input type="button" id="${id}${pad(w)}99" data-contentid="${id}${pad(w)}99" value="Watch" class="d-none" /></div></div></div></div>` : "";
    return `<div class="weeksdata"><div class="p-3"><h2 class="text-big">Week: ${date}</h2></div><div class="p-3 pt-0"><div><strong>Announcement</strong><p class="m-2 p2">Week ${w}: quiz ${w} on Sunday ${5 + w} November 2026. Read chapter ${w}.</p></div><div><strong>Description</strong><p class="m-2 p2">Topic ${w}.</p></div><div><strong>Content:</strong>${items}${more}</div></div></div>`;
  };
  const head = fixture("cms-course").split('<div class="weeksdata">')[0].replace("CSEN701 Embedded Systems Architecture", name);
  return head + Array.from({ length: weeks }, (_, i) => week(weeks - i)).join("") + "</div></form></body></html>";
}
export function bigSite(o: { extra?: boolean } = {}) {
  return {
    [urls.home]: fixture("cms-home"), [urls.schedule]: fixture("schedule"), [urls.transcript]: fixture("transcript"),
    [urls.course(1201, 64)]: bigCourse(1201, "CSEN701 Embedded Systems Architecture", o),
    [urls.course(1202, 64)]: bigCourse(1202, "CSEN702 Microprocessors"),
    [urls.course(1203, 64)]: bigCourse(1203, "CSEN703 Analysis and Design of Algorithms"),
  };
}
const pdf = (s: string) => new TextEncoder().encode("%PDF-1.4 " + s.padEnd(40_000, "."));
export function bigFiles(o: { extra?: boolean } = {}) {
  const files: Record<string, Uint8Array> = {};
  for (let w = 1; w <= WEEKS; w++) for (let i = 1; i <= PER_WEEK; i++) files[`https://cms.guc.edu.eg/Uploads/1201/64/l-${w}-${i}.pdf`] = pdf(`${w}.${i}`);
  if (o.extra) files[`https://cms.guc.edu.eg/Uploads/1201/64/sheet-${WEEKS}.pdf`] = pdf("sheet");
  return files;
}

/** Counts statements a Db runs (the N+1 check). */
function counting(engine: Engine) {
  const db = engine.db as any, q = db.query.bind(db), tx = db.tx.bind(db);
  let n = 0;
  db.query = (...a: unknown[]) => { n++; return q(...a); };
  db.tx = (fn: (d: unknown) => unknown) => tx((inner: any) => { const iq = inner.query.bind(inner); return fn({ ...inner, query: (...a: unknown[]) => { n++; return iq(...a); } }); });
  return () => { const v = n; n = 0; return v; };
}

export async function bench() {
  const dir = await mkdtemp(join(tmpdir(), "clem-bench-"));
  let pages = bigSite(), files = bigFiles();
  const guc = fakeGuc(pages, { etags: true, files });
  const http: typeof guc.http = (r, c) => fakeGuc(pages, { etags: true, files }).http(r, c).then((x) => { guc.log.push({ url: r.url, method: r.method, conditional: !!r.headers?.["If-None-Match"], binary: r.binary }); return x; });
  const h = host({ files: join(dir, "Files") });
  h.paths.data = join(dir, "db");
  const engine = await Engine.open("bench", h, { http, sleep: noWait, jobs: false });
  const statements = counting(engine);
  const out: Record<string, number | string> = {};
  const since = () => { const at = guc.log.length; return () => guc.log.slice(at); };
  try {
    let log = since(), t = performance.now();
    await engine.connect("student.name", "secret");
    await engine.link("s1", "1201:64");
    await (engine as any).light;
    out.initialSyncMs = Math.round(performance.now() - t); out.initialSyncRequests = log().length; out.initialSyncStatements = statements();

    log = since(); t = performance.now();
    await engine.sync();
    out.resyncMs = Math.round(performance.now() - t); out.resyncRequests = log().length; out.resyncStatements = statements();

    // First check saves every file (168 × 40 KB), then the page gains one file.
    await engine.setSettings("s1", { save: { kinds: { slides: true, assignments: true, sheets: true, other: true } } });
    statements(); log = since(); t = performance.now();
    const first = await engine.check("s1", "now");
    out.firstCheckMs = Math.round(performance.now() - t); out.firstCheckRequests = log().length; out.firstCheckBytes = first?.bytes || 0; out.firstCheckStatements = statements();
    pages = bigSite({ extra: true }); files = bigFiles({ extra: true });
    log = since(); t = performance.now();
    const one = await engine.check("s1", "schedule");
    out.oneNewFileMs = Math.round(performance.now() - t); out.oneNewFileRequests = log().length; out.oneNewFileBytes = one?.bytes || 0; out.oneNewFileSaved = one?.saved || 0; out.oneNewFileStatements = statements();
    log = since(); t = performance.now();
    await engine.check("s1", "schedule");
    out.unchangedCheckMs = Math.round(performance.now() - t); out.unchangedCheckRequests = log().length; out.unchangedCheckStatements = statements();

    const inbox = await engine.inbox(); statements();
    await engine.ackInbox(inbox.map((i) => i.key));
    out.ackInboxItems = inbox.length; out.ackInboxStatements = statements();

    const time = async (name: string, fn: () => Promise<unknown>) => { await fn(); const t0 = performance.now(); for (let i = 0; i < 5; i++) await fn(); out[name] = +((performance.now() - t0) / 5).toFixed(2); };
    await time("readOverviewMs", () => engine.overview());
    await time("readCoursesMs", () => engine.courses());
    await time("readMaterialsMs", () => engine.materials("1201:64"));
    await time("readAnnouncementsMs", () => engine.announcements());
    await time("readSearchMs", () => engine.search("lecture 7"));
    await time("readInboxMs", () => engine.inbox());
    await time("readNowMs", () => engine.now());
    await time("readSubjectMs", () => engine.subject("s1"));
    out.materials = (await engine.db.query<{ n: number }>("select count(*)::int as n from guc_materials"))[0].n;

    const plans: Record<string, string> = {};
    const explain = async (name: string, sql: string, params: unknown[]) => {
      await engine.db.query("set enable_seqscan = off");
      const rows = await engine.db.query<{ "QUERY PLAN": string }>("explain " + sql, params);
      await engine.db.query("set enable_seqscan = on");
      plans[name] = rows.map((r) => r["QUERY PLAN"]).join("\n");
    };
    await explain("materials by course", "select material_id from guc_materials where owner_id = $1 and course_key = $2", ["bench", "1201:64"]);
    await explain("announcements newest", "select announcement_id from guc_announcements a where a.owner_id = $1 order by date_trunc('milliseconds', a.first_seen) desc, a.announcement_id desc limit 41", ["bench"]);
    await explain("events since", "select event_key from guc_events where owner_id = $1 and created_at > $2 order by created_at limit 300", ["bench", new Date(0)]);
    const size = await engine.db.query<{ size: string }>("select pg_size_pretty(pg_database_size(current_database())) as size");
    out.dbSize = size[0].size;
    return { out, plans };
  } finally {
    await engine.close();
    await rm(dir, { recursive: true, force: true });
  }
}

if (/bench-guc-engine.ts$/.test(process.argv[1] || "")) {
  const { out, plans } = await bench();
  if (process.argv.includes("--json")) console.log(JSON.stringify(out));
  else { console.table(out); for (const [k, v] of Object.entries(plans)) console.log(`\n${k}:\n${v}`); }
}
