import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kinetraMcp, claudeMcpConfig, codexMcpConfig, toolResult, NATIVE_NOTE, MAX_BODY, CLAUDE_TOOL, TOOL_TIMEOUT_SECONDS } from "../../desktop/kinetra-mcp.ts";
import { runKinetraTurn, MAX_CALLS } from "../../desktop/kinetra-turn.ts";
import { ClaudeProvider, claudeArgs } from "../../desktop/claude.ts";
import { Codex } from "../../desktop/codex.ts";

after(() => kinetraMcp.close());

/** One JSON-RPC message to an endpoint, as a CLI's MCP client sends it. */
async function rpc(url: string, token: string | null, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

test("the MCP server speaks the protocol, lists one tool and runs calls through the answer's loop", async () => {
  const seen: unknown[] = [];
  const endpoint = await kinetraMcp.open(async (request) => { seen.push(request); return { result: { ran: request.action }, pictures: [{ mime: "image/png", data: "iVBORw0KGgo=" }] }; });
  const init = await rpc(endpoint.url, endpoint.token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.deepEqual(init.body.result.capabilities.tools, { listChanged: false });
  assert.equal((await rpc(endpoint.url, endpoint.token, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const list = await rpc(endpoint.url, endpoint.token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(list.body.result.tools.map((t: any) => t.name), ["kinetra"]);
  assert.ok(list.body.result.tools[0].inputSchema.properties.action.enum.includes("pdf"));
  const call = await rpc(endpoint.url, endpoint.token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "kinetra", arguments: { action: "help" } } });
  assert.deepEqual(call.body.result.content, [{ type: "text", text: '{"ran":"help"}' }, { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }]);
  assert.equal(call.body.result.isError, false);
  // A request wrapped once more, as in the text protocol, is unwrapped.
  await rpc(endpoint.url, endpoint.token, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "kinetra", arguments: { kinetra: { action: "recipes" } } } });
  assert.deepEqual(seen, [{ action: "help" }, { action: "recipes" }]);
  assert.equal((await rpc(endpoint.url, endpoint.token, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "shell", arguments: {} } })).body.error.code, -32602);
  assert.equal((await rpc(endpoint.url, endpoint.token, { jsonrpc: "2.0", id: 6, method: "nope" })).body.error.code, -32601);
  // A batch is answered as a batch.
  const batch = await rpc(endpoint.url, endpoint.token, [{ jsonrpc: "2.0", id: 7, method: "ping" }, { jsonrpc: "2.0", id: 8, method: "ping" }]);
  assert.deepEqual(batch.body.map((r: any) => r.id), [7, 8]);
  endpoint.close();
});

test("nothing else can call it: a token is needed, browsers are refused, closed endpoints stop and huge bodies are rejected", async () => {
  const endpoint = await kinetraMcp.open(async () => ({ result: "ok", pictures: [] }));
  const other = await kinetraMcp.open(async () => ({ result: "other", pictures: [] }));
  const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
  assert.equal((await rpc(endpoint.url, null, ping)).status, 401);
  assert.equal((await rpc(endpoint.url, "0".repeat(64), ping)).status, 401);
  assert.equal((await rpc(endpoint.url, endpoint.token, ping, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await rpc(endpoint.url.replace("/mcp", "/other"), endpoint.token, ping)).status, 404);
  // Each answer's token reaches its own loop only.
  const call = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "kinetra", arguments: { action: "help" } } };
  assert.equal((await rpc(other.url, other.token, call)).body.result.content[0].text, "other");
  endpoint.close();
  assert.equal((await rpc(endpoint.url, endpoint.token, ping)).status, 401);
  assert.equal((await rpc(other.url, other.token, "x".repeat(MAX_BODY + 1))).status, 413);
  other.close();
  assert.ok(new URL(endpoint.url).hostname === "127.0.0.1");
});

test("a tool error is marked as an error result", () => {
  assert.equal(toolResult({ result: { error: "bad" }, pictures: [] }).isError, true);
  assert.equal(toolResult({ result: { created: true, error: undefined }, pictures: [] }).isError, false);
});

