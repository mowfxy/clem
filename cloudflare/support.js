// Signed-in people read their own support cases, reply to staff and see active announcements.
import { HttpError, json, now, readJson, text } from "./lib/http.js";

const caseColumns =
  "s.id,s.category,s.subject,s.message,s.created_at,COALESCE(t.status,'open') AS status,t.updated_at,t.staff_replied_at,t.user_seen_at";

export async function activeAnnouncements(env, at = now()) {
  return (
    await env.DB.prepare(
      "SELECT id,title,body,tone,link,starts_at,ends_at FROM desktop_announcements WHERE archived=0 AND starts_at<=? AND (ends_at IS NULL OR ends_at>?) ORDER BY starts_at DESC LIMIT 5",
    )
      .bind(at, at)
      .all()
  ).results;
}

async function ownCase(env, userId, id) {
  const row = await env.DB.prepare(
    `SELECT ${caseColumns} FROM mowr_support s LEFT JOIN mowr_support_state t ON t.case_id=s.id WHERE s.id=? AND s.owner_id=?`,
  )
    .bind(id, userId)
    .first();
  if (!row) throw new HttpError(404, "Case not found.");
  return row;
}

export async function handleSupport(request, env, user, path) {
  if (path === "/announcements" && request.method === "GET")
    return json({ announcements: await activeAnnouncements(env) });
  if (path === "/support/cases" && request.method === "GET") {
    const cases = (
      await env.DB.prepare(
        `SELECT ${caseColumns} FROM mowr_support s LEFT JOIN mowr_support_state t ON t.case_id=s.id WHERE s.owner_id=? ORDER BY COALESCE(t.updated_at,s.created_at) DESC LIMIT 50`,
      )
        .bind(user.id)
        .all()
    ).results;
    const messages = cases.length
      ? (
          await env.DB.prepare(
            `SELECT id,case_id,author,author_name,body,created_at FROM mowr_support_messages WHERE author!='note' AND case_id IN (${cases.map(() => "?").join(",")}) ORDER BY created_at`,
          )
            .bind(...cases.map((c) => c.id))
            .all()
        ).results
      : [];
    return json({
      cases: cases.map((c) => ({
        ...c,
        unread: !!c.staff_replied_at && (!c.user_seen_at || c.user_seen_at < c.staff_replied_at),
        messages: messages.filter((m) => m.case_id === c.id),
      })),
    });
  }
  const match = /^\/support\/cases\/([\w-]{8,64})\/(reply|seen)$/.exec(path);
  if (match && request.method === "POST") {
    const found = await ownCase(env, user.id, match[1]);
    const at = now();
    if (match[2] === "seen") {
      await env.DB.prepare(
        "INSERT INTO mowr_support_state(case_id,updated_at,user_seen_at) VALUES(?,?,?) ON CONFLICT(case_id) DO UPDATE SET user_seen_at=excluded.user_seen_at",
      )
        .bind(found.id, found.updated_at || found.created_at, at)
        .run();
      return json({ ok: true });
    }
    if (found.status === "closed")
      throw new HttpError(409, "This case is closed. Open a new request instead.");
    const body = text((await readJson(request)).body, 10000, { min: 2 });
    await env.DB.prepare(
      "INSERT INTO mowr_support_messages(id,case_id,author,author_id,author_name,body,created_at) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(crypto.randomUUID(), found.id, "user", user.id, "", body, at)
      .run();
    // A reply from the person reopens a resolved or pending case.
    await env.DB.prepare(
      "INSERT INTO mowr_support_state(case_id,status,updated_at,user_replied_at,user_seen_at) VALUES(?,'open',?,?,?) ON CONFLICT(case_id) DO UPDATE SET status='open',updated_at=excluded.updated_at,user_replied_at=excluded.user_replied_at,user_seen_at=excluded.user_seen_at",
    )
      .bind(found.id, at, at, at)
      .run();
    return json({ ok: true });
  }
  return null;
}
