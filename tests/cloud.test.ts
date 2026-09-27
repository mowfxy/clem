import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
process.env.MOWR_LEGACY_WORKSPACE="true";
const pg = new PGlite();
await pg.exec(await fs.readFile("database/001_core.sql", "utf8"));
await pg.exec(await fs.readFile("database/002_accounts.sql", "utf8"));
await pg.exec(await fs.readFile("database/003_github.sql", "utf8"));
process.env.DATABASE_URL = "postgresql://test:test@local.neon.tech/test";
process.env.SESSION_SECRET = "test-session-secret-32-characters-minimum";
process.env.CREDENTIAL_ENCRYPTION_KEY = "test-encryption-secret-at-least-thirty-two-characters";
neonConfig.fetchFunction = async (_url: any, init: any) => {
  try {
    const body = JSON.parse(init.body);
    const run = async (q: any) => {
      const r = await pg.query(q.query, q.params);
      return {
        fields: r.fields.map((f) => ({
          name: f.name,
          dataTypeID: f.dataTypeID,
        })),
        rows: (r.rows as any[]).map((row) =>
          r.fields.map((f) => {
            const v = row[f.name];
            return v === null
              ? null
              : typeof v === "object"
                ? JSON.stringify(v)
                : String(v);
          }),
        ),
        rowCount: r.affectedRows || r.rows.length,
      };
    };
    if (body.queries) {
      await pg.exec("BEGIN");
      try {
        const results = [];
        for (const q of body.queries) results.push(await run(q));
        await pg.exec("COMMIT");
        return Response.json({ results });
      } catch (e) {
        await pg.exec("ROLLBACK");
        throw e;
      }
    }
    return Response.json(await run(body));
  } catch (e) {
    return Response.json({ message: (e as Error).message }, { status: 400 });
  }
};
const { default: app } = await import("../server/app.ts");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const port = (server.address() as any).port;
async function request(path: string, method = "GET", body?: any, cookie = "") {
  return fetch(`http://127.0.0.1:${port}/api/${path}`, {
    method,
    headers: {
      Origin: "http://127.0.0.1:5173",
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
after(async () => {
  server.close();
  await pg.close();
});
test("accounts, scoped persistence and encrypted connections work with PostgreSQL", async () => {
  const a = await request("auth/signup", "POST", {
    name: "Alice",
    email: "alice@example.test",
    password: "Long-example-password1",
  });
  assert.equal(a.status, 200);
  const au = (await a.json()).user;
  const ac = a.headers.get("set-cookie")!.split(";")[0];
  const b = await request("auth/signup", "POST", {
    name: "Bob",
    email: "bob@example.test",
    password: "Long-example-password2",
  });
  assert.equal(b.status, 200);
  const bc = b.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    (
      await request(
        "workspace",
        "PUT",
        { ownerId: au.id, state: { chats: ["private"] }, revision: 0 },
        ac,
      )
    ).status,
    200,
  );
  assert.equal(
    (await (await request("workspace", "GET", undefined, bc)).json()).state,
    null,
  );
  assert.equal(
    (
      await request(
        "workspace",
        "PUT",
        { ownerId: au.id, state: { chats: [] }, revision: 1 },
        bc,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        "workspace",
        "PUT",
        { ownerId: au.id, state: { chats: [] }, revision: 0 },
        ac,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        "providers",
        "POST",
        {
          provider: "anthropic",
          key: "test-dummy-key-do-not-use",
          model: "example",
          context: 32000,
        },
        ac,
      )
    ).status,
    200,
  );
  const creds = await pg.query("SELECT ciphertext FROM mowr_credentials");
  assert.ok(!(creds.rows[0] as any).ciphertext.includes("test-dummy"));
  const models = await (await request("models", "GET", undefined, bc)).json();
  assert.equal(models.find((m:any)=>m.id==='anthropic').connected, false);
  assert.equal((await request('providers','POST',{provider:'openai',key:'test-dummy-key',model:'example'},ac)).status,400);
  assert.equal((await request('subscriptions','GET')).status,401);
  const wrong = await request("auth/login", "POST", {
    email: "alice@example.test",
    password: "not-the-password",
  });
  assert.equal(wrong.status, 401);
  const good = await request("auth/login", "POST", {
    email: "alice@example.test",
    password: "Long-example-password1",
  });
  assert.equal(good.status, 200);
  const personal = await (
    await request("scopes/personal", "GET", undefined, ac)
  ).json();
  assert.equal(
    personal.id,
    (await (await request("scopes/personal", "GET", undefined, ac)).json()).id,
  );
  assert.equal(
    (await request("files/" + crypto.randomUUID(), "GET", undefined, bc))
      .status,
    404,
  );
});
test("mutations reject foreign origins and scheduler rejects missing authorization", async () => {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, {
    method: "POST",
    headers: {
      Origin: "https://untrusted.example",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(r.status, 403);
  assert.equal((await request("cron")).status, 401);
  assert.equal((await request("workspace")).status, 401);
});

test('desktop Drive enforces identity, consent state, exports and disconnect',async()=>{
 const rawFetch=globalThis.fetch;
 const names=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','APP_URL'];const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 Object.assign(process.env,{SUPABASE_URL:'https://drive-test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',GOOGLE_CLIENT_ID:'test-id',GOOGLE_CLIENT_SECRET:'test-secret',APP_URL:'http://127.0.0.1:5173'});
 await pg.exec('CREATE TABLE IF NOT EXISTS mowr_security (owner_id text primary key,email_mfa boolean default false)');
 const uid='11111111-1111-4111-8111-111111111111';await pg.query('INSERT INTO mowr_users(id,display_name) VALUES($1,$2) ON CONFLICT DO NOTHING',['supabase:'+uid,'Drive test']);
 const token='e30.'+Buffer.from(JSON.stringify({aal:'aal1'})).toString('base64url')+'.test';let exportUrl='',revoked=false,uploaded='';
 globalThis.fetch=async(input:any,init:any)=>{
  const url=String(input);
  if(url.startsWith('https://drive-test.supabase.co/'))return init?.headers?.Authorization==='Bearer '+token?Response.json({id:uid,email_confirmed_at:'2026-09-19',email:'test@example.test'}):new Response('{}',{status:401});
  if(url==='https://oauth2.googleapis.com/token')return Response.json({refresh_token:'fixture-refresh',access_token:'fixture-access'});
  if(url==='https://oauth2.googleapis.com/revoke'){revoked=true;return new Response('{}');}
  if(url.startsWith('https://www.googleapis.com/drive/v3/files/')){
   if(url.includes('/export?')){exportUrl=url;return new Response('fixture-office-bytes');}
   return Response.json({id:'doc123',name:'Research',mimeType:'application/vnd.google-apps.document'});
  }
  if(url.startsWith('https://www.googleapis.com/drive/v3/files?'))return Response.json({files:[{id:'doc123',name:'Research'}]});
  if(url.startsWith('https://www.googleapis.com/upload/drive/v3/files?')){uploaded=Buffer.from(init.body).toString();return Response.json({id:'up123'});}
  return rawFetch(input,init);
 };
 const base=`http://127.0.0.1:${port}/api/drive/`;
 const headers={Authorization:'Bearer '+token,Origin:'http://127.0.0.1:5173'};
 const cookie='mowr_supabase='+token;
 try{
  assert.equal((await rawFetch(base+'files',{headers:{Authorization:'Bearer forged'}})).status,401);
  const connect=await rawFetch(base+'connect?desktop=1&account='+uid,{headers:{Cookie:cookie},redirect:'manual'});assert.equal(connect.status,302);
  const google=new URL(connect.headers.get('location')!);const state=google.searchParams.get('state');const oauthCookie=connect.headers.get('set-cookie')!.split(';')[0];
  const wrong=await rawFetch(base+'callback?code=test&state='+state,{headers:{Cookie:cookie},redirect:'manual'});assert.equal(wrong.status,400);
  const callback=await rawFetch(base+'callback?code=test&state='+state,{headers:{Cookie:cookie+'; '+oauthCookie},redirect:'manual'});assert.equal(callback.status,200);assert.match(await callback.text(),/Drive is connected/);
  assert.equal((await rawFetch(base+'files',{headers})).status,200);
  const download=await rawFetch(base+'file/doc123',{headers});assert.equal(download.status,200);assert.equal(decodeURIComponent(download.headers.get('X-Mowr-File-Name')!),'Research.docx');assert.match(exportUrl,/wordprocessingml/);
  // Uploads carry raw file bytes of any type (JSON included), from the desktop's bearer token or a same-origin page.
  const upload=await rawFetch(base+'upload?folder=fold123&name=data.json',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{"a":1}'});
  assert.equal(upload.status,200);assert.equal((await upload.json()).id,'up123');assert.match(uploaded,/\{"a":1\}/);
  assert.equal((await rawFetch(base+'upload?folder=fold123&name=notes.txt',{method:'POST',headers:{Cookie:cookie,Origin:'http://127.0.0.1:5173','Content-Type':'text/plain'},body:'hello'})).status,200);
  assert.equal((await rawFetch(base+'upload?folder=fold123&name=notes.txt',{method:'POST',headers:{Cookie:cookie,Origin:'https://untrusted.example','Content-Type':'text/plain'},body:'hello'})).status,403);
  assert.equal((await rawFetch(base+'connection',{method:'DELETE',headers})).status,200);assert.ok(revoked);
  assert.equal((await pg.query("SELECT * FROM mowr_credentials WHERE owner_id=$1 AND provider='drive'",['supabase:'+uid])).rows.length,0);
  await pg.query('INSERT INTO mowr_security(owner_id,email_mfa) VALUES($1,true)',['supabase:'+uid]);
  // The emailed code guards web cookie sessions; the desktop's own bearer sign-in is not subject to it.
  assert.equal((await rawFetch(base+'files',{headers:{Cookie:cookie}})).status,401);
  assert.equal((await rawFetch(base+'files',{headers})).status,400);
  assert.match((await (await rawFetch(base+'files',{headers})).json()).error,/Connect Google Drive/);
 }finally{globalThis.fetch=rawFetch;for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}}
});

test('production storage policy blocks legacy workspace uploads',async()=>{delete process.env.MOWR_LEGACY_WORKSPACE;try{for(const path of ['workspace','scopes','files/reserve'])assert.equal((await request(path,'POST',{})).status,410);}finally{process.env.MOWR_LEGACY_WORKSPACE='true';}});

test('subscription VM time has a per-person share and unused reservations are refunded',async()=>{
 const {reserveRuntime,refundRuntime,USER_MONTHLY_RUNTIME_SECONDS}=await import('../server/subscriptions.ts');
 await pg.exec('CREATE TABLE IF NOT EXISTS mowr_runtime_budget(month text primary key,reserved_seconds integer not null default 0)');
 const month=new Date().toISOString().slice(0,7),used=async(key:string)=>(await pg.query<{reserved_seconds:number}>('SELECT reserved_seconds FROM mowr_runtime_budget WHERE month=$1',[key])).rows[0]?.reserved_seconds??0;
 const taken=[];for(let i=0;i<USER_MONTHLY_RUNTIME_SECONDS/600;i++)taken.push(await reserveRuntime('supabase:heavy',600));
 await assert.rejects(reserveRuntime('supabase:heavy',600),/Your free account connection allowance/);
 assert.equal(await used(month),USER_MONTHLY_RUNTIME_SECONDS);
 // Someone else still has their own share.
 const other=await reserveRuntime('supabase:light',180);
 assert.equal(await used(month),USER_MONTHLY_RUNTIME_SECONDS+180);
 // A VM deleted early gives back what it did not use, exactly once per reservation.
 await refundRuntime(taken[0]);await refundRuntime(other);
 assert.ok(await used(month)<=USER_MONTHLY_RUNTIME_SECONDS-590);
 assert.ok(await used(month+':supabase:heavy')<=USER_MONTHLY_RUNTIME_SECONDS-590);
 assert.ok(await used(month+':supabase:light')<=1);
 await reserveRuntime('supabase:heavy',500);
});

test('application errors keep their message; only database failures report an outage',async()=>{
 const {DatabaseError}=await import('../server/d1.ts');
 const {default:express}=await import('express');
 const probe=express();probe.get('/app',()=>{throw Error('The free account connection allowance is used up for this month.');});probe.get('/db',()=>{throw new DatabaseError('Cloud database request failed (500).');});
 const [handler]=(app as any).router.stack.slice(-1);probe.use(handler.handle);
 const s=probe.listen(0,'127.0.0.1');await new Promise<void>(r=>s.once('listening',r));const p=(s.address() as any).port;
 try{
  const a=await fetch(`http://127.0.0.1:${p}/app`);assert.equal(a.status,400);assert.match((await a.json()).error,/allowance is used up/);
  assert.equal((await fetch(`http://127.0.0.1:${p}/db`)).status,503);
 }finally{s.close();}
});
