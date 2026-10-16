import { useEffect, useRef } from "react";

/** One letter per menu row, as in Claude's menus: a word's first letter when free, else the next unused letter in the
 *  label. Destructive rows pick first so Delete/Remove keep their D/R. */
export function menuKeys(rows: { label: string; danger?: boolean }[]): (string | null)[] {
  const used = new Set<string>(), keys: (string | null)[] = rows.map(() => null);
  const order = rows.map((_, i) => i).sort((a, b) => Number(!!rows[b].danger) - Number(!!rows[a].danger));
  for (const i of order) {
    const label = rows[i].label.toUpperCase();
    const pick = [...label.split(/\s+/).map((w) => w[0] || ""), ...label].find((c) => /^[A-Z]$/.test(c) && !used.has(c));
    if (pick) { used.add(pick); keys[i] = pick; }
  }
  return keys;
}

/** While the menu is open, pressing a row's letter runs that row. */
export function useMenuKeys(open: boolean, keys: (string | null)[], run: (index: number) => void) {
  const latest = useRef({ keys, run });
  latest.current = { keys, run };
  useEffect(() => {
    if (!open) return;
    const press = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if ((e.target as HTMLElement | null)?.closest?.("input,textarea,select,[contenteditable='true']")) return;
      const i = latest.current.keys.indexOf(e.key.toUpperCase());
      if (i < 0) return;
      e.preventDefault();
      latest.current.run(i);
    };
    document.addEventListener("keydown", press);
    return () => document.removeEventListener("keydown", press);
  }, [open]);
}
