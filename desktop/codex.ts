import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import {kinetraInstructions, kinetraTool} from "./kinetra-runtime.ts";
import {runKinetraTurn} from "./kinetra-turn.ts";

export class Codex {
  private turn: {id:string;cancelled:boolean} | null = null;
  private inspections = new Set<ChildProcessWithoutNullStreams>();
  get busy() {
    return this.turn !== null || this.starting || this.active.size > 0;
  }
  private loginError: string | null = null;
  private loginChallenge: {url:string;code:string} | null = null;
  loginState(){return {pending:!!this.loginProcess,loginError:this.loginError,challenge:this.loginProcess?this.loginChallenge:null};}
  private loginProcess: ChildProcessWithoutNullStreams | null = null;
  private starting = false;
  private active = new Map<string, ChildProcessWithoutNullStreams>();
  private executable: string;
  private home: string;
  private workspace: string;
  constructor(executable: string, home: string, workspace: string) {
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
      this.executable,
      [
        "-c",
        'cli_auth_credentials_store="keyring"',
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
    if (this.catalog && Date.now() - this.catalog.at < 60000)
      return this.catalog.models;
    if (this.catalogRequest) return this.catalogRequest;
    this.catalogRequest = this.readModels().finally(() => {
      this.catalogRequest = null;
    });
    return this.catalogRequest;
  }
  private async readModels(): Promise<any[]> {
    if (!(await this.status())) return [];
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
  async account(force = false): Promise<any> {
    if (
      !force &&
      this.accountCache &&
      Date.now() - this.accountCache.at < 60000
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
        if(code !== 0 && !this.loginError)this.loginError = /keyring|credential store|credential manager/i.test(output)?"Windows could not save the Codex credentials. Please retry sign-in.":"Codex could not finish connecting on this device. Please retry sign-in.";
        if (this.loginProcess === child) this.loginProcess = null;
        clearTimeout(timer);
        if (!delivered)
          reject(Error("No provider sign-in challenge was received."));
      });
    });
  }
  async logout() {
    this.accountCache = null;
    this.catalog = null;
    this.loginProcess?.kill();
    const child = await this.start(["logout"]);
    await new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(Error("Provider sign-out failed.")),
      );
    });
  }
  cancel(id: string) {
    if(this.turn?.id===id)this.turn.cancelled=true;
    this.active.get(id)?.kill();
  }
  stop() {
    if(this.turn)this.turn.cancelled=true;
    for (const child of this.inspections) child.kill();
    this.loginProcess?.kill();
    for (const child of this.active.values()) child.kill();
  }
  async run(id:string,prompt:string,emit:(event:any)=>void,images:string[]=[],selection?:{model?:string;reasoning?:string},pdf?:(spec:any,cancelled:()=>boolean)=>Promise<any>){
    if(this.busy)throw Error("Wait for the current request or cancel it.");
    const turn={id,cancelled:false};this.turn=turn;
    try{
      const text=await runKinetraTurn(prompt,kinetraInstructions,async input=>{
        let output="";
        await this.runOnce(id,input,event=>{if(event.type==="delta")output+=event.text||"";},images,selection);
        return output;
      },request=>kinetraTool(request,pdf?spec=>pdf(spec,()=>turn.cancelled):undefined),()=>turn.cancelled);
      emit({id,type:"delta",text});emit({id,type:"done"});
    }finally{this.turn=null;}
  }
  private async runOnce(
    id: string,
    prompt: string,
    emit: (event: any) => void,
    images: string[] = [],
    selection?: { model?: string; reasoning?: string },
  ) {
    if (this.active.size || this.starting)
      throw Error("Wait for the current request or cancel it.");
    this.starting = true;
    let child: ChildProcessWithoutNullStreams;
    try {
      if (!(await this.status()))
        throw Error("Connect your ChatGPT subscription first.");
      const options: string[] = [];
      if (selection?.model) {
        const available = await this.models();
        const chosen = available.find((m) => m.id === selection.model);
        if (!chosen)
          throw Error(
            "That model is no longer available. Refresh your models.",
          );
        options.push("--model", chosen.id);
        if (selection.reasoning) {
          if (
            !chosen.reasoningEfforts.some(
              (e: any) => e.reasoningEffort === selection.reasoning,
            )
          )
            throw Error("That reasoning level is unavailable for this model.");
          options.push("-c", `model_reasoning_effort="${selection.reasoning}"`);
        }
      }
      if(this.turn?.cancelled)throw Error("Request cancelled");
      child = await this.start([
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "-c",
        "features.shell_tool=false",
        "-c",
        "features.unified_exec=false",
        "-c",
        'web_search="disabled"',
        "--json",
        ...options,
        ...images.flatMap((path) => ["--image", path]),
        "-",
      ]);
    } finally {
      this.starting = false;
    }
    this.active.set(id, child);
    if(this.turn?.cancelled)child.kill();
    let completed = false,
      bytes = 0;
    const timer = setTimeout(() => child.kill(), 180000);
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      bytes += line.length;
      if (bytes > 2_000_000) {
        child.kill();
        return;
      }
      try {
        const event = JSON.parse(line);
        if (
          event.type === "item.completed" &&
          event.item?.type === "agent_message"
        )
          emit({ id, type: "delta", text: event.item.text });
        if (event.type === "turn.completed") completed = true;
      } catch {
        child.kill();
      }
    });
    child.stderr.resume();
    child.stdin.end(prompt);
    try {
      await new Promise<void>((resolve, reject) => {
        child.on("error", () => reject(Error("Codex could not start.")));
        child.on("close", (code) =>
          code === 0 && completed
            ? resolve()
            : reject(
                Error("Request interrupted, cancelled, or rejected by Codex."),
              ),
        );
      });
      emit({ id, type: "done" });
    } finally {
      clearTimeout(timer);
      lines.close();
      this.active.delete(id);
      this.accountCache = null;
    }
  }
}
