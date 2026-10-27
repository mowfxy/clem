/**
 * Edits to a file the person has open, as the model writes them. Asking a model to send a whole document back inside
 * JSON breaks on long documents: one unescaped quote, a LaTeX backslash or a cut-off reply 70,000 characters in, and
 * nothing can be read. So edits come as plain-text blocks that need no escaping, and only the parts that change:
 *
 *   SUMMARY: one sentence
 *   @@@ SECTION 4
 *   HEADING: Partial derivatives
 *   …the section's full new text, as is…
 *   @@@ DELETE 7
 *
 * A reply in the older JSON shapes is still read (parseModelJson), so a model that ignores the format is not wasted.
 */
import { applyEdit } from './diff.ts';
import { parseModelJson } from './model-json.ts';

export type PatchBlock = { command: string; args: string[]; body: string };
export type Patch = { summary: string; blocks: PatchBlock[] };

const MARK = /^@@@[ \t]*([A-Za-z]+)[ \t]*(.*?)[ \t]*$/;

/** The SUMMARY line and the @@@ blocks of a reply; no blocks when the reply has none. */
export function readPatch(raw: string): Patch {
  let text = raw.replace(/\r\n?/g, '\n');
  // A reply wrapped whole in a code fence.
  const fenced = /^\s*```[\w-]*\n([\s\S]*?)\n```\s*$/.exec(text);
  if (fenced && fenced[1].includes('@@@')) text = fenced[1];
  const lines = text.split('\n'), blocks: PatchBlock[] = [];
  let summary = '', current: { command: string; args: string[]; lines: string[] } | null = null;
  const close = () => {
    if (!current) return;
    const body = current.lines.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
    if (current.command !== 'END') blocks.push({ command: current.command, args: current.args, body });
    current = null;
  };
  for (const line of lines) {
    const mark = MARK.exec(line);
    if (mark) { close(); current = { command: mark[1].toUpperCase(), args: mark[2].split(/\s+/).filter(Boolean), lines: [] }; continue; }
    if (current) { current.lines.push(line); continue; }
    const said = /^\s*\**SUMMARY\**\s*:\**\s*(.+)$/i.exec(line);
    if (said && !summary) summary = said[1].trim();
  }
  close();
  return { summary: summary.replace(/\*+$/, '').trim(), blocks };
}

const number = (block: PatchBlock, at = 0) => {
  const n = Number(block.args.find((a) => /^\d+$/.test(a)) ?? block.args[at]);
  if (!Number.isInteger(n)) throw Error(`“@@@ ${block.command} ${block.args.join(' ')}” needs a section number.`);
  return n;
};

/** A section block's body: an optional first line "HEADING: …", then the text. */
function headed(body: string) {
  const m = /^HEADING:[ \t]*(.*)(?:\n|$)/i.exec(body);
  return m ? { heading: m[1].trim(), text: body.slice(m[0].length).replace(/^\n+/, '') } : { text: body };
}

type Section = { heading?: string; text?: string; caption?: string; [key: string]: unknown };
type Spec = { title: string; sections: Section[]; [key: string]: unknown };
const TEXT_FIELDS = new Set(['title', 'subtitle', 'author', 'date', 'summary', 'font', 'headingFont', 'kind', 'style']);

/**
 * A Clem-made document's specification with the reply's blocks applied. Section numbers are 1-based and always mean
 * the sections as they were sent, so deleting section 3 does not renumber an edit to section 5 in the same reply.
 */
