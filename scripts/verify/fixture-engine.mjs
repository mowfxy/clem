// What the desktop's engine answers when nothing is connected: GUC signed out, no VPS, Telegram unpaired, the organizer
// idle. Checks that mock window.clemDesktop themselves add it first (page.addInitScript(idleEngine)); it wraps their
// invoke, so every request is still theirs to answer and record, and only a guc*/pro*/tg*/vps* request they left to
// their catch-all (undefined or {}) gets the engine's real "not connected" answer instead of an empty object the app
// would read as data. Checks with an engine of their own (guc-hub, guc-setup, proactivity, telegram, vps) don't need it.
export function idleEngine() {
  const counts = { courses: 0, unread: 0, materials: 0, deadlines: 0, grades: 0 };
  const off = { connected: false, syncing: false, courses: 0, linked: 0, counts };
  const vps = { connected: false, storage: { mode: "device", device: 0, vps: 0, cache: 0, cap: 2 * 1024 ** 3, pinned: 0, files: { device: 0, vps: 0 } }, worker: { enabled: false, installed: false, runner: "desktop", model: "none" }, passwordAllowed: false };
  const tg = { configured: false, paired: null };
  const fail = (message) => () => { throw Error(message); };
  const answers = {
    gucStatus: () => off, gucOverview: () => off, gucInbox: () => [], gucNewCourses: () => [], gucLinks: () => [], gucCourses: () => [],
    gucAckInbox: () => ({}), gucAckNewCourses: () => ({}),
    proInbox: () => ({ posts: [], apply: [] }), proStatus: () => ({}), proLog: () => [], proWatches: () => [], proMutes: () => [], proAck: () => ({}),
    tgStatus: () => tg, tgUnpair: () => tg, tgPair: fail("Telegram isn't available yet."),
    vpsStatus: () => vps,
  };
  const idle = (r) => {
    if (answers[r.action]) return answers[r.action](r);
    if (/^guc/.test(r.action)) throw Error("Connect GUC first.");
    if (/^vps/.test(r.action)) throw Error("Set up your VPS first.");
    return undefined;
  };
  const empty = (v) => v === undefined || (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0 && Object.getPrototypeOf(v) === Object.prototype);
  const wrap = (bridge) => {
    if (!bridge || typeof bridge.invoke !== "function" || bridge.__idle) return bridge;
    const inner = bridge.invoke;
    bridge.invoke = async (r) => {
      const got = await inner(r);
      if (!/^(guc|pro|tg|vps)/.test(r?.action || "") || !empty(got)) return got;
      const answer = idle(r);
      return answer === undefined ? got : answer;
    };
    bridge.__idle = true;
    return bridge;
  };
  // A check's own hook on window.clemDesktop (set earlier) still runs, with this wrap inside it.
  const prior = Object.getOwnPropertyDescriptor(window, "clemDesktop");
  let current = prior && "value" in prior ? wrap(prior.value) : undefined;
  Object.defineProperty(window, "clemDesktop", {
    configurable: true,
    get: () => (prior?.get ? prior.get.call(window) : current),
    set: (v) => { if (prior?.set) prior.set.call(window, wrap(v)); else current = wrap(v); },
  });
}
