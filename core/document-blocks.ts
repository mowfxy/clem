export type DocumentBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph" | "bullet" | "number" | "code"; text: string }
  | { kind: "table"; rows: string[][] };
export function documentBlocks(markdown: string): DocumentBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n"),
    blocks: DocumentBlock[] = [];
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((s) => s.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const code = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i]))
        code.push(lines[i]);
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      cells(lines[i + 1]).every((c) => /^:?-{3,}:?$/.test(c))
    ) {
      const rows = [cells(line)];
      i++;
      while (
        i + 1 < lines.length &&
        lines[i + 1].includes("|") &&
        lines[i + 1].trim()
      )
        rows.push(cells(lines[++i]));
      blocks.push({ kind: "table", rows });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)/),
      bullet = line.match(/^\s*[-*+]\s+(.+)/),
      number = line.match(/^\s*\d+[.)]\s+(.+)/);
    if (heading)
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2],
      });
    else if (bullet || number)
      blocks.push({
        kind: bullet ? "bullet" : "number",
        text: (bullet || number)![1],
      });
    else if (line.trim()) blocks.push({ kind: "paragraph", text: line });
  }
  return blocks;
}
export function slidePages(text: string, width = 82, maxLines = 15) {
  const pages: string[] = [];
  let lines: string[] = [],
    used = 0;
  for (const line of text.split("\n")) {
    const words = line.split(/\s+/);
    let row = "";
    for (let word of words) {
      while (word.length > width) {
        if (row) {
          lines.push(row);
          row = "";
        }
        lines.push(word.slice(0, width));
        word = word.slice(width);
      }
      if ((row + " " + word).trim().length > width) {
        lines.push(row);
        row = word;
      } else row = (row + " " + word).trim();
    }
    lines.push(row);
  }
  while (used < lines.length) {
    pages.push(lines.slice(used, used + maxLines).join("\n"));
    used += maxLines;
  }
  return pages.length ? pages : [""];
}