export function applySpecPatch(spec: Spec, patch: Patch): Spec {
  const sections = spec.sections.map((s) => ({ ...s }));
  const count = sections.length;
  const removed = new Set<number>(), inserted = new Map<number, Section[]>();
  let next: Spec = { ...spec };
  const known = (n: number, block: PatchBlock) => { if (n < 1 || n > count) throw Error(`“@@@ ${block.command} ${n}”: the document has sections 1 to ${count}.`); return n - 1; };
  for (const block of patch.blocks) {
    switch (block.command) {
      case 'SECTION': {
        const i = known(number(block), block), { heading, text } = headed(block.body);
        if (heading !== undefined) sections[i].heading = heading || undefined;
        if (text.trim() || heading === undefined) sections[i].text = text;
        break;
      }
      case 'HEADING': sections[known(number(block), block)].heading = block.body.trim() || undefined; break;
      case 'CAPTION': sections[known(number(block), block)].caption = block.body.trim() || undefined; break;
      case 'DELETE': removed.add(known(number(block), block)); break;
      case 'INSERT': {
        // "INSERT AFTER 4", "INSERT BEFORE 1", "INSERT 4" (after 4); after 0 is the start.
        const before = block.args.some((a) => /^before$/i.test(a)), n = number(block);
        if (n < 0 || n > count || (before && n < 1)) throw Error(`“@@@ INSERT ${block.args.join(' ')}”: the document has sections 1 to ${count}.`);
        const after = before ? n - 1 : n, { heading, text } = headed(block.body);
        inserted.set(after, [...(inserted.get(after) || []), { ...(heading ? { heading } : {}), text }]);
        break;
      }
      case 'SET': {
        const field = block.args[0] || '';
        if (TEXT_FIELDS.has(field)) next[field] = block.body.trim() || undefined;
        else if (field === 'references') next.references = block.body.split('\n').map((l) => l.replace(/^\s*(?:[-*]|\[\d+\]|\d+[.)])\s*/, '').trim()).filter(Boolean);
        else if (field === 'design') next.design = parseModelJson(block.body, 'The design setting must be a JSON object.');
        else throw Error(`“@@@ SET ${field}”: only ${[...TEXT_FIELDS, 'references', 'design'].join(', ')} can be set.`);
        break;
      }
      case 'SPEC': {
        const whole = parseModelJson<Spec>(block.body, 'The full specification was not JSON.');
        if (!whole || typeof whole !== 'object' || !Array.isArray(whole.sections)) throw Error('The full specification needs a "sections" list.');
        return whole;
      }
      default: throw Error(`“@@@ ${block.command}” is not an edit Clem knows (use SECTION, HEADING, CAPTION, INSERT, DELETE, SET or SPEC).`);
    }
  }
  const out: Section[] = [...(inserted.get(0) || [])];
  sections.forEach((s, i) => { if (!removed.has(i)) out.push(s); out.push(...(inserted.get(i + 1) || [])); });
  for (const s of out) for (const key of Object.keys(s)) if (s[key] === undefined) delete s[key];
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  if (!out.length) throw Error('That would leave the document with no sections.');
  next = { ...next, sections: out };
  return next;
}

/** A Clem-made document's revised specification: from @@@ blocks, or from {"summary","spec"} when the model sent JSON. */
export function revisedSpec(spec: Spec, raw: string): { summary: string; spec: Spec } {
  const patch = readPatch(raw);
  if (patch.blocks.length) return { summary: patch.summary || 'Edited the document.', spec: applySpecPatch(spec, patch) };
  if (/^\s*(?:```\w*\s*)?\{/.test(raw)) {
    const parsed = parseModelJson<{ summary?: string; spec?: Spec }>(raw);
    if (parsed.spec && typeof parsed.spec === 'object' && Array.isArray(parsed.spec.sections)) return { summary: String(parsed.summary || 'Edited the document.'), spec: parsed.spec };
  }
  throw Error(patch.summary ? `No change was given: ${patch.summary}` : 'The reply had no @@@ edit blocks.');
}

/** The reply format for a Clem-made document, for the editing model's instructions. */
export const SPEC_PATCH_FORMAT = [
  'Reply in plain text, not JSON, in exactly this format, sending only the parts that change:',
  'SUMMARY: one short sentence describing the change',
  '@@@ SECTION n      (replaces section n; an optional first line "HEADING: …" changes its heading; then the section\'s complete new text, written out in full)',
  '@@@ HEADING n      (only the heading of section n; the next line is the new heading)',
  '@@@ CAPTION n      (the figure caption of section n)',
  '@@@ INSERT AFTER n (a new section after section n; 0 means at the start; optional "HEADING: …" line, then its text)',
  '@@@ DELETE n',
  '@@@ SET field      (title, subtitle, author, date, summary, font or headingFont: the value on the next line; references: one per line; design: a JSON object)',
  '@@@ SPEC           (only to change figures: the complete revised specification as JSON)',
  'Section numbers are the "n" values you were given. Text after a block line is copied into the document exactly as written: no escaping, no quotes around it, real line breaks, LaTeX backslashes written once (\\frac, not \\\\frac).',
].join('\n');

/** A text file with the reply's REPLACE/WITH pairs applied in order, or its FILE block as the whole new file. */
export function revisedText(current: string, raw: string): { summary: string; text: string } {
  const patch = readPatch(raw);
  if (!patch.blocks.length) {
    if (/^\s*(?:```\w*\s*)?\{/.test(raw)) {
      const parsed = parseModelJson<{ summary?: string; text?: string }>(raw);
      if (typeof parsed.text === 'string') return { summary: String(parsed.summary || 'Edited the file.'), text: parsed.text };
    }
    throw Error(patch.summary ? `No change was given: ${patch.summary}` : 'The reply had no @@@ edit blocks.');
  }
  let text = current;
  for (let i = 0; i < patch.blocks.length; i++) {
    const block = patch.blocks[i];
    if (block.command === 'FILE') { text = applyEdit(text, { content: block.body + (current.endsWith('\n') && !block.body.endsWith('\n') ? '\n' : '') }); continue; }
    if (block.command === 'REPLACE') {
      const next = patch.blocks[i + 1];
      if (next?.command !== 'WITH') throw Error('Every “@@@ REPLACE” block must be followed by a “@@@ WITH” block.');
      try { text = applyEdit(text, { find: block.body, replace: next.body }); }
      catch (error) { throw Error(`${(error as Error).message} (the text began “${block.body.slice(0, 80)}”)`); }
      i++;
      continue;
    }
    throw Error(`“@@@ ${block.command}” is not an edit Clem knows here (use REPLACE then WITH, or FILE).`);
  }
  return { summary: patch.summary || 'Edited the file.', text };
}

