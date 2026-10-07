export type UsageWindow = { usedPercent?: number | null; windowDurationMins?: number | null; resetsAt?: number | null };
export type UsageBucket = { primary?: UsageWindow | null; secondary?: UsageWindow | null };
export type UsageSnapshot = { rateLimits?: UsageBucket | null; rateLimitsByLimitId?: Record<string, UsageBucket> | null; ordinaryUsageAllowed?: boolean | null };

export function remaining(window?: UsageWindow | null): number | null {
  const used = window?.usedPercent;
  return typeof used === 'number' && Number.isFinite(used) ? Math.max(0, Math.min(100, 100 - used)) : null;
}

export function usageWindows(usage?: UsageSnapshot | null) {
  const buckets = usage?.rateLimitsByLimitId && Object.keys(usage.rateLimitsByLimitId).length
    ? Object.entries(usage.rateLimitsByLimitId) : usage?.rateLimits ? [['codex', usage.rateLimits] as const] : [];
  return buckets.flatMap(([limitId, bucket]) => [bucket.primary, bucket.secondary]
    .filter((window): window is UsageWindow => !!window)
    .map(window => ({ limitId, window, left: remaining(window) })));
}

export function isBelowSwitchThreshold(usage?: UsageSnapshot | null): boolean {
  if (usage?.ordinaryUsageAllowed === false) return true;
  const windows = usageWindows(usage);
  return windows.some(({window,left}) => left !== null &&
    ((window.windowDurationMins || 0) >= 10080 ? left < 5 : (window.windowDurationMins || 0) <= 360 ? left < 10 : false));
}

export function hasCapacity(usage?: UsageSnapshot | null): boolean {
  if (!usage || usage.ordinaryUsageAllowed === false) return false;
  const windows = usageWindows(usage);
  return windows.length > 0 && windows.every(({window,left}) => left !== null &&
    ((window.windowDurationMins || 0) >= 10080 ? left >= 5 : (window.windowDurationMins || 0) <= 360 ? left >= 10 : left > 0));
}

export function resetWindows(previous?: UsageSnapshot | null, current?: UsageSnapshot | null): string[] {
  const before = new Map(usageWindows(previous).map(({limitId,window,left}) => [`${limitId}:${window.windowDurationMins}`, {window,left}]));
  const windows=usageWindows(current).filter(({limitId,window,left}) => {
    const old = before.get(`${limitId}:${window.windowDurationMins}`);
    if (!old || old.left === null || left === null) return false;
    const resetTimeAdvanced = !!old.window.resetsAt && !!window.resetsAt && window.resetsAt > old.window.resetsAt;
    return resetTimeAdvanced ? left > old.left + 0.5 : left > old.left + 20 &&
      (!old.window.resetsAt || old.window.resetsAt <= Date.now() / 1000);
  }).map(({limitId,window}) => `${limitId} ${window.windowDurationMins === 10080 ? 'weekly' : 'hourly'}`);
  if(!windows.length&&previous?.ordinaryUsageAllowed===false&&current?.ordinaryUsageAllowed===true)windows.push('codex hourly');
  return windows;
}

/**
 * When a plan that refused a request can be used again, in milliseconds: the latest reset among the windows that are
 * used up (all of them must reset), else the soonest reset still ahead. Undefined when the provider does not say.
 */
export function resumeAt(usage?: UsageSnapshot | null, now = Date.now()): number | undefined {
  const ahead = usageWindows(usage).filter(({ window }) => typeof window.resetsAt === 'number' && window.resetsAt * 1000 > now);
  const spent = ahead.filter(({ left }) => left !== null && left <= 0);
  const times = (spent.length ? spent : ahead).map(({ window }) => window.resetsAt! * 1000);
  if (!times.length) return undefined;
  return spent.length ? Math.max(...times) : Math.min(...times);
}
