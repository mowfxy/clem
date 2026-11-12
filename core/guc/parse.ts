// HTML parsers for GUC's CMS and student portal. The CMS layout (season headers, course grid, weeksdata blocks,
// a#download, the course description box) follows AhmedAshrafAZ/cms-downloader (MIT, see THIRD-PARTY-NOTICES.md);
// the schedule and transcript tables follow the GroupSchedule.aspx / Transcript_001.aspx layouts other student tools read.
import * as cheerio from "cheerio";
import { normCode, withCode } from "./codes.ts";
import { PERIOD_TIMES } from "./hub.ts";
import type { GucAnnouncement, GucCourse, GucCoursePage, GucGrade, GucMaterial, GucSlot, GucWeek } from "./types.ts";

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

/** HomePageStn.aspx: one "Season : N, Title: …" header per season, each with its GridView1_<i> course table. */
export function parseCourseList(html: string): GucCourse[] {
  const $ = cheerio.load(html);
  const headers = $("div.menu-header-title").toArray();
  if (!headers.length && !$(`table[id^="${P}r1_GridView1_"]`).length) throw new SiteChanged("the course list");
  const courses: GucCourse[] = [];
  headers.forEach((h, index) => {
    const title = oneLine($(h).text());
    const sid = Number(/Season\s*:\s*(\d+)/i.exec(title)?.[1]);
    const season = /Title\s*:\s*(.+)$/i.exec(title)?.[1]?.trim() || title;
    if (!sid) return;
    $(`table#${P}r1_GridView1_${index} tr`).slice(1).each((_, row) => {
      const cells = $(row).children("td");
      if (cells.length < 3) return;
      const raw = oneLine(cells.eq(1).text()).replaceAll("|", "");
      const id = Number(/\((\d+)\)\s*$/.exec(raw)?.[1]);
      if (!id) return;
      const label = raw.slice(0, raw.lastIndexOf("(")).trim();
      const code = normCode(/^\(([^)]+)\)/.exec(label)?.[1] || label);
      const name = label.replace(/^\([^)]*\)\s*/, "").trim() || label;
      courses.push({ key: `${id}:${sid}`, id, seasonId: sid, season, code, name, active: /^active$/i.test(oneLine(cells.eq(2).text())) });
    });
  });
  return courses;
}

/** Splits a block of announcements into paragraphs, so a new one is told apart from the ones already there. */
function paragraphs($: cheerio.CheerioAPI, el: ReturnType<cheerio.CheerioAPI>) {
  const html = (el.html() || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n\n");
  return cheerio.load(html).text().replace(/ /g, " ").split(/\n[ \t]*\n|\n(?=\s*[-•*]\s)/).map(clean).filter((t) => t.length > 2);
}

/** CourseViewStn.aspx: the course description/announcements box and one div.weeksdata per week. */
export function parseCoursePage(html: string, courseKey: string): GucCoursePage {
  const $ = cheerio.load(html);
  const desc = $(`#${P}desc`);
  if (!desc.length && !$("div.weeksdata").length) throw new SiteChanged("a course page");
  const announcements: GucAnnouncement[] = paragraphs($, desc).map((text) => ({ id: stableId(courseKey + "|c|" + text), courseKey, scope: "course", text }));
  const weeks: GucWeek[] = [], materials: GucMaterial[] = [];
  $("div.weeksdata").each((_, el) => {
    const week = $(el), title = oneLine(week.find("h2").first().text()) || "Week";
    const date = /(\d{4}-\d{2}-\d{2})/.exec(title)?.[1];
    const body = week.children().eq(1).children();
    const part = (i: number) => { const el = body.eq(i), p = el.find("p"); return clean((p.length ? p : el).text()); };
    const announcement = part(0), description = part(1);
    if (announcement) announcements.push({ id: stableId(courseKey + "|w|" + title + "|" + announcement), courseKey, scope: "week", week: title, text: announcement });
    const items: GucMaterial[] = [];
    week.find(".card-body").each((_, card) => {
      const c = $(card), name = oneLine(c.find("strong").first().text() || c.children().first().text());
      if (!name) return;
      const link = c.find("a#download, a[download]").first(), url = link.attr("href")?.trim() || "";
      const id = c.find("[data-contentid]").first().attr("data-contentid") || stableId(courseKey + "|" + (url || name));
      const kind = /\(([^()]+)\)\s*$/.exec(name)?.[1]?.trim() || (/https?:\/\//.test(name) ? "Link" : "File");
      items.push({ id: String(id), courseKey, week: title, title: name.replace(/^\d+\s*-\s*/, "").replace(/\s*\([^()]+\)\s*$/, "") || name, kind, url: url && new URL(url, CMS + "/apps/student/").href });
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
