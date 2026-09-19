import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";

export class Codex {
  private loginProcess:ChildProcessWithoutNullStreams|null=null;
  private starting = false;
  private active = new Map<string, ChildProcessWithoutNullStreams>();
  constructor(
    private executable: string,
    private home: string,
    private workspace: string,
  ) {}
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
  async login() {
    this.loginProcess?.kill();
    const child = await this.start(["login", "--device-auth"]);
    this.loginProcess=child;
    let output = "";
    return new Promise<{ url: string; code: string }>((resolve, reject) => {
      let delivered = false;
      const timer = setTimeout(() => {
        child.kill();
        if (!delivered) reject(Error("Provider sign-in timed out."));
      }, 180000);
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
      child.on("close", () => {
        if(this.loginProcess===child)this.loginProcess=null;
        clearTimeout(timer);
        if (!delivered)
          reject(Error("No provider sign-in challenge was received."));
      });
    });
  }
  async logout() {
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
    this.active.get(id)?.kill();
  }
  stop() {
    this.loginProcess?.kill();
    for (const child of this.active.values()) child.kill();
  }
  async run(
    id: string,
    prompt: string,
    emit: (event: any) => void,
    images: string[] = [],
  ) {
    if (this.active.size || this.starting)
      throw Error("Wait for the current request or cancel it.");
    this.starting = true;
    let child: ChildProcessWithoutNullStreams;
    try {
      if (!(await this.status()))
        throw Error("Connect your ChatGPT subscription first.");
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
        ...images.flatMap((path) => ["--image", path]),
        "-",
      ]);
    } finally {
      this.starting = false;
    }
    this.active.set(id, child);
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
    }
  }
}
