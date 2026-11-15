// The workspace actions of Clem's agent on the VPS worker (docs/GUC-VPS-ENGINE.md "Workspace on the VPS"): with the
// laptop off there is no window to open a subject, so the agent reads and changes the workspace itself. The window
// does the same things through its own screens (a subject page, /flashcards, a note). Byte-stable guide.
export const WS_ACTIONS = ["ws.subjects", "ws.subject", "ws.files", "ws.flashcards", "ws.note"] as const;
export const isWsAction = (a: unknown): a is (typeof WS_ACTIONS)[number] => typeof a === "string" && (WS_ACTIONS as readonly string[]).includes(a);
export const WORKSPACE_GUIDE = `Workspace (the person's subjects, projects, files, plans and flashcards; their computer may be off, so you change them here and they appear in Clem when it opens):
- {"kinetra":{"action":"ws.subjects"}}: every subject and project with its exam date, files, decks and plan.
- {"kinetra":{"action":"ws.subject","name":"…","kind":"subject","examDate":"YYYY-MM-DD"}}: makes a subject or project (or sets an existing one's exam date).
- {"kinetra":{"action":"ws.files","subject":"…"}}: a subject's files; then read and search them by name with {"kinetra":{"action":"read","file":"…"}} and {"kinetra":{"action":"search","query":"…"}}.
- {"kinetra":{"action":"ws.flashcards","subject":"…","from":["file name",…],"request":"…","kind":"flashcards"}}: writes a deck (or kind "quiz") from those files (all of the subject's when "from" is left out) and keeps it in the subject.
- {"kinetra":{"action":"ws.note","subject":"…","name":"….md","content":"…"}}: saves a Markdown or text file in the subject (or loose with no subject); it is sent with your reply.
Plans: write \`\`\`plan blocks in your reply as usual; they are saved as soon as you finish (a new plan too: the person asked for it in words). Then say in one plain sentence what you changed.`;
