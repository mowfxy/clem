/** The commands Mowr's Telegram bot understands: shown in Settings → Telegram, sent to Telegram for its "/" menu
 *  (setMyCommands) and listed by /help. `usage` is how it is typed; `menu` is Telegram's short menu text. */
export type TelegramCommand = { name: string; usage: string; does: string; menu: string };

export const TELEGRAM_COMMANDS: TelegramCommand[] = [
  { name: "help", usage: "/help", does: "Lists these commands.", menu: "What you can send" },
  { name: "new", usage: "/new", does: "Starts a fresh conversation in this space. Earlier messages are no longer sent to the AI, so replies stay quick and on topic.", menu: "Start a fresh conversation" },
  { name: "undo", usage: "/undo", does: "Forgets your last question and its answer.", menu: "Forget the last exchange" },
  { name: "spaces", usage: "/spaces", does: "Lists your subjects and projects, numbered, and marks the one the bot is using.", menu: "List subjects and projects" },
  { name: "space", usage: "/space <name or number>", does: "Switches to a subject or project, so answers use its files, memory and conversation. /space workspace goes back to your whole workspace; /space alone says where you are.", menu: "Switch subject or project" },
  { name: "files", usage: "/files [words]", does: "Lists the files in this space's linked PC folders, or only those whose names contain the words.", menu: "List this space's files" },
  { name: "get", usage: "/get <file name>", does: "Sends you a file from this space's linked folders (up to 20 MB).", menu: "Send a file to this chat" },
  { name: "pdf", usage: "/pdf <request>", does: "Answers as a PDF.", menu: "Answer as a PDF" },
  { name: "word", usage: "/word <request>", does: "Answers as a Word document.", menu: "Answer as a Word file" },
  { name: "slides", usage: "/slides <request>", does: "Makes a PowerPoint deck.", menu: "Make a PowerPoint deck" },
  { name: "sheet", usage: "/sheet <request>", does: "Makes an Excel workbook.", menu: "Make an Excel workbook" },
  { name: "brief", usage: "/brief <request>", does: "Answers in a few lines.", menu: "Short answer" },
  { name: "memory", usage: "/memory", does: "Shows what Mowr remembers about you and this space.", menu: "What Mowr remembers" },
  { name: "status", usage: "/status", does: "Shows the space, the AI answering, how long the conversation is and the linked folders.", menu: "Where and how replies run" },
];

/** A message's command, if it starts with one Mowr knows ("/space@MyBot Physics" → space, "Physics"). */
export function telegramCommand(text: string): { name: string; arg: string } | undefined {
  const match = text.trim().match(/^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return undefined;
  const name = match[1].toLowerCase();
  return TELEGRAM_COMMANDS.some((c) => c.name === name) ? { name, arg: (match[2] || "").trim() } : undefined;
}

/** The request the AI is given for a file command, or undefined when the command is not one. */
export function fileRequest(name: string, arg: string) {
  const lead: Record<string, string> = { pdf: "Create a PDF: ", word: "Create a Word document (docx): ", slides: "Create a PowerPoint deck (pptx): ", sheet: "Create an Excel workbook (xlsx): ", brief: "Answer in a few short lines: " };
  return lead[name] && arg ? lead[name] + arg : undefined;
}

export type TelegramSpace = { scope: string; name: string; kind: "subject" | "project" };
export const WORKSPACE_SCOPE = "user:me";

/** The space "/space <arg>" means: a number from /spaces, "workspace", or a name (exact, then starting with, then containing). */
export function pickSpace(arg: string, spaces: TelegramSpace[]): TelegramSpace | "workspace" | undefined {
  const want = arg.trim().toLowerCase();
  if (!want) return undefined;
  if (/^(workspace|whole workspace|all|everything|home)$/.test(want)) return "workspace";
  if (/^\d+$/.test(want)) return spaces[Number(want) - 1];
  return spaces.find((s) => s.name.toLowerCase() === want) || spaces.find((s) => s.name.toLowerCase().startsWith(want)) || spaces.find((s) => s.name.toLowerCase().includes(want));
}

export function spaceLabel(scope: string, spaces: TelegramSpace[]) {
  if (scope === WORKSPACE_SCOPE) return "your whole workspace";
  const space = spaces.find((s) => s.scope === scope);
  if (space) return `${space.kind === "subject" ? "subject" : "project"} “${space.name}”`;
  return scope.startsWith("chat:") ? "a chat" : "a space that no longer exists";
}

export function helpText() {
  return ["Commands:", ...TELEGRAM_COMMANDS.map((c) => `${c.usage} — ${c.does}`), "", "Anything else you send (text, a photo, a PDF or Word file) is answered by Mowr on your PC."].join("\n");
}

/** Files whose path contains every word of `query` (any order, any case; a number only as a whole number, so
 *  "lecture 3" is not "Lecture 13"), shortest paths first. */
export function matchFiles<T extends { path: string }>(files: T[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const has = (path: string, w: string) => /^\d+$/.test(w) ? RegExp(`(?<!\\d)0*${w}(?!\\d)`).test(path) : path.includes(w);
  const hits = files.filter((f) => words.every((w) => has(f.path.toLowerCase(), w)));
  const exact = hits.filter((f) => (f.path.split(/[\\/]/).pop() || "").toLowerCase() === query.trim().toLowerCase());
  return exact.length ? exact : hits.sort((a, b) => a.path.length - b.path.length);
}
