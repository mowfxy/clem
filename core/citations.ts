/** Inline source citations. Models write [[File name.pdf, p. 3]] (page optional);
 *  Mowr turns each into a link the chat renders as a chip that opens the source. */
const pattern = /\[\[([^\]\n]{1,160}?)(?:\s*[,·|]\s*(?:p\.?|pp\.?|page)\s*(\d{1,4})(?:\s*[-–]\s*\d{1,4})?)?\]\]/gi;

export type Citation = { name: string; page?: number };

/** Rewrites citations outside code fences into `source:` links. */
export function linkCitations(markdown: string) {
  return markdown.split(/(```[\s\S]*?(?:```|$))/g).map((part, i) => i % 2 ? part : part.replace(pattern, (_, name: string, page?: string) => {
    const clean = name.trim().replace(/^source:\s*/i, '');
    return `[${clean.replace(/[[\]]/g, '')}${page ? ` · p. ${page}` : ''}](source:${encodeURIComponent(clean)}${page ? '#p=' + page : ''})`;
  })).join('');
}

export function readCitation(href: string): Citation | null {
  if (!href.startsWith('source:')) return null;
  const [name, hash = ''] = href.slice(7).split('#');
  let decoded: string;
  try { decoded = decodeURIComponent(name); } catch { return null; }
  const page = Number(/p=(\d+)/.exec(hash)?.[1]);
  return { name: decoded, page: Number.isFinite(page) && page > 0 ? page : undefined };
}

/** Finds the stored file a citation names: exact, then case-insensitive, then by stem. */
export function matchSource<T extends { name: string }>(files: T[], name: string): T | undefined {
  const lower = name.toLowerCase(), stem = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]{1,5}$/, '');
  // "notes.pdf (2)" is how a second file of the same name is shown to the model (core/file-tools.ts).
  const copy = name.match(/^(.+) \((\d+)\)$/);
  if (copy && !files.some(f => f.name === name)) return files.filter(f => f.name.toLowerCase() === copy[1].toLowerCase())[Number(copy[2]) - 1] || matchSource(files, copy[1]);
  return files.find(f => f.name === name) || files.find(f => f.name.toLowerCase() === lower) || files.find(f => stem(f.name) === stem(name)) || files.find(f => f.name.toLowerCase().endsWith('/' + lower) || f.name.toLowerCase().endsWith('\\' + lower));
}

export const citationInstructions = 'When you use supplied sources, cite them inline as [[exact file name, p. N]] right after the claim (omit the page when unknown). Only cite files that appear in the supplied sources.';
