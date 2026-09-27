// Staff API for admin.mowrai.com. Every mutation is authorised by role and written to the audit log.
import { ownerEligible, subscriptionActive } from "./account-policy.js";
import { grantActive } from "./lib/account-state.js";
import { HttpError, json, lemon, now, readJson, text } from "./lib/http.js";

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
  if (!ids.length) return { owners: new Set(), subs: [], grants: [] };
  const list = placeholders(ids);
  const [owners, subs, grants] = await Promise.all([
    all(env, `SELECT user_id FROM desktop_owner_grants WHERE user_id IN (${list})`, ...ids),
    all(env, `SELECT * FROM desktop_subscriptions WHERE user_id IN (${list})`, ...ids),
    all(env, `SELECT * FROM desktop_comp_grants WHERE user_id IN (${list})`, ...ids),
  ]);
  return { owners: new Set(owners.map((o) => o.user_id)), subs, grants };
}

const peopleSql = `WITH ids AS (SELECT user_id FROM desktop_profiles UNION SELECT user_id FROM desktop_activity UNION SELECT user_id FROM desktop_subscriptions UNION SELECT user_id FROM desktop_comp_grants UNION SELECT owner_id FROM mowr_support)
SELECT ids.user_id AS id, a.email, a.first_seen_at, a.last_seen_at, p.username, p.display_name, p.setup_step,
 CASE WHEN m.status='suspended' AND (m.until IS NULL OR m.until>?) THEN 1 ELSE 0 END AS suspended, m.until AS suspended_until,
 (SELECT COUNT(*) FROM mowr_support s WHERE s.owner_id=ids.user_id) AS cases
FROM ids LEFT JOIN desktop_activity a ON a.user_id=ids.user_id LEFT JOIN desktop_profiles p ON p.user_id=ids.user_id LEFT JOIN desktop_moderation m ON m.user_id=ids.user_id`;

