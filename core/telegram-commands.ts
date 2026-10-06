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
  { name: "model", usage: "/model [name or number]", does: "Picks the AI that answers here from the models your connected accounts offer: tap one, or send its name or number.", menu: "Choose the AI model" },
  { name: "thinking", usage: "/thinking [level]", does: "Picks how long the model thinks (the levels it offers, such as low, medium or high): tap one, or send the level.", menu: "Choose the thinking level" },
  { name: "status", usage: "/status", does: "Shows the space, the AI answering, how long the conversation is and the linked folders.", menu: "Where and how replies run" },
];

/** A model as Mowr's providers list it (Codex, Claude Code, Grok), for the Telegram pickers. */
export type TelegramModel = { id: string; name: string; reasoningEfforts?: { reasoningEffort: string }[]; defaultReasoningEffort?: string };
/** One row of tap buttons under a bot message; `data` comes back when it is tapped (at most 64 bytes, Telegram's limit). */
export type TelegramButton = { text: string; data: string };
const EFFORT_NAMES: Record<string, string> = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
export const effortName = (level: string) => EFFORT_NAMES[level] || level;
/** Tap data for picking a model or a level: "m|<model id>" and "t|<level>". */
export const MODEL_PICK = "m|", THINKING_PICK = "t|";
const fits = (data: string) => new TextEncoder().encode(data).length <= 64;

/** The model a "/model" argument means: a number from the list, then the name or id (exact, starting with, containing). */
export function pickModel(arg: string, models: TelegramModel[]): TelegramModel | undefined {
  const want = arg.trim().toLowerCase();
  if (!want) return undefined;
  if (/^\d+$/.test(want)) return models[Number(want) - 1];
  const named = (m: TelegramModel) => [m.name.toLowerCase(), m.id.toLowerCase(), m.id.replace(/^[a-z]+:/i, "").toLowerCase()];
  return models.find((m) => named(m).includes(want)) || models.find((m) => named(m).some((n) => n.startsWith(want))) || models.find((m) => named(m).some((n) => n.includes(want)));
}
/** The level a "/thinking" argument means, among those the model offers ("extra high" and "xhigh" alike). */
export function pickEffort(arg: string, model: TelegramModel | undefined) {
  const want = arg.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const levels = (model?.reasoningEfforts || []).map((e) => e.reasoningEffort);
  if (/^(default|auto)$/.test(want)) return "";
  return levels.find((l) => l.toLowerCase() === want || effortName(l).toLowerCase().replace(/\s+/g, "") === want);
}
/** The model picker: every model, numbered, with the one in use marked; a button for each, two to a row. */
export function modelMenu(models: TelegramModel[], current: string | undefined) {
  if (!models.length) return { text: "No AI models are available. Connect ChatGPT, Claude or Grok in Mowr on your PC: Settings → Models.", buttons: [] as TelegramButton[][] };
  const lines = models.map((m, i) => `${i + 1}. ${m.name}${m.id === current ? " ← current" : ""}`);
  const tappable = models.filter((m) => fits(MODEL_PICK + m.id)).map((m) => ({ text: (m.id === current ? "✓ " : "") + m.name, data: MODEL_PICK + m.id }));
  const buttons: TelegramButton[][] = [];
  for (let i = 0; i < tappable.length; i += 2) buttons.push(tappable.slice(i, i + 2));
  return { text: ["Choose the AI that answers here:", ...lines, "", "Tap one, or send /model with its name or number."].join("\n"), buttons };
}
/** The thinking picker for one model: its levels, the one in use marked, plus the model's own default. */
export function thinkingMenu(model: TelegramModel | undefined, current: string | undefined) {
  const levels = (model?.reasoningEfforts || []).map((e) => e.reasoningEffort).filter((l) => fits(THINKING_PICK + l));
  if (!model) return { text: "Choose a model first with /model.", buttons: [] as TelegramButton[][] };
  if (!levels.length) return { text: `${model.name} has no thinking levels to choose from.`, buttons: [] as TelegramButton[][] };
  const fallback = model.defaultReasoningEffort ? ` (${effortName(model.defaultReasoningEffort)})` : "";
  const row = [{ text: (!current ? "✓ " : "") + "Default" + fallback, data: THINKING_PICK + "default" }, ...levels.map((l) => ({ text: (l === current ? "✓ " : "") + effortName(l), data: THINKING_PICK + l }))];
  const buttons: TelegramButton[][] = [];
  for (let i = 0; i < row.length; i += 3) buttons.push(row.slice(i, i + 3));
  return { text: `How long ${model.name} thinks: now ${current ? effortName(current) : "its default" + fallback}. Longer thinking is slower but more careful. Tap a level, or send /thinking with one.`, buttons };
}

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
