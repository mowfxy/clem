// Slash commands: typed anywhere in a message as "/name", shown as a chip in the composer and in the sent message. Each one
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
  { id: "figure", label: "Figure", icon: "visuals", description: "Draw it like a textbook figure", placeholder: "Which setup or apparatus should Mowr draw?", skills: ["figures", "visuals", "notation"],
    instruction: () => "Draw this as a textbook figure: one ```visual block with \"kind\":\"figure\", started from the closest verified textbook figure and made physically correct (attachments through anchors, forces with the right directions and proportional lengths, computed field lines). If I ask for 3D, use a \"3d\" scene of real objects with materials and charges instead. Then say in two or three lines what the figure shows." },
  { id: "pdf", label: "PDF", icon: "cmd-pdf", description: "Make a formatted PDF document", placeholder: "What should the document cover?", skills: ["documents"], workflow: "report",
    instruction: () => "Make this as a PDF document with the Kinetra pdf action, not as a chat answer. Choose the right kind of document, a specific title and one section per heading." },
  { id: "research", label: "Research", icon: "research", description: "Search the web and cite every source", placeholder: "What should Mowr research?", skills: ["web", "numbers"], workflow: "research",
    instruction: () => "Research this properly: search the web with several specific queries, compare sources, and link every claim to its source. Say what is uncertain or disputed." },
  { id: "explain", label: "Explain", icon: "cmd-explain", description: "Teach it step by step", placeholder: "What should Mowr explain?", skills: ["notation"], workflow: "tutor",
    instruction: () => "Teach this step by step as a tutor: start from what I likely know, one idea at a time, one worked example, then one short question to check I understood." },
  { id: "solve", label: "Solve", icon: "cmd-solve", description: "A worked solution with checked numbers", placeholder: "Paste the problem…", skills: ["numbers", "notation"], workflow: "problem-solving",
    instruction: () => "Give a complete worked solution: givens and unknowns, the method and why, every step with units, the answer clearly marked, and a ```check block for the key numbers." },
  { id: "summarize", label: "Summarize", icon: "cmd-summarize", description: "Summarize a file, link or text", placeholder: "What should Mowr summarize?", skills: ["files", "video-notes"], workflow: "summary",
    instruction: () => "Summarize this: the main point first in one or two sentences, then the key points in order, then anything I should act on. Work only from the material supplied or linked." },
  { id: "notes", label: "Notes", icon: "cmd-notes", description: "Study notes from a lecture, video or file", placeholder: "Which lecture, video or topic?", skills: ["video-notes", "files"], workflow: "study-guide",
    instruction: () => "Make clear study notes from this: sections that follow the material's own structure, key definitions and formulas, worked examples, and a short recap at the end." },
  { id: "videos", label: "Videos", icon: "play", description: "Find YouTube videos that explain it", placeholder: "What topic?", skills: ["videos"], workflow: "youtube",
    instruction: () => "Find 2–4 real YouTube videos that explain this well, using web search, and link each one so it plays in the chat, with one line on why it fits." },
  { id: "slides", label: "Slides", icon: "slides", description: "A slide deck to export to PowerPoint", placeholder: "What is the presentation about?", skills: ["export"], workflow: "slides",
    instruction: () => "Write this as a slide deck: a title slide, then one # heading per slide with 3–5 short bullets, speaker notes under each slide, ready to export to PowerPoint." },
  { id: "flashcards", label: "Flashcards", icon: "cmd-flashcards", description: "Make a flashcard deck in this subject", placeholder: "Which topic or material?", skills: ["study"], subjectOnly: true },
  { id: "quiz", label: "Quiz", icon: "cmd-quiz", description: "Make a quiz in this subject", placeholder: "Which topic or material?", skills: ["study"], subjectOnly: true },
  { id: "routine", label: "Routine", icon: "cmd-routine", description: "Run something on a schedule", placeholder: "What should run, and when?", skills: ["automations"],
    instruction: () => "Set this up as a Mowr routine: propose it in one ```automation block with a clear name, the time and repeat, and the exact prompt it should run." },
  { id: "remember", label: "Remember", icon: "cmd-remember", description: "Save something to memory", placeholder: "What should Mowr remember?", skills: ["memory"],
    instruction: () => "Remember that" },
  { id: "outline", label: "Outline", icon: "cmd-outline", description: "Plan an essay, report or talk", placeholder: "What are you writing?", workflow: "essay",
    instruction: () => "Write an outline for this, not the full text: a one-line thesis or aim, then numbered sections with two or three points each and the evidence each point needs. End with what I still need to find out." },
  { id: "feedback", label: "Feedback", icon: "cmd-feedback", description: "Honest feedback on your work", placeholder: "Paste or attach your work…", workflow: "editing",
    instruction: () => "Give honest, specific feedback on this work: what works, the three changes that would improve it most (quote the passage each one is about), then smaller fixes. Keep my voice; don't rewrite it all." },
  { id: "compare", label: "Compare", icon: "compare", description: "Compare options side by side", placeholder: "What should Mowr compare?", skills: ["web"], workflow: "decision",
    instruction: () => "Compare these side by side: a table with the criteria that matter as rows, a short note on each real difference, then a clear recommendation and when the other option would win." },
  { id: "plan", label: "Plan", icon: "cmd-plan", description: "A schedule that gets it done", placeholder: "What, and by when?", workflow: "proposal",
    instruction: () => "Make a realistic plan for this: work back from the deadline, break it into dated steps small enough to start today, and mark the one to do first. Ask if the deadline or time I have is missing." },
  { id: "mnemonic", label: "Mnemonic", icon: "cmd-mnemonic", description: "A memory trick that sticks", placeholder: "What do you need to remember?", skills: ["notation"],
    instruction: () => "Make this easy to remember: two or three different memory tricks (an acronym, a vivid image or story, a rhyme), then say which one fits best and why. Keep every fact correct." },
  { id: "debate", label: "Debate", icon: "cmd-debate", description: "The strongest case on each side", placeholder: "Which question or claim?", skills: ["web"],
    instruction: () => "Argue both sides of this: the strongest case for, the strongest case against, the evidence each relies on, where they really disagree, and a fair verdict on which is better supported." },
  { id: "translate", label: "Translate", icon: "cmd-translate", description: "Translate and keep the tone", placeholder: "What, and into which language?",
    instruction: () => "Translate this faithfully, keeping its tone and formatting. If no language is named, ask which one. After the translation, note any phrase that has no exact equivalent." },
  { id: "compact", label: "Compact", icon: "cmd-compact", description: "Shrink this chat to a brief and keep going", placeholder: "Anything to keep in focus? (optional)",
    instruction: (rest) => `Compact this conversation into a brief I can continue from: the goal, decisions made, key facts, numbers and sources, what is still open, and where we stopped.${rest.trim() ? " Keep this in focus: " + rest.trim() + "." : ""} Use short headed lists. No preamble.` },
  { id: "handoff", label: "Handoff", icon: "cmd-handoff", description: "Continue in a fresh chat with a brief", placeholder: "What should the next chat do? (optional)",
    instruction: (rest) => `Write a handoff brief so a fresh chat can pick this up with no other context: the goal, what has been done and decided, key facts and sources, open questions, and the next steps.${rest.trim() ? " The next chat will: " + rest.trim() + "." : ""} Address it to the next chat. No preamble.` },
  { id: "skill", label: "Skill", icon: "skills", description: "Create a reusable skill", placeholder: "Opens the skill editor", skills: ["own-skills"] },
  { id: "skill-creator", label: "Skill creator", icon: "skills", description: "Work out a new skill together in chat", placeholder: "What should the skill help with?", skills: ["own-skills"], workflow: "create-skill",
    instruction: (rest) => rest.trim()
      ? "Help me turn this into a reusable Mowr skill. Ask me up to three short questions only if something essential is unclear (the outcome, when it applies, what I will provide); otherwise draft it straight away."
      : "Help me create a reusable Mowr skill. Start by asking, in one short message, what I want it to help with and when it should apply. Draft the skill once you know." },
];

const byId = new Map(slashCommands.map((c) => [c.id, c]));

/** The first command in a message ("/name" at the start or after a space) and the message without it, or null. */
export function readCommand(text: string): { command: SlashCommand; rest: string } | null {
  for (const m of text.matchAll(/(^|\s)\/([a-z]+(?:-[a-z]+)*)(?=\s|$)/gi)) {
    const command = byId.get(m[2].toLowerCase());
    if (!command) continue;
    const start = m.index + m[1].length, end = start + m[2].length + 1;
    const before = text.slice(0, start).replace(/[ \t]+$/, ""), after = text.slice(end).replace(/^[ \t]+/, "");
    return { command, rest: (before && after && !before.endsWith("\n") ? before + " " + after : before + after).replace(/^\s+/, "") };
  }
  return null;
}

/** A message with its command moved to the front, as "/name rest", so the chip always sits before the words. */
export function leadingCommand(text: string) {
  const found = readCommand(text);
  return found ? `/${found.command.id} ${found.rest}` : text;
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
