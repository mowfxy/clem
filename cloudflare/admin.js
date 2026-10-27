// Staff API for admin.m4labs.xyz, the M4 Labs admin: lab-wide accounts and team, plus each product's own sections
// (Clem today). Every mutation is authorised by role and written to the audit log.
import { ownerEligible, subscriptionActive } from "./account-policy.js";
import { grantActive } from "./lib/account-state.js";
import { HttpError, json, lemon, now, readJson, text } from "./lib/http.js";
import { claimUsername } from "./lib/username.js";

const ROLE_RANK = { support: 1, admin: 2, owner: 3 };
const PRICE_CENTS = 200;
const day = 86400000;

function claims(authorization) {
  try {
    const part = authorization.slice(7).split(".")[1];
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return {};
  }
}

export async function staffRole(env, user) {
  if (ownerEligible(user)) return "owner";
  const row = await env.DB.prepare("SELECT role FROM desktop_admins WHERE user_id=?")
    .bind(user.id)
    .first();
  return row?.role || null;
}

function need(staff, role) {
  if (ROLE_RANK[staff.role] < ROLE_RANK[role])
    throw new HttpError(403, `This action needs the ${role} role.`);
}

async function audit(env, staff, action, target, detail = "") {
  await env.DB.prepare(
    "INSERT INTO desktop_audit_log(id,actor_id,actor_email,action,target,detail,created_at) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(crypto.randomUUID(), staff.id, staff.email, action, target, String(detail).slice(0, 2000), now())
    .run();
}

const all = async (env, sql, ...values) =>
  (await env.DB.prepare(sql).bind(...values).all()).results;
const first = (env, sql, ...values) => env.DB.prepare(sql).bind(...values).first();
const run = (env, sql, ...values) => env.DB.prepare(sql).bind(...values).run();
const placeholders = (items) => items.map(() => "?").join(",");
const id = (value) => {
  if (typeof value !== "string" || !/^[\w-]{3,64}$/.test(value)) throw new HttpError(400, "Invalid identifier.");
  return value;
};
const days = (value, max = 3650) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new HttpError(400, `Choose between 1 and ${max} days.`);
  return new Date(Date.now() + n * day).toISOString();
};

/** One label per person so the portal can filter and count consistently. */
function planFor(userId, { owners, subs, grants }) {
  if (owners.has(userId)) return { plan: "owner", until: null };
  const grant = grants.filter((g) => g.user_id === userId && grantActive(g));
  if (grant.length)
    return { plan: "complimentary", until: grant.some((g) => !g.valid_until) ? null : grant.map((g) => g.valid_until).sort().at(-1) };
  const own = subs.filter((s) => s.user_id === userId);
  const live = own.find((s) => subscriptionActive(s));
  if (live) return { plan: live.status === "cancelled" ? "cancelling" : "subscribed", until: live.valid_until };
  if (own.some((s) => s.status === "past_due" || s.status === "unpaid")) return { plan: "past_due", until: null };
  if (own.length) return { plan: "lapsed", until: null };
  return { plan: "free", until: null };
}

async function planContext(env, ids) {
  const context = { owners: new Set(), subs: [], grants: [] };
  // D1 binds at most 100 parameters per query, so look people up in chunks.
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90), list = placeholders(chunk);
    const [owners, subs, grants] = await Promise.all([
      all(env, `SELECT user_id FROM desktop_owner_grants WHERE user_id IN (${list})`, ...chunk),
      all(env, `SELECT * FROM desktop_subscriptions WHERE user_id IN (${list})`, ...chunk),
      all(env, `SELECT * FROM desktop_comp_grants WHERE user_id IN (${list})`, ...chunk),
    ]);
    for (const o of owners) context.owners.add(o.user_id);
    context.subs.push(...subs);
    context.grants.push(...grants);
  }
  return context;
}

// Support cases were once stored under "supabase:<id>"; everything else uses the bare Supabase id.
const caseOwner = "(CASE WHEN s.owner_id LIKE 'supabase:%' THEN substr(s.owner_id,10) ELSE s.owner_id END)";
const ownsCase = "s.owner_id IN (?,'supabase:'||?)";

