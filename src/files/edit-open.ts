// The file open beside the chat is changed in place when the AI decides a message asks for that: it calls clem.editOpen
// (src/App.tsx editOpen → FilePanel's edit). No rule reads the message first (owner, 2026-11-27: "the AI controls
// everything"); a question about the file, or a request for something new from it, is simply answered.

export const EDIT_OPEN_ACTION = "clem.editOpen";

/** What the AI is told with a message sent while a file it can change in place is open beside the chat. */
export function editOpenGuide(name: string) {
  return `"${name}" is open beside the chat, and Clem can change it in place. When the person's message asks to change that file (fix, rewrite, add, remove, reword, restyle, "make it longer", "the diagram is wrong", "it should have a table of contents"), call {"kinetra":{"action":"clem.editOpen","instruction":"<the change, complete and self-contained, in their words>"}}: Clem edits the same file, highlights the changes beside the chat and keeps the earlier version for Undo. Then say in one or two sentences what changed. A question about the file, or a request for something new from it (flashcards, a summary, a quiz, a separate file), is answered as usual, without clem.editOpen.`;
}
