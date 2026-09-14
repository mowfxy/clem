import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
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

test('GitHub connections isolate tokens and reject unsafe imports',async()=>{
 const rawFetch=globalThis.fetch;let authorized='';
 globalThis.fetch=async(input:any,init:any)=>{if(!String(input).startsWith('https://api.github.com/'))return rawFetch(input,init);authorized=init.headers.Authorization||'';if(String(input).endsWith('/user'))return Response.json({login:'reader'});if(String(input).endsWith('/binary'))return Response.json({type:'file',name:'binary',path:'binary',size:3,encoding:'base64',content:Buffer.from([0,1,2]).toString('base64')});return Response.json({type:'file',name:'README.md',path:'README.md',size:5,encoding:'base64',content:Buffer.from('hello').toString('base64')})};
 try{
 const a=await request('auth/login','POST',{email:'alice@example.test',password:'Long-example-password1'});const ac=a.headers.get('set-cookie')!.split(';')[0];
 // Use a separate address to keep the existing authentication-rate assertions independent.
 const b=await rawFetch(`http://127.0.0.1:${port}/api/auth/login`,{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json','X-Forwarded-For':'127.0.0.2'},body:JSON.stringify({email:'bob@example.test',password:'Long-example-password2'})});const bc=b.headers.get('set-cookie')!.split(';')[0];
 assert.equal((await request('github/connection','POST',{token:'github_pat_private_read_only_example'},ac)).status,200);
 assert.equal((await request('github/file?repo=owner/repo&filePath=README.md','GET',undefined,ac)).status,200);assert.equal(authorized,'Bearer github_pat_private_read_only_example');
 assert.equal((await request('github/file?repo=owner/repo&filePath=README.md','GET',undefined,bc)).status,200);assert.equal(authorized,'');
 assert.equal((await request('github/file?repo=owner/repo&filePath=binary')).status,400);
 assert.equal((await request('github/file?repo=owner/repo&filePath=..%2Fsecret')).status,400);
 assert.equal((await request('github/connection','POST',{token:'github_pat_private_read_only_example'})).status,401);
 assert.equal((await request('github/connection','DELETE',undefined,ac)).status,200);
 await request('github/file?repo=owner/repo&filePath=README.md','GET',undefined,ac);assert.equal(authorized,'');
 }finally{globalThis.fetch=rawFetch}
});
