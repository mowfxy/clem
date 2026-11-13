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
const clean = (s: string) => s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export type PageState = "ok" | "login" | "unavailable";
/** A login form, or the portal's "Page will be available from…" message page, instead of the page asked for. */
export function pageState(html: string, url = ""): PageState {
  if (/\/main\/messagepage\.aspx/i.test(url) || /page\s+will\s+be\s+available\s+from/i.test(html)) return "unavailable";
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
    const nameAt = col(/course|name/, 1), seasonAt = col(/season|semester|sid/, 5), statusAt = head.findIndex((h) => /status|active/.test(h));
    const seasonTitleAt = head.findIndex((h, i) => i !== seasonAt && /title/.test(h));
    for (const row of rows.slice(1)) {
      const cells = $(row).children("td");
      if (cells.length < 2) continue;
      const label = courseLabel(cells.eq(nameAt).text());
      const sid = Number(oneLine(cells.eq(seasonAt).text()).match(/\d+/)?.[0]);
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

/** Splits a block of announcements into paragraphs, so a new one is told apart from the ones already there. */
function paragraphs($: cheerio.CheerioAPI, el: ReturnType<cheerio.CheerioAPI>) {
  const html = (el.html() || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n\n");
  return cheerio.load(html).text().replace(/ /g, " ").split(/\n[ \t]*\n|\n(?=\s*[-•*]\s)/).map(clean).filter((t) => t.length > 2);
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
  const announcements: GucAnnouncement[] = paragraphs($, desc).map((text) => ({ id: stableId(courseKey + "|c|" + text), courseKey, scope: "course", text }));
  const weeks: GucWeek[] = [], materials: GucMaterial[] = [];
  $("div.weeksdata").each((_, el) => {
    const week = $(el), title = oneLine(week.find("h2").first().text()) || "Week";
    const date = weekDay(title);
    // "Announcement" and "Description" are <strong> labels; their text is the <p> beside them (or after their box).
    const labelled = (word: RegExp) => {
      const strong = week.find("strong").filter((_, s) => word.test(oneLine($(s).text()))).first();
      if (!strong.length) return undefined;
      const near = strong.siblings("p").first();
      return clean((near.length ? near : strong.parent().nextAll("p").first()).text());
    };
    const body = week.children().eq(1).children();
    const part = (i: number) => { const el = body.eq(i), p = el.find("p"); return clean((p.length ? p : el).text()); };
    const announcement = labelled(/^announcement/i) ?? part(0), description = labelled(/^description/i) ?? part(1);
    if (announcement) announcements.push({ id: stableId(courseKey + "|w|" + title + "|" + announcement), courseKey, scope: "week", week: title, text: announcement });
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
export function parseTranscript(html: string): GucGrade[] {
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
      grades.push({ id: stableId(label + "|" + (courseCode || title)), semester: label, code: courseCode, name: title, hours: Number.isFinite(h) ? h : null, numeric: Number.isFinite(n) ? n : null, letter: letter >= 0 ? cells[letter] || "" : "" });
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
