import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { urls } from "../core/guc/parse.ts";
import { GucError } from "../desktop/engine/errors.ts";
import { GucClient, type Http } from "../desktop/engine/guc-client.ts";
import { Engine } from "../desktop/engine/index.ts";
import { fakeGuc, host, noWait, site } from "./guc-fake.ts";

const who = { username: "student.name", password: "secret" };

test("the client never runs more than two requests to a host at once, however they arrive", async () => {
  let running = 0, most = 0;
  const http: Http = async () => {
    most = Math.max(most, ++running);
    await new Promise((r) => setTimeout(r, 2));
    running--;
    return { status: 200, headers: {}, body: "<p>ok</p>" };
  };
  const client = new GucClient(who, http, noWait);
  const ask = (i: number) => client.send({ method: "GET", url: "https://cms.guc.edu.eg/page" + i });
  // Each finished request starts another straight away, while others are still waiting for a place.
  await Promise.all(Array.from({ length: 12 }, (_, i) => ask(i).then(() => ask(100 + i))));
  assert.equal(most, 2);
  assert.equal(client.requests, 24);
});

test("403 is a page the account may not open, not a wrong password; 401 is", async () => {
  const answer = (status: number): Http => async () => ({ status, headers: {}, body: "" });
  await assert.rejects(new GucClient(who, answer(403), noWait).page(urls.home), (e) => e instanceof GucError && e.kind === "unavailable");
  await assert.rejects(new GucClient(who, answer(401), noWait).page(urls.home), (e) => e instanceof GucError && e.kind === "auth");
});

test("a file that answers with a sign-in page doesn't pause GUC while the password still works", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clem-client-"));
  const file = "https://cms.guc.edu.eg/Uploads/1201/64/lecture-1.pdf";
  const login = new TextEncoder().encode('<html><form><input type="password" name="p"></form></html>');
  const guc = fakeGuc(site(), { etags: true });
  const http: Http = async (r, c) => r.binary && r.url === file && c.password === "secret" ? { status: 200, headers: { "content-type": "text/html" }, body: "", bytes: login } : guc.http(r, c);
  const engine = await Engine.open("owner-c", host({ files: join(dir, "Files") }), { http, sleep: noWait, memory: true, jobs: false });
  try {
    await engine.connect("student.name", "secret");
    await engine.link("subj-1", "1201:64");
    await (engine as any).light;
    await assert.rejects(engine.check("subj-1", "now"), (e) => e instanceof GucError && e.kind === "auth");
    const status = await engine.status();
    assert.equal(status.passwordNeeded, undefined, "the home page still takes the password");
    assert.equal(status.connected, true);
  } finally { await engine.close(); await rm(dir, { recursive: true, force: true }); }
});
