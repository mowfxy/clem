// HTML parsers for GUC's CMS and student portal. The CMS layout (season headers, course grid, weeksdata blocks,
// a#download, the course description box) follows AhmedAshrafAZ/cms-downloader (MIT, see THIRD-PARTY-NOTICES.md);
// the schedule and transcript tables follow the GroupSchedule.aspx / Transcript_001.aspx layouts other student tools read.
import * as cheerio from "cheerio";
import { normCode, withCode } from "./codes.ts";
import { PERIOD_TIMES } from "./hub.ts";
import type { GucAnnouncement, GucCourse, GucCoursePage, GucCoursework, GucExam, GucGrade, GucMaterial, GucMidterm, GucSlot, GucWeek } from "./types.ts";

const P = "ContentPlaceHolderright_ContentPlaceHoldercontent_";
export const CMS = "https://cms.guc.edu.eg";
export const PORTAL = "https://apps.guc.edu.eg/student_ext";
export const urls = {
  home: CMS + "/apps/student/HomePageStn.aspx",
  course: (id: number, sid: number) => `${CMS}/apps/student/CourseViewStn.aspx?id=${id}&sid=${sid}`,
  schedule: PORTAL + "/Scheduling/GroupSchedule.aspx",
  transcript: PORTAL + "/Grade/Transcript_001.aspx",
};

/** Raised when a page loads but its layout no longer matches what Clem reads. */
export class SiteChanged extends Error { constructor(what: string) { super(`GUC changed how ${what} looks.`); this.name = "SiteChanged"; } }

/** A short stable id (FNV-1a, 2×32 bits) for text that has no id of its own. */
export function stableId(text: string) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x5bd1e995) >>> 0; b = (b ^ (b >>> 15)) >>> 0; }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export type PageState = "ok" | "login" | "unavailable";
/** A login form, or the portal's "Page will be available from…" message page, instead of the page asked for. */
export function pageState(html: string, url = ""): PageState {
  // "Your request to refresh the transcript page has been temporarily paused": GUC allows one load a minute.
  if (/\/main\/messagepage\.aspx/i.test(url) || /page\s+will\s+be\s+available\s+from/i.test(html) || /has been temporarily paused/i.test(html)) return "unavailable";
  if (/<input[^>]+type\s*=\s*["']?password/i.test(html) || /\/login/i.test(url)) return "login";
  return "ok";
}

/** "(|CSEN301|) Data Structures (351)" or "(CSEN301) Data Structures (351)" → code, name and CMS id. */
function courseLabel(raw: string) {
  const text = oneLine(raw);
  const piped = /^\(\|([^|]*)\|\)\s*(.*?)\s*\((\d+)\)\s*$/.exec(text);
  if (piped) return { code: normCode(piped[1]) || piped[1].trim(), name: piped[2].trim() || piped[1].trim(), id: Number(piped[3]) };
  const flat = text.replaceAll("|", ""), id = Number(/\((\d+)\)\s*$/.exec(flat)?.[1]);
  if (!id) return undefined;
  const label = flat.slice(0, flat.lastIndexOf("(")).trim();
  return { code: normCode(/^\(([^)]+)\)/.exec(label)?.[1] || label), name: label.replace(/^\([^)]*\)\s*/, "").trim() || label, id };
}

/** HomePageStn.aspx. Two layouts are read:
 *  - the student grid GUC serves today, `…_GridViewcourses`: one row per course, the label "(|CODE|) NAME (ID)" in the
 *    second cell and the season id in the sixth (as guc-cms-scrapper reads it);
 *  - the older one, a "Season : N, Title: …" header per season, each with its GridView1_<i> table. */
