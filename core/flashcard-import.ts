import type { CardState, StudyItem } from './types.ts';

/** Flashcards brought in from Anki or Quizlet, before they become a study set. `state` is review history that maps
 *  onto Clem's FSRS scheduler (core/srs.ts); a card without it starts as new. */
export type ImportedCard = StudyItem & { state?: CardState; deck?: string };
export type ImportedDeck = { name: string; cards: ImportedCard[]; warnings: string[]; media?: { name: string; data: Uint8Array }[] };

/** The most cards one import brings in, and the longest side of a card kept. */
export const MAX_CARDS = 20_000;
export const MAX_SIDE = 8_000;
const DAY = 86_400_000;

// ── Quizlet ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Quizlet exports a set as text: term and definition split by a tab, a comma or a character of the person's choosing,
// and cards split by new lines or semicolons. The same goes for .txt, .tsv and .csv files.

export type Separator = 'tab' | 'comma' | 'semicolon' | 'dash';
const marks: Record<Separator, string> = { tab: '\t', comma: ',', semicolon: ';', dash: ' - ' };
export const separatorNames: Record<Separator, string> = { tab: 'Tab', comma: 'Comma', semicolon: 'Semicolon', dash: 'Dash ( - )' };

/** The separator most lines split on exactly once (a tab wins over a comma, as Quizlet's default). */
export function detectSeparator(text: string): Separator {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 200);
  if (!lines.length) return 'tab';
  const score = (s: Separator) => lines.filter((l) => (s === 'comma' ? csvFields(l).length === 2 : l.split(marks[s]).length === 2)).length / lines.length;
  const order: Separator[] = ['tab', 'comma', 'semicolon', 'dash'];
  const best = order.reduce((a, b) => (score(b) > score(a) ? b : a));
  return score(best) > 0 ? best : 'tab';
}
/** One CSV line's fields, with "quoted, fields" and "" for a quote. */
function csvFields(line: string) {
  const out: string[] = [];
  let field = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) { if (c === '"' && line[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c; }
    else if (c === '"' && !field.trim()) { quoted = true; field = ''; }
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}
/** Splits CSV text into records, keeping new lines inside quoted fields. */
function csvRecords(text: string) {
  const records: string[] = [];
  let current = '', quotes = 0;
  for (const line of text.split(/\r?\n/)) {
    current = current ? current + '\n' + line : line;
    quotes += (line.match(/"/g) || []).length;
    if (quotes % 2 === 0) { records.push(current); current = ''; quotes = 0; }
  }
  if (current) records.push(current);
  return records;
}
/** Cards from Quizlet's text export (or any two-column text): the first side is the question, the rest the answer.
 *  A first line that reads like column names ("Term, Definition") is skipped. */
export function parseQuizlet(text: string, separator: Separator = detectSeparator(text)) {
  const clean = text.replace(/^﻿/, '');
  const rows = separator === 'comma' ? csvRecords(clean).map(csvFields) : clean.split(/\r?\n/).map((l) => l.split(marks[separator]));
  const cards: ImportedCard[] = [];
  let skipped = 0;
  for (const [i, row] of rows.entries()) {
    const [front = '', ...rest] = row.map((x) => x.trim());
    const back = rest.join(separator === 'comma' ? ', ' : ' ').trim();
    if (!front && !back) continue;
    if (i === 0 && /^(term|front|question|word)$/i.test(front) && /^(definition|back|answer|meaning)$/i.test(back)) continue;
    if (!front || !back) { skipped++; continue; }
    if (cards.length >= MAX_CARDS) { skipped++; continue; }
    cards.push({ question: front.slice(0, MAX_SIDE), answer: back.slice(0, MAX_SIDE) });
  }
  return { cards, separator, skipped };
}

// ── Anki ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', times: '×', divide: '÷', deg: '°' };
/** An Anki field (HTML) as plain text: line breaks kept, pictures named, sounds dropped, entities decoded. */
export function ankiText(html: string, pictures?: Set<string>) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // New lines in HTML are spaces; <br> and blocks make the lines.
    .replace(/\s*\n\s*/g, ' ')
    .replace(/<img[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi, (_, a?: string, b?: string, c?: string) => { const name = decodeEntities(a ?? b ?? c ?? ''); pictures?.add(name); return ` [picture: ${name}] `; })
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/?(div|p|ul|ol|li|tr|h\d)(\s[^>]*)?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m) => decodeEntities(m))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return entities[e.toLowerCase()] ?? m;
  });
}