/** The same three requests, sent by a model as text envelopes or as native calls, with a document planned in parts. */
async function scenario(mode: "text" | "native") {
  const requests = [{ action: "call", module: "mowr", fn: "solveCircuit", args: [{}] }, { action: "look", file: "a.pdf", pages: [1] }, { action: "pdf", title: "T", sections: [{ heading: "A", text: "x" }] }];
  const ran: unknown[] = [], seenResults: unknown[] = [], inputs: string[] = [], pictures: string[][] = [];
  let step = 0;
  const answer = await runKinetraTurn<string>("q", "INSTRUCTIONS", async (input, _followUp, attached, native) => {
    inputs.push(input);
    pictures.push(attached);
    step++;
    if (mode === "native") {
      if (step > 1) return "Done.";
      for (const r of requests) { const out = await native(r); seenResults.push(out.result); pictures.push(out.pictures); }
      return "Done.";
    }
    for (const match of input.matchAll(/Kinetra result for .*\n(.*)/g)) seenResults.push(JSON.parse(match[1]));
    return step === 1 ? requests.map((r) => JSON.stringify({ kinetra: r })).join("\n") : "Done.";
  }, async (request) => {
    ran.push(request);
    if (request.action === "look") return { pictures: ["a.pdf — page 1"], attachPictures: ["page1.png"] };
    if (request.action === "pdf") return { created: true, file: { id: "f" } };
    return { nodes: { "1": 6 } };
  }, () => false, { stateful: true });
  return { answer, ran, seenResults, inputs, pictures };
}

test("text and native requests run the same tools and give the model identical results", async () => {
  const text = await scenario("text"), native = await scenario("native");
  assert.equal(text.answer, "Done.");
  assert.equal(native.answer, "Done.");
  assert.deepEqual(native.ran, text.ran);
  assert.deepEqual(native.seenResults, text.seenResults);
  assert.match(JSON.stringify(native.seenResults[1]), /These pictures are attached: look at them now/);
  // Text: the picture travels with the next message. Native: inside the tool result, and not sent again.
  assert.deepEqual(text.pictures, [[], ["page1.png"]]);
  assert.deepEqual(native.pictures.filter((p) => p.length), [["page1.png"]]);
  assert.equal(native.inputs.length, 1, "native results are never resent as new results");
});

test("native calls share MAX_CALLS with the text protocol and run one at a time", async () => {
  let running = 0, most = 0, ran = 0;
  const results: any[] = [];
  await runKinetraTurn("q", "", async (_input, followUp, _p, native) => {
    if (followUp) return "Done.";
    // Fired all at once, as a client running tools in parallel would.
    results.push(...(await Promise.all(Array.from({ length: MAX_CALLS + 3 }, (_, i) => native({ action: "call", n: i })))).map((r) => r.result));
    return "Done.";
  }, async () => { running++; most = Math.max(most, running); await new Promise((r) => setImmediate(r)); running--; ran++; return 1; }, () => false, { stateful: true });
  assert.equal(ran, MAX_CALLS);
  assert.equal(most, 1);
  assert.deepEqual(results.slice(-3).map((r) => r.error), Array(3).fill("Not run: no tool calls were left."));
});

test("a stopped answer stops native calls too", async () => {
  let stop = false, ran = 0;
  await assert.rejects(runKinetraTurn("q", "", async (_i, _f, _p, native) => {
    await native({ action: "help" });
    stop = true;
    await native({ action: "help" });
    return "x";
  }, async () => { ran++; return 1; }, () => stop), /Request cancelled/);
  assert.equal(ran, 1);
});

test("Claude Code gets the Kinetra server as its only MCP server, allowed, without safe mode", () => {
  const plain = claudeArgs("sonnet", "high", { id: "s", resume: false });
  for (const flag of ["--safe-mode", "--disallowedTools", "mcp__*"]) assert.ok(plain.includes(flag), flag);
  assert.ok(!plain.includes("--mcp-config"));
  const config = claudeMcpConfig({ url: "http://127.0.0.1:1/mcp", token: "t", close() {} });
  const native = claudeArgs("sonnet", "high", { id: "s", resume: true }, config);
  for (const flag of ["--safe-mode", "--disallowedTools", "mcp__*"]) assert.ok(!native.includes(flag), flag);
  assert.equal(native[native.indexOf("--mcp-config") + 1], config);
  assert.ok(native.includes("--strict-mcp-config") && native.includes("--disable-slash-commands"));
  assert.equal(native[native.indexOf("--allowedTools") + 1], `WebSearch,${CLAUDE_TOOL}`);
  assert.equal(native[native.indexOf("--max-turns") + 1], String(MAX_CALLS + 10));
  assert.deepEqual(native.slice(-4), ["--resume", "s", "--effort", "high"]);
  assert.deepEqual(JSON.parse(config).mcpServers.kinetra, { type: "http", url: "http://127.0.0.1:1/mcp", headers: { Authorization: "Bearer t" } });
  const codex = codexMcpConfig({ url: "http://127.0.0.1:1/mcp", token: "t", close() {} });
  assert.equal(codex["mcp_servers.kinetra.tool_timeout_sec"], TOOL_TIMEOUT_SECONDS);
  assert.deepEqual(codex["mcp_servers.kinetra.http_headers"], { Authorization: "Bearer t" });
});