export function parseCourseList(html: string): GucCourse[] {
  const $ = cheerio.load(html);
  const courses: GucCourse[] = [];
  const grid = $(`#${P}GridViewcourses`);
  if (grid.length) {
    const rows = grid.find("tr").toArray();
    const head = $(rows[0]).children("th,td").toArray().map((c) => oneLine($(c).text()).toLowerCase());
    const col = (re: RegExp, fallback: number) => { const i = head.findIndex((h) => re.test(h)); return i >= 0 ? i : fallback; };
    // The live grid's headers are "Name, Active, Season, ID, SeasonId": "Season" is the term's title ("Winter 2026"),
    // "SeasonId" the number the course link needs. The row's own View Course link is the surest source of both ids.
    const idCol = head.findIndex((h) => /^(season\s*id|sid)$/.test(h));
    const nameAt = col(/course|name/, 1), seasonAt = idCol >= 0 ? idCol : col(/season|semester|sid/, 5), statusAt = head.findIndex((h) => /status|active/.test(h));
    const seasonTitleAt = head.findIndex((h, i) => i !== seasonAt && /title|^season$|^semester$/.test(h));
    for (const row of rows.slice(1)) {
      const cells = $(row).children("td");
      if (cells.length < 2) continue;
      const label = courseLabel(cells.eq(nameAt).text());
      const link = /[?&]sid=(\d+)/i.exec($(row).find("a[href*='sid=']").attr("href") || "")?.[1];
      const sid = Number(link || oneLine(cells.eq(seasonAt).text()).match(/\d+/)?.[0]);
      if (!label?.id || !sid) continue;
      const status = statusAt >= 0 ? oneLine(cells.eq(statusAt).text()) : "";
      const season = (seasonTitleAt >= 0 && oneLine(cells.eq(seasonTitleAt).text())) || `Season ${sid}`;
      courses.push({ key: `${label.id}:${sid}`, id: label.id, seasonId: sid, season, code: label.code, name: label.name, active: !status || /^active$/i.test(status) });
    }
    if (courses.length) {
      // The student grid lists this term's courses; without a status column, the newest season is the active one.
      const latest = Math.max(...courses.map((c) => c.seasonId));
      return statusAt >= 0 ? courses : courses.map((c) => ({ ...c, active: c.seasonId === latest }));
    }
  }
  const headers = $("div.menu-header-title").toArray();
  if (!headers.length && !$(`table[id^="${P}r1_GridView1_"]`).length && !grid.length) throw new SiteChanged("the course list");
  headers.forEach((h, index) => {
    const title = oneLine($(h).text());
    const sid = Number(/Season\s*:\s*(\d+)/i.exec(title)?.[1]);
    const season = /Title\s*:\s*(.+)$/i.exec(title)?.[1]?.trim() || title;
    if (!sid) return;
    $(`table#${P}r1_GridView1_${index} tr`).slice(1).each((_, row) => {
      const cells = $(row).children("td");
      if (cells.length < 3) return;
      const label = courseLabel(cells.eq(1).text());
      if (!label) return;
      courses.push({ key: `${label.id}:${sid}`, id: label.id, seasonId: sid, season, code: label.code, name: label.name, active: /^active$/i.test(oneLine(cells.eq(2).text())) });
    });
  });
  return courses;
}

// ---------- Announcement text: the box read as it is written ----------
/** Bumped when the announcement reader changes: each course's page is read again once, and what it gives is a baseline
 *  (no "new announcement" for posts that only changed shape; read state carries over in the engine's save). 2: whole
 *  posts instead of one per paragraph or table cell. */
export const ANNOUNCEMENT_VERSION = 2;
/** A DOM node as domhandler (cheerio's tree) has it; only what the reader needs. */
type DomNode = { type: string; name?: string; data?: string; children?: DomNode[]; attribs?: Record<string, string> };
/** What the reader makes of a box: lines (`start`: the first line of a paragraph), table rows, paragraph gaps and rules. */
type Piece = { kind: "line" | "row" | "gap" | "hr"; text?: string; start?: boolean };
const BLOCK = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "section", "article", "header", "footer", "center", "pre", "address", "dl", "dt", "dd", "figure", "figcaption", "form", "fieldset", "main", "nav", "aside", "ul", "ol", "tr", "caption"]);
const SKIP = new Set(["script", "style", "noscript", "template", "head", "title", "input", "select", "button", "iframe", "object", "img"]);
const tidy = (s: string) => s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
/** Rows of this table only (not of a table nested in a cell), through thead/tbody/tfoot. */
const rowsOf = (t: DomNode) => (t.children || []).flatMap((c) => (c.name === "tr" ? [c] : /^(thead|tbody|tfoot)$/.test(c.name || "") ? (c.children || []).filter((r) => r.name === "tr") : []));
const cellsOf = (tr: DomNode) => (tr.children || []).filter((c) => c.name === "td" || c.name === "th");
const span = (n: DomNode, a: string) => Math.min(50, Math.max(1, Number.parseInt(n.attribs?.[a] || "1") || 1));

