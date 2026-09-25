import { handleProviders } from "./provider-vault.js";
import { validateSync } from "../core/sync.ts";
import {
  normalizeUsername,
  validUsername,
  ownerEligible,
  verifySignature,
} from "./account-policy.js";
import { corsHeaders, HttpError, json, lemon, limit } from "./lib/http.js";
import {
  complimentary,
  hasActiveSubscription,
  recordActivity,
  subscriptions as subscriptionsFor,
  suspension,
} from "./lib/account-state.js";
import { handleAdmin } from "./admin.js";
import { handleSupport } from "./support.js";

async function webhook(request, env) {
  const raw = await request.text();
  if (raw.length > 256000) return json({ error: "Payload too large" }, 413);
  if (
    !(await verifySignature(
      raw,
      request.headers.get("X-Signature"),
      env.LEMON_WEBHOOK_SECRET,
    ))
  )
    return json({ error: "Invalid signature" }, 401);
  const event = JSON.parse(raw);
  if (event.data?.type !== "subscriptions") return json({ received: true });
  if (!/^\d+$/.test(String(event.data.id)))
    return json({ error: "Invalid subscription" }, 400);
  // Retrieve authoritative current state: duplicates and out-of-order deliveries cannot restore stale access.
  const current = await lemon(env, "subscriptions/" + event.data.id),
    a = current.data.attributes;
  if (
    String(a.store_id) !== env.LEMON_STORE_ID ||
    String(a.variant_id) !== env.LEMON_VARIANT_ID ||
    Boolean(a.test_mode) !== (env.LEMON_TEST_MODE === "true")
  )
    return json({ error: "Wrong product or environment" }, 400);
  const checkoutId = event.meta?.custom_data?.checkout_id;
  const existing = await env.DB.prepare(
    "SELECT user_id FROM desktop_subscriptions WHERE subscription_id=?",
  )
    .bind(String(event.data.id))
    .first();
  const checkout = checkoutId
    ? await env.DB.prepare("SELECT user_id FROM desktop_checkouts WHERE id=?")
        .bind(checkoutId)
        .first()
    : null;
  const owner = existing?.user_id || checkout?.user_id;
  if (!owner) return json({ error: "Unrecognized desktop checkout" }, 400);
  if (existing && checkout && existing.user_id !== checkout.user_id)
    return json({ error: "Checkout owner mismatch" }, 400);
  const until = a.ends_at || a.renews_at;
  await env.DB.prepare(
    "INSERT INTO desktop_subscriptions(subscription_id,user_id,status,valid_until,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET status=excluded.status,valid_until=excluded.valid_until,updated_at=excluded.updated_at WHERE excluded.updated_at>=desktop_subscriptions.updated_at",
  )
    .bind(String(event.data.id), owner, a.status, until || null, a.updated_at)
    .run();
  return json({ received: true });
}
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    const response = await route(request, env);
    const cors = corsHeaders(request);
    if (!Object.keys(cors).length) return response;
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(_event, env) {
    await env.DB.prepare("DELETE FROM desktop_rate_limits WHERE expires<?")
      .bind(Math.floor(Date.now() / 60000) - 60)
      .run();
  },
};

