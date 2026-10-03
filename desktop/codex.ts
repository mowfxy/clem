import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {kinetraInstructions, kinetraTool} from "./kinetra-runtime.ts";
import {streamTurn,WEB_SEARCH,type TurnSession,type TurnControl} from "./codex-stream.ts";
import {AppServer} from "./app-server.ts";
import {toolRequests,brokenToolRequest,shownLength,runKinetraTurn} from "./kinetra-turn.ts";

/** While a reply might still turn out to be a tool envelope, hold it instead of streaming it. */
export function mayBeTool(text: string) {
  const t = text.trimStart();
  if (!t || t.startsWith("{")) return true;
  if ("```json".startsWith(t)) return true;
  if (!t.startsWith("```")) return false;
  const body = t.replace(/^```(?:json)?/, "").replace(/\s/g, "");
  return !body || '{"kinetra"'.startsWith(body.slice(0, 10)) || body.startsWith('{"kinetra"');
}
const IDLE_MS = 10 * 60_000;

/** What the person sees while a tool runs, instead of a silent pause. */
export function toolStatus(request: any) {
  if (request?.action === "pdf") return request.revise ? "Updating the document…" : "Typesetting the PDF…";
  if (request?.action === "open") return "Reading the document…";
  if (request?.action === "read" && typeof request.file === "string") return `Reading ${request.file.split(/[\\/]/).pop()!.slice(0, 60)}${Number(request.page) > 0 ? `, page ${Math.floor(Number(request.page))}` : ""}…`;
  if (request?.action === "search") return "Searching your files…";
  if (request?.action === "files") return "Looking through your files…";
  if (request?.action === "call" && typeof request.module === "string" && /^diagram\/|^mowr$/.test(request.module) && /^render|plot|flowchart|chart|timeline|cycle|mindmap|diagram|table|venn/i.test(String(request.fn))) return "Drawing the figure…";
  if (request?.action === "call") return "Calculating…";
  return "Checking Mowr's tools…";
}

/** Provider output is never shown verbatim: it can include sensitive diagnostics. */
export function codexFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error || "");
  if (/cancelled/i.test(detail)) return "Request stopped.";
  if (/401|unauthorized|authentication|token.*expired|connect your ChatGPT/i.test(detail)) return "Codex could not authenticate this request. Retry sign-in in Settings > Models.";
  if (/429|usage.limit|rate.limit|quota/i.test(detail)) return "Your connected account has reached its usage limit. Check usage in Settings > Models, or choose another connected account.";
  if (/reasoning level/i.test(detail)) return "This reasoning level is unavailable for the selected model. Choose another level.";
  if (/model.*(?:unavailable|not found|not supported|no longer available|does not exist)/i.test(detail)) return "This model is unavailable for your account. Refresh models in Settings > Models.";
  if (/timed out/i.test(detail)) return "The model took too long to respond. Try a lower reasoning level or a smaller request.";
  if (/network|connect|fetch|socket|dns/i.test(detail)) return "The connection to Codex was interrupted. Check your connection and try again.";
  if (/Kinetra.*limit/i.test(detail)) return "This task exceeded the document tool limit. Try a smaller document or split the request.";
  return "Codex could not complete this request. Please try again.";
}

export class Codex {
  /** Every chat that is answering right now. Chats run side by side on the shared connection. */
  private turns = new Map<string, {cancelled:boolean}>();
  private inspections = new Set<ChildProcessWithoutNullStreams>();
  get busy() {
    return this.turns.size > 0 || !!this.starting || this.active.size > 0;
  }
  private server: AppServer | null = null;
  private serverStart: Promise<AppServer> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private controls = new Map<string, TurnControl>();
  /** A warm, shared app-server. Starting the CLI is the slowest part of a request, so it is reused. */
  private async connection(): Promise<AppServer> {
    if (this.server && !this.server.dead) return this.server;
    if (this.serverStart) return this.serverStart;
    this.serverStart = (async () => {
      const server = new AppServer(await this.start(["app-server", "-c", 'cli_auth_credentials_store="file"', "-c", 'forced_login_method="chatgpt"', "-c", "features.shell_tool=false", "-c", "features.unified_exec=false", "-c", `web_search="${WEB_SEARCH}"`]));
      this.server = server;
      try { await server.ready; } catch (error) { server.close(); if (this.server === server) this.server = null; throw error; }
      return server;
    })().finally(() => { this.serverStart = null; });
    return this.serverStart;
  }
  /** Starts the connection ahead of the first message, so the first reply is not slowed by startup. */
  warm() {
    void this.connection().then(() => this.scheduleIdle()).catch(() => {});
    if (!this.catalog) void this.models().catch(() => {});
  }
  private scheduleIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.server?.idle && !this.busy && Date.now() - this.server.lastUsed >= IDLE_MS) { this.server.close(); this.server = null; }
      else if (this.server && !this.server.dead) this.scheduleIdle();
    }, IDLE_MS);
    this.idleTimer.unref?.();
  }
  private loginError: string | null = null;
  private loginChallenge: {url:string;code:string} | null = null;
  loginState(){return {pending:!!this.loginProcess,loginError:this.loginError,challenge:this.loginProcess?this.loginChallenge:null};}
  private loginProcess: ChildProcessWithoutNullStreams | null = null;
  private starting: number | boolean = 0;
  private active = new Map<string, ChildProcessWithoutNullStreams>();
  /** A function when the program can change while Mowr runs (CodexEngine updates it); read at every start. */
  private executable: string | (() => string);
  private home: string;
  private workspace: string;
  constructor(executable: string | (() => string), home: string, workspace: string) {
    this.executable = executable;
    this.home = home;
    this.workspace = workspace;
  }
  private async start(args: string[]) {
    await mkdir(this.home, { recursive: true });
    await mkdir(this.workspace, { recursive: true });
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      "PATH",
      "SystemRoot",
      "WINDIR",
      "TEMP",
      "TMP",
      "USERPROFILE",
      "LOCALAPPDATA",
      "APPDATA",
    ])
      if (process.env[key]) env[key] = process.env[key];
    env.CODEX_HOME = this.home;
    return spawn(
      typeof this.executable === "function" ? this.executable() : this.executable,
      [
        "-c",
        'cli_auth_credentials_store="file"',
        "-c",
        'forced_login_method="chatgpt"',
        ...args,
      ],
      {
        cwd: this.workspace,
        env,
        shell: false,
        windowsHide: true,
        stdio: "pipe",
      },
    );
  }
  async status() {
    const child = await this.start(["login", "status"]);
    let text = "";
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve(false);
      }, 10000);
      child.stdout.on("data", (x) => (text += x));
      child.stderr.on("data", (x) => (text += x));
      child.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code === 0 && /chatgpt/i.test(text));
      });
    });
  }
  private catalog: { at: number; models: any[] } | null = null;
  private catalogRequest: Promise<any[]> | null = null;
  async models(): Promise<any[]> {
    if (this.catalog && Date.now() - this.catalog.at < 10 * 60_000)
      return this.catalog.models;
    if (this.catalogRequest) return this.catalogRequest;
    this.catalogRequest = this.readModels().finally(() => {
      this.catalogRequest = null;
    });
    return this.catalogRequest;
  }
  private async readModels(): Promise<any[]> {
    if (!(await this.status())) return [];
    // Codex keeps its own copy of the model list in this account's home and goes on serving it for days, so a model
    // released after the account was linked never shows up. Dropping it makes this listing ask OpenAI again.
    await rm(join(this.home, "models_cache.json"), { force: true }).catch(() => {});
    const child = await this.start(["app-server"]);
    const lines = createInterface({ input: child.stdout });
    return new Promise((resolve, reject) => {
      let ended = false,
        bytes = 0,
        id = 1;
      const models: any[] = [];
      const finish = (error?: Error) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        lines.close();
        child.kill();
        if (error) reject(error);
        else {
          this.catalog = { at: Date.now(), models };
          resolve(models);
        }
      };
      const timer = setTimeout(
        () => finish(Error("Model sync timed out. Try again.")),
        20000,
      );
      const send = (method: string, params: any, requestId?: number) =>
        child.stdin.write(
          JSON.stringify({
            method,
            params,
            ...(requestId ? { id: requestId } : {}),
          }) + "\n",
        );
      child.on("error", () =>
        finish(Error("Codex model sync could not start.")),
      );
      child.on("close", () => finish(Error("Codex model sync ended early.")));
      child.stdin.on("error", () =>
        finish(Error("Codex model sync disconnected.")),
      );
      child.stderr.resume();
      lines.on("line", (line) => {
        try {
          bytes += line.length;
          if (bytes > 2000000) throw Error("Model catalog too large.");
          const message = JSON.parse(line);
          if (message.id !== id) return;
          if (message.error) throw Error("Codex could not list models.");
          if (id === 1) {
            send("initialized", {});
            send("model/list", { limit: 100, includeHidden: false }, ++id);
            return;
          }
          for (const m of message.result.data) {
            if (m.hidden || !m.model) continue;
            models.push({
              id: m.model,
              name: m.displayName || m.model,
              provider: "OpenAI",
              connected: true,
              context: 32000,
              specialties: [],
              tools: [],
              description: m.description || "",
              reasoningEfforts: m.supportedReasoningEfforts || [],
              defaultReasoningEffort: m.defaultReasoningEffort,
              isDefault: m.isDefault,
            });
          }
          if (message.result.nextCursor) {
            if (id > 20) throw Error("Model catalog too large.");
            send(
              "model/list",
              {
                limit: 100,
                includeHidden: false,
                cursor: message.result.nextCursor,
              },
              ++id,
            );
          } else finish();
        } catch (e) {
          finish(e as Error);
        }
      });
      send(
        "initialize",
        { clientInfo: { name: "mowr", version: "0.2.0" } },
        id,
      );
    });
  }
  private accountCache: { at: number; value: any } | null = null;
  private accountRequest: Promise<any> | null = null;
  /** `force` bypasses the cache; a number sets the maximum acceptable age in milliseconds. */
  async account(force: boolean | number = false): Promise<any> {
    const maxAge = force === true ? 0 : force === false ? 60000 : force;
    if (
      this.accountCache &&
      Date.now() - this.accountCache.at < maxAge
    )
      return this.accountCache.value;
    if (this.accountRequest) return this.accountRequest;
    this.accountRequest = this.readAccount()
      .then((value) => {
        this.accountCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        this.accountRequest = null;
      });
    return this.accountRequest;
  }
  private async readAccount(): Promise<any> {
    const child = await this.start(["app-server"]);
    this.inspections.add(child);
    const lines = createInterface({ input: child.stdout });
    return new Promise((resolve, reject) => {
      let ended = false,
        bytes = 0,
        account: any = null;
      const finish = (value?: any, error?: Error) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        lines.close();
        this.inspections.delete(child);
        child.kill();
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(
        () =>
          account ? finish({connected:true,...account,usage:null,usageError:"Usage refresh timed out. Try refreshing.",checkedAt:Date.now()}) : finish(undefined, Error("Account status could not be refreshed. Try again.")),
        20000,
      );
      const send = (id: number, method: string, params: unknown) =>
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      child.stderr.resume();
      child.on("error", () =>
        finish(undefined, Error("Codex could not start.")),
      );
      child.on("close", () =>
        finish(undefined, Error("Account check interrupted.")),
      );
      child.stdin.on("error", () =>
        finish(undefined, Error("Account check disconnected.")),
      );
      lines.on("line", (line) => {
        try {
          bytes += line.length;
          if (bytes > 2000000) throw Error("Account response too large.");
          const m = JSON.parse(line);
          if (![1, 2, 3].includes(m.id)) return;
          if (m.error) {
            if (m.id === 3) {
              finish({
                connected: true,
                ...account,
                usage: null,
                usageError: "Usage is unavailable from the provider.",
                checkedAt: Date.now(),
              });
              return;
            }
            throw Error("Could not read the connected account.");
          }
          if (m.id === 1) {
            child.stdin.write(
              JSON.stringify({ method: "initialized", params: {} }) + "\n",
            );
            send(2, "account/read", { refreshToken: false });
          }
          if (m.id === 2) {
            const a = m.result?.account;
            if (a?.type !== "chatgpt") {
              finish({ connected: false, checkedAt: Date.now() });
              return;
            }
            account = { email: a.email || null, plan: a.planType || null };
            send(3, "account/rateLimits/read", {});
          }
          if (m.id === 3)
            finish({
              connected: true,
              ...account,
              usage: m.result,
              checkedAt: Date.now(),
            });
        } catch (e) {
          finish(undefined, e as Error);
        }
      });
      send(1, "initialize", { clientInfo: { name: "mowr", version: "0.2.0" } });
    });
  }
  async login() {
    if(this.loginProcess && this.loginChallenge)return this.loginChallenge;
    this.loginError = null;
    this.accountCache = null;
    this.catalog = null;
    this.closeServer();
    this.loginProcess?.kill();
    const child = await this.start(["login", "--device-auth"]);
    this.loginProcess = child;
    let output = "";
    return new Promise<{ url: string; code: string }>((resolve, reject) => {
      let delivered = false;
      const timer = setTimeout(() => {
        this.loginError = "Sign-in expired. Start again to get a new code.";
        child.kill();
        if (!delivered) reject(Error(this.loginError));
      }, 900000);
      const collect = (part: Buffer) => {
        output += part.toString().replace(/\x1b\[[0-9;]*m/g, "");
        if (output.length > 16000) {
          child.kill();
          return;
        }
        const url = output.match(/https:\/\/auth\.openai\.com\/[^\s]+/)?.[0],
          code = output.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/)?.[0];
        if (url && code && !delivered) {
          delivered = true;
          this.loginChallenge = {url,code};
          resolve({ url, code });
        }
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("error", () => {
        clearTimeout(timer);
        reject(
          Error("Install the official Codex CLI to connect your subscription."),
        );
      });
      child.on("close", (code) => {
        this.accountCache = null;
        this.catalog = null;
        this.closeServer();
        if(code !== 0 && !this.loginError)this.loginError = /keyring|credential store|credential manager/i.test(output)?"Windows could not save the Codex credentials. Please retry sign-in.":"Codex could not finish connecting on this device. Please retry sign-in.";
        if (this.loginProcess === child) this.loginProcess = null;
        clearTimeout(timer);
        if (!delivered)
          reject(Error("No provider sign-in challenge was received."));
      });
    });
  }
  /** After Codex itself was updated: the next listing and connection use the new program. */
  engineChanged() {
    this.catalog = null;
    this.closeServer();
  }
  private closeServer() {
    if (this.server && !this.busy) { this.server.close(); this.server = null; }
  }
  async logout() {
    this.accountCache = null;
    this.catalog = null;
    this.server?.close();
    this.server = null;
    this.loginProcess?.kill();
    const child = await this.start(["logout"]);
    await new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(Error("Provider sign-out failed.")),
      );
    });
  }
  /** Stops one chat only; other chats on the same connection keep answering. */
  cancel(id: string) {
    const turn=this.turns.get(id);
    if(turn)turn.cancelled=true;
    this.controls.get(id)?.interrupt?.();
    this.active.get(id)?.kill();
  }
  stop() {
    for(const turn of this.turns.values())turn.cancelled=true;
    for (const control of this.controls.values()) control.interrupt?.();
    for (const child of this.inspections) child.kill();
    this.loginProcess?.kill();
    for (const child of this.active.values()) child.kill();
    this.server?.close();
    this.server = null;
  }
  async run(id:string,prompt:string,emit:(event:any)=>void,images:string[]=[],selection?:{model?:string;reasoning?:string},pdf?:(spec:any,cancelled:()=>boolean)=>Promise<any>,instructions=kinetraInstructions,tools?:(request:any,cancelled:()=>boolean)=>Promise<any>,unfinished?:()=>string|undefined){
    if(this.turns.has(id))throw Error("This chat is already answering.");
    const turn={cancelled:false};this.turns.set(id,turn);
    const session:TurnSession={};
    try{
      let shown=false;
      await runKinetraTurn(prompt,instructions,async(input,followUp)=>{
        let output="",delivered=0;
        // A lead-in shown before a tool ran ("Let me calculate that.") is its own paragraph, never glued to the answer.
        const show=(end:number)=>{if(end<=delivered)return;emit({id,type:"delta",text:(shown&&!delivered?"\n\n":"")+output.slice(delivered,end)});delivered=end;shown=true;};
        await this.runOnce(id,input,event=>{
          if(event.type==="status"){emit({id,...event});return;}
          if(event.type!=="delta")return;
          output+=event.text||"";
          // Hold tool envelopes (and anything that may still become one), but stream ordinary prose immediately.
          if(!mayBeTool(output))show(shownLength(output));
        },followUp?[]:images,selection,session,turn);
        if(!toolRequests(output)&&!brokenToolRequest(output))show(output.length);
        return output;
      },async request=>{
        emit({id,type:"status",text:toolStatus(request)});
        return (tools&&await tools(request,()=>turn.cancelled))??kinetraTool(request,pdf?spec=>pdf(spec,()=>turn.cancelled):undefined);
      },()=>turn.cancelled,{stateful:true,unfinished});
      emit({id,type:"done"});
    }finally{if(this.turns.get(id)===turn)this.turns.delete(id);this.scheduleIdle();}
  }
  /** A short internal request (memory notes): never blocks the user's turn or streams to the screen. */
  async quick(prompt:string,selection?:{model?:string;reasoning?:string},timeoutMs=45000){
    const server=await this.connection();
    let output="";
    await streamTurn(server,{},prompt,selection,[],text=>{output+=text;},()=>false,{},timeoutMs);
    this.scheduleIdle();
    return output;
  }
  /** Whether the model is one of this ChatGPT account's models (as last listed). */
  catalogHas(model:string){return !!this.catalog?.models.some((m:any)=>m.id===model);}
  /** Lowest reasoning level the model offers, for internal requests. */
  lightest(model?:string){
    const efforts=this.catalog?.models.find((m:any)=>m.id===model)?.reasoningEfforts||[];
    return efforts.find((e:any)=>e.reasoningEffort==="minimal")?.reasoningEffort||efforts.find((e:any)=>e.reasoningEffort==="low")?.reasoningEffort||efforts[0]?.reasoningEffort;
  }
  /** Checks the selection against the cached catalog without delaying the request on a refresh. */
  private async validate(selection?:{model?:string;reasoning?:string}){
    if(!selection?.model)return;
    const available=this.catalog?this.catalog.models:await Promise.race([this.models().catch(()=>null),new Promise<null>(resolve=>setTimeout(()=>resolve(null),2500))]);
    if(this.catalog&&Date.now()-this.catalog.at>=5*60_000)void this.models().catch(()=>{});
    if(!available)return;
    const chosen=available.find((m:any)=>m.id===selection.model);
    if(!chosen)throw Error("That model is no longer available. Refresh your models.");
    if(selection.reasoning&&!chosen.reasoningEfforts.some((e:any)=>e.reasoningEffort===selection.reasoning))
      throw Error("That reasoning level is unavailable for this model.");
  }
  private async runOnce(
    id: string,
    prompt: string,
    emit: (event: any) => void,
    images: string[] = [],
    selection?: { model?: string; reasoning?: string },
    session: TurnSession = {},
    turn: {cancelled:boolean} = {cancelled:false},
  ) {
    this.starting = Number(this.starting) + 1;
    let server: AppServer;
    try {
      const [connected] = await Promise.all([this.connection(), session.threadId ? undefined : this.validate(selection)]);
      server = connected;
      if(turn.cancelled)throw Error("Request cancelled");
    } finally {
      this.starting = Math.max(0, Number(this.starting) - 1);
    }
    const control: TurnControl = {};
    this.controls.set(id, control);
    try {
      await streamTurn(server,session,prompt,selection,images,text=>emit({id,type:"delta",text}),()=>turn.cancelled,control,undefined,status=>emit({id,type:"status",text:status}));
    } finally {
      this.controls.delete(id);
      this.accountCache = null;
    }
  }
}