/** A table as rows of cells with rowspan and colspan spread out, so each row reads complete on its own. A cell spread
 *  across columns is said once in its row (`dup` marks its copies). */
function tableGrid(t: DomNode, cell: (n: DomNode) => string) {
  type Cell = { text: string; dup?: boolean };
  const grid: Cell[][] = [], carry: (Cell & { left: number })[] = [];
  for (const tr of rowsOf(t).slice(0, 400)) {
    const row: Cell[] = [];
    let col = 0;
    const take = () => { const c = carry[col]; row[col] = { text: c.text, dup: c.dup }; c.left--; col++; };
    for (const td of cellsOf(tr)) {
      while (carry[col]?.left > 0) take();
      const text = cell(td), wide = span(td, "colspan"), tall = span(td, "rowspan");
      for (let k = 0; k < wide; k++) { row[col] = { text, dup: k > 0 }; if (tall > 1) carry[col] = { text, dup: k > 0, left: tall - 1 }; col++; }
    }
    // Cells still spanning down from rows above, after this row's own cells.
    while (col < carry.length) { if (carry[col]?.left > 0) take(); else col++; }
    grid.push(row);
  }
  return grid;
}

/** Walks a box into pieces: block elements end a paragraph, <br> ends a line (two in a row, a paragraph), list items
 *  are "- item" lines, a table is one line per row with its cells joined by " · ", and a link keeps its address. */
