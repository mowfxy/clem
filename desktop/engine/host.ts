// What Clem's background engine needs from whoever hosts it: the desktop app (desktop/main.ts) or, later, worker/.
// The engine never imports electron; secrets, notices and paths come in through here.

export type EngineHost = {
  /** Encrypted at rest (the desktop Vault). Values never reach logs, the window's state or a prompt. */
  secrets: {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
  notify(notice: { key: string; title: string; body: string }): void;
  paths: { /** This owner's engine folder. */ data: string; /** desktop/engine/migrations, or its copy beside the bundle. */ migrations: string; /** Where CMS files fetched only for viewing go; the system temp folder when left out. */ temp?: string };
  log(level: "info" | "warn" | "error", message: string): void;
};