/** Renders one side of an Anki card template ("{{Front}}", "{{#Field}}…{{/Field}}", "{{FrontSide}}", "{{cloze:Text}}"). */
export function renderTemplate(template: string, fields: Record<string, string>, extra: { frontSide?: string; cloze?: { ord: number; side: 'q' | 'a' } } = {}) {
  let out = template;
  // Sections: shown when the field has text ({{#X}}) or when it hasn't ({{^X}}). Inner ones go first.
  for (let pass = 0; pass < 8 && /\{\{[#^]/.test(out); pass++)
    out = out.replace(/\{\{([#^])\s*([^}]+?)\s*\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\s*\2\s*\}\}/g, (_, kind: string, name: string, inner: string) => {
      const has = !!ankiText(fields[name] || '');
      return (kind === '#') === has ? inner : '';
    });
  return out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, tag: string) => {
    if (tag === 'FrontSide') return extra.frontSide ?? '';
    const parts = tag.split(':'), name = parts.at(-1)!.trim(), filters = parts.slice(0, -1).map((f) => f.trim());
    if (filters.includes('type')) return '';
    const value = fields[name] ?? '';
    if (filters.includes('cloze') && extra.cloze) return cloze(value, extra.cloze.ord, extra.cloze.side);
    return value;
  });
}
/** One cloze card's side: on the question its own deletion is hidden ([…] or the hint), the others shown; on the answer
 *  its deletion is shown in bold. */
export function cloze(text: string, ord: number, side: 'q' | 'a') {
  return text.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_, n: string, answer: string, hint?: string) => {
    if (Number(n) !== ord) return answer;
    return side === 'q' ? `[${hint ? hint : '…'}]` : `<b>${answer}</b>`;
  });
}
/** The cloze numbers a note's text uses (one card each). */
export const clozeNumbers = (text: string) => [...new Set([...text.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);

/** The answer side without the question repeated above it: Anki's answers usually start with {{FrontSide}} and a rule. */
export function answerOnly(answerHtml: string, questionHtml: string) {
  const rule = answerHtml.search(/<hr[^>]*id\s*=\s*["']?answer/i);
  if (rule >= 0) return answerHtml.slice(rule).replace(/^<hr[^>]*>/i, '');
  return answerHtml.startsWith(questionHtml) ? answerHtml.slice(questionHtml.length) : answerHtml;
}

/** An Anki card's review history as Clem's FSRS state, when it maps cleanly: Anki's own FSRS memory state (stability
 *  and difficulty, kept in the card's data since Anki 23.10) and a review date. SM-2 history (ease and interval only)
 *  does not map, so those cards start as new. */
export function ankiState(card: { type: number; queue: number; due: number; ivl: number; reps: number; lapses: number; data?: string }, collectionCreated: number, lastReview?: number): CardState | undefined {
  if (card.type === 0 || !card.reps) return undefined;
  let memory: { s?: number; d?: number } = {};
  try { memory = JSON.parse(card.data || '{}') || {}; } catch { return undefined; }
  const stability = Number(memory.s), difficulty = Number(memory.d);
  if (!(stability > 0) || !(difficulty >= 1 && difficulty <= 10)) return undefined;
  // Review cards are due in days from the collection's creation; learning ones at a time in seconds.
  const due = card.type === 2 ? collectionCreated * 1000 + card.due * DAY : card.due * 1000;
  if (!Number.isFinite(due) || due <= 0) return undefined;
  const last = lastReview && lastReview > 0 ? lastReview : card.type === 2 ? due - Math.max(1, card.ivl) * DAY : due - 10 * 60_000;
  return { due, stability, difficulty, reps: Math.max(1, card.reps), lapses: Math.max(0, card.lapses), last };
}