/** A Claude Code stand-in that calls the MCP server it was given over HTTP, like the real CLI, then answers. */
function fakeClaude(provider: any, script: (url: string, token: string) => Promise<string>) {
  const runs: { args: string[]; input: string; env: any }[] = [];
  provider.start = async (args: string[]) => {
    const run = { args, input: "", env: provider.env() };
    runs.push(run);
    const child: any = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    child.stdin.on("data", (part: Buffer) => { run.input += part.toString(); });
    child.stdin.on("finish", async () => {
      const i = args.indexOf("--mcp-config");
      let text = "";
      if (i >= 0) {
        const server = JSON.parse(args[i + 1]).mcpServers.kinetra;
        text = await script(server.url, server.headers.Authorization.slice(7));
      } else text = await script("", "");
      child.stdout.write(JSON.stringify({ type: "result", subtype: "success", result: text, is_error: false }) + "\n");
      child.emit("close", 0);
    });
    return child;
  };
  return runs;
}

test("Claude: a native call runs through MCP inside one reply, with its pictures, and the endpoint closes after", async () => {
  const provider: any = new ClaudeProvider("fixture", mkdtempSync(join(tmpdir(), "mowr-claude-")));
  provider.status = async () => ({ connected: true });
  const folder = mkdtempSync(join(tmpdir(), "mowr-pic-"));
  const png = join(folder, "page.png");
  writeFileSync(png, Buffer.from("89504e470d0a1a0a", "hex"));
  let url = "", token = "", result: any;
  const runs = fakeClaude(provider, async (u, t) => {
    url = u; token = t;
    await rpc(u, t, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    result = (await rpc(u, t, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "kinetra", arguments: { action: "look", file: "a.pdf", pages: [1] } } })).body.result;
    return "Checked the page.";
  });
  const ran: any[] = [];
  const answer = await runKinetraTurn<{ path: string; mime: string }>("Look at page 1", "INSTRUCTIONS", async (input, followUp, _pictures, native) => {
    let text = "";
    const { inlinePictures } = await import("../../desktop/kinetra-mcp.ts");
    const { readFile } = await import("node:fs/promises");
    await provider.run("c1", input, "claude:sonnet", undefined, (e: any) => { if (e.type === "delta") text += e.text; }, [], { id: "00000000-0000-4000-8000-000000000000", resume: followUp }, inlinePictures(native, readFile));
    return text;
  }, async (request) => { ran.push(request); return { pictures: ["a.pdf — page 1"], attachPictures: [{ path: png, mime: "image/png" }] }; }, () => false, { stateful: true });
  assert.equal(answer, "Checked the page.");
  assert.deepEqual(ran, [{ action: "look", file: "a.pdf", pages: [1] }]);
  assert.equal(result.content[1].type, "image");
  assert.equal(result.content[1].mimeType, "image/png");
  assert.equal(Buffer.from(result.content[1].data, "base64").toString("hex"), "89504e470d0a1a0a");
  // The first message says that requests go to the tool; Claude Code has the tool timeout and output limit raised.
  assert.ok(JSON.parse(runs[0].input).message.content[0].text.startsWith(NATIVE_NOTE));
  assert.equal(runs[0].env.MCP_TOOL_TIMEOUT, String(TOOL_TIMEOUT_SECONDS * 1000));
  // The reply is over: its endpoint no longer answers.
  assert.equal((await rpc(url, token, { jsonrpc: "2.0", id: 3, method: "ping" })).status, 401);
});

test("Claude: without a provider session or with the text protocol, an envelope in the reply still runs", async () => {
  const provider: any = new ClaudeProvider("fixture", mkdtempSync(join(tmpdir(), "mowr-claude-")));
  provider.status = async () => ({ connected: true });
  let n = 0;
  fakeClaude(provider, async () => (++n === 1 ? '{"kinetra":{"action":"recipes"}}' : "Answer."));
  const ran: any[] = [];
  const answer = await runKinetraTurn("q", "I", async (input, followUp, _p, native) => {
    let text = "";
    await provider.run("c2", input, "claude:sonnet", undefined, (e: any) => { if (e.type === "delta") text += e.text; }, [], { id: "00000000-0000-4000-8000-000000000001", resume: followUp }, async (r: any) => ({ ...(await native(r)), pictures: [] }));
    return text;
  }, async (r) => { ran.push(r); return "recipes"; }, () => false, { stateful: true });
  assert.equal(answer, "Answer.");
  assert.deepEqual(ran, [{ action: "recipes" }]);
});