export const TEXT_PATCH_FORMAT = [
  'Reply in plain text, not JSON, in exactly this format:',
  'SUMMARY: one short sentence',
  '@@@ REPLACE',
  '…text copied exactly from the file, enough lines to be found only once…',
  '@@@ WITH',
  '…the new text for it…',
  'Repeat REPLACE/WITH pairs for each change. Only when most of the file changes, send "@@@ FILE" followed by the complete new file instead.',
  'Text after a block line is used exactly as written: no escaping and no quotes around it.',
].join('\n');

/** Office elements rewritten: "@@@ ELEMENT i" blocks, or {"edits":[{i,text}]} when the model sent JSON. */
export function revisedElements(raw: string): { summary: string; edits: { i: number; text: string }[] } {
  const patch = readPatch(raw);
  if (patch.blocks.length) {
    const edits = patch.blocks.map((b) => {
      if (b.command !== 'ELEMENT') throw Error(`“@@@ ${b.command}” is not an edit Clem knows here (use ELEMENT i).`);
      return { i: number(b), text: b.body };
    });
    return { summary: patch.summary, edits };
  }
  if (/^\s*(?:```\w*\s*)?\{/.test(raw)) {
    const parsed = parseModelJson<{ summary?: string; edits?: { i: number; text: string }[] }>(raw);
    return { summary: String(parsed.summary || ''), edits: Array.isArray(parsed.edits) ? parsed.edits : [] };
  }
  throw Error(patch.summary ? `No change was given: ${patch.summary}` : 'The reply had no @@@ edit blocks.');
}

export const ELEMENT_PATCH_FORMAT = [
  'Reply in plain text, not JSON, in exactly this format:',
  'SUMMARY: one short sentence',
  '@@@ ELEMENT i',
  '…the complete new text of element i…',
  'One block per changed element. Text after a block line is used exactly as written: no escaping and no quotes around it.',
].join('\n');

/** A reply that was read and means what it says ("nothing to change"): asking again would not help. */
export class Settled extends Error {}

/**
 * Asks once more when a reply could not be used: the model sees what went wrong and answers again. `use` turns a reply
 * into the result and throws, in words the model can act on, when it cannot.
 */
export async function withRetry<T>(
  ask: (messages: { role: string; content: string }[]) => Promise<string>,
  messages: { role: string; content: string }[],
  use: (raw: string) => Promise<T> | T,
  { signal, tries = 2 }: { signal?: AbortSignal; tries?: number } = {},
): Promise<T> {
  let thread = messages, failure: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    const raw = await ask(thread);
    try { return await use(raw); }
    catch (error) {
      if (signal?.aborted || error instanceof Settled) throw error;
      failure = error;
      // The tail of a long reply is enough for the model to see what it sent; the whole of it would double the request.
      const shown = raw.length > 6000 ? '…' + raw.slice(-6000) : raw;
      thread = [...messages, { role: 'assistant', content: shown }, { role: 'user', content: `That reply could not be applied: ${(error as Error).message}\nSend the edit again, complete, in the exact format asked for.` }];
    }
  }
  throw failure;
}
