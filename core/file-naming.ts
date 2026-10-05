/** Readable names for added files, from the name, the document's own first page and where it is saved.
 *  Inside a subject or project the place is already known, so a lecture is named by what it covers:
 *  "Nodal Analysis – Lecture 3". Outside one, by its course: "Electric Circuits – Lecture 3". */

/** A line from the start of the document; a larger size is more prominent (titles, headings). */
export type NameLine = { text: string; size: number };
export type NameSource = { title?: string; lines: NameLine[] };

const FILLER = new Set(['scan', 'scanned', 'doc', 'document', 'file', 'img', 'image', 'print', 'untitled', 'download', 'downloads', 'copy', 'new', 'final', 'pdf', 'page', 'export', 'output', 'attachment', 'tmp', 'temp', 'microsoft', 'word', 'powerpoint', 'slides', 'slide', 'notes', 'version', 'ver', 'rev', 'draft', 'updated', 'edited', 'compressed', 'handout', 'presentation', 'pptx', 'docx', 'the', 'and', 'for', 'of']);

/** A name that says nothing about the file: numbers, codes, "scan0001", "Document (3)". */
export function isGenericName(name: string) {
  const base = name.replace(/\.[^.]+$/, '');
  const chars = base.replace(/[\s_\-.()[\]]/g, '');
  if (!chars) return true;
  if (/^[A-Za-z ]+$/.test(base) && !FILLER.has(base.trim().toLowerCase())) return false;
  const digits = (chars.match(/\d/g) || []).length;
  if (digits / chars.length >= 0.4) return true;
  if (/[@#$%^&*=+~`|]/.test(base)) return true;
  const words = base.split(/[\s_\-.()[\]]+/).filter((t) => /^[A-Za-zÀ-ɏ؀-ۿ]{3,}$/.test(t) && !FILLER.has(t.toLowerCase()) && !(t.length <= 4 && t === t.toUpperCase()));
  return words.length === 0;
}

// "Lecture 3", "Lec03", "Tut. 2", "Sheet #4", "Chapter IV", "Assignment no. 1"…
const KINDS: [RegExp, string][] = [
  [/^lec(?:t(?:ure)?s?)?$/i, 'Lecture'], [/^tut(?:orials?)?$/i, 'Tutorial'], [/^problem\s+sheets?$/i, 'Problem Sheet'], [/^problem\s+sets?$/i, 'Problem Set'],
  [/^(?:work)?sheets?$/i, 'Sheet'], [/^assign(?:ments?)?$/i, 'Assignment'], [/^(?:hw|home\s?works?)$/i, 'Homework'], [/^lab(?:orator(?:y|ies)|s)?$/i, 'Lab'],
  [/^(?:ch|chap|chapters?)$/i, 'Chapter'], [/^(?:wk|weeks?)$/i, 'Week'], [/^units?$/i, 'Unit'], [/^modules?$/i, 'Module'], [/^sessions?$/i, 'Session'],
  [/^quiz(?:zes)?$/i, 'Quiz'], [/^midterms?$/i, 'Midterm'], [/^exams?$/i, 'Exam'], [/^seminars?$/i, 'Seminar'], [/^recitations?$/i, 'Recitation'],
  [/^parts?$/i, 'Part'], [/^sections?$/i, 'Section'], [/^topics?$/i, 'Topic'], [/^class(?:es)?$/i, 'Class'], [/^projects?$/i, 'Project'],
];
const LABEL = /(?<![\p{L}\d])(lec(?:t(?:ure)?s?)?|tut(?:orials?)?|problem\s+sheets?|problem\s+sets?|(?:work)?sheets?|assign(?:ments?)?|hw|home\s?works?|lab(?:orator(?:y|ies)|s)?|ch|chap|chapters?|wk|weeks?|units?|modules?|sessions?|quiz(?:zes)?|midterms?|exams?|seminars?|recitations?|parts?|sections?|topics?|class(?:es)?|projects?)\s*\.?\s*[-#:]?\s*(?:no\.?\s*|number\s*)?(\d{1,3}|[ivx]{1,5})(?![\p{L}\d])/iu;
const SHORT_LECTURE = /^\s*L\s*-?\s*(\d{1,2})(?![\p{L}\d])/iu;
const CODE = /(?<![\p{L}\d])[A-Z]{2,5}\s?-?\d{3,4}[A-Z]?(?![\p{L}\d])/u;
const all = (re: RegExp) => RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
const PERSON = /(?<![\p{L}])(?:dr|prof|eng|engr|mr|mrs|ms)\.?\s+\p{L}[\p{L}.'-]*(?:\s+\p{Lu}[\p{L}.'-]*){0,2}/giu;
const JUNK = [
  /\b(professor|instructor|lecturer|teaching assistant|presented by|prepared by|submitted by|supervised by)\b/i,
  /\b(university|universit[äé]t|faculty|department|dept\.?|school of|college|institute|academy|semester|spring|fall|autumn|winter|summer)\b/i,
  /@|https?:|www\.|\.(com|edu|org|net)\b/i,
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i,
  /©|copyright|all rights reserved/i,
  /^(outline|agenda|contents|table of contents|objectives|learning (objectives|outcomes)|instructions|questions?|name|student|id|due|deadline|total|marks?|grade|points?|answer|solution)s?\b\s*[:\-]?/i,
  /^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i,
];

const roman = (s: string) => /^[ivx]+$/i.test(s) && !/^\d+$/.test(s);
function labelOf(text: string): string | undefined {
  const m = text.replace(/_/g, ' ').match(LABEL);
  if (m) {
    const kind = KINDS.find(([re]) => re.test(m[1].replace(/\s+/g, ' ').trim()))?.[1];
    if (!kind) return undefined;
    // A lone "I"/"V" after a word is usually English, not a number.
    if (roman(m[2]) && m[2].length === 1 && !/^(lecture|chapter|part|unit|module|section)$/i.test(kind)) return undefined;
    return `${kind} ${roman(m[2]) ? m[2].toUpperCase() : String(Number(m[2]))}`;
  }
  const short = text.match(SHORT_LECTURE);
  return short ? `Lecture ${Number(short[1])}` : undefined;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const placePattern = (place: string) => place.trim() ? RegExp(place.trim().split(/[\s_\-:–—.]+/).filter(Boolean).map(escape).join('[\\s_\\-:–—.]*'), 'iu') : undefined;
const tidy = (text: string) => text.replace(/\s+/g, ' ').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
const trimSeparators = (text: string) => text.replace(/^[\s\-–—:|,.·•()[\]#]+|[\s\-–—:|,.·•([#]+$/gu, '').replace(/\(\s*\)|\[\s*\]/g, '').replace(/\s+/g, ' ').trim();
const titled = (text: string) => (text === text.toUpperCase() && /\p{Lu}{4}/u.test(text) ? text.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (_, a, c) => a + c.toUpperCase()).replace(/\b(And|Of|The|In|On|To|For|With|A|An)\b(?!$)/g, (w, _, i) => (i ? w.toLowerCase() : w)) : text);

/** What a line or name says once the label, course codes, people and the place's own name are taken out. */
function residue(text: string, place?: RegExp) {
  let out = text.replace(/_/g, ' ').replace(/^microsoft (powerpoint|word)\s*-\s*/i, '').replace(/\.(pdf|pptx?|docx?|tex|dvi)$/i, '');
  if (place) out = out.replace(all(place), ' ');
  out = out.replace(LABEL, ' ').replace(SHORT_LECTURE, ' ').replace(all(CODE), ' ').replace(PERSON, ' ');
  return trimSeparators(out);
}
const meaningful = (text: string) => text.split(/[\s\-–—:|,.()]+/).some((w) => /^\p{L}{3,}$/u.test(w) && !FILLER.has(w.toLowerCase()));
const junk = (text: string) => JUNK.some((re) => re.test(text));

/** The course a document belongs to: a line naming it next to its code ("ELCT 301 – Electric Circuits"). */
function courseOf(source: NameSource | undefined) {
  for (const line of source?.lines.slice(0, 12) || []) {
    if (!CODE.test(line.text)) continue;
    const name = residue(line.text);
    if (name.length >= 4 && name.length <= 60 && meaningful(name) && !junk(name)) return titled(name);
    const code = line.text.match(CODE)?.[0];
    if (code) return code.replace(/^([A-Z]+)\s?-?(\d)/, '$1 $2');
  }
  return undefined;
}

/** What the document covers: its most prominent line that is not the course, a person, a date or the label alone. */
function topicOf(source: NameSource | undefined, place?: RegExp) {
  if (!source) return undefined;
  const lines = source.lines.slice(0, 40);
  const largest = Math.max(0, ...lines.map((l) => l.size));
  const prominent = lines.filter((l) => l.size >= largest * 0.7);
  // The document title comes first; then page-one lines by size, top to bottom.
  const candidates = [...(source.title ? [source.title] : []), ...[...prominent].sort((a, b) => b.size - a.size).map((l) => l.text)];
  for (const raw of candidates) {
    const text = tidy(raw);
    if (!text || text.length > 90 || junk(text)) continue;
    const left = residue(text, place);
    if (left.length < 3 || left.length > 70 || left.split(' ').length > 10 || !meaningful(left) || junk(left) || isGenericName(left + '.x')) continue;
    return titled(left);
  }
  return undefined;
}

/**
 * The name to store a file under, or the original when it already reads well.
 * `place` is the subject or project the file is saved into, when there is one.
 */
export function betterFileName(original: string, source: NameSource | undefined, place?: string) {
  const ext = original.match(/\.[^.\s]{1,6}$/)?.[0] || '';
  const base = original.slice(0, original.length - ext.length);
  const inPlace = place ? placePattern(place) : undefined;
  const label = labelOf(base) || (source ? [source.title || '', ...source.lines.slice(0, 15).map((l) => l.text)].map(labelOf).find(Boolean) : undefined);
  // A name worth keeping says something beyond its label, code, teacher and place: "Thevenin practice.pdf".
  const nameSays = residue(base, inPlace);
  const named = !isGenericName(original) && meaningful(nameSays);
  if (named && !(inPlace && inPlace.test(base))) return original;
  if (named) return trimSeparators(base.replace(all(inPlace!), ' ').replace(/_/g, ' ')) + ext;
  const topic = topicOf(source, inPlace);
  let name: string | undefined;
  if (place) name = [topic, label].filter(Boolean).join(' – ');
  else if (label) name = [courseOf(source) || topic, label].filter(Boolean).join(' – ');
  else name = topic;
  name = tidy(name || '').slice(0, 90).replace(/[\s–-]+$/, '');
  if (!name || name.length < 3) return original;
  return name.toLowerCase() === base.trim().toLowerCase() ? original : name + ext;
}
