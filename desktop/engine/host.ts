// What Clem's background engine needs from whoever hosts it: the desktop app (desktop/main.ts) or, later, worker/.
// The engine never imports electron; secrets, notices and paths come in through here.

export type EngineHost = {
  /** Encrypted at rest (the desktop Vault). Values never reach logs, the window's state or a prompt. */
  secrets: {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
  /** `open`: where a click goes (a #/app route, or a chat and the message to scroll to). */
  notify(notice: { key: string; title: string; body: string; open?: { route?: string; chat?: string; message?: string } }): void;
  paths: { /** This owner's engine folder. */ data: string; /** desktop/engine/migrations, or its copy beside the bundle. */ migrations: string; /** Where CMS files fetched only for viewing go; the system temp folder when left out. */ temp?: string;
    /** The workspace's Files folder (Accounts/<owner>/Files): saved CMS files are kept under GUC/ and shown there. */ files?: string };
  log(level: "info" | "warn" | "error", message: string): void;
  /** Google Drive for the subject copies (desktop: DriveLive); left out, Drive copies say Drive isn't available. */
  drive?: import("./drive-mirror.ts").DriveMirror;
  /** Something a background check changed (files saved, news): the window refreshes and picks up its inbox. */
  changed?(): void;
  /** The saved workspace (desktop: the window's state.json; a VPS: the snapshot the desktop sends). The organizer reads
   *  a compact snapshot of it (core/proactivity/snapshot.ts); left out, sweeps see GUC only. */
  workspace?(): Promise<unknown>;
  /** One short answer from Clem's organizer model (desktop: answerWith, no tools). Left out, sweeps use rules only. */
  complete?(request: { system: string; user: string; model?: string; reasoning?: string }): Promise<string>;
  /** Clem's account service as this owner (desktop: the signed-in Supabase session; a VPS: its own). Telegram's relay
   *  talks to the bot through it; left out, there is no Telegram. */
  account?(path: string, init?: { method?: string; body?: BodyInit; headers?: Record<string, string> }, signal?: AbortSignal, timeout?: number): Promise<Response>;
  /** A Telegram message (or a tap that needs the agent or the workspace) answered as the main thread answers: the same
   *  agent, tools, data and hand-off (desktop: the window). The reply is Markdown with clem-cards, and any files made. */
  converse?(turn: TelegramTurn): Promise<{ text: string; files?: { name: string; type: string; bytes: Uint8Array }[] }>;
  /** Shows a route or a chat's message in Clem (a tap on Open in Clem). */
  open?(o: { route?: string; chat?: string; message?: string }): void;
  /** Where newly saved CMS files go (the VPS store while files live there and it is reachable); left out: this PC. */
  store?(): import("./storage.ts").FileStore | undefined;
  /** Other stores this host can read saved files from, by location (a VPS reachable over SSH; the worker's own disk). */
  stores?(): Partial<Record<"vps" | "drive", import("./storage.ts").FileStore>>;
  /** A VPS is connected (subject cards offer "My VPS" for files). */
  vps?(): { files: boolean } | undefined;
};
export type TelegramTurn = { id: string; text: string } | { id: string; tap: import("../../core/telegram/render.ts").Tap };
