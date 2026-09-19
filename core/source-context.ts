/** Local lexical retrieval with source locators and an explicit excerpt notice. */
export function sourceExcerpts(
  sources: { name: string; text: string }[],
  query: string,
  budget = 20000,
) {
  const terms = [
    ...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []),
  ];
  const chunks = sources.flatMap((source, file) => {
    const parts = [];
    for (let start = 0; start < source.text.length; start += 1600) {
      const text = source.text.slice(start, start + 1800);
      parts.push({
        file,
        start,
        text,
        name: source.name,
        score: terms.reduce(
          (n, t) => n + (text.toLowerCase().includes(t) ? 1 : 0),
          0,
        ),
      });
    }
    return parts;
  });
  const ranked = [...chunks].sort(
    (a, b) => b.score - a.score || a.start - b.start || a.file - b.file,
  );
  let used = 0;
  const selected = [];
  for (const c of ranked) {
    const cost = c.text.length + c.name.length + 70;
    if (used + cost > budget) continue;
    selected.push(c);
    used += cost;
  }
  const result = selected
    .sort((a, b) => a.file - b.file || a.start - b.start)
    .map((c) => `[Source: ${c.name}; text offset ${c.start}]\n${c.text}`)
    .join("\n\n");
  return (
    (selected.length < chunks.length
      ? "[Selected excerpts only. Do not claim to have reviewed entire files; ask for a narrower question if evidence is missing.]\n"
      : "") + result
  );
}
