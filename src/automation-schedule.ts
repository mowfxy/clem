// Pure schedule math for routines (no UI), so it can be tested directly.
export const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** The next run strictly after `now`, keeping the routine's own time of day (and weekday): `anchor` is
 *  its last scheduled run, stepped forward a day or a week at a time so late or missed runs do not drift. */
export function nextAutomation(schedule: string, anchor = Date.now(), now = Date.now()) {
  const date = new Date(anchor), step = schedule === "weekly" ? 7 : 1;
  do date.setDate(date.getDate() + step); while (date.getTime() <= now);
  return date.getTime();
}
/** The first time a new routine runs: the next matching time (and weekday) from now. */
export function firstAutomationRun(block: { time: string; day?: string }, now = Date.now()) {
  const [h, m] = block.time.split(":").map(Number), date = new Date(now);
  date.setHours(h, m, 0, 0);
  const day = block.day ? DAYS.indexOf(block.day) : -1;
  if (day >= 0) date.setDate(date.getDate() + ((day - date.getDay() + 7) % 7));
  if (date.getTime() <= now) date.setDate(date.getDate() + (day >= 0 ? 7 : 1));
  return date.getTime();
}