const peopleSql = `WITH ids AS (SELECT user_id FROM desktop_profiles UNION SELECT user_id FROM desktop_activity UNION SELECT user_id FROM desktop_subscriptions UNION SELECT user_id FROM desktop_comp_grants UNION SELECT ${caseOwner} FROM clem_support s)
SELECT ids.user_id AS id, a.email, a.first_seen_at, a.last_seen_at, p.username, p.display_name, p.setup_step,
 CASE WHEN m.status='suspended' AND (m.until IS NULL OR m.until>?) THEN 1 ELSE 0 END AS suspended, m.until AS suspended_until,
 (SELECT COUNT(*) FROM clem_support s WHERE s.owner_id IN (ids.user_id,'supabase:'||ids.user_id)) AS cases
FROM ids LEFT JOIN desktop_activity a ON a.user_id=ids.user_id LEFT JOIN desktop_profiles p ON p.user_id=ids.user_id LEFT JOIN desktop_moderation m ON m.user_id=ids.user_id`;

// Filters that SQL can apply before the list is cut, so totals and results are exact.
const peopleFilters = {
  suspended: ["suspended=1", false],
  active: ["last_seen_at>?", true],
  new: ["first_seen_at>?", true],
  setup: ["COALESCE(setup_step,0)<4", false],
};

// The same labels as planFor, worked out in SQL so a plan filter is applied before the list is cut instead of loading
// every person. planFor still labels the returned rows (and supplies their dates).
const plans = new Set(["owner", "complimentary", "subscribed", "cancelling", "past_due", "lapsed", "free"]);
const liveSubscription = (status) => `EXISTS(SELECT 1 FROM desktop_subscriptions x WHERE x.user_id=people.id AND x.status='${status}' AND x.valid_until>?)`;
const planSql = `CASE WHEN EXISTS(SELECT 1 FROM desktop_owner_grants o WHERE o.user_id=people.id) THEN 'owner'
 WHEN EXISTS(SELECT 1 FROM desktop_comp_grants g WHERE g.user_id=people.id AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>?)) THEN 'complimentary'
 WHEN ${liveSubscription("active")} THEN 'subscribed' WHEN ${liveSubscription("cancelled")} THEN 'cancelling'
 WHEN EXISTS(SELECT 1 FROM desktop_subscriptions x WHERE x.user_id=people.id AND x.status IN ('past_due','unpaid')) THEN 'past_due'
 WHEN EXISTS(SELECT 1 FROM desktop_subscriptions x WHERE x.user_id=people.id) THEN 'lapsed' ELSE 'free' END`;

// M4 Labs accounts live in Supabase and sign in to every lab product. With the service key the portal lists all of
// them; without it, it falls back to the people Clem has seen.
let directoryCache = { at: 0, users: null };
async function directory(env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  if (directoryCache.users && Date.now() - directoryCache.at < 60000) return directoryCache.users;
  const users = [];
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new HttpError(502, "The M4 Labs account directory could not be read.");
    const batch = (await r.json()).users || [];
    for (const u of batch) users.push({ id: u.id, email: u.email || null, created_at: u.created_at || null, last_sign_in_at: u.last_sign_in_at || null });
    if (batch.length < 1000) break;
  }
  directoryCache = { at: Date.now(), users };
  return users;
}

// A username alone (claimed from any lab product) makes a profile row without the person ever opening Clem.
const clemProducts = (u) => (u.first_seen_at || u.setup_step || u.cases || u.plan !== "free" ? ["clem"] : []);

// Every M4 Labs account, joined to what each product knows about it. Filters other than "account" are Clem's.
async function accounts(env, { q = "", filter = "all", limit = 500 } = {}) {
  const listed = await directory(env).catch(() => null);
  if (!listed) {
    const found = await people(env, { q, filter, limit });
    return { ...found, users: found.users.map((u) => ({ ...u, products: clemProducts(u) })), directory: false };
  }
  const clem = await people(env, { limit: 100000 });
  const byId = new Map(clem.users.map((u) => [u.id, u]));
  const merged = listed.map((a) => {
    const c = byId.get(a.id);
    byId.delete(a.id);
    return c ? { ...c, email: c.email || a.email, created_at: a.created_at, last_sign_in_at: a.last_sign_in_at, products: clemProducts(c) }
      : { id: a.id, email: a.email, created_at: a.created_at, last_sign_in_at: a.last_sign_in_at, suspended: false, cases: 0, plan: "free", products: [] };
  });
  // Clem records whose account is gone from the directory stay visible so their cases and history are reachable.
  for (const c of byId.values()) merged.push({ ...c, products: clemProducts(c) });
  const week = Date.now() - 7 * day;
  const after = (v) => !!v && Date.parse(v) > week;
  const needle = q.toLowerCase();
  const tests = {
    all: () => true,
    active: (u) => after(u.last_seen_at) || after(u.last_sign_in_at),
    new: (u) => after(u.created_at || u.first_seen_at),
    setup: (u) => u.products.includes("clem") && (u.setup_step || 0) < 4,
    suspended: (u) => u.suspended,
    account: (u) => !u.products.length,
  };
  const test = tests[filter] || (() => false);
  const latest = (u) => [u.last_seen_at, u.last_sign_in_at, u.created_at, u.first_seen_at].filter(Boolean).sort().pop() || "";
  const users = merged
    .filter((u) => test(u) && (!needle || u.id === q || [u.email, u.username, u.display_name].some((v) => String(v || "").toLowerCase().includes(needle))))
    .sort((a, b) => latest(b).localeCompare(latest(a)));
  return { users: users.slice(0, limit), total: users.length, directory: true };
}

