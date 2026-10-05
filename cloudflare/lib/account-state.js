import { subscriptionActive } from "../account-policy.js";
import { now } from "./http.js";

// Entitlement must keep working if the Worker is deployed before admin-schema.sql is applied.
const missingTable = (error) => /no such table/i.test(String(error?.message || error));
async function tolerant(work, fallback) {
  try {
    return await work();
  } catch (error) {
    if (missingTable(error)) return fallback;
    throw error;
  }
}

/** Returns the current suspension, or null. Expired suspensions are treated as lifted. */
export async function suspension(env, userId, at = Date.now()) {
  const row = await tolerant(
    () =>
      env.DB.prepare("SELECT status,reason,until FROM desktop_moderation WHERE user_id=?")
        .bind(userId)
        .first(),
    null,
  );
  if (!row || row.status !== "suspended") return null;
  if (row.until && Date.parse(row.until) <= at) return null;
  return { reason: row.reason, until: row.until || null };
}

export function grantActive(grant, at = Date.now()) {
  return (
    !grant.revoked_at &&
    (!grant.valid_until || Date.parse(grant.valid_until) > at)
  );
}

export async function complimentary(env, userId) {
  const grants = await tolerant(
    () => env.DB.prepare("SELECT * FROM desktop_comp_grants WHERE user_id=?").bind(userId).all(),
    { results: [] },
  );
  return grants.results.some((grant) => grantActive(grant));
}

export async function subscriptions(env, userId) {
  return (
    await env.DB.prepare("SELECT * FROM desktop_subscriptions WHERE user_id=?")
      .bind(userId)
      .all()
  ).results;
}

export const hasActiveSubscription = (rows) =>
  rows.some((row) => subscriptionActive(row));

/** Lets staff find a person by email. Only written from authenticated requests. */
export async function recordActivity(env, user) {
  const at = now();
  await tolerant(() => env.DB.prepare(
    // Entitlement is polled often; last-seen only needs hourly precision, so unchanged rows are not rewritten sooner.
    "INSERT INTO desktop_activity(user_id,email,first_seen_at,last_seen_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,last_seen_at=excluded.last_seen_at WHERE desktop_activity.email<>excluded.email OR desktop_activity.last_seen_at<?",
  )
    .bind(user.id, String(user.email || "").toLowerCase(), at, at, new Date(Date.parse(at) - 3600000).toISOString())
    .run(), null);
}
