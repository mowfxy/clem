// How much of the VPS disk Clem may use (docs/GUC-VPS-ENGINE.md "Storage limit"). The disk as a whole must never pass
// 75% full because of Clem: whatever else is on the server counts first, and Clem writes only while the disk stays
// at or under 75% after the write. Pure; the measuring is in desktop/engine/vps/limit.ts.

/** The share of the VPS disk that may be full once Clem has written. */
export const DISK_SHARE = 0.75;
/** How long a measurement is trusted before `df` runs again (writes in between are counted as they happen). */
export const MEASURE_MS = 5 * 60_000;
export type DiskSize = { total: number; free: number };

/** Bytes Clem may still write: the free space above the 25% of the disk that must stay free. Never negative. */
export const roomOn = (d: DiskSize, share = DISK_SHARE) => Math.max(0, Math.floor(d.free - (1 - share) * d.total));
/** Whether `bytes` more fit: at the limit exactly still fits; one byte over doesn't. */
export const fits = (d: DiskSize, bytes: number, share = DISK_SHARE) => bytes <= roomOn(d, share);

/** `df -Pk <path>`'s last line: total and available in KiB. Null when it can't be read. */
export function parseDf(stdout: string): DiskSize | null {
  const line = stdout.trim().split("\n").filter((l) => /\d/.test(l)).pop() || "";
  const cols = line.trim().split(/\s+/);
  // Filesystem 1024-blocks Used Available Capacity Mounted-on (the filesystem's name may hold no spaces with -P).
  const nums = cols.map((c) => (/^\d+$/.test(c) ? Number(c) : NaN));
  const at = nums.findIndex((n) => Number.isFinite(n));
  if (at < 0 || !Number.isFinite(nums[at + 2])) return null;
  const total = nums[at] * 1024, free = nums[at + 2] * 1024;
  return total > 0 ? { total, free } : null;
}

/** What Settings shows ("Using X of Y on your VPS; the rest stays on this PC"): `used` is Clem's files there, `max`
 *  what Clem may use in all (its files plus the room left). */
export type LimitView = { used: number; max: number; diskTotal: number; diskFree: number; measuredAt: number };
export const limitView = (d: DiskSize, used: number, measuredAt: number): LimitView => ({ used, max: used + roomOn(d), diskTotal: d.total, diskFree: d.free, measuredAt });