async function people(env, { q = "", filter = "all", limit = 500 } = {}) {
  const like = "%" + q.toLowerCase() + "%";
  const where = ["(?='' OR lower(COALESCE(email,'')) LIKE ? OR lower(COALESCE(username,'')) LIKE ? OR lower(COALESCE(display_name,'')) LIKE ? OR id=?)"];
  const values = [now(), q, like, like, like, q];
  const sqlFilter = peopleFilters[filter];
  if (sqlFilter) {
    where.push(sqlFilter[0]);
    if (sqlFilter[1]) values.push(new Date(Date.now() - 7 * day).toISOString());
  } else if (plans.has(filter)) {
    const at = now();
    where.push(`${planSql}=?`);
    values.push(at, at, at, filter);
  } else if (filter !== "all") where.push("0");
  const base = `SELECT * FROM (${peopleSql}) AS people WHERE ${where.join(" AND ")}`;
  const [rows, counted] = await Promise.all([
    all(env, `${base} ORDER BY COALESCE(last_seen_at,first_seen_at,'') DESC LIMIT ?`, ...values, limit),
    first(env, `SELECT COUNT(*) AS n FROM (${base})`, ...values),
  ]);
  const context = await planContext(env, rows.map((r) => r.id));
  const list = rows.map((row) => ({ ...row, suspended: !!row.suspended, ...planFor(row.id, context) }));
  return { users: list, total: counted.n };
}

async function supabaseUser(env, userId) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return null;
  const u = await r.json();
  return { email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, confirmed: !!u.email_confirmed_at, mfa: !!u.factors?.some((f) => f.status === "verified"), providers: u.app_metadata?.providers || [] };
}

async function caseList(env, { status = "active", q = "", limit = 200 }) {
  const statusFilter = status === "all" ? "" : status === "active" ? "AND COALESCE(t.status,'open') IN ('open','pending')" : "AND COALESCE(t.status,'open')=?";
  const like = "%" + q.toLowerCase() + "%";
  const values = [...(status !== "all" && status !== "active" ? [status] : []), q, like, like, like, limit];
  const rows = await all(
    env,
    `SELECT s.id,${caseOwner} AS owner_id,s.category,s.subject,s.created_at,COALESCE(t.status,'open') AS status,COALESCE(t.priority,'normal') AS priority,t.assignee_id,COALESCE(t.updated_at,s.created_at) AS updated_at,t.staff_replied_at,t.user_replied_at,a.email,p.username,
     (SELECT COUNT(*) FROM clem_support_messages x WHERE x.case_id=s.id AND x.author!='note') AS replies
     FROM clem_support s LEFT JOIN clem_support_state t ON t.case_id=s.id LEFT JOIN desktop_activity a ON a.user_id=${caseOwner} LEFT JOIN desktop_profiles p ON p.user_id=${caseOwner}
     WHERE 1=1 ${statusFilter} AND (?='' OR lower(s.subject) LIKE ? OR lower(COALESCE(a.email,'')) LIKE ? OR lower(s.message) LIKE ?)
     ORDER BY CASE COALESCE(t.priority,'normal') WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, COALESCE(t.updated_at,s.created_at) DESC LIMIT ?`,
    ...values,
  );
  return rows.map((row) => ({
    ...row,
    awaiting_staff: row.status === "open" && (!row.staff_replied_at || (row.user_replied_at && row.user_replied_at > row.staff_replied_at)),
  }));
}

async function setCaseState(env, caseId, fields) {
  const existing = await first(env, "SELECT * FROM clem_support_state WHERE case_id=?", caseId);
  const next = { status: "open", priority: "normal", assignee_id: null, staff_replied_at: null, user_seen_at: null, user_replied_at: null, ...existing, ...fields, updated_at: now() };
  await run(
    env,
    "INSERT INTO clem_support_state(case_id,status,priority,assignee_id,updated_at,staff_replied_at,user_seen_at,user_replied_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET status=excluded.status,priority=excluded.priority,assignee_id=excluded.assignee_id,updated_at=excluded.updated_at,staff_replied_at=excluded.staff_replied_at",
    caseId, next.status, next.priority, next.assignee_id, next.updated_at, next.staff_replied_at, next.user_seen_at, next.user_replied_at,
  );
  return next;
}

