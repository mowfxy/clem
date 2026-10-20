import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { ACTIONS } from "./kinetra-turn.ts";

/**
 * Kinetra as a local MCP server, so Claude Code and Codex send tool requests as structured tool calls instead of
 * {"kinetra":…} JSON in their text. It speaks MCP's Streamable HTTP transport (JSON responses, no event stream) on
 * 127.0.0.1 only. Each answer registers its own endpoint with a random bearer token, and every call goes through
 * that answer's Kinetra loop (desktop/kinetra-turn.ts), which applies the same limits as the text protocol:
 * MAX_CALLS, the tools' own timeouts and size caps. Nothing else on the machine can call it: the token is needed,
 * and a request that carries a browser Origin is refused.
 */

/** The largest request body accepted: the most one model reply may hold (the text protocol's limit). */
export const MAX_BODY = 64_000_000;
/** How long a CLI waits for one tool call. The text protocol has no limit of its own around a tool (each tool has
 *  its own: 30 s for a calculation, a minute to draw pages), so the CLIs are given one long enough never to cut a tool short. */
export const TOOL_TIMEOUT_SECONDS = 3600;
/** The most of one tool result a CLI passes to the model, in tokens: far above any result Kinetra returns (the worker
 *  caps results at 2 MB), so nothing is cut that the text protocol would have sent whole. */
export const TOOL_OUTPUT_TOKENS = 1_000_000;
export const SERVER_NAME = "kinetra";
export const TOOL_NAME = "kinetra";
/** How the tool appears to Claude Code (mcp__server__tool). */
export const CLAUDE_TOOL = `mcp__${SERVER_NAME}__${TOOL_NAME}`;
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** What one call returns: the result as the model sees it (the same JSON the text protocol sends) and pictures to show. */
export type NativeResult = { result: unknown; pictures: { mime: string; data: string }[] };
export type NativeCall = (request: Record<string, unknown>) => Promise<NativeResult>;
export type NativeEndpoint = { url: string; token: string; close: () => void };

export const kinetraToolSpec = {
  name: TOOL_NAME,
  title: "Kinetra",
  description:
    'Runs one Kinetra request: verified calculations, textbook figures, and real files (PDF, Word, PowerPoint, Excel, text files, images), plus reading the person\'s files. The arguments are exactly the object the instructions write inside {"kinetra":…}: an "action" and its fields, for example {"action":"call","module":"clem","fn":"solveCircuit","args":[…]} or {"action":"pdf","title":…,"sections":[…]}.',
  inputSchema: {
    type: "object",
    properties: { action: { type: "string", enum: [...ACTIONS], description: "call, pdf, docx, pptx, xlsx, file, image, open, recipes, api, skill, help, files, read, search, look, regions, crop, editpdf, find, attach, or batch (several requests in one call: {\"action\":\"batch\",\"requests\":[…]})" } },
    required: ["action"],
    additionalProperties: true,
  },
  annotations: { title: "Kinetra", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};

/** The tool result in MCP's form: the result JSON as text, and the pictures as image content after it. */
export function toolResult({ result, pictures }: NativeResult) {
  const error = !!result && typeof result === "object" && "error" in (result as object) && Object.keys(result as object).length === 1;
  return {
    content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result ?? null) }, ...pictures.map((p) => ({ type: "image", data: p.data, mimeType: p.mime }))],
    isError: error,
  };
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** One shared local server; each answer adds its own endpoint while it runs. */
class KinetraMcp {
  private server: Server | null = null;
  private port = 0;
  private starting: Promise<void> | null = null;
  private endpoints = new Map<string, NativeCall>();

