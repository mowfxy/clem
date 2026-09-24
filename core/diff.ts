/** Line diff for reviewing proposed file changes. Exact LCS for ordinary files,
 *  falling back to a prefix/suffix trim when both sides are very large. */
export type DiffLine = { kind: 'same' | 'add' | 'remove'; text: string; a?: number; b?: number };

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split(/\r?\n/), b = after.split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  const out: DiffLine[] = a.slice(0, start).map((text, i) => ({ kind: 'same' as const, text, a: i + 1, b: i + 1 }));
  if (midA.length * midB.length <= 2_500_000) {
    const n = midA.length, m = midB.length, dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) { out.push({ kind: 'same', text: midA[i], a: start + i + 1, b: start + j + 1 }); i++; j++; }
      else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { out.push({ kind: 'add', text: midB[j], b: start + j + 1 }); j++; }
      else { out.push({ kind: 'remove', text: midA[i], a: start + i + 1 }); i++; }
    }
  } else {
    midA.forEach((text, i) => out.push({ kind: 'remove', text, a: start + i + 1 }));
    midB.forEach((text, j) => out.push({ kind: 'add', text, b: start + j + 1 }));
  }
  a.slice(endA).forEach((text, i) => out.push({ kind: 'same', text, a: endA + i + 1, b: endB + i + 1 }));
  return out;
}

/** Groups a diff into hunks with `context` unchanged lines around each change. */
export function hunks(lines: DiffLine[], context = 3) {
  const keep = new Set<number>();
  lines.forEach((l, i) => { if (l.kind !== 'same') for (let k = i - context; k <= i + context; k++) keep.add(k); });
  const out: (DiffLine | { kind: 'gap'; count: number })[] = [];
  let skipped = 0;
  lines.forEach((l, i) => { if (keep.has(i)) { if (skipped) out.push({ kind: 'gap', count: skipped }); skipped = 0; out.push(l); } else skipped++; });
  if (skipped && out.length) out.push({ kind: 'gap', count: skipped });
  return out;
}

export const diffStats = (lines: DiffLine[]) => ({ added: lines.filter(l => l.kind === 'add').length, removed: lines.filter(l => l.kind === 'remove').length });

/** Applies a single exact find/replace; the find text must occur exactly once. */
export function applyEdit(current: string, edit: { find?: string; replace?: string; content?: string }) {
  if (edit.content !== undefined) return edit.content;
  if (!edit.find) throw Error('The change does not say what to replace.');
  const first = current.indexOf(edit.find);
  if (first < 0) throw Error('The text to replace is no longer in the file.');
  if (current.indexOf(edit.find, first + 1) >= 0) throw Error('The text to replace appears more than once. Ask for a more specific change.');
  return current.slice(0, first) + (edit.replace ?? '') + current.slice(first + edit.find.length);
}
