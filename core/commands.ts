// Slash commands: typed as "/name what you want", shown as a chip in the composer and in the sent message. Each one
// becomes an explicit instruction for the model and pulls in the playbooks that do the job (see mowr-skills.ts and
// skills.ts), so a command never depends on the model guessing what "/pdf" means. /visual, /flashcards, /quiz and
// /skill keep their own handling in the app; for those the text reaches the model as before.
export type SlashCommand = {
  id: string;
  label: string;
  icon: string;
  description: string;
  /** Composer placeholder once the command is chosen. */
  placeholder: string;
  /** What the model is told, placed before the person's words. Absent for commands the app handles itself. */
  instruction?: (rest: string) => string;
  /** Mowr playbooks to include (ids from mowr-skills.ts). */
  skills?: string[];
  /** Built-in workflow to include (id from skills.ts). */
  workflow?: string;
  /** Only offered inside a subject. */
  subjectOnly?: boolean;
};

export const slashCommands: SlashCommand[] = [
  { id: "visual", label: "Visual", icon: "visuals", description: "Draw an interactive visual", placeholder: "What should Mowr draw?", skills: ["visuals"] },
  { id: "pdf", label: "PDF", icon: "files", description: "Make a formatted PDF document", placeholder: "What should the document cover?", skills: ["documents"], workflow: "report",
    instruction: () => "Make this as a PDF document with the Kinetra pdf action, not as a chat answer. Choose the right kind of document, a specific title and one section per heading." },
  { id: "research", label: "Research", icon: "research", description: "Search the web and cite every source", placeholder: "What should Mowr research?", skills: ["web", "numbers"], workflow: "research",
    instruction: () => "Research this properly: search the web with several specific queries, compare sources, and link every claim to its source. Say what is uncertain or disputed." },
  { id: "explain", label: "Explain", icon: "subjects", description: "Teach it step by step", placeholder: "What should Mowr explain?", skills: ["notation"], workflow: "tutor",
    instruction: () => "Teach this step by step as a tutor: start from what I likely know, one idea at a time, one worked example, then one short question to check I understood." },
  { id: "solve", label: "Solve", icon: "diagram", description: "A worked solution with checked numbers", placeholder: "Paste the problem…", skills: ["numbers", "notation"], workflow: "problem-solving",
    instruction: () => "Give a complete worked solution: givens and unknowns, the method and why, every step with units, the answer clearly marked, and a ```check block for the key numbers." },
  { id: "summarize", label: "Summarize", icon: "analysis", description: "Summarize a file, link or text", placeholder: "What should Mowr summarize?", skills: ["files", "video-notes"], workflow: "summary",
    instruction: () => "Summarize this: the main point first in one or two sentences, then the key points in order, then anything I should act on. Work only from the material supplied or linked." },
  { id: "notes", label: "Notes", icon: "long", description: "Study notes from a lecture, video or file", placeholder: "Which lecture, video or topic?", skills: ["video-notes", "files"], workflow: "study-guide",
    instruction: () => "Make clear study notes from this: sections that follow the material's own structure, key definitions and formulas, worked examples, and a short recap at the end." },
  { id: "videos", label: "Videos", icon: "play", description: "Find YouTube videos that explain it", placeholder: "What topic?", skills: ["videos"], workflow: "youtube",
    instruction: () => "Find 2–4 real YouTube videos that explain this well, using web search, and link each one so it plays in the chat, with one line on why it fits." },
  { id: "slides", label: "Slides", icon: "slides", description: "A slide deck to export to PowerPoint", placeholder: "What is the presentation about?", skills: ["export"], workflow: "slides",
    instruction: () => "Write this as a slide deck: a title slide, then one # heading per slide with 3–5 short bullets, speaker notes under each slide, ready to export to PowerPoint." },
  { id: "flashcards", label: "Flashcards", icon: "subjects", description: "Make a flashcard deck in this subject", placeholder: "Which topic or material?", skills: ["study"], subjectOnly: true },
  { id: "quiz", label: "Quiz", icon: "verify", description: "Make a quiz in this subject", placeholder: "Which topic or material?", skills: ["study"], subjectOnly: true },
  { id: "routine", label: "Routine", icon: "clock", description: "Run something on a schedule", placeholder: "What should run, and when?", skills: ["automations"],
    instruction: () => "Set this up as a Mowr routine: propose it in one ```automation block with a clear name, the time and repeat, and the exact prompt it should run." },
  { id: "remember", label: "Remember", icon: "pin", description: "Save something to memory", placeholder: "What should Mowr remember?", skills: ["memory"],
    instruction: () => "Remember that" },
  { id: "skill", label: "Skill", icon: "skills", description: "Create a reusable skill", placeholder: "Opens the skill editor", skills: ["own-skills"] },
];

const byId = new Map(slashCommands.map((c) => [c.id, c]));

/** The command a message starts with and the words after it, or null. */
export function readCommand(text: string): { command: SlashCommand; rest: string } | null {
  const m = /^\/([a-z]+)(?=\s|$)\s*([\s\S]*)$/i.exec(text);
  const command = m ? byId.get(m[1].toLowerCase()) : undefined;
  return command ? { command, rest: m![2] } : null;
}

/** Commands matching what has been typed after "/" (before any space), best matches first. */
export function commandsFor(typed: string, inSubject: boolean) {
  const q = typed.toLowerCase();
  return slashCommands
    .filter((c) => (inSubject || !c.subjectOnly) && (c.id.startsWith(q) || c.label.toLowerCase().includes(q) || (q.length > 1 && c.description.toLowerCase().includes(q))))
    .sort((a, b) => Number(!a.id.startsWith(q)) - Number(!b.id.startsWith(q)));
}

/** What the model reads for a message: the command's instruction, then the person's words. */
export function expandCommand(text: string) {
  const found = readCommand(text);
  if (!found?.command.instruction) return text;
  const instruction = found.command.instruction(found.rest);
  return found.command.id === "remember" ? `${instruction} ${found.rest.replace(/^that\s+/i, "")}` : `${instruction}\n\n${found.rest}`;
}
