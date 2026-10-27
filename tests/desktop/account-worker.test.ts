import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../../cloudflare/account-worker.js";
const schema = readFileSync(
  new URL("../../cloudflare/account-schema.sql", import.meta.url),
  "utf8",
);
function setup() {
  const database = new DatabaseSync(":memory:");
  database.exec(schema);
  database.exec(readFileSync(new URL("../../cloudflare/sync-schema.sql",import.meta.url),"utf8"));
  const DB = {
    prepare(sql: string) {
      return {
        bind(...values: any[]) {
          const statement = database.prepare(sql);
          return {
            first: async () => statement.get(...values) || null,
            all: async () => ({ results: statement.all(...values) }),
            run: async () => statement.run(...values),
          };
        },
      };
    },
  };
  return {
    database,
    env: {
      DB,
      SUPABASE_URL: "https://auth.example",
      SUPABASE_ANON_KEY: "public",
    },
  };
}
test("account endpoints enforce identity, atomic username ownership and absent checkout credentials", async () => {
  const { database, env } = setup(),
    original = globalThis.fetch;
  let user = {
    id: "user-a",
    email: "a@example.com",
    email_confirmed_at: "2026-09-19",
  };
  globalThis.fetch = async () => Response.json(user);
  const call = (path: string, body?: unknown) =>
    worker.fetch(
      new Request("https://account.example" + path, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: "Bearer test",
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
    );
  try {
    assert.equal(
      (await worker.fetch(new Request("https://account.example/profile"), env))
        .status,
      401,
    );
    assert.equal(
      (
        await call("/profile", {
          username: "unique",
          displayName: "A",
          step: 3,
          memory: true,
        })
      ).status,
      200,
    );
    user = { ...user, id: "user-b" };
    assert.equal(
      (
        await call("/profile", {
          username: "UNIQUE",
          displayName: "B",
          step: 3,
          memory: false,
        })
      ).status,
      409,
    );
    assert.deepEqual(await (await call("/username?value=unique")).json(), {
      available: false,
      valid: true,
    });
    // Clem is free: every signed-in account has access and checkout is never needed.
    assert.equal((await call("/checkout", {})).status, 409);
    assert.deepEqual(await (await call("/entitlement")).json(), {
      active: true,
      reason: "free",
    });
    user = {
      id: "owner-id",
      email: "m@mohamedmowafy.com",
      email_confirmed_at: "",
    };
    assert.equal((await call("/entitlement")).status, 403);
    user.email_confirmed_at = "2026-09-19";
    assert.deepEqual(await (await call("/entitlement")).json(), {
      active: true,
      reason: "owner",
    });
    user.email = "other@example.com";
    assert.deepEqual(await (await call("/entitlement")).json(), {
      active: true,
      reason: "owner",
    });
    user.id = "unrelated-id";
    // The owner grant stays bound to the original id; others simply get free access.
    assert.equal((await (await call("/entitlement")).json()).reason, "free");
  } finally {
    globalThis.fetch = original;
    database.close();
  }
});
test("username probing is rate limited without account details", async () => {
  const { database, env } = setup(),
    original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ id: "probe", email_confirmed_at: "2026-09-19" });
  try {
    let response;
    for (let i = 0; i < 31; i++)
      response = await worker.fetch(
        new Request("https://account.example/username?value=someone", {
          headers: { Authorization: "Bearer test" },
        }),
        env,
      );
    assert.equal(response!.status, 429);
  } finally {
    globalThis.fetch = original;
    database.close();
  }
});

test('essential sync rejects workspace data, isolates accounts and compares revisions',async()=>{
 const {database,env}=setup(),original=globalThis.fetch;let id='sync-a';
 globalThis.fetch=async()=>Response.json({id,email:'a@example.test',email_confirmed_at:'2026-09-20'});
 const call=(kind:string,body?:unknown)=>worker.fetch(new Request('https://account.example/sync/'+kind,{method:body?'POST':'GET',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),env);
 try{
  assert.equal((await call('chats',{revision:0,data:[]})).status,400);
  assert.equal((await call('notes',{revision:0,data:[{id:'project:a',text:'Memory',files:['secret.txt']}]})).status,400);
  assert.equal((await call('notes',{revision:0,data:[{id:'project:a',text:'Memory'}]})).status,200);
  assert.equal((await call('notes',{revision:0,data:[]})).status,409);
  assert.equal((await call('notes',{revision:1,data:[{id:'project:a',text:'Correction'}]})).status,200);
  const saved=await(await call('notes')).json();assert.equal(saved.revision,2);assert.equal(saved.data[0].text,'Correction');
  id='sync-b';assert.deepEqual(await(await call('notes')).json(),{revision:0,data:[]});
 }finally{globalThis.fetch=original;database.close();}
});

test("a username belongs to the M4 Labs account and is mirrored to Supabase", async () => {
  const { database, env } = setup(),
    original = globalThis.fetch,
    mirrored: any[] = [];
  Object.assign(env, { SUPABASE_SERVICE_ROLE_KEY: "service" });
  let user = { id: "user-a", email: "a@example.com", email_confirmed_at: "2026-09-19" };
  globalThis.fetch = async (url: any, init?: any) => {
    if (String(url).includes("/auth/v1/admin/users/")) {
      mirrored.push([String(url).split("/").pop(), JSON.parse(init.body)]);
      return Response.json({});
    }
    return Response.json(user);
  };
  const call = (path: string, body?: unknown) =>
    worker.fetch(new Request("https://account.example" + path, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer test", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env);
  try {
    // Claimed from another product: Clem's setup then starts past its username step.
    assert.deepEqual(await (await call("/username", { username: "Lab_Name" })).json(), { username: "lab_name", previous: null });
    assert.deepEqual(mirrored, [["user-a", { app_metadata: { username: "lab_name" } }]]);
    const profile = await (await call("/profile")).json();
    assert.equal(profile.step, 1);
    assert.equal(profile.username, "lab_name");
    // Saving Clem's setup with the same name does not mirror again; a new name does.
    await call("/profile", { username: "lab_name", displayName: "A", step: 2, memory: true });
    assert.equal(mirrored.length, 1);
    await call("/profile", { username: "renamed", displayName: "A", step: 2, memory: true });
    assert.deepEqual(mirrored[1], ["user-a", { app_metadata: { username: "renamed" } }]);
    user = { ...user, id: "user-b" };
    assert.equal((await call("/username", { username: "renamed" })).status, 409);
    assert.equal((await call("/username", { username: "x" })).status, 400);
  } finally {
    globalThis.fetch = original;
    database.close();
  }
});