function readPieces(nodes: DomNode[]): Piece[] {
  const out: Piece[] = [];
  let cur = "", start = true;
  const flush = () => { const t = tidy(cur); cur = ""; if (t) { out.push({ kind: "line", text: t, start }); start = false; } };
  const gap = () => { flush(); if (out.length && out.at(-1)!.kind !== "gap") out.push({ kind: "gap" }); start = true; };
  const cellText = (n: DomNode) => tidy(readPieces(n.children || []).filter((p) => p.text).map((p) => p.text).join(" "));
  const walk = (n: DomNode) => {
    if (n.type === "text") { cur += (n.data || "").replace(/\s+/g, " "); return; }
    if (n.type !== "tag") return;
    const name = (n.name || "").toLowerCase();
    if (SKIP.has(name)) return;
    if (name === "br") { if (tidy(cur)) flush(); else gap(); return; }
    if (name === "hr") { gap(); out.push({ kind: "hr" }); start = true; return; }
    if (name === "a") {
      const before = cur.length;
      (n.children || []).forEach(walk);
      const text = tidy(cur.slice(before)), href = (n.attribs?.href || "").trim();
      const url = /^(https?:|mailto:)/i.test(href) ? href : href && !/^(#|javascript:)/i.test(href) ? cmsHref(href) : "";
      if (url && text && text !== url && text !== url.replace(/^mailto:/i, "")) cur += ` (${url})`;
      else if (url && !text) cur += url;
      return;
    }
    if (name === "li") { flush(); readPieces(n.children || []).filter((p) => p.text).forEach((p, i) => out.push({ kind: "line", text: i ? p.text : "- " + p.text, start: false })); return; }
    if (name === "table") {
      gap();
      const grid = tableGrid(n, cellText);
      // A layout table (one cell a row) is a frame, not data: its cells read as paragraphs, so stamps in them still count.
      if (grid.every((r) => r.filter((c) => c && !c.dup).length <= 1)) for (const tr of rowsOf(n)) for (const td of cellsOf(tr)) { (td.children || []).forEach(walk); gap(); }
      else for (const r of grid) { const cells = r.filter((c) => c?.text && !c.dup).map((c) => c.text); if (cells.length) out.push({ kind: "row", text: cells.join(" · ") }); }
      gap();
      return;
    }
    const block = BLOCK.has(name);
    if (block) gap();
    (n.children || []).forEach(walk);
    if (block) gap();
  };
  nodes.forEach(walk);
  flush();
  return out;
}

const isSeparator = (t: string) => /^[\s\-_=*~—–]*$/.test(t) && (t.match(/[-_=*~—–]/g) || []).length >= 5;
/** "[12/9/2026]" starts a post wherever a line starts; "12/9/2026:" and "(12/9/2026)" only where a paragraph starts. */
const STAMP_BRACKET = /^\[\s*\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}\s*\]/;
const STAMP = /^(\(\s*\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}\s*\)|\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}\s*:)/;
const piecesText = (ps: Piece[]) => ps.map((p) => (p.kind === "gap" ? "" : p.text || "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();

/** An element's whole text as written: line breaks, list items and table rows kept (a week's announcement). */
export const boxText = (el: { toArray(): unknown[] }) => piecesText(readPieces(el.toArray() as DomNode[]).filter((p) => !(p.kind === "line" && isSeparator(p.text!))));

/** The course's announcement box as whole posts, top first. A post ends only at a clear boundary: an <hr>, a line of
 *  five or more dashes, underscores, equals or stars (dropped), or a paragraph that opens with a date stamp
 *  ("[4/11/2026]: …", kept in its post). Greetings, sign-offs and tables stay inside their post, so a letter, or a quiz
 *  notice with its table of rooms, is one announcement, not one per paragraph or cell. */
export function announcementPosts(el: { toArray(): unknown[] }): string[] {
  const posts: Piece[][] = [[]];
  for (const p of readPieces((el.toArray() as DomNode[]).flatMap((n) => n.children || []))) {
    const here = posts.at(-1)!, has = here.some((x) => x.text);
    if (p.kind === "hr" || (p.kind === "line" && isSeparator(p.text!))) { if (has) posts.push([]); continue; }
    if (p.kind === "line" && has && (STAMP_BRACKET.test(p.text!) || (p.start && STAMP.test(p.text!)))) { posts.push([p]); continue; }
    here.push(p);
  }
  return posts.map(piecesText).filter((t) => /[\p{L}\p{N}]/u.test(t));
}

/** A CMS link as an absolute URL. An href that is already http(s) (a Google Drive link) is kept as it is, and
 *  "/Uploads/…" doesn't get a double slash. */
export const cmsHref = (href: string) => { const h = href.trim(); return !h ? "" : /^https?:\/\//i.test(h) ? h : new URL(h, CMS + "/apps/student/").href; };
/** "Week: 2026-9-7" or "Week: 2026-09-07" → "2026-09-07". */
export const weekDay = (title: string) => { const m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(title); return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : undefined; };
/** What kind of item a CMS card is, from the words after its title ("(Lecture slides)"). */
function itemKind(raw: string, title: string) {
  const t = raw.replace(/[()]/g, " ").replace(/\s+/g, " ").trim(), l = t.toLowerCase();
  if (l.includes("lecture")) return "Lecture slides";
  if (l.includes("solution")) return "Solution";
  if (l.includes("assignment")) return "Assignment";
  if (l.includes("project")) return "Project";
  if (l.includes("exam") || l.includes("quiz")) return "Exam";
  if (l.includes("video") || l.includes("record")) return "Video";
  return t ? t[0].toUpperCase() + t.slice(1) : /https?:\/\//.test(title) ? "Link" : "File";
}

/** CourseViewStn.aspx: the course description/announcements box and one div.weeksdata per week. Each card's title is
 *  the first child of its `[id^=content]` block, its kind the text right after it and its file the first link
 *  (guc-cms-scrapper's reading), with the older strong / a#download layout as a fallback. */
export function parseCoursePage(html: string, courseKey: string): GucCoursePage {
  const $ = cheerio.load(html);
  const desc = $(`#${P}desc`);
  if (!desc.length && !$("div.weeksdata").length) throw new SiteChanged("a course page");
  // Ids hash the post's text, so an unchanged post keeps its id (and read state); `order` keeps the page's own order.
  const announcements: GucAnnouncement[] = (desc.length ? announcementPosts(desc) : []).map((text, order) => ({ id: stableId(courseKey + "|c|" + text), courseKey, scope: "course", text, order }));
  const weeks: GucWeek[] = [], materials: GucMaterial[] = [];
  $("div.weeksdata").each((_, el) => {
    const week = $(el), title = oneLine(week.find("h2").first().text()) || "Week";
    const date = weekDay(title);
    // "Announcement" and "Description" are <strong> labels; their text is the <p> beside them (or after their box).
    const labelled = (word: RegExp) => {
      const strong = week.find("strong").filter((_, s) => word.test(oneLine($(s).text()))).first();
      if (!strong.length) return undefined;
      // The label's own box minus the label, so a table or list after the <p> is kept. A box holding other labels or
      // files is the week's whole body: then only the <p> beside the label; with nothing beside it, the <p> after its box.
      const box = strong.parent();
      if (box.children("strong").length > 1 || box.find(".card-body").length) return boxText(strong.siblings("p").first());
      const own = box.clone();
      own.children("strong").first().remove();
      return boxText(own.children().length || own.text().trim() ? own : box.nextAll("p").first());
    };
    const body = week.children().eq(1).children();
    const part = (i: number) => boxText(body.eq(i));
    const announcement = labelled(/^announcement/i) ?? part(0), description = labelled(/^description/i) ?? part(1);
    if (announcement && /[\p{L}\p{N}]/u.test(announcement)) announcements.push({ id: stableId(courseKey + "|w|" + title + "|" + announcement), courseKey, scope: "week", week: title, text: announcement, order: announcements.length });
    const items: GucMaterial[] = [];
    week.find(".card-body").each((_, card) => {
      const c = $(card), box = c.find("[id^=content]").first(), head = box.children().first();
      const titleEl = head.length ? head : c.find("strong").first().length ? c.find("strong").first() : c.children().first();
      const name = oneLine(titleEl.text());
      if (!name) return;
      // The words right after the title ("(Lecture slides)") are a text node, not an element.
      const next = head.length ? head[0].nextSibling : null;
      const after = next && next.type === "text" ? oneLine((next as unknown as { data: string }).data) : "";
      const dl = c.find("a#download, a[download]").first(), link = dl.length ? dl : c.find("a[href]").first();
      const url = cmsHref(link.attr("href") || "");
      const id = c.find("[data-contentid]").first().attr("data-contentid") || /^content(\d+)$/.exec(box.attr("id") || "")?.[1] || stableId(courseKey + "|" + (url || name));
      const bracket = /\(([^()]+)\)\s*$/.exec(name)?.[1]?.trim() || "";
      items.push({ id: String(id), courseKey, week: title, title: name.replace(/^\d+\s*-\s*/, "").replace(/\s*\([^()]+\)\s*$/, "") || name, kind: itemKind(after || bracket, name), url });
    });
    weeks.push({ title, date, announcement, description, materials: items });
    materials.push(...items);
  });
  return { courseKey, announcements, weeks, materials };
}

const DAYS = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];
const PERIODS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
const TIMES = PERIOD_TIMES;
const TYPE = /\b(lab|lecture|lec|tutorial|tut|seminar|sem|practical)\s*$/i;
const typeName = (t: string) => { const l = t.toLowerCase(); return l.startsWith("lec") ? "Lecture" : l.startsWith("tut") ? "Tutorial" : l.startsWith("lab") || l.startsWith("prac") ? "Lab" : l.startsWith("sem") ? "Seminar" : t; };

/** GroupSchedule.aspx: rows are days, columns periods; a busy cell holds a small table of [group, room, course + type]. */
export function parseSchedule(html: string): GucSlot[] {
  const $ = cheerio.load(html);
  let table = $(`#${P}scdTbl`);
  if (!table.length) table = $("table").filter((_, t) => DAYS.some((d) => $(t).find("tr").first().next().text().toLowerCase().includes(d))).first();
  if (!table.length) throw new SiteChanged("the schedule");
  const rows = table.children("tbody").length ? table.children("tbody").children("tr") : table.children("tr");
  const header = rows.first().children("td,th").toArray().map((c) => $(c).text().toLowerCase());
  const column = (i: number) => { const at = PERIODS.findIndex((w) => header[i]?.includes(w)); return at >= 0 ? at : i - 1; };
  const slots: GucSlot[] = [];
  rows.slice(1).each((_, row) => {
    const cells = $(row).children("td,th");
    const day = DAYS.find((d) => cells.first().text().toLowerCase().includes(d));
    if (!day) return;
    cells.slice(1).each((i, cell) => {
      const text = oneLine($(cell).text());
      if (!text || /^free$/i.test(text)) return;
      const period = column(i + 1);
      const entries = $(cell).find("table tr").toArray().map((r) => $(r).children("td,th").toArray());
      for (const tds of entries.length ? entries : [[cell]]) {
        const parts = tds.map((t) => oneLine($(t).text()));
        // The cell reads "CSEN 701 Tut"; its title, when there is one, names the course in full but not the type.
        const shown = parts.at(tds.length >= 3 ? 2 : -1) || "", last = (tds.length >= 3 && $(tds[2]).attr("title")?.trim()) || shown;
        const type = TYPE.exec(last)?.[1] || TYPE.exec(shown)?.[1] || "", course = withCode(last.replace(TYPE, "").trim());
        if (!course) continue;
        const code = normCode(course) || course;
        const slot = { day: day[0].toUpperCase() + day.slice(1), period: period + 1, start: TIMES[period]?.[0] || "", end: TIMES[period]?.[1] || "", code, name: course, type: type && typeName(type), group: tds.length >= 3 ? parts[0] : "", location: tds.length >= 2 ? parts[tds.length - 2] : "" };
        slots.push({ id: stableId([slot.day, slot.period, slot.code, slot.type, slot.group].join("|")), ...slot });
      }
    });
  });
  return slots;
}

/** Transcript_001.aspx: each semester is a table whose first row holds a <strong> label, then a header row, then courses. */
export function parseTranscript(html: string, year?: string): GucGrade[] {
  const $ = cheerio.load(html);
  const grades: GucGrade[] = [];
  $("table").each((_, t) => {
    const rows = $(t).find("tr"), label = oneLine(rows.first().find("strong").first().text());
    if (rows.length < 3 || !/\b(winter|spring|summer|fall|makeup|round)\b|\d{4}/i.test(label)) return;
    const head = rows.eq(1).children("td,th").toArray().map((c) => $(c).text().toLowerCase().trim());
    const col = (re: RegExp) => head.findIndex((h) => re.test(h));
    const code = col(/code/);
    let name = head.findIndex((h, i) => i !== code && /name|title/.test(h));
    if (name < 0) name = head.findIndex((h, i) => i !== code && /course|subject/.test(h));
    let numeric = col(/numeric/), letter = col(/^(grade|letter)/), hours = col(/hour|credit|ch$/);
    rows.slice(2).each((_, r) => {
      const cells = $(r).children("td").toArray().map((c) => oneLine($(c).text()));
      if (cells.length < 3 || /semester gpa|cumulative gpa/i.test(cells.join(" "))) return;
      if (name < 0) name = cells.length > 1 ? 1 : 0;
      if (numeric < 0) numeric = cells.findIndex((c) => /^\d\.\d{1,2}$/.test(c));
      if (letter < 0) letter = cells.findIndex((c) => /^[A-F][+-]?$|^FA$|^FF$/.test(c));
      if (hours < 0) hours = cells.findIndex((c, i) => i !== numeric && /^\d{1,2}$/.test(c));
      const title = cells[name] || "";
      const courseCode = normCode(code >= 0 ? cells[code] || "" : title) || (code >= 0 ? cells[code] || "" : "");
      if (!title) return;
      const n = Number.parseFloat(cells[numeric] ?? ""), h = Number.parseInt(cells[hours] ?? "");
      grades.push({ id: stableId(label + "|" + (courseCode || title)), semester: label, code: courseCode, name: title, hours: Number.isFinite(h) ? h : null, numeric: Number.isFinite(n) ? n : null, letter: letter >= 0 ? cells[letter] || "" : "", ...(year ? { year } : {}) });
    });
  });
  if (!grades.length && !/transcript/i.test(html)) throw new SiteChanged("the transcript");
  return grades;
}

/** The hidden fields and selects of an ASP.NET form, to post a dropdown change back. */
export function formFields(html: string) {
  const $ = cheerio.load(html), fields: Record<string, string> = {};
  $("input[type=hidden]").each((_, el) => { const n = $(el).attr("name"); if (n) fields[n] = $(el).attr("value") || ""; });
  $("select").each((_, el) => { const n = $(el).attr("name"); if (n) fields[n] = $(el).find("option[selected]").attr("value") ?? $(el).find("option").first().attr("value") ?? ""; });
  return fields;
}

/** The transcript's study-year dropdown: its field name and the newest year's option. */
export function transcriptYears(html: string) {
  const $ = cheerio.load(html);
  for (const el of $("select").toArray()) {
    const options = $(el).find("option").toArray().map((o) => ({ value: $(o).attr("value") || "", text: oneLine($(o).text()), selected: $(o).attr("selected") !== undefined }))
      .filter((o) => /20\d{2}\s*[-/]\s*20\d{2}/.test(o.text));
    if (options.length) return { field: $(el).attr("name") || "", options, latest: [...options].sort((a, b) => b.text.localeCompare(a.text))[0] };
  }
  return undefined;
}

/** The study year (its first calendar year) that `now` falls in; GUC's year starts in September. */
export const studyYear = (now: Date) => now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
type YearOption = { value: string; text: string };
/** The transcript year to read next. GUC lets the transcript load only once a minute and shows one study year per load,
 *  so a sync reads one year: past years Clem hasn't read yet first (newest first, stopping at `end`, the first past
 *  year with no grades), then whichever of this year and last year was read longer ago. `more`: past years still unread. */
export function nextTranscriptYear(options: YearOption[], state: { at: Record<string, number>; end?: string } | undefined, now: Date) {
  const start = (text: string) => Number(/20\d{2}/.exec(text)?.[0]);
  const current = studyYear(now), endAt = state?.end ? start(state.end) : -Infinity;
  const years = options.filter((o) => start(o.text) <= current && start(o.text) > endAt && start(o.text) > current - 8).sort((a, b) => start(b.text) - start(a.text));
  const pending = years.filter((o) => start(o.text) < current && !state?.at?.[o.text]);
  if (pending.length) return { year: pending[0], more: pending.length > 1 };
  const recent = years.slice(0, 2).sort((a, b) => (state?.at?.[a.text] || 0) - (state?.at?.[b.text] || 0))[0];
  return recent ? { year: recent, more: false } : undefined;
}

/** Undoes Dean Edwards' p,a,c,k,e,r packing, which the transcript page uses to hide its `sTo('…')` redirect. */
function unpack(script: string) {
  const out: string[] = [];
  for (const m of script.matchAll(/\}\('((?:\\'|[^'])*)',(\d+),(\d+),'((?:\\'|[^'])*)'\.split\('\|'\)/g)) {
    const base = Number(m[2]), words = m[4].split("|"), digits = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const encode = (n: number): string => (n < base ? "" : encode(Math.floor(n / base))) + digits[n % base];
    const map = new Map(words.map((w, i) => [encode(i), w] as const));
    out.push(m[1].replace(/\\'/g, "'").replace(/\b\w+\b/g, (w) => map.get(w) || w));
  }
  return out.join("\n");
}
/** The transcript sometimes answers with a script that reloads it with `?v=<token>`; returns that URL. */
export function transcriptChallenge(html: string, url: string) {
  if (/<table[\s\S]*semester gpa/i.test(html)) return undefined;
  const scripts = cheerio.load(html)("script").toArray().map((s) => cheerio.load(s).text()).join("\n");
  const token = /\bsTo\s*\(\s*['"]?([A-Za-z0-9_-]{6,})['"]?\s*\)/.exec(scripts + "\n" + unpack(scripts))?.[1];
  if (!token || !/\d/.test(token)) return undefined;
  const next = new URL(url);
  next.searchParams.set("v", token);
  return next.href;
}

// ---------- Student portal: this term's grades and exam seats (as the Grok bot's check_portal.py reads them) ----------
export const portalUrls = {
  grades: PORTAL + "/Grade/CheckGrade_01.aspx",
  exams: PORTAL + "/Exam/ViewExamSeat_01.aspx",
};

/** Some portal pages first answer with a short page whose script calls `sTo('<token>')`; the real page is the same path
 *  with `?v=<token>`. Returns that URL, or undefined for a normal page. */
export function portalBounce(html: string, url: string) {
  const token = html.length < 2000 ? /sTo\(\s*'([^']+)'\s*\)/.exec(html)?.[1] : undefined;
  if (!token) return transcriptChallenge(html, url);
  const next = new URL(url);
  next.searchParams.set("v", token);
  return next.href;
}

/** CheckGrade_01.aspx: the midterm table (course, grade). */
export function parseMidterms(html: string): GucMidterm[] {
  const $ = cheerio.load(html);
  const out: GucMidterm[] = [];
  $(`#${P}midDg tr`).slice(1).each((_, r) => {
    const tds = $(r).children("td").toArray().map((c) => oneLine($(c).text()));
    if (tds.length < 2 || !tds[0]) return;
    out.push({ id: stableId("mid|" + tds[0]), course: withCode(tds[0]), code: normCode(tds[0]) || "", grade: tds[1] });
  });
  return out;
}

/** CheckGrade_01.aspx: the course dropdown whose postback shows one course's coursework. */
export function courseworkOptions(html: string) {
  const $ = cheerio.load(html), select = $(`#${P}smCrsLst`);
  if (!select.length) return undefined;
  const options = select.find("option").toArray().map((o) => ({ value: ($(o).attr("value") || "").trim(), name: oneLine($(o).text()) }))
    .filter((o) => o.value && o.value !== "0" && !/^(choose|select)\b|^-+$/i.test(o.name));
  return { field: select.attr("name") || "", options };
}

/** The form to post back with `field` set to `value`: every named <input> as it is on the page (view state, event
 *  validation, the button), plus the dropdown. The page must be the latest GET: view state goes stale. */
export function postbackForm(html: string, field: string, value: string) {
  const $ = cheerio.load(html), form = $("form").first(), fields: Record<string, string> = {};
  (form.length ? form.find("input[name]") : $("input[name]")).each((_, el) => {
    const i = $(el), type = (i.attr("type") || "text").toLowerCase();
    if ((type === "checkbox" || type === "radio") && i.attr("checked") === undefined) return;
    fields[i.attr("name")!] = i.attr("value") || "";
  });
  fields[field] = value;
  return fields;
}

/** One course's coursework after the postback: a row with a first cell starts an assessment ("Quiz 1"), the rows
 *  under it are its parts. */
export function parseCoursework(html: string, course: { name: string; value: string }): GucCoursework {
  const $ = cheerio.load(html);
  const entries: GucCoursework["entries"] = [];
  $(`#${P}nttTr tr`).slice(1).each((_, r) => {
    const tds = $(r).children("td").toArray().map((c) => oneLine($(c).text()));
    if (tds.length < 2) return;
    const [first, element = "", grade = "", professor = ""] = tds;
    if (first) entries.push({ name: first, elements: [] });
    const at = entries.at(-1);
    if (at && (element || grade)) at.elements.push({ name: element, grade, professor });
  });
  return { id: stableId("cw|" + course.value + "|" + course.name), course: withCode(course.name), code: normCode(course.name) || "", entries };
}

/** ViewExamSeat_01.aspx: the first table whose header names the exam day or type; a row of 8+ cells is one exam. */
export function parseExamSeats(html: string): GucExam[] {
  const $ = cheerio.load(html);
  for (const t of $("table").toArray()) {
    const rows = $(t).find("tr").toArray();
    if (!rows.length) continue;
    const head = $(rows[0]).children("th,td").toArray().map((c) => oneLine($(c).text()).toLowerCase());
    if (!head.some((h) => /exam day|exam type/.test(h))) continue;
    const at = (re: RegExp, fallback: number) => { const i = head.findIndex((h) => re.test(h)); return i >= 0 ? i : fallback; };
    const ix = { course: at(/course/, 0), day: at(/day/, 1), date: at(/date/, 2), start: at(/start|from/, 3), end: at(/end|^to\b/, 4), hall: at(/hall|room|venue/, 5), seat: at(/seat/, 6), type: at(/type/, 7) };
    const out: GucExam[] = [];
    for (const r of rows.slice(1)) {
      const tds = $(r).children("td").toArray().map((c) => oneLine($(c).text()));
      if (tds.length < 8) continue;
      const e = { course: withCode(tds[ix.course]), code: normCode(tds[ix.course]) || "", day: tds[ix.day], date: tds[ix.date], start: tds[ix.start], end: tds[ix.end], hall: tds[ix.hall], seat: tds[ix.seat], type: tds[ix.type] };
      out.push({ id: stableId(["exam", e.course, e.date, e.start, e.type].join("|")), ...e });
    }
    return out;
  }
  return [];
}
