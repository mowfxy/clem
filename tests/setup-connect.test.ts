import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { foundFor, orderServices } from "../src/desktop/ai-found.ts";
import { modelOf } from "../src/after-setup.ts";
import { detectPcSignIns } from "../desktop/ai-detect.ts";

test("setup finds what is on the PC by its files alone, and never reads a token", async () => {
  const home = await mkdtemp(join(tmpdir(), "clem-detect-"));
  try {
    assert.deepEqual(await detectPcSignIns(home), { codex: { signedIn: false }, claude: { signedIn: false } });
    await mkdir(join(home, ".codex")); await mkdir(join(home, ".claude"));
    await writeFile(join(home, ".codex", "auth.json"), '{"tokens":{"access_token":"secret"}}');
    await writeFile(join(home, ".claude", ".credentials.json"), '{"claudeAiOauth":{"accessToken":"secret"}}');
    await writeFile(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "sam@example.com" } }));
    const found = await detectPcSignIns(home);
    assert.deepEqual(found, { codex: { signedIn: true }, claude: { signedIn: true, email: "sam@example.com" } });
    assert.equal(JSON.stringify(found).includes("secret"), false);
    await writeFile(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "<script>" } }));
    assert.equal((await detectPcSignIns(home)).claude.email, undefined);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("each AI gets one state and button, found ones first, Gemini first when nothing is found", () => {
  const none = { codex: { signedIn: false }, claude: { signedIn: false } };
  assert.equal(foundFor("chatgpt", {}, none, false), "out", "Codex comes with Clem, so ChatGPT is never missing");
  assert.equal(foundFor("chatgpt", {}, { codex: { signedIn: true } }, false), "pc");
  assert.equal(foundFor("chatgpt", {}, none, true), "connected");
  assert.equal(foundFor("claude", { installed: true }, { claude: { signedIn: true } }, false), "pc");
  assert.equal(foundFor("claude", { installed: false }, { claude: { signedIn: true } }, false), "missing", "a sign-in file without Claude Code is no use");
  assert.equal(foundFor("claude", { installed: true, connected: true }, none, false), "connected");
  assert.equal(foundFor("grok", { installed: true }, none, false), "out");
  assert.equal(foundFor("antigravity", {}, none, false), "missing");
  assert.deepEqual(orderServices({ chatgpt: "out", claude: "missing", grok: "missing", antigravity: "missing" }), ["antigravity", "chatgpt", "claude", "grok"]);
  assert.deepEqual(orderServices({ chatgpt: "out", claude: "pc", grok: "connected", antigravity: "missing" }), ["grok", "claude", "chatgpt", "antigravity"]);
  assert.ok(modelOf("claude", "claude:sonnet") && !modelOf("chatgpt", "claude:sonnet"));
  assert.ok(modelOf("grok", "grok:grok-4") && modelOf("antigravity", "antigravity:gemini-3") && modelOf("chatgpt", "gpt-5.5"));
});
