import {subscriptionsRouter,subscriptionReady,cleanExpiredSubscriptionSessions} from './subscriptions.ts';
import {filesRouter} from './files.ts';
import {securityRouter,supportRouter,emailAllowed} from './security.ts';
import {emailRouter} from './emails.ts';
import {databaseReady} from './db.ts';
import {supabaseConfig,supabaseIdentity} from './auth.ts';
import { runChat } from './skill-runtime.ts';
import { boundedConversation } from '../core/chat-context.ts';
import { nextRun, runDue } from "./automations.ts";
import "./config.ts";
import express from "express";
import { once } from "node:events";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";
import { modelCatalog, generate } from "./providers.ts";
import { diagram } from "./diagram.ts";
import { capabilities } from "./config.ts";
import { db, ensureUser } from "./db.ts";
import {
  identity,
  setSession,
  hashPassword,
  checkPassword,
  signState,
  readState,
  cookies,
} from "./auth.ts";
import { encrypt, decrypt } from "./vault.ts";
import { uploadUrl, downloadUrl, objectSize, removeObject } from "./storage.ts";
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (typeof req.query.route === "string") {
    const query = new URLSearchParams(req.originalUrl.split("?")[1] || "");
    const route = query.get("route");
    query.delete("route");
    req.url = "/api/" + route + (query.size ? "?" + query : "");
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  // Opt-out links are signed per address and posted by mail clients (one-click unsubscribe), so no Origin.
  if (req.path === "/api/email/unsubscribe") { next(); return; }
  const origin = req.get("origin");
  const allowed = new Set([
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    process.env.APP_URL,
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
    process.env.VERCEL_PROJECT_PRODUCTION_URL &&
      `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
  ]);
  if (
    ["POST", "PUT", "DELETE", "PATCH"].includes(req.method) &&
    (!origin ||
      !allowed.has(origin) ||
      (!req.is("application/json") && req.method !== "DELETE"))
  ) {
    res.status(403).json({ error: "Use Mowr from its configured APP_URL." });
    return;
  }
  next();
});
app.use(express.json({ limit: "3mb" }));
// Retained legacy readers support migration, but desktop-owned content cannot be uploaded.
app.use((req,res,next)=>{
  if(process.env.MOWR_LEGACY_WORKSPACE!=="true" && ["POST","PUT","PATCH"].includes(req.method) && /^\/api\/(workspace|scopes|files)(\/|$)/.test(req.path)) {
    res.status(410).json({error:"Chats, files, projects and subjects are stored locally in the Mowr desktop app."});return;
  }
  next();
});
app.use('/api/subscriptions',subscriptionsRouter);
app.use('/api/security',securityRouter);
app.use('/api/support',supportRouter);
app.use('/api/email',emailRouter);
if(supabaseConfig())app.use('/api/files',filesRouter);
const localLimits = new Map<string, { count: number; until: number }>();
async function rate(key: string, limit = 30) {
  if (databaseReady()) {
    const rows =
      await db()`INSERT INTO mowr_rate_limits(key,count) VALUES(${key},1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN mowr_rate_limits.window_start < now()-interval '1 minute' THEN 1 ELSE mowr_rate_limits.count+1 END,window_start=CASE WHEN mowr_rate_limits.window_start < now()-interval '1 minute' THEN now() ELSE mowr_rate_limits.window_start END RETURNING count`;
    return rows[0].count <= limit;
  }
  const old = localLimits.get(key);
  if (!old || old.until < Date.now()) {
    if (localLimits.size > 1000) localLimits.clear();
    localLimits.set(key, { count: 1, until: Date.now() + 60000 });
    return true;
  }
  return ++old.count <= limit;
}
async function requireUser(req: express.Request, res: express.Response) {
  const u = await identity(req);
  if (!u) {
    res.status(401).json({ error: "Sign in to use this feature." });
    return null;
  }
  if (databaseReady()) {
    const rows = await db()`SELECT disabled FROM mowr_users WHERE id=${u.id}`;
    if (!rows.length || rows[0].disabled) {
      res.status(401).json({ error: "This session is no longer active." });
      return null;
    }
  }
  return u;
}
async function credential(userId: string, provider: string) {
  if (!databaseReady()) return undefined;
  const rows =
    await db()`SELECT ciphertext,nonce,metadata FROM mowr_credentials WHERE owner_id=${userId} AND provider=${provider}`;
  if (!rows.length) return undefined;
  return {
    key: decrypt(rows[0].ciphertext, rows[0].nonce, userId),
    model: String(rows[0].metadata.model || ""),
    kind: rows[0].metadata.kind,
    owner: userId,
  };
}
app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", ...capabilities() }),
);
app.get("/api/auth/session", async (req, res) =>
  res.json({ user: await identity(req), ...capabilities() }),
);
app.get('/api/supabase/config',(_req,res)=>res.json(supabaseConfig()||{}));
app.post('/api/supabase/session',async(req,res)=>{if(!(await rate('supabase:'+String(req.ip),30))){res.status(429).json({error:'Try again in a minute.'});return;}const {token}=z.object({token:z.string().min(20).max(3500)}).parse(req.body);const user=await supabaseIdentity(token);if(!user){res.status(401).json({error:'Invalid or expired sign-in.'});return;}if(databaseReady())await ensureUser(user.id,user.name);res.clearCookie('mowr_session',{path:'/'});res.cookie('mowr_supabase',token,{httpOnly:true,secure:!!process.env.VERCEL,sameSite:'lax',maxAge:3600000,path:'/'});if(!await emailAllowed({...req,headers:{...req.headers,cookie:'mowr_supabase='+token+'; mowr_email_verified='+ (cookies(req).mowr_email_verified||'')}} as express.Request,user.id)){res.status(403).json({error:'Email verification required.',code:'EMAIL_MFA'});return;}res.json({user});});
const authInput = z.object({
  email: z.email().max(200).optional(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80).optional(),
});
app.post("/api/auth/:action", async (req, res) => {
  const action = req.params.action;
  if (action === "logout") {
    res.clearCookie("mowr_session", { path: "/" });
    res.clearCookie("mowr_supabase", { path: "/" });
    res.json({ ok: true });
    return;
  }
  if(supabaseConfig()){res.status(400).json({error:"Use the secure sign-in dialog."});return;}
  const body = authInput.parse(req.body);
  const address = String(req.headers["x-forwarded-for"] || req.ip).split(
    ",",
  )[0];
  if (!(await rate(`auth:${address}`, 6))) {
    res.status(429).json({ error: "Too many attempts. Wait a minute." });
    return;
  }
  if (action === "unlock") {
    const expected = process.env.MOWR_ACCESS_PASSWORD;
    if (!expected) {
      res.status(503).json({
        error:
          "Set MOWR_ACCESS_PASSWORD in .env.local to enable a private workspace without a database.",
      });
      return;
    }
    const a = createHash("sha256").update(body.password).digest(),
      b = createHash("sha256").update(expected).digest();
    if (!timingSafeEqual(a, b)) {
      res.status(401).json({ error: "Incorrect workspace password." });
      return;
    }
    const user = { id: "owner", name: "Thinker" };
    if (databaseReady()) await ensureUser(user.id, user.name);
    await setSession(res, user);
    res.json({ user });
    return;
  }
  if (!body.email) throw new Error("Enter an email address.");
  const email = body.email.toLowerCase();
  if (action === "signup") {
    if (!body.name) throw new Error("Enter your name.");
    const id = randomUUID(),
      hash = await hashPassword(body.password);
    try {
      await db()`INSERT INTO mowr_users(id,email,display_name,password_hash) VALUES(${id},${email},${body.name},${hash})`;
    } catch {
      res.status(400).json({
        error: "Unable to create this account. Try signing in instead.",
      });
      return;
    }
    const user = { id, email, name: body.name };
    await setSession(res, user);
    res.json({ user });
    return;
  }
  if (action === "login") {
    const rows =
      await db()`SELECT id,display_name,password_hash,disabled FROM mowr_users WHERE email=${email}`;
    if (
      !rows.length ||
      rows[0].disabled ||
      !(await checkPassword(body.password, rows[0].password_hash || ""))
    ) {
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    const user = { id: rows[0].id, email, name: rows[0].display_name };
    await setSession(res, user);
    res.json({ user });
    return;
  }
  res.status(404).json({ error: "Unknown account action." });
});
app.post("/api/account/password", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const b = z
    .object({
      current: z.string().max(128),
      password: z.string().min(10).max(128),
    })
    .parse(req.body);
  const rows =
    await db()`SELECT password_hash FROM mowr_users WHERE id=${u.id}`;
  if (
    !rows[0]?.password_hash ||
    !(await checkPassword(b.current, rows[0].password_hash))
  ) {
    res.status(400).json({ error: "Current password is incorrect." });
    return;
  }
  const hash = await hashPassword(b.password);
  await db()`UPDATE mowr_users SET password_hash=${hash} WHERE id=${u.id}`;
  res.json({ ok: true });
});
app.get("/api/models", async (req, res) => {
  const u = await identity(req);
  const list = modelCatalog();
  if (u && databaseReady()) {
    const rows =
      await db()`SELECT provider,metadata FROM mowr_credentials WHERE owner_id=${u.id} AND provider<>'drive'`;
    for (const row of rows) {
      const m = list.find((m) => m.id === row.provider);
      if (m) {
        m.name = row.metadata.model;
        m.connected = (row.provider!=='openai'&&row.provider!=='xai')||row.metadata.kind==='subscription';
        m.context = Number(row.metadata.context || 32000);
        m.specialties = Array.isArray(row.metadata.specialties)
          ? row.metadata.specialties
          : [];
      }
    }
  }
  res.json(
    list.map((m) => ({
      ...m,
      connected: m.connected && (!!u || !process.env.VERCEL),
    })),
  );
});
app.post('/api/providers/check',async(req,res)=>{const user=await requireUser(req,res);if(!user)return;res.status(400).json({error:'Use subscription sign-in for Codex and Grok. API keys are not accepted.'});});
app.post("/api/providers", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const b = z
    .object({
      provider: z.enum(["anthropic", "google"]),
      key: z.string().min(10).max(1000),
      model: z.string().min(1).max(100),
      context: z.number().int().min(1000).max(2000000).default(32000),
    })
    .parse(req.body);
  const value = encrypt(b.key, u.id);
  await db()`INSERT INTO mowr_credentials(owner_id,provider,ciphertext,nonce,key_version,metadata) VALUES(${u.id},${b.provider},${value.ciphertext},${value.nonce},1,${JSON.stringify({ model: b.model, context: b.context })}::jsonb) ON CONFLICT(owner_id,provider) DO UPDATE SET ciphertext=excluded.ciphertext,nonce=excluded.nonce,metadata=excluded.metadata,updated_at=now()`;
  res.json({ ok: true });
});
app.delete("/api/providers/:provider", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  await db()`DELETE FROM mowr_credentials WHERE owner_id=${u.id} AND provider=${String(req.params.provider)}`;
  res.json({ ok: true });
});
app.get("/api/diagram", (req, res) => {
  res.json(
    diagram(Number(req.query.angle ?? 45), Number(req.query.speed ?? 15)),
  );
});
const chatInput = z.object({
  mode:z.enum(["chat","plan","step"]).default("chat"),
  model: z.enum(["openai", "anthropic", "google", "xai"]),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1).max(210000),
      }),
    )
    .min(1)
    .max(150),
});
app.post("/api/chat", async (req, res) => {
  const u = await identity(req);
  if (process.env.VERCEL && !u) {
    res.status(401).json({ error: "Sign in to connect with your models." });
    return;
  }
  if (!(await rate(`chat:${u?.id || "local"}`, 20))) {
    res
      .status(429)
      .json({ error: "Please wait a moment before starting another request." });
    return;
  }
  const b = chatInput.parse(req.body);
  // Long chats keep every request in a brief and older answers as outlines instead of failing.
  const messages = boundedConversation(b.messages, 600000) as typeof b.messages;
  const controller = new AbortController();
  const timeout=setTimeout(()=>controller.abort(),270000);
  res.on("close",()=>clearTimeout(timeout));
  res.on("close", () => controller.abort());
  let started = false;
  try {
    const c = u ? await credential(u.id, b.model) : undefined;
    for await (const chunk of runChat(
      b.model,
      messages,
      controller.signal,
      c, b.mode
    )) {
      if (!started) {
        res.setHeader("Content-Type", "application/x-ndjson");
        started = true;
      }
      if (!res.write(JSON.stringify(chunk) + "\n"))
        await once(res, "drain", { signal: controller.signal });
    }
    res.end(JSON.stringify({ type: "done" }) + "\n");
  } catch (e) {
    if (!controller.signal.aborted) {
      if (!started) res.status(502).json({ error: (e as Error).message });
      else
        res.end(
          JSON.stringify({ type: "error", error: (e as Error).message }) + "\n",
        );
    }
  }
});
app.get("/api/workspace", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const rows =
    await db()`SELECT state,revision FROM mowr_workspaces WHERE owner_id=${u.id}`;
  res.json(rows[0] || { state: null, revision: 0 });
});
app.put("/api/workspace", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const b = z
    .object({
      ownerId: z.string(),
      state: z.record(z.string(), z.unknown()),
      revision: z.number().int().min(0),
    })
    .parse(req.body);
  if (b.ownerId !== u.id) {
    res.status(409).json({ error: "Account changed. Reload this workspace." });
    return;
  }
  const rows =
    await db()`INSERT INTO mowr_workspaces(owner_id,state,revision) VALUES(${u.id},${JSON.stringify(b.state)}::jsonb,1) ON CONFLICT(owner_id) DO UPDATE SET state=excluded.state,revision=mowr_workspaces.revision+1,updated_at=now() WHERE mowr_workspaces.revision=${b.revision} RETURNING revision`;
  if (!rows.length) {
    res.status(409).json({
      error: "This workspace changed in another tab. Reload before saving.",
    });
    return;
  }
  res.json(rows[0]);
});
app.post("/api/files/reserve", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const b = z
    .object({
      id: z.uuid(),
      scopeId: z.uuid(),
      name: z.string().min(1).max(250),
      size: z.number().int().min(1).max(1500000000),
      type: z.string().max(150),
    })
    .parse(req.body);
  const rows =
    await db()`SELECT id FROM mowr_scopes WHERE id=${b.scopeId} AND owner_id=${u.id}`;
  if (!rows.length) {
    res.status(403).json({ error: "This space is not available." });
    return;
  }
  const key = `${u.id.replace("supabase:", "")}/${b.id}`;
  const signedUrl = await uploadUrl(key, b.size, b.type, cookies(req).mowr_supabase);
  const sql = db();
  await sql.transaction([
    sql`INSERT INTO mowr_usage(owner_id) VALUES(${u.id}) ON CONFLICT DO NOTHING`,
    sql`UPDATE mowr_usage SET reserved_bytes=reserved_bytes+${b.size} WHERE owner_id=${u.id}`,
    sql`INSERT INTO mowr_files(id,owner_id,scope_id,object_key,name,mime,bytes,status,expires_at) VALUES(${b.id},${u.id},${b.scopeId},${key},${b.name},${b.type},${b.size},'reserved',now()+interval '10 minutes')`,
  ]);
  res.json({ url: signedUrl, id: b.id });
});
app.post("/api/files/:id/complete", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const rows =
    await db()`SELECT * FROM mowr_files WHERE id=${String(req.params.id)} AND owner_id=${u.id}`;
  const f = rows[0];
  if (!f) throw new Error("File not found.");
  if (f.status === "ready") {
    res.json({ ok: true });
    return;
  }
  if ((await objectSize(f.object_key, cookies(req).mowr_supabase)) !== Number(f.bytes))
    throw new Error("Uploaded file size does not match its reservation.");
  await db()`UPDATE mowr_files SET status='ready',expires_at=NULL WHERE id=${f.id} AND owner_id=${u.id} AND status='reserved'`;
  res.json({ ok: true });
});
app.get("/api/files/:id", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const rows =
    await db()`SELECT object_key FROM mowr_files WHERE id=${String(req.params.id)} AND owner_id=${u.id} AND status='ready'`;
  if (!rows.length) {
    res.status(404).json({ error: "File not found." });
    return;
  }
  res.json({ url: await downloadUrl(rows[0].object_key, cookies(req).mowr_supabase) });
});
app.delete("/api/files/:id", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const rows =
    await db()`SELECT * FROM mowr_files WHERE id=${String(req.params.id)} AND owner_id=${u.id}`;
  if (rows.length) {
    const f = rows[0];
    await removeObject(f.object_key, cookies(req).mowr_supabase);
    await db()`DELETE FROM mowr_files WHERE id=${f.id} AND owner_id=${u.id}`;
  }
  res.json({ ok: true });
});
app.get("/api/scopes/personal", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  await db()`INSERT INTO mowr_scopes(id,owner_id,kind,name) VALUES(${randomUUID()},${u.id},'personal','Personal') ON CONFLICT DO NOTHING`;
  const rows =
    await db()`SELECT id FROM mowr_scopes WHERE owner_id=${u.id} AND kind='personal'`;
  res.json(rows[0]);
});
app.post("/api/scopes", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const b = z
    .object({
      id: z.uuid(),
      kind: z.enum(["personal", "project", "subject"]),
      name: z.string().max(100),
      memory: z.string().max(30000).default(""),
    })
    .parse(req.body);
  await db()`INSERT INTO mowr_scopes(id,owner_id,kind,name,memory) VALUES(${b.id},${u.id},${b.kind},${b.name},${b.memory}) ON CONFLICT(id) DO UPDATE SET name=excluded.name,memory=excluded.memory WHERE mowr_scopes.owner_id=${u.id}`;
  res.json({ ok: true });
});
async function requireDriveUser(req: express.Request, res: express.Response) {
  if (!req.headers.authorization) return requireUser(req, res);
  const token = req.headers.authorization.match(/^Bearer ([^ ]+)$/)?.[1];
  const user = token ? await supabaseIdentity(token) : null;
  if (!user || !await emailAllowed(req, user.id)) {
    res.status(401).json({error: "Complete account verification before using Drive."}); return null;
  }
  const rows = await db()`SELECT disabled FROM mowr_users WHERE id=${user.id}`;
  if (!rows.length || rows[0].disabled) { res.status(401).json({error: "Sign in again."}); return null; }
  return user;
}
app.delete("/api/drive/connection", async (req, res) => {
  const user = await requireDriveUser(req, res); if (!user) return;
  const saved = await credential(user.id, "drive");
  if (saved) {
    const result = await fetch("https://oauth2.googleapis.com/revoke", {method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:new URLSearchParams({token:saved.key}), signal:AbortSignal.timeout(15000)});
    if (!result.ok && result.status !== 400) throw Error("Google could not revoke access. Try again.");
  }
  await db()`DELETE FROM mowr_credentials WHERE owner_id=${user.id} AND provider='drive'`;
  res.json({ok:true});
});
app.get("/api/drive/connect", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  if (!capabilities().drive)
    throw new Error(
      "Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and APP_URL to .env.local.",
    );
  const nonce = randomUUID();
  if (req.query.account && u.id !== "supabase:" + String(req.query.account)) throw Error("Sign in to the same Mowr account as your desktop, then reconnect Drive.");
  const state = await signState({ sub: u.id, nonce, desktop: req.query.desktop === "1" });
  res.cookie("mowr_oauth", nonce, {
    httpOnly: true,
    secure: !!process.env.VERCEL,
    sameSite: "lax",
    maxAge: 600000,
    path: "/",
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.APP_URL + "/api/drive/callback",
    response_type: "code",
    // Read files people pick or sync; create new files (only) when Mowr saves its work back.
    scope: "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  res.redirect(url.href);
});
app.get("/api/drive/callback", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const state = await readState(String(req.query.state || ""));
  if (state.sub !== u.id || state.nonce !== cookies(req).mowr_oauth)
    throw new Error("OAuth state expired or did not match.");
  res.clearCookie("mowr_oauth", { path: "/" });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: String(req.query.code),
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.APP_URL + "/api/drive/callback",
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok)
    throw new Error("Google authorization failed. Reconnect Drive.");
  const token = await response.json();
  if (!token.refresh_token)
    throw new Error(
      "Google did not provide offline access. Reconnect and grant access.",
    );
  const enc = encrypt(token.refresh_token, u.id);
  await db()`INSERT INTO mowr_credentials(owner_id,provider,ciphertext,nonce,key_version,metadata) VALUES(${u.id},'drive',${enc.ciphertext},${enc.nonce},1,'{}') ON CONFLICT(owner_id,provider) DO UPDATE SET ciphertext=excluded.ciphertext,nonce=excluded.nonce`;
  if (state.desktop) {
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    res.type("html").send('<!doctype html><title>Drive connected</title><body style="background:#141414;color:#eeece4;font:18px system-ui;display:grid;place-content:center;min-height:90vh;text-align:center"><h1>Drive is connected.</h1><p>Return to Mowr to choose your files.</p></body>');
  } else res.redirect(process.env.APP_URL + "/#/app/connectors");
});
async function driveToken(userId: string) {
  const c = await credential(userId, "drive");
  if (!c) throw new Error("Connect Google Drive first.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: c.key,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error("Drive access expired. Reconnect.");
  return (await r.json()).access_token;
}
// A short-lived access token for the person's own Drive, so the desktop app can search it and stream files (including
// long videos with seeking) straight from Google instead of through this server. Never stored by the app.
app.get("/api/drive/token", async (req, res) => {
  const u = await requireDriveUser(req, res);
  if (!u) return;
  res.json({ accessToken: await driveToken(u.id), expiresIn: 3300 });
});
app.get("/api/drive/files", async (req, res) => {
  const u = await requireDriveUser(req, res);
  if (!u) return;
  const token = await driveToken(u.id);
  const folder = String(req.query.folder || "");
  if (folder && !/^[\w-]{1,150}$/.test(folder))
    throw new Error("Invalid folder.");
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.search = new URLSearchParams({
    q: `trashed = false${folder ? ` and '${folder}' in parents` : ""}`,
    fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime)",
    pageSize: "50",
    ...(req.query.page ? { pageToken: String(req.query.page) } : {}),
  }).toString();
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error("Google Drive could not list these files.");
  res.json(await r.json());
});
app.get("/api/drive/file/:id", async (req, res) => {
  const u = await requireDriveUser(req, res);
  if (!u) return;
  const id = String(req.params.id);
  if (!/^[\w-]{1,150}$/.test(id)) throw new Error("Invalid Drive file.");
  const token = await driveToken(u.id);
  const meta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,size`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!meta.ok) throw new Error("Drive file unavailable.");
  const m = await meta.json();
  if (Number(m.size) > 30000000)
    throw new Error("Choose a Drive document under 30 MB.");
  const formats: Record<string, {mime:string; extension:string}> = {
    "application/vnd.google-apps.document": {mime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",extension:".docx"},
    "application/vnd.google-apps.spreadsheet": {mime:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",extension:".xlsx"},
    "application/vnd.google-apps.presentation": {mime:"application/vnd.openxmlformats-officedocument.presentationml.presentation",extension:".pptx"},
  };
  const format = formats[m.mimeType];
  const url = format
    ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(format.mime)}`
    : `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok || !r.body)
    throw new Error("This Drive file cannot be downloaded.");
  res.setHeader("Content-Type", format?.mime || m.mimeType);
  res.setHeader("X-Mowr-File-Name", encodeURIComponent(m.name + (format?.extension || "")));
  let bytes = 0;
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    bytes += chunk.length;
    if (bytes > 30000000) {
      await r.body.cancel().catch(() => {});
      res.destroy();
      return;
    }
    res.write(chunk);
  }
  res.end();
});
app.post("/api/drive/upload", express.raw({ type: () => true, limit: "4mb" }), async (req, res) => {
  const u = await requireDriveUser(req, res);
  if (!u) return;
  const folder = String(req.query.folder || ""), name = String(req.query.name || "").replace(/[\u0000-\u001f]/g, "").slice(0, 200);
  if (!/^[\w-]{1,150}$/.test(folder) || !name) { res.status(400).json({ error: "Choose a Drive folder and a file name." }); return; }
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || !body.length) { res.status(400).json({ error: "The file is empty." }); return; }
  const token = await driveToken(u.id);
  const boundary = "mowr" + randomUUID().replace(/-/g, "");
  const type = String(req.headers["content-type"] || "application/octet-stream").split(";")[0].replace(/[^\w.+/-]/g, "") || "application/octet-stream";
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`),
    body,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body: payload });
  if (r.status === 403) { res.status(403).json({ error: "Reconnect Google Drive to let Mowr save files there." }); return; }
  if (!r.ok) { res.status(502).json({ error: "Google Drive did not accept the file." }); return; }
  res.json(await r.json());
});
app.get("/api/automations", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const rows =
    await db()`SELECT id,name,prompt,model,schedule,enabled,next_run_at,last_result,last_error FROM mowr_automations WHERE owner_id=${u.id} ORDER BY updated_at DESC`;
  res.json(rows);
});
app.post("/api/automations", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const b = z
    .object({
      name: z.string().min(1).max(100),
      prompt: z.string().min(1).max(20000),
      model: z.enum(["openai", "anthropic", "google", "xai"]),
      schedule: z.enum(["daily", "weekdays", "weekly"]),
    })
    .parse(req.body);
  const count =
    await db()`SELECT count(*)::int AS count FROM mowr_automations WHERE owner_id=${u.id}`;
  if (count[0].count >= 5)
    throw new Error("Keep at most five active automations per account.");
  const rows =
    await db()`INSERT INTO mowr_automations(id,owner_id,name,prompt,model,schedule,next_run_at) VALUES(${randomUUID()},${u.id},${b.name},${b.prompt},${b.model},${b.schedule},${nextRun(b.schedule)}) RETURNING id`;
  res.json(rows[0]);
});
app.patch("/api/automations/:id", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const b = z.object({ enabled: z.boolean() }).parse(req.body);
  await db()`UPDATE mowr_automations SET enabled=${b.enabled},updated_at=now() WHERE id=${String(req.params.id)} AND owner_id=${u.id}`;
  res.json({ ok: true });
});
app.delete("/api/automations/:id", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  await db()`DELETE FROM mowr_automations WHERE id=${String(req.params.id)} AND owner_id=${u.id}`;
  res.json({ ok: true });
});
app.get("/api/cron", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const supplied = req.get("authorization") || "";
  if (
    !secret ||
    !timingSafeEqual(
      createHash("sha256").update(supplied).digest(),
      createHash("sha256")
        .update("Bearer " + secret)
        .digest(),
    )
  ) {
    res.status(401).json({ error: "Unauthorized scheduler." });
    return;
  }
  if(subscriptionReady())await cleanExpiredSubscriptionSessions();
  res.json(await runDue());
});
app.use(
  (
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    const message =
      error instanceof z.ZodError
        ? "Check the required fields and try again."
        : error.message;
    if (
      /password_hash|connection|relation|constraint|syntax|neon|fetch failed/i.test(
        message,
      )
    )
      res.status(503).json({
        error:
          "Database setup is incomplete or unavailable. Check DATABASE_URL and run npm run db:migrate.",
      });
    else res.status(400).json({ error: message });
  },
);
export default app;
