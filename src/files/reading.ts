/** Where the person stopped reading each file, so a file opens again at the same place. Kept on this PC only. */
export type ReadingSpot = { /** PDFs: the page at the top of the view and how far into it (0–1). */ page?: number; frac: number; zoom?: number; at: number };

const KEY = "mowr-reading";
const LIMIT = 300;

function all(): Record<string, ReadingSpot> {
  try { const raw = JSON.parse(localStorage.getItem(KEY) || "{}"); return raw && typeof raw === "object" ? raw : {}; } catch { return {}; }
}

export function readingSpot(fileId: string): ReadingSpot | null {
  const spot = all()[fileId];
  return spot && typeof spot.frac === "number" ? spot : null;
}

export function keepReadingSpot(fileId: string, spot: Omit<ReadingSpot, "at">) {
  try {
    const spots = all();
    spots[fileId] = { ...spot, at: Date.now() };
    const ids = Object.keys(spots);
    if (ids.length > LIMIT) ids.sort((a, b) => spots[a].at - spots[b].at).slice(0, ids.length - LIMIT).forEach((id) => delete spots[id]);
    localStorage.setItem(KEY, JSON.stringify(spots));
  } catch {}
}