async function team(env) {
  const rows = await all(env, "SELECT user_id AS id,email,role,added_by,added_at FROM desktop_admins ORDER BY added_at");
  const owners = await all(env, "SELECT g.user_id AS id,a.email FROM desktop_owner_grants g LEFT JOIN desktop_activity a ON a.user_id=g.user_id");
  return [...owners.map((o) => ({ id: o.id, email: o.email || "Owner", role: "owner" })), ...rows];
}

export async function handleAdmin(request, env, user, path, authorization) {
  const role = await staffRole(env, user);
  if (!role) throw new HttpError(403, "This account does not have staff access.");
  const aal = claims(authorization).aal;
  if (env.ADMIN_REQUIRE_MFA === "true" && aal !== "aal2")
    throw new HttpError(403, "Staff access needs an authenticator. Set one up to continue.", "MFA_REQUIRED");
  const staff = { id: user.id, email: String(user.email || ""), role, mfa: aal === "aal2" };
  const get = request.method === "GET";
  const params = new URL(request.url).searchParams;
  const body = get ? {} : await readJson(request);
  let m;

  if (path === "/admin/me") return json({ ...staff, lemon: !!env.LEMON_API_KEY, directory: !!env.SUPABASE_SERVICE_ROLE_KEY, requireMfa: env.ADMIN_REQUIRE_MFA === "true", products: ["clem"] });

  if (path === "/admin/overview" && get) {
    const since = (n) => new Date(Date.now() - n * day).toISOString();
    // Counted in SQL so totals stay exact however many people use Clem.
    const [listed, totals, steps, joined, caseTotals, recentCases] = await Promise.all([
      directory(env).catch(() => null),
      first(env, `SELECT COUNT(*) AS users, SUM(first_seen_at>?) AS newThisWeek, SUM(last_seen_at>?) AS activeThisWeek, SUM(last_seen_at>?) AS activeToday, SUM(suspended) AS suspended FROM (${peopleSql})`, since(7), since(7), since(1), now()),
      all(env, `SELECT COALESCE(setup_step,0) AS step, COUNT(*) AS n FROM (${peopleSql}) GROUP BY COALESCE(setup_step,0)`, now()),
      all(env, `SELECT substr(first_seen_at,1,10) AS date, COUNT(*) AS n FROM (${peopleSql}) WHERE first_seen_at>=? GROUP BY substr(first_seen_at,1,10)`, now(), since(14).slice(0, 10)),
      first(env, "SELECT COUNT(*) AS open, SUM(CASE WHEN COALESCE(t.status,'open')='open' AND (t.staff_replied_at IS NULL OR (t.user_replied_at IS NOT NULL AND t.user_replied_at>t.staff_replied_at)) THEN 1 ELSE 0 END) AS awaiting, SUM(CASE WHEN COALESCE(t.priority,'normal') IN ('urgent','high') THEN 1 ELSE 0 END) AS urgent FROM clem_support s LEFT JOIN clem_support_state t ON t.case_id=s.id WHERE COALESCE(t.status,'open') IN ('open','pending')"),
      caseList(env, { status: "active", limit: 6 }),
    ]);
    // Clem is free: report how far people got through the app's four-step welcome instead of plans.
    const setup = Object.fromEntries(steps.map((r) => [r.step, r.n]));
    const signups = Array.from({ length: 14 }, (_, i) => {
      const date = new Date(Date.now() - (13 - i) * day).toISOString().slice(0, 10);
      return { date, count: joined.find((r) => r.date === date)?.n || 0 };
    });
    return json({
      // Lab-wide: every M4 Labs account, whichever products it uses. Null when the directory is not configured.
      accounts: listed && { total: listed.length, newThisWeek: listed.filter((a) => a.created_at > since(7)).length, activeThisWeek: listed.filter((a) => a.last_sign_in_at > since(7)).length },
      users: totals.users,
      newThisWeek: totals.newThisWeek || 0,
      activeThisWeek: totals.activeThisWeek || 0,
      activeToday: totals.activeToday || 0,
      suspended: totals.suspended || 0,
      setup,
      openCases: caseTotals.open,
      awaitingReply: caseTotals.awaiting || 0,
      urgentCases: caseTotals.urgent || 0,
      signups,
      recentCases,
      // The audit log is admin-only (see /admin/audit); support staff do not see it here either.
      recentAudit: ROLE_RANK[staff.role] >= ROLE_RANK.admin ? await all(env, "SELECT * FROM desktop_audit_log ORDER BY created_at DESC LIMIT 8") : [],
    });
  }

  if (path === "/admin/stats" && get) {
    const range = [7, 30, 90].includes(Number(params.get("days"))) ? Number(params.get("days")) : 30;
    const from = new Date(Date.now() - (range - 1) * day).toISOString().slice(0, 10);
    const [models, daily, hours, perPerson, links, sync] = await Promise.all([
      all(env, "SELECT provider,model,SUM(turns) AS turns,SUM(images) AS images,COUNT(DISTINCT user_id) AS people FROM desktop_usage WHERE day>=? GROUP BY provider,model ORDER BY turns DESC", from),
      all(env, "SELECT day,SUM(turns) AS turns,COUNT(DISTINCT user_id) AS people FROM desktop_usage WHERE day>=? GROUP BY day ORDER BY day", from),
      all(env, "SELECT day,hours FROM desktop_usage_hours WHERE day>=?", from),
      all(env, "SELECT user_id,SUM(turns) AS turns,COUNT(DISTINCT provider) AS providers,COUNT(DISTINCT day) AS days FROM desktop_usage WHERE day>=? GROUP BY user_id ORDER BY turns DESC", from),
      all(env, "SELECT kind,COUNT(DISTINCT user_id) AS people FROM provider_links GROUP BY kind"),
      all(env, "SELECT kind,COUNT(*) AS people FROM desktop_sync GROUP BY kind"),
    ]);
    const reasoning = await all(env, "SELECT reasoning,SUM(turns) AS turns FROM desktop_usage WHERE day>=? AND reasoning<>'' GROUP BY reasoning ORDER BY turns DESC", from);
    const providers = {};
    for (const m of models) {
      const p = (providers[m.provider] ||= { provider: m.provider, turns: 0, images: 0 });
      p.turns += m.turns;
      p.images += m.images;
    }
    const providerPeople = await all(env, "SELECT provider,COUNT(DISTINCT user_id) AS people FROM desktop_usage WHERE day>=? GROUP BY provider", from);
    for (const row of providerPeople) if (providers[row.provider]) providers[row.provider].people = row.people;
    const byHour = Array(24).fill(0), byWeekday = Array(7).fill(0);
    for (const row of hours) String(row.hours).split(",").forEach((n, h) => { byHour[h] += Number(n) || 0; });
    for (const row of daily) byWeekday[new Date(row.day + "T12:00:00Z").getUTCDay()] += row.turns;
    const series = Array.from({ length: range }, (_, i) => {
      const date = new Date(Date.now() - (range - 1 - i) * day).toISOString().slice(0, 10);
      const found = daily.find((d) => d.day === date);
      return { date, count: found?.turns || 0, people: found?.people || 0 };
    });
    const turns = models.reduce((sum, m) => sum + m.turns, 0);
    const busiest = series.reduce((best, d) => (d.count > best.count ? d : best), { date: null, count: 0 });
    return json({
      range,
      turns,
      images: models.reduce((sum, m) => sum + m.images, 0),
      people: perPerson.length,
      perPerson: perPerson.length ? Math.round(turns / perPerson.length) : 0,
      topPerson: perPerson[0]?.turns || 0,
      multiProvider: perPerson.filter((p) => p.providers > 1).length,
      everyDay: perPerson.filter((p) => p.days >= Math.min(range, 7)).length,
      busiest,
      providers: Object.values(providers).sort((a, b) => b.turns - a.turns),
      models: models.slice(0, 12),
      reasoning,
      byHour,
      byWeekday,
      series,
      links,
      sync,
    });
  }

  if (path === "/admin/users" && get) {
    return json(await accounts(env, { q: (params.get("q") || "").trim().slice(0, 120), filter: params.get("plan") || "all" }));
  }

  if ((m = /^\/admin\/users\/([\w-]{3,64})$/.exec(path)) && get) {
    const userId = m[1];
    const [row] = await all(env, `${peopleSql} WHERE ids.user_id=?`, now(), userId);
    if (!row) {
      // An M4 Labs account that has not used a product yet: show what the directory knows.
      const account = await supabaseUser(env, userId).catch(() => null);
      if (!account) throw new HttpError(404, "No M4 Labs account with this ID.");
      const [notes, history] = await Promise.all([
        all(env, "SELECT * FROM desktop_staff_notes WHERE user_id=? ORDER BY created_at DESC", userId),
        ROLE_RANK[staff.role] >= ROLE_RANK.admin ? all(env, "SELECT * FROM desktop_audit_log WHERE target=? ORDER BY created_at DESC LIMIT 40", userId) : [],
      ]);
      return json({
        user: { id: userId, email: account.email, created_at: account.created_at, last_sign_in_at: account.last_sign_in_at, suspended: false, cases: 0, plan: "free", products: [] },
        owner: false, moderation: null, notes, cases: [], directory: account, history,
      });
    }
    const context = await planContext(env, [userId]);
    const [moderation, notes, cases, directory] = await Promise.all([
      first(env, "SELECT * FROM desktop_moderation WHERE user_id=?", userId),
      all(env, "SELECT * FROM desktop_staff_notes WHERE user_id=? ORDER BY created_at DESC", userId),
      all(env, `SELECT s.id,s.subject,s.category,s.created_at,COALESCE(t.status,'open') AS status,COALESCE(t.priority,'normal') AS priority FROM clem_support s LEFT JOIN clem_support_state t ON t.case_id=s.id WHERE ${ownsCase} ORDER BY s.created_at DESC`, userId, userId),
      supabaseUser(env, userId).catch(() => null),
    ]);
    return json({
      user: { ...row, suspended: !!row.suspended, ...planFor(userId, context), products: clemProducts({ ...row, ...planFor(userId, context) }) },
      subscriptions: context.subs,
      grants: context.grants.map((g) => ({ ...g, active: grantActive(g) })),
      owner: context.owners.has(userId),
      moderation,
      notes,
      cases,
      directory,
      history: ROLE_RANK[staff.role] >= ROLE_RANK.admin ? await all(env, "SELECT * FROM desktop_audit_log WHERE target=? ORDER BY created_at DESC LIMIT 40", userId) : [],
    });
  }

  if ((m = /^\/admin\/users\/([\w-]{3,64})\/(grant|revoke-grant|suspend|unsuspend|note|username|cancel-subscription|sync-subscription)$/.exec(path)) && !get) {
    const [, userId, action] = m;
    if (action === "note") {
      need(staff, "support");
      const note = text(body.body, 4000);
      await run(env, "INSERT INTO desktop_staff_notes(id,user_id,author_id,author_email,body,created_at) VALUES(?,?,?,?,?,?)", crypto.randomUUID(), userId, staff.id, staff.email, note, now());
      await audit(env, staff, "user.note", userId, note.slice(0, 200));
      return json({ ok: true });
    }
    need(staff, "admin");
    if (action === "username") {
      const { username, previous } = await claimUsername(env, userId, body.username);
      await audit(env, staff, "user.username", userId, `${previous ? "@" + previous : "none"} → @${username}`);
      return json({ ok: true, username });
    }
    if (action === "grant") {
      const until = days(body.days);
      const reason = text(body.reason, 300, { required: false });
      await run(env, "INSERT INTO desktop_comp_grants(id,user_id,reason,valid_until,created_by,created_at) VALUES(?,?,?,?,?,?)", crypto.randomUUID(), userId, reason, until, staff.id, now());
      await audit(env, staff, "subscription.grant", userId, `${until ? "until " + until.slice(0, 10) : "no expiry"}${reason ? " · " + reason : ""}`);
      return json({ ok: true });
    }
    if (action === "revoke-grant") {
      const grantId = id(body.grantId);
      const result = await run(env, "UPDATE desktop_comp_grants SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL", now(), grantId, userId);
      if (!result.meta?.changes && !result.changes) throw new HttpError(404, "Grant not found or already revoked.");
      await audit(env, staff, "subscription.revoke_grant", userId, grantId);
      return json({ ok: true });
    }
    if (action === "suspend") {
      if (await first(env, "SELECT 1 FROM desktop_owner_grants WHERE user_id=?", userId))
        throw new HttpError(409, "Owner accounts cannot be suspended.");
      if (userId === staff.id) throw new HttpError(409, "You cannot suspend yourself.");
      const reason = text(body.reason, 500);
      const until = days(body.days, 3650);
      await run(env, "INSERT INTO desktop_moderation(user_id,status,reason,until,updated_by,updated_at) VALUES(?,'suspended',?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET status='suspended',reason=excluded.reason,until=excluded.until,updated_by=excluded.updated_by,updated_at=excluded.updated_at", userId, reason, until, staff.id, now());
      await audit(env, staff, "user.suspend", userId, `${reason}${until ? " · until " + until.slice(0, 10) : ""}`);
      return json({ ok: true });
    }
    if (action === "unsuspend") {
      if (userId === staff.id) throw new HttpError(409, "Another admin must lift your suspension.");
      await run(env, "INSERT INTO desktop_moderation(user_id,status,reason,until,updated_by,updated_at) VALUES(?,'active','',NULL,?,?) ON CONFLICT(user_id) DO UPDATE SET status='active',reason='',until=NULL,updated_by=excluded.updated_by,updated_at=excluded.updated_at", userId, staff.id, now());
      await audit(env, staff, "user.unsuspend", userId);
      return json({ ok: true });
    }
    const subscriptionId = String(body.subscriptionId || "");
    if (!/^\d+$/.test(subscriptionId)) throw new HttpError(400, "Invalid subscription.");
    const owned = await first(env, "SELECT * FROM desktop_subscriptions WHERE subscription_id=? AND user_id=?", subscriptionId, userId);
    if (!owned) throw new HttpError(404, "Subscription not found for this person.");
    if (!env.LEMON_API_KEY) throw new HttpError(503, "Lemon Squeezy is not configured on the account service.");
    const current = action === "cancel-subscription" ? await lemon(env, "subscriptions/" + subscriptionId, undefined, "DELETE") : await lemon(env, "subscriptions/" + subscriptionId);
    const a = current.data.attributes;
    await run(env, "UPDATE desktop_subscriptions SET status=?,valid_until=?,updated_at=? WHERE subscription_id=?", a.status, a.ends_at || a.renews_at || owned.valid_until, a.updated_at || now(), subscriptionId);
    await audit(env, staff, action === "cancel-subscription" ? "subscription.cancel" : "subscription.sync", userId, `${subscriptionId} → ${a.status}`);
    return json({ ok: true, status: a.status });
  }

  if (path === "/admin/subscriptions" && get) {
    const [subs, grants] = await Promise.all([
      all(env, "SELECT s.*,a.email,p.username FROM desktop_subscriptions s LEFT JOIN desktop_activity a ON a.user_id=s.user_id LEFT JOIN desktop_profiles p ON p.user_id=s.user_id ORDER BY s.updated_at DESC LIMIT 500"),
      all(env, "SELECT g.*,a.email,p.username FROM desktop_comp_grants g LEFT JOIN desktop_activity a ON a.user_id=g.user_id LEFT JOIN desktop_profiles p ON p.user_id=g.user_id ORDER BY g.created_at DESC LIMIT 500"),
    ]);
    return json({
      subscriptions: subs.map((s) => ({ ...s, active: subscriptionActive(s) })),
      grants: grants.map((g) => ({ ...g, active: grantActive(g) })),
      priceCents: PRICE_CENTS,
      lemon: !!env.LEMON_API_KEY,
      testMode: env.LEMON_TEST_MODE === "true",
    });
  }

  if (path === "/admin/cases" && get)
    return json({ cases: await caseList(env, { status: params.get("status") || "active", q: (params.get("q") || "").trim().slice(0, 120) }) });

  if ((m = /^\/admin\/cases\/([\w-]{8,64})$/.exec(path)) && get) {
    const found = await first(env, `SELECT s.*,${caseOwner} AS owner_id,COALESCE(t.status,'open') AS status,COALESCE(t.priority,'normal') AS priority,t.assignee_id,t.staff_replied_at,t.user_seen_at,t.user_replied_at,a.email,a.last_seen_at,p.username,p.display_name FROM clem_support s LEFT JOIN clem_support_state t ON t.case_id=s.id LEFT JOIN desktop_activity a ON a.user_id=${caseOwner} LEFT JOIN desktop_profiles p ON p.user_id=${caseOwner} WHERE s.id=?`, m[1]);
    if (!found) throw new HttpError(404, "Case not found.");
    const context = await planContext(env, [found.owner_id]);
    return json({
      case: { ...found, ...planFor(found.owner_id, context) },
      messages: await all(env, "SELECT * FROM clem_support_messages WHERE case_id=? ORDER BY created_at", found.id),
      otherCases: await all(env, `SELECT s.id,s.subject,s.created_at,COALESCE(t.status,'open') AS status FROM clem_support s LEFT JOIN clem_support_state t ON t.case_id=s.id WHERE ${ownsCase} AND s.id!=? ORDER BY s.created_at DESC LIMIT 10`, found.owner_id, found.owner_id, found.id),
      team: await team(env),
    });
  }

  if ((m = /^\/admin\/cases\/([\w-]{8,64})\/(reply|update)$/.exec(path)) && !get) {
    need(staff, "support");
    const found = await first(env, `SELECT s.id,${caseOwner} AS owner_id FROM clem_support s WHERE s.id=?`, m[1]);
    if (!found) throw new HttpError(404, "Case not found.");
    if (m[2] === "reply") {
      const internal = body.internal === true;
      const message = text(body.body, 10000, { min: 2 });
      const at = now();
      await run(env, "INSERT INTO clem_support_messages(id,case_id,author,author_id,author_name,body,created_at) VALUES(?,?,?,?,?,?,?)", crypto.randomUUID(), found.id, internal ? "note" : "staff", staff.id, "Clem support", message, at);
      if (!internal) await setCaseState(env, found.id, { status: ["open", "pending", "resolved", "closed"].includes(body.status) ? body.status : "pending", staff_replied_at: at });
      await audit(env, staff, internal ? "case.note" : "case.reply", found.owner_id, found.id);
      return json({ ok: true });
    }
    const fields = {};
    if (body.status !== undefined) {
      if (!["open", "pending", "resolved", "closed"].includes(body.status)) throw new HttpError(400, "Invalid status.");
      fields.status = body.status;
    }
    if (body.priority !== undefined) {
      if (!["low", "normal", "high", "urgent"].includes(body.priority)) throw new HttpError(400, "Invalid priority.");
      fields.priority = body.priority;
    }
    if (body.assigneeId !== undefined) fields.assignee_id = body.assigneeId === null ? null : id(body.assigneeId);
    await setCaseState(env, found.id, fields);
    await audit(env, staff, "case.update", found.owner_id, `${found.id} ${JSON.stringify(fields)}`);
    return json({ ok: true });
  }

  if (path === "/admin/announcements") {
    if (get) return json({ announcements: await all(env, "SELECT * FROM desktop_announcements ORDER BY archived, created_at DESC LIMIT 100") });
    need(staff, "admin");
    const tone = ["info", "success", "warning"].includes(body.tone) ? body.tone : "info";
    const link = body.link ? text(body.link, 300) : null;
    if (link && !/^https:\/\/clem.m4labs.xyz\//.test(link)) throw new HttpError(400, "Links must point to clem.m4labs.xyz.");
    const announcement = { id: crypto.randomUUID(), title: text(body.title, 80), body: text(body.body, 400), tone, link, starts_at: now(), ends_at: days(body.days, 365) };
    await run(env, "INSERT INTO desktop_announcements(id,title,body,tone,link,starts_at,ends_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)", announcement.id, announcement.title, announcement.body, tone, link, announcement.starts_at, announcement.ends_at, staff.id, now());
    await audit(env, staff, "announcement.publish", announcement.id, announcement.title);
    return json({ ok: true, announcement });
  }
  if ((m = /^\/admin\/announcements\/([\w-]{8,64})\/archive$/.exec(path)) && !get) {
    need(staff, "admin");
    await run(env, "UPDATE desktop_announcements SET archived=1 WHERE id=?", m[1]);
    await audit(env, staff, "announcement.archive", m[1]);
    return json({ ok: true });
  }

  if (path === "/admin/team") {
    if (get) return json({ team: await team(env) });
    need(staff, "owner");
    const email = text(body.email, 200).toLowerCase();
    const role = body.role === "support" ? "support" : "admin";
    // Activity rows refresh on sign-in, so after an email change two accounts can briefly share one address.
    let matches = await all(env, "SELECT user_id FROM desktop_activity WHERE email=? LIMIT 2", email);
    if (!matches.length) matches = ((await directory(env).catch(() => null)) || []).filter((a) => a.email?.toLowerCase() === email).map((a) => ({ user_id: a.id }));
    if (!matches.length) throw new HttpError(404, "That person needs an M4 Labs account first. They can create one by signing in to any lab product.");
    if (matches.length > 1) throw new HttpError(409, "More than one account has used this email, so it cannot be matched to one person yet.");
    const [person] = matches;
    await run(env, "INSERT INTO desktop_admins(user_id,email,role,added_by,added_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,email=excluded.email", person.user_id, email, role, staff.id, now());
    await audit(env, staff, "team.add", person.user_id, `${email} as ${role}`);
    return json({ ok: true });
  }
  if ((m = /^\/admin\/team\/([\w-]{3,64})\/remove$/.exec(path)) && !get) {
    need(staff, "owner");
    await run(env, "DELETE FROM desktop_admins WHERE user_id=?", m[1]);
    await audit(env, staff, "team.remove", m[1]);
    return json({ ok: true });
  }

  if (path === "/admin/audit" && get) {
    need(staff, "admin");
    const q = "%" + (params.get("q") || "").toLowerCase().slice(0, 120) + "%";
    return json({ entries: await all(env, "SELECT * FROM desktop_audit_log WHERE lower(action||' '||target||' '||detail||' '||actor_email) LIKE ? ORDER BY created_at DESC LIMIT 300", q) });
  }

  throw new HttpError(404, "Not found");
}