async function people(env, { q = "", limit = 1000 } = {}) {
  const like = "%" + q.toLowerCase() + "%";
  const rows = await all(
    env,
    `${peopleSql} WHERE (?='' OR lower(COALESCE(a.email,'')) LIKE ? OR lower(COALESCE(p.username,'')) LIKE ? OR lower(COALESCE(p.display_name,'')) LIKE ? OR ids.user_id=?) ORDER BY COALESCE(a.last_seen_at,a.first_seen_at,'') DESC LIMIT ?`,
    now(), q, like, like, like, q, limit,
  );
  const context = await planContext(env, rows.map((r) => r.id));
  return rows.map((row) => ({ ...row, suspended: !!row.suspended, ...planFor(row.id, context) }));
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
    `SELECT s.id,s.owner_id,s.category,s.subject,s.created_at,COALESCE(t.status,'open') AS status,COALESCE(t.priority,'normal') AS priority,t.assignee_id,COALESCE(t.updated_at,s.created_at) AS updated_at,t.staff_replied_at,t.user_replied_at,a.email,p.username,
     (SELECT COUNT(*) FROM mowr_support_messages x WHERE x.case_id=s.id AND x.author!='note') AS replies
     FROM mowr_support s LEFT JOIN mowr_support_state t ON t.case_id=s.id LEFT JOIN desktop_activity a ON a.user_id=s.owner_id LEFT JOIN desktop_profiles p ON p.user_id=s.owner_id
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
  const existing = await first(env, "SELECT * FROM mowr_support_state WHERE case_id=?", caseId);
  const next = { status: "open", priority: "normal", assignee_id: null, staff_replied_at: null, user_seen_at: null, user_replied_at: null, ...existing, ...fields, updated_at: now() };
  await run(
    env,
    "INSERT INTO mowr_support_state(case_id,status,priority,assignee_id,updated_at,staff_replied_at,user_seen_at,user_replied_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET status=excluded.status,priority=excluded.priority,assignee_id=excluded.assignee_id,updated_at=excluded.updated_at,staff_replied_at=excluded.staff_replied_at",
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
    throw new HttpError(403, "Staff access requires authenticator verification. Add an authenticator in Mowr security settings.");
  const staff = { id: user.id, email: String(user.email || ""), role, mfa: aal === "aal2" };
  const get = request.method === "GET";
  const params = new URL(request.url).searchParams;
  const body = get ? {} : await readJson(request);
  let m;

  if (path === "/admin/me") return json({ ...staff, lemon: !!env.LEMON_API_KEY, directory: !!env.SUPABASE_SERVICE_ROLE_KEY, requireMfa: env.ADMIN_REQUIRE_MFA === "true" });

  if (path === "/admin/overview" && get) {
    const everyone = await people(env, { limit: 5000 });
    const since = (n) => new Date(Date.now() - n * day).toISOString();
    const count = (fn) => everyone.filter(fn).length;
    // Mowr is free: report how far people got through the app's four-step welcome instead of plans.
    const setup = {};
    for (const p of everyone) setup[p.setup_step || 0] = (setup[p.setup_step || 0] || 0) + 1;
    const signups = Array.from({ length: 14 }, (_, i) => {
      const date = new Date(Date.now() - (13 - i) * day).toISOString().slice(0, 10);
      return { date, count: count((p) => (p.first_seen_at || "").startsWith(date)) };
    });
    const cases = await caseList(env, { status: "active", limit: 500 });
    return json({
      users: everyone.length,
      newThisWeek: count((p) => p.first_seen_at && p.first_seen_at > since(7)),
      activeThisWeek: count((p) => p.last_seen_at && p.last_seen_at > since(7)),
      activeToday: count((p) => p.last_seen_at && p.last_seen_at > since(1)),
      suspended: count((p) => p.suspended),
      setup,
      openCases: cases.length,
      awaitingReply: cases.filter((c) => c.awaiting_staff).length,
      urgentCases: cases.filter((c) => c.priority === "urgent" || c.priority === "high").length,
      signups,
      recentCases: cases.slice(0, 6),
      recentAudit: await all(env, "SELECT * FROM desktop_audit_log ORDER BY created_at DESC LIMIT 8"),
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
    const plan = params.get("plan") || "all";
    let rows = await people(env, { q: (params.get("q") || "").trim().slice(0, 120) });
    const week = new Date(Date.now() - 7 * day).toISOString();
    if (plan === "suspended") rows = rows.filter((r) => r.suspended);
    else if (plan === "active") rows = rows.filter((r) => r.last_seen_at && r.last_seen_at > week);
    else if (plan === "new") rows = rows.filter((r) => r.first_seen_at && r.first_seen_at > week);
    else if (plan === "setup") rows = rows.filter((r) => (r.setup_step || 0) < 4);
    else if (plan !== "all") rows = rows.filter((r) => r.plan === plan);
    return json({ users: rows.slice(0, 500), total: rows.length });
  }

  if ((m = /^\/admin\/users\/([\w-]{3,64})$/.exec(path)) && get) {
    const userId = m[1];
    const [row] = await all(env, `${peopleSql} WHERE ids.user_id=?`, now(), userId);
    if (!row) throw new HttpError(404, "No Mowr record for this person.");
    const context = await planContext(env, [userId]);
    const [moderation, notes, cases, directory] = await Promise.all([
      first(env, "SELECT * FROM desktop_moderation WHERE user_id=?", userId),
      all(env, "SELECT * FROM desktop_staff_notes WHERE user_id=? ORDER BY created_at DESC", userId),
      all(env, "SELECT s.id,s.subject,s.category,s.created_at,COALESCE(t.status,'open') AS status,COALESCE(t.priority,'normal') AS priority FROM mowr_support s LEFT JOIN mowr_support_state t ON t.case_id=s.id WHERE s.owner_id=? ORDER BY s.created_at DESC", userId),
      supabaseUser(env, userId).catch(() => null),
    ]);
    return json({
      user: { ...row, suspended: !!row.suspended, ...planFor(userId, context) },
      subscriptions: context.subs,
      grants: context.grants.map((g) => ({ ...g, active: grantActive(g) })),
      owner: context.owners.has(userId),
      moderation,
      notes,
      cases,
      directory,
      history: await all(env, "SELECT * FROM desktop_audit_log WHERE target=? ORDER BY created_at DESC LIMIT 40", userId),
    });
  }

  if ((m = /^\/admin\/users\/([\w-]{3,64})\/(grant|revoke-grant|suspend|unsuspend|note|cancel-subscription|sync-subscription)$/.exec(path)) && !get) {
    const [, userId, action] = m;
    if (action === "note") {
      need(staff, "support");
      const note = text(body.body, 4000);
      await run(env, "INSERT INTO desktop_staff_notes(id,user_id,author_id,author_email,body,created_at) VALUES(?,?,?,?,?,?)", crypto.randomUUID(), userId, staff.id, staff.email, note, now());
      await audit(env, staff, "user.note", userId, note.slice(0, 200));
      return json({ ok: true });
    }
    need(staff, "admin");
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
    const found = await first(env, "SELECT s.*,COALESCE(t.status,'open') AS status,COALESCE(t.priority,'normal') AS priority,t.assignee_id,t.staff_replied_at,t.user_seen_at,t.user_replied_at,a.email,a.last_seen_at,p.username,p.display_name FROM mowr_support s LEFT JOIN mowr_support_state t ON t.case_id=s.id LEFT JOIN desktop_activity a ON a.user_id=s.owner_id LEFT JOIN desktop_profiles p ON p.user_id=s.owner_id WHERE s.id=?", m[1]);
    if (!found) throw new HttpError(404, "Case not found.");
    const context = await planContext(env, [found.owner_id]);
    return json({
      case: { ...found, ...planFor(found.owner_id, context) },
      messages: await all(env, "SELECT * FROM mowr_support_messages WHERE case_id=? ORDER BY created_at", found.id),
      otherCases: await all(env, "SELECT s.id,s.subject,s.created_at,COALESCE(t.status,'open') AS status FROM mowr_support s LEFT JOIN mowr_support_state t ON t.case_id=s.id WHERE s.owner_id=? AND s.id!=? ORDER BY s.created_at DESC LIMIT 10", found.owner_id, found.id),
      team: await team(env),
    });
  }

  if ((m = /^\/admin\/cases\/([\w-]{8,64})\/(reply|update)$/.exec(path)) && !get) {
    need(staff, "support");
    const found = await first(env, "SELECT id,owner_id FROM mowr_support WHERE id=?", m[1]);
    if (!found) throw new HttpError(404, "Case not found.");
    if (m[2] === "reply") {
      const internal = body.internal === true;
      const message = text(body.body, 10000, { min: 2 });
      const at = now();
      await run(env, "INSERT INTO mowr_support_messages(id,case_id,author,author_id,author_name,body,created_at) VALUES(?,?,?,?,?,?,?)", crypto.randomUUID(), found.id, internal ? "note" : "staff", staff.id, "Mowr support", message, at);
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
    if (link && !/^https:\/\/mowrai\.com\//.test(link)) throw new HttpError(400, "Links must point to mowrai.com.");
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
    const person = await first(env, "SELECT user_id FROM desktop_activity WHERE email=?", email);
    if (!person) throw new HttpError(404, "That person needs to sign in to the Mowr app once before they can be added.");
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