  private async start() {
    if (this.server) return;
    this.starting ??= new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => void this.handle(req, res));
      // Long tool calls (a document of many parts) must not be cut off by Node's own request timeouts.
      server.requestTimeout = 0;
      server.headersTimeout = 60_000;
      server.keepAliveTimeout = 5_000;
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        this.server = server;
        this.port = (server.address() as AddressInfo).port;
        server.unref();
        resolve();
      });
    }).finally(() => { this.starting = null; });
    await this.starting;
  }

  /** An endpoint for one answer's calls. `close` removes it; a call arriving afterwards is refused. */
  async open(call: NativeCall): Promise<NativeEndpoint> {
    await this.start();
    const token = randomBytes(32).toString("hex");
    this.endpoints.set(token, call);
    return { url: `http://127.0.0.1:${this.port}/mcp`, token, close: () => { this.endpoints.delete(token); } };
  }

  /** Stops the server (on quit, and in tests). */
  close() {
    this.endpoints.clear();
    this.server?.close();
    this.server = null;
  }

  private send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
    if (res.headersSent) return;
    const text = body === undefined ? "" : JSON.stringify(body);
    res.writeHead(status, { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers });
    res.end(text);
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    try {
      // A web page can reach localhost: anything sent by a browser (it always names its Origin) is refused.
      if (req.headers.origin) return this.send(res, 403, { error: "Browsers may not call this server." });
      if (new URL(req.url || "/", "http://127.0.0.1").pathname !== "/mcp") return this.send(res, 404, { error: "Not found" });
      const auth = String(req.headers.authorization || "");
      const token = /^Bearer\s+([0-9a-f]{64})$/i.exec(auth)?.[1] || "";
      const call = [...this.endpoints].find(([t]) => same(t, token))?.[1];
      if (!call) return this.send(res, 401, { error: "Unauthorized" });
      if (req.method === "GET") return this.send(res, 405, undefined, { Allow: "POST, DELETE" });
      if (req.method === "DELETE") return this.send(res, 200);
      if (req.method !== "POST") return this.send(res, 405, undefined, { Allow: "POST, DELETE" });
      const body = await readBody(req);
      if (body === null) {
        // Answered before the rest is read; the rest is discarded and the connection closed.
        this.send(res, 413, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, { Connection: "close" });
        return;
      }
      let message: any;
      try { message = JSON.parse(body); } catch { return this.send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
      const answer = async (m: any) => (m && m.id !== undefined && m.id !== null ? this.dispatch(m, call) : undefined);
      if (Array.isArray(message)) {
        const replies = (await Promise.all(message.map(answer))).filter(Boolean);
        return replies.length ? this.send(res, 200, replies) : this.send(res, 202);
      }
      const reply = await answer(message);
      return reply ? this.send(res, 200, reply) : this.send(res, 202);
    } catch (error) {
      this.send(res, 500, { jsonrpc: "2.0", id: null, error: { code: -32603, message: (error as Error).message } });
    }
  }

  private async dispatch(m: any, call: NativeCall) {
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: m.id, result });
    const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: m.id, error: { code, message } });
    switch (m.method) {
      case "initialize": {
        const asked = String(m.params?.protocolVersion || "");
        return ok({ protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: SERVER_NAME, title: "Kinetra (Clem)", version: "1.0.0" } });
      }
      case "ping": return ok({});
      case "tools/list": return ok({ tools: [kinetraToolSpec] });
      case "resources/list": return ok({ resources: [] });
      case "resources/templates/list": return ok({ resourceTemplates: [] });
      case "prompts/list": return ok({ prompts: [] });
      case "tools/call": {
        if (m.params?.name !== TOOL_NAME) return fail(-32602, `Unknown tool "${String(m.params?.name)}". The only tool is ${TOOL_NAME}.`);
        const args = m.params?.arguments;
        // Some clients wrap the request once more ({"kinetra":{…}} or {"request":{…}}): the request is the inner object.
        const request = args && typeof args === "object" && !Array.isArray(args)
          ? (typeof args.action !== "string" && Object.keys(args).length === 1 && typeof Object.values(args)[0] === "object" ? (Object.values(args)[0] as Record<string, unknown>) : args)
          : null;
        if (!request || Array.isArray(request)) return ok(toolResult({ result: { error: 'The arguments must be one Kinetra request object, such as {"action":"help"}.' }, pictures: [] }));
        return ok(toolResult(await call(request)));
      }
      default: return fail(-32601, `Method not found: ${String(m.method)}`);
    }
  }
}

/** The request body, or null as soon as it passes MAX_BODY (the rest is then discarded as it arrives). */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0, over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > MAX_BODY) { over = true; chunks.length = 0; resolve(null); return; }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!over) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

/** The one server for this app. */
export const kinetraMcp = new KinetraMcp();

/**
 * Sent before the instructions when the provider has the native tool. The instructions keep describing requests as
 * {"kinetra":…} objects (one description for every provider); this maps each one to a tool call. A model that does not
 * see the tool still has the text protocol, which runs the same way.
 */
export const NATIVE_NOTE = `NATIVE KINETRA TOOL: this session has a tool named "${TOOL_NAME}". Wherever the instructions below say to reply with {"kinetra":X}, call the ${TOOL_NAME} tool with X as its arguments instead (for example {"kinetra":{"action":"help"}} becomes a ${TOOL_NAME} call with {"action":"help"}), and keep working in the same reply: its result comes back to you directly, with any pictures. Where the instructions say to batch requests in one reply, make those ${TOOL_NAME} calls together in one turn (parallel tool calls). Write no {"kinetra":…} JSON in your text. If that tool is not available to you, reply with the {"kinetra":…} JSON as described, and Clem runs it.\n\n`;