/** A Codex app-server stand-in: on turn/start it asks to confirm the Kinetra call, makes it over HTTP, then answers. */
function fakeCodex() {
  const p: any = new EventEmitter();
  p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.stdin = new PassThrough();
  p.sent = [] as any[]; p.kill = () => { p.emit("close", 0); return true; };
  const write = (m: any) => p.stdout.write(JSON.stringify(m) + "\n");
  let config: any = {}, buffer = "";
  p.stdin.on("data", async (data: Buffer) => {
    buffer += data.toString();
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const req = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1); p.sent.push(req);
      if (req.method === "initialize") write({ id: req.id, result: {} });
      if (req.method === "thread/start") { config = req.params.config; write({ id: req.id, result: { thread: { id: "t1" } } }); }
      if (req.method === "turn/start") {
        write({ id: req.id, result: { turn: { id: "u1" } } });
        write({ id: 900, method: "mcpServer/elicitation/request", params: { threadId: "t1", serverName: "kinetra", mode: "form", message: "Allow kinetra?", requestedSchema: { type: "object", properties: {} } } });
        write({ method: "item/started", params: { threadId: "t1", item: { type: "mcpToolCall", id: "m1" } } });
        const url = config["mcp_servers.kinetra.url"], token = config["mcp_servers.kinetra.http_headers"].Authorization.slice(7);
        const out = await rpc(url, token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "kinetra", arguments: { action: "call", module: "mowr", fn: "solveCircuit" } } });
        write({ method: "item/agentMessage/delta", params: { threadId: "t1", itemId: "a1", delta: "Result: " + out.body.result.content[0].text } });
        write({ method: "turn/completed", params: { threadId: "t1", turn: { status: "completed" } } });
      }
    }
  });
  return p;
}

test("Codex: the thread gets the Kinetra server, the call runs natively, and its confirmation is granted", async () => {
  const codex: any = new Codex("fixture", "fixture", "fixture");
  codex.models = async () => [];
  let server: any;
  codex.start = async () => (server = fakeCodex());
  const events: any[] = [];
  const ran: any[] = [];
  await codex.run("a", "solve it", (e: any) => events.push(e), [], undefined, undefined, undefined, async (request: any) => { ran.push(request); return { nodes: { "1": 6 } }; });
  assert.equal(events.filter((e) => e.type === "delta").map((e) => e.text).join(""), 'Result: {"nodes":{"1":6}}');
  assert.deepEqual(ran, [{ action: "call", module: "mowr", fn: "solveCircuit" }]);
  const start = server.sent.find((r: any) => r.method === "thread/start");
  assert.equal(start.params.config["mcp_servers.kinetra.tool_timeout_sec"], TOOL_TIMEOUT_SECONDS);
  assert.ok(server.sent.find((r: any) => r.method === "turn/start").params.input[0].text.startsWith(NATIVE_NOTE));
  assert.deepEqual(server.sent.find((r: any) => r.id === 900 && !r.method).result, { action: "accept", content: {} });
  assert.equal(server.sent.filter((r: any) => r.method === "turn/start").length, 1, "one reply: no text follow-up was needed");
  codex.stop();
});

test("Codex: a plain request (no tools) gets no MCP server, and other confirmations are still refused", async () => {
  const codex: any = new Codex("fixture", "fixture", "fixture");
  codex.models = async () => [];
  let server: any;
  codex.start = async () => {
    server = new EventEmitter();
    server.stdout = new PassThrough(); server.stderr = new PassThrough(); server.stdin = new PassThrough(); server.sent = []; server.kill = () => true;
    const write = (m: any) => server.stdout.write(JSON.stringify(m) + "\n");
    server.stdin.on("data", (d: Buffer) => {
      for (const line of d.toString().split("\n").filter(Boolean)) {
        const req = JSON.parse(line); server.sent.push(req);
        if (req.method === "initialize") write({ id: req.id, result: {} });
        if (req.method === "thread/start") write({ id: req.id, result: { thread: { id: "t" } } });
        if (req.method === "turn/start") {
          write({ id: req.id, result: { turn: { id: "u" } } });
          write({ id: 901, method: "mcpServer/elicitation/request", params: { threadId: "t", serverName: "other", mode: "form", message: "?", requestedSchema: {} } });
        }
      }
    });
    return server;
  };
  await assert.rejects(codex.run("p", "plain", () => {}), /unsupported tool/);
  const start = server.sent.find((r: any) => r.method === "thread/start");
  assert.ok(!Object.keys(start.params.config).some((k) => k.startsWith("mcp_servers")));
  assert.equal(server.sent.find((r: any) => r.id === 901 && !r.method).error.code, -32601);
  codex.stop();
});