async function route(request, env) {
    try {
      const path = new URL(request.url).pathname;
      if (path === "/webhooks/lemon" && request.method === "POST")
        return await webhook(request, env);
      if (request.method !== "GET" && request.method !== "POST")
        return json({ error: "Method not allowed" }, 405);
      if (
        !(await limit(
          env,
          "ip:" + (request.headers.get("CF-Connecting-IP") || "unknown"),
          path.startsWith("/admin/") ? 300 : 90,
        ))
      )
        return json({ error: "Try again shortly." }, 429);
      const authorization = request.headers.get("Authorization");
      if (!authorization?.startsWith("Bearer "))
        return json({ error: "Sign in required" }, 401);
      const check = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: authorization,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!check.ok) return json({ error: "Session expired" }, 401);
      const user = await check.json();
      if (!user.id || !user.email_confirmed_at)
        return json({ error: "Verify your email first" }, 403);
      if (user.factors?.some((f) => f.status === "verified")) {
        const encoded = authorization.slice(7).split(".")[1];
        let claims;
        try {
          claims = JSON.parse(
            atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
          );
        } catch {
          return json({ error: "Authenticator verification required" }, 403);
        }
        if (claims.sub !== user.id || claims.aal !== "aal2")
          return json({ error: "Authenticator verification required" }, 403);
      }
      if (path.startsWith("/admin/")) {
        if (!(await limit(env, "admin:" + user.id, 240)))
          return json({ error: "Try again shortly." }, 429);
        return await handleAdmin(request, env, user, path, authorization);
      }
      if (!(await limit(env, "user:" + user.id, 60)))
        return json({ error: "Try again shortly." }, 429);
      const supportResponse = await handleSupport(request, env, user, path);
      if (supportResponse) return supportResponse;
      const providerResponse = await handleProviders(request, env, user, path);
      if (providerResponse) return providerResponse;
      if (path.startsWith("/sync/")) {
        const kind = path.slice(6);
        if (!["skills", "memory", "notes"].includes(kind))
          return json({ error: "Only skills and memory can be synced." }, 400);
        if (request.method === "GET") {
          const row = await env.DB.prepare(
            "SELECT revision,payload FROM desktop_sync WHERE user_id=? AND kind=?",
          )
            .bind(user.id, kind)
            .first();
          return json(
            row
              ? { revision: row.revision, data: JSON.parse(row.payload) }
              : { revision: 0, data: [] },
          );
        }
        const reader = request.body?.getReader();
        let raw = "";
        const decoder = new TextDecoder();
        let bytes = 0;
        if (!reader) return json({ error: "Missing data" }, 400);
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.length;
            if (bytes > 1000000) {
              await reader.cancel();
              return json({ error: "Sync data exceeds 1 MB." }, 413);
            }
            raw += decoder.decode(part.value, { stream: true });
          }
          raw += decoder.decode();
        } finally {
          reader.releaseLock();
        }
        let body, data;
        try {
          body = JSON.parse(raw);
          if (
            Object.keys(body).some((k) => !["revision", "data"].includes(k)) ||
            !Number.isSafeInteger(body.revision) ||
            body.revision < 0
          )
            throw Error();
          data = validateSync(kind, body.data);
        } catch {
          return json(
            {
              error:
                "Invalid sync data. Chats, files and projects must stay local.",
            },
            400,
          );
        }
        const row = await env.DB.prepare(
          "INSERT INTO desktop_sync(user_id,kind,revision,payload,updated_at) SELECT ?,?,1,?,? WHERE ?=0 ON CONFLICT(user_id,kind) DO UPDATE SET revision=desktop_sync.revision+1,payload=excluded.payload,updated_at=excluded.updated_at WHERE desktop_sync.revision=? RETURNING revision",
        )
          .bind(
            user.id,
            kind,
            JSON.stringify(data),
            new Date().toISOString(),
            body.revision,
            body.revision,
          )
          .first();
        // Existing revisions use UPDATE because the conditional INSERT intentionally has no row.
        const updated =
          row ||
          (body.revision > 0
            ? await env.DB.prepare(
                "UPDATE desktop_sync SET revision=revision+1,payload=?,updated_at=? WHERE user_id=? AND kind=? AND revision=? RETURNING revision",
              )
                .bind(
                  JSON.stringify(data),
                  new Date().toISOString(),
                  user.id,
                  kind,
                  body.revision,
                )
                .first()
            : null);
        return updated
          ? json({ revision: updated.revision })
          : json(
              { error: "Sync changed on another device. Retry to merge." },
              409,
            );
      }
      if (ownerEligible(user))
        await env.DB.prepare(
          "INSERT OR IGNORE INTO desktop_owner_grants(user_id,granted_at) VALUES(?,?)",
        )
          .bind(user.id, new Date().toISOString())
          .run();
      const grant = await env.DB.prepare(
        "SELECT user_id FROM desktop_owner_grants WHERE user_id=?",
      )
        .bind(user.id)
        .first();
      const comp = !grant && (await complimentary(env, user.id));
      const paid = hasActiveSubscription(await subscriptionsFor(env, user.id));
      const suspended = grant ? null : await suspension(env, user.id);
      // Mowr is free: every signed-in account that is not suspended has access.
      const active = !suspended;
      if (path === "/entitlement") {
        await recordActivity(env, user);
        if (suspended)
          return json({
            active: false,
            reason: "suspended",
            message: suspended.reason,
            until: suspended.until,
          });
        return json({
          active,
          reason: grant ? "owner" : comp ? "complimentary" : paid ? "subscription" : "free",
        });
      }
      if (path === "/username") {
        if (!(await limit(env, "username:" + user.id, 30)))
          return json({ error: "Try again shortly." }, 429);
        const username = normalizeUsername(
          new URL(request.url).searchParams.get("value"),
        );
        if (!validUsername(username))
          return json({ available: false, valid: false });
        const found = await env.DB.prepare(
          "SELECT user_id FROM desktop_profiles WHERE username=?",
        )
          .bind(username)
          .first();
        return json({
          available: !found || found.user_id === user.id,
          valid: true,
        });
      }
      if (path === "/profile") {
        if (request.method === "GET") {
          const row = await env.DB.prepare(
            "SELECT * FROM desktop_profiles WHERE user_id=?",
          )
            .bind(user.id)
            .first();
          return json(
            row
              ? {
                  step: row.setup_step,
                  username: row.username || "",
                  displayName: row.display_name,
                  memory: !!row.memory,
                }
              : { step: 0, username: "", displayName: "", memory: true },
          );
        }
        const body = await request.json(),
          username = normalizeUsername(body.username);
        if (
          !validUsername(username) ||
          typeof body.displayName !== "string" ||
          body.displayName.length > 80 ||
          !Number.isInteger(body.step) ||
          body.step < 0 ||
          body.step > 4 ||
          typeof body.memory !== "boolean"
        )
          return json({ error: "Invalid setup information" }, 400);
        try {
          await env.DB.prepare(
            "INSERT INTO desktop_profiles(user_id,username,display_name,setup_step,memory) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,setup_step=excluded.setup_step,memory=excluded.memory",
          )
            .bind(
              user.id,
              username,
              body.displayName.trim(),
              body.step,
              body.memory ? 1 : 0,
            )
            .run();
        } catch (error) {
          if (String(error).includes("UNIQUE"))
            return json(
              { error: "That username was just taken. Choose another." },
              409,
            );
          throw error;
        }
        return json({ ok: true });
      }
      if (path === "/checkout" && request.method === "POST") {
        if (suspended)
          return json({ error: "This account is suspended. Contact support@mowrai.com." }, 403);
        if (active) return json({ error: "You already have access." }, 409);
        if (!env.LEMON_API_KEY || !env.LEMON_STORE_ID || !env.LEMON_VARIANT_ID)
          return json(
            { error: "Payments are not configured yet. Your setup is saved." },
            503,
          );
        const profile = await env.DB.prepare(
          "SELECT setup_step FROM desktop_profiles WHERE user_id=?",
        )
          .bind(user.id)
          .first();
        if (!profile || profile.setup_step < 3)
          return json({ error: "Complete desktop setup first." }, 409);
        if (!(await limit(env, "checkout:" + user.id, 3)))
          return json({ error: "Wait before retrying checkout." }, 429);
        const pending = await env.DB.prepare(
          "SELECT url FROM desktop_checkouts WHERE user_id=? AND expires_at>? AND url IS NOT NULL ORDER BY expires_at DESC LIMIT 1",
        )
          .bind(user.id, new Date().toISOString())
          .first();
        if (pending) return json({ url: pending.url });
        const variant = await lemon(env, "variants/" + env.LEMON_VARIANT_ID),
          v = variant.data.attributes;
        if (
          !v.is_subscription ||
          v.interval !== "month" ||
          v.interval_count !== 1 ||
          v.price !== 200
        )
          throw Error(
            "Configure the $2 monthly variant before enabling checkout.",
          );
        const store = await lemon(env, "stores/" + env.LEMON_STORE_ID);
        if (store.data.attributes.currency !== "USD")
          throw Error("Checkout store must use USD.");
        const id = crypto.randomUUID(),
          expires = new Date(Date.now() + 30 * 60000).toISOString();
        await env.DB.prepare(
          "INSERT INTO desktop_checkouts(id,user_id,expires_at) VALUES(?,?,?)",
        )
          .bind(id, user.id, expires)
          .run();
        const result = await lemon(env, "checkouts", {
          data: {
            type: "checkouts",
            attributes: {
              custom_price: 200,
              test_mode: env.LEMON_TEST_MODE === "true",
              expires_at: expires,
              product_options: {
                enabled_variants: [Number(env.LEMON_VARIANT_ID)],
                redirect_url: "https://mowrai.com/#/desktop-return",
              },
              checkout_options: { skip_trial: true },
              checkout_data: { email: user.email, custom: { checkout_id: id } },
            },
            relationships: {
              store: { data: { type: "stores", id: env.LEMON_STORE_ID } },
              variant: { data: { type: "variants", id: env.LEMON_VARIANT_ID } },
            },
          },
        });
        const url = result.data.attributes.url;
        await env.DB.prepare("UPDATE desktop_checkouts SET url=? WHERE id=?")
          .bind(url, id)
          .run();
        return json({ url });
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      return json(
        {
          error:
            "Account service could not complete this request. Your existing data is unchanged.",
        },
        503,
      );
    }
}
