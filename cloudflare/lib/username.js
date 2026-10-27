// A username belongs to the M4 Labs account, not to one product. D1 keeps it unique; the Supabase account carries a
// copy in app_metadata.username so any lab product can read it from the session without asking the person again.
import { normalizeUsername, validUsername } from "../account-policy.js";
import { HttpError } from "./http.js";

export async function mirrorUsername(env, userId, username) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return false;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json" },
    // app_metadata merges key by key, so providers and other keys stay as they are.
    body: JSON.stringify({ app_metadata: { username } }),
    signal: AbortSignal.timeout(10000),
  });
  return r.ok;
}

/** Sets the account's username everywhere. Throws 400 when invalid and 409 when another account has it. */
export async function claimUsername(env, userId, value) {
  const username = normalizeUsername(value);
  if (!validUsername(username))
    throw new HttpError(400, "Use 3–24 letters, numbers or underscores; start with a letter.");
  const before = await env.DB.prepare("SELECT username FROM desktop_profiles WHERE user_id=?").bind(userId).first();
  try {
    // A profile row with setup_step 0 is an account that has not set Clem up yet; claiming a name does not change that.
    await env.DB.prepare("INSERT INTO desktop_profiles(user_id,username) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username")
      .bind(userId, username)
      .run();
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new HttpError(409, "That username is taken. Choose another.");
    throw error;
  }
  await mirrorUsername(env, userId, username);
  return { username, previous: before?.username || null };
}