/**
 * A provider's side of a native call: the loop's result with its picture files read in, since MCP sends pictures
 * inline rather than as files. (Each provider also keeps its own inactivity limit from firing while a tool runs: the
 * text protocol runs tools between replies, where no such limit applies.)
 */
export function inlinePictures<P extends { path: string; mime?: string }>(
  native: (request: Record<string, unknown>) => Promise<{ result: unknown; pictures: P[] }>,
  read: (path: string) => Promise<Uint8Array>,
): NativeCall {
  return async (request) => {
    const { result, pictures } = await native(request);
    return { result, pictures: await Promise.all(pictures.map(async (p) => ({ mime: p.mime || mimeOf(p.path), data: Buffer.from(await read(p.path)).toString("base64") }))) };
  };
}
/** While `work` runs, `alive` is called every 20 s and once at the end, so a provider's inactivity limit never ends a reply mid-tool. */
export async function keepingAlive<T>(work: () => Promise<T>, alive: () => void): Promise<T> {
  const timer = setInterval(alive, 20_000);
  try {
    return await work();
  } finally {
    clearInterval(timer);
    alive();
  }
}
const mimeOf = (path: string) => (/\.png$/i.test(path) ? "image/png" : /\.webp$/i.test(path) ? "image/webp" : "image/jpeg");

/** Claude Code's --mcp-config for one answer's endpoint. */
export function claudeMcpConfig(endpoint: NativeEndpoint) {
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: { type: "http", url: endpoint.url, headers: { Authorization: `Bearer ${endpoint.token}` } } } });
}

/** Codex's thread configuration for one answer's endpoint (the bearer token travels as a header, never on disk). */
export function codexMcpConfig(endpoint: NativeEndpoint) {
  return {
    [`mcp_servers.${SERVER_NAME}.url`]: endpoint.url,
    [`mcp_servers.${SERVER_NAME}.http_headers`]: { Authorization: `Bearer ${endpoint.token}` },
    [`mcp_servers.${SERVER_NAME}.tool_timeout_sec`]: TOOL_TIMEOUT_SECONDS,
    [`mcp_servers.${SERVER_NAME}.startup_timeout_sec`]: 30,
    // Results reach the model whole, as they do in the text protocol (a guide, a passage of a file, a solved circuit).
    tool_output_token_limit: TOOL_OUTPUT_TOKENS,
  };
}

/** How the tool appears to Grok (server__tool, reached through its use_tool). */
export const GROK_TOOL = `${SERVER_NAME}__${TOOL_NAME}`;
/** The most of one tool result Grok passes to the model, in bytes (its default is 20 kB, which would cut a guide or a
 *  passage of a file that the text protocol sends whole). */
export const GROK_MAX_OUTPUT_BYTES = 4_000_000;
/**
 * Grok reads MCP servers only from config files, so a native answer writes this as the working folder's
 * .grok/config.toml. The address and token come from the environment Grok is started with (grokMcpEnv): the file holds
 * no secret, and two answers running in one subject's folder at once each reach their own endpoint.
 */
export const GROK_MCP_CONFIG = [
  "# Written by Clem before each Grok answer: Kinetra, reached through this answer's local endpoint.",
  "[mcp]",
  `max_output_bytes = ${GROK_MAX_OUTPUT_BYTES}`,
  "",
  `[mcp_servers.${SERVER_NAME}]`,
  'url = "${CLEM_KINETRA_URL}"',
  "enabled = true",
  "startup_timeout_sec = 30",
  `tool_timeout_sec = ${TOOL_TIMEOUT_SECONDS}`,
  "",
  `[mcp_servers.${SERVER_NAME}.headers]`,
  'Authorization = "Bearer ${CLEM_KINETRA_TOKEN}"',
  "",
].join("\n");
export const grokMcpEnv = (endpoint: NativeEndpoint) => ({ CLEM_KINETRA_URL: endpoint.url, CLEM_KINETRA_TOKEN: endpoint.token });
/** NATIVE_NOTE for Grok, which reaches MCP tools through use_tool: naming the tool saves it a search step. */
export const GROK_NATIVE_NOTE = NATIVE_NOTE.replace(
  `call the ${TOOL_NAME} tool with X as its arguments instead (for example {"kinetra":{"action":"help"}} becomes a ${TOOL_NAME} call with {"action":"help"})`,
  `call use_tool with tool_name "${GROK_TOOL}" and X as tool_input instead (for example {"kinetra":{"action":"help"}} becomes use_tool with {"tool_name":"${GROK_TOOL}","tool_input":{"action":"help"}}); you need not search for the tool first`,
);
