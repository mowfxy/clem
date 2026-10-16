/** Calendar days between two moments in local time ("yesterday" means the date before today, not 24 hours ago). */
export function daysAgo(t: number, now = Date.now()) {
  const day = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  return Math.round((day(now) - day(t)) / 86_400_000);
}

/** A date as Mowr writes it: "today", "yesterday", "3 days ago", then "Sep 15" (with the year when it differs). */
export function shortWhen(t: number, now = Date.now()) {
  const days = daysAgo(t, now);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const then = new Date(t);
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(then.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) });
}

/** The same moment one calendar day earlier, at noon, so stepping back never skips or repeats a date around a clock change. */
export function dayBefore(t: number) {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12).getTime();
}
