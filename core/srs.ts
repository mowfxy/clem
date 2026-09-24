/** Spaced repetition with the FSRS-4.5 memory model (default parameters).
 *  Each card keeps its own stability (days until recall drops to 90%) and difficulty (1–10). */
export type Grade = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy
export type CardState = { due: number; stability: number; difficulty: number; reps: number; lapses: number; last: number };

const w = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const DECAY = -0.5, FACTOR = 19 / 81, RETENTION = 0.9, DAY = 86_400_000;
const clampD = (d: number) => Math.min(10, Math.max(1, d));

export const retrievability = (elapsedDays: number, stability: number) => Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);
/** Days until retrievability falls to the target retention. */
export const interval = (stability: number, retention = RETENTION) => Math.max(1, Math.round(stability / FACTOR * (Math.pow(retention, 1 / DECAY) - 1)));

const initialDifficulty = (g: Grade) => clampD(w[4] - (g - 3) * w[5]);

export function review(card: CardState | undefined, grade: Grade, now = Date.now()): CardState {
  if (!card || !card.reps) {
    const stability = w[grade - 1], difficulty = initialDifficulty(grade);
    // Again/Hard on a new card come back today; Good/Easy follow the model.
    const due = grade === 1 ? now + 60_000 * 5 : grade === 2 ? now + 60_000 * 30 : now + interval(stability) * DAY;
    return { due, stability, difficulty, reps: 1, lapses: grade === 1 ? 1 : 0, last: now };
  }
  const elapsed = Math.max(0, (now - card.last) / DAY), r = retrievability(elapsed, card.stability);
  const nextD = clampD(w[7] * initialDifficulty(3) + (1 - w[7]) * (card.difficulty - w[6] * (grade - 3)));
  let stability: number;
  if (grade === 1) stability = Math.min(card.stability, w[11] * Math.pow(nextD, -w[12]) * (Math.pow(card.stability + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r)));
  else stability = card.stability * (1 + Math.exp(w[8]) * (11 - nextD) * Math.pow(card.stability, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * (grade === 2 ? w[15] : 1) * (grade === 4 ? w[16] : 1));
  stability = Math.max(0.1, stability);
  const due = grade === 1 ? now + 60_000 * 10 : now + interval(stability) * DAY;
  return { due, stability, difficulty: nextD, reps: card.reps + 1, lapses: card.lapses + (grade === 1 ? 1 : 0), last: now };
}

/** Preview intervals for each button, for labels like “4d”. */
export function previews(card: CardState | undefined, now = Date.now()) {
  return ([1, 2, 3, 4] as Grade[]).map(g => { const next = review(card, g, now); return label(next.due - now); });
}
export function label(ms: number) {
  const m = ms / 60_000;
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  const d = m / 1440;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

export const isDue = (card: CardState | undefined, now = Date.now()) => !card || card.due <= now;

/** Daily pace needed to see every card at least once, plus what is due, before an exam date. */
export function examPace(cards: (CardState | undefined)[], examDate: string | undefined, now = Date.now()) {
  const unseen = cards.filter(c => !c || !c.reps).length;
  const due = cards.filter(c => c && c.reps && c.due <= now).length;
  if (!examDate) return { unseen, due, days: null as number | null, perDay: null as number | null };
  const end = new Date(examDate + 'T09:00:00').getTime();
  const days = Math.max(0, Math.ceil((end - now) / DAY));
  return { unseen, due, days, perDay: days > 0 ? Math.ceil(unseen / days) + due : unseen + due };
}
