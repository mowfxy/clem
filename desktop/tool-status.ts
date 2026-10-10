/**
 * What a CLI's tool call is doing, in a few words for the chat's status line ("Reading Week 3.pdf…"), so the person
 * sees which of their files the AI is opening, searching or writing instead of "Using a tool…". Names are Claude
 * Code's (Read, Grep…), Grok's (read_file, search…) and the Kinetra tool's; null when there is nothing better to say.
 */
const KINETRA: Record<string, string> = {
  call: "Working it out with Kinetra…", pdf: "Typesetting the PDF…", docx: "Writing the Word document…", pptx: "Building the slides…",
  xlsx: "Building the spreadsheet…", file: "Saving the file…", image: "Drawing the figure…", look: "Looking at the page…",
  crop: "Cropping a figure…", regions: "Finding the figures…", editpdf: "Editing the PDF…", read: "Reading a file…",
  search: "Searching your files…", files: "Listing your files…", find: "Finding the file…", recipes: "Checking figure recipes…",
};

/** The last two parts of a path ("Lectures/Week 3.pdf"), without Mowr's own folders in front. */
export function shortPath(path: unknown) {
  const parts = String(path || "").replace(/\\/g, "/").split("/").filter(Boolean);
  const tail = parts.slice(-2);
  if (tail.length === 2 && /^(Files|Attachments|Made|_text|Drafts|Outputs|chat-[0-9a-f]{8})$/.test(tail[0])) tail.shift();
  // _text/Week 3.pdf.txt is Mowr's reading of Week 3.pdf: name the document.
  const text = tail.join("/").replace(/\.(pdf|docx?|pptx?|xlsx?)\.txt$/i, ".$1");
  return text.length > 60 ? "…" + text.slice(-58) : text;
}

const quoted = (text: unknown) => { const t = String(text || "").trim().replace(/\s+/g, " "); return t ? `“${t.length > 50 ? t.slice(0, 48) + "…" : t}”` : ""; };

export function describeTool(name: string, input: any): string | null {
  const n = String(name || ""), i = input && typeof input === "object" ? input : {};
  const path = i.file_path ?? i.path ?? i.target_file ?? i.filename ?? i.file;
  if (/kinetra/i.test(n)) {
    const request = typeof i.action === "string" ? i : (Object.values(i)[0] as any) || {};
    const action = String(request.action || "");
    if (action === "pdf" && request.title) return `Typesetting “${String(request.title).slice(0, 50)}”…`;
    if ((action === "read" || action === "look") && (request.file || request.path || request.name)) return `${action === "look" ? "Looking at" : "Reading"} ${shortPath(request.file || request.path || request.name)}…`;
    return KINETRA[action] || "Working with Kinetra…";
  }
  if (/^(Read|read_file|view|open_file)$/i.test(n)) return path ? `Reading ${shortPath(path)}…` : "Reading a file…";
  if (/^(Write|write|write_file|create_file)$/i.test(n)) return path ? `Writing ${shortPath(path)}…` : "Writing a file…";
  if (/^(Edit|MultiEdit|edit|edit_file|str_replace|NotebookEdit)$/i.test(n)) return path ? `Editing ${shortPath(path)}…` : "Editing a file…";
  if (/^(Grep|grep|search|search_files|ripgrep)$/i.test(n)) return i.pattern || i.query ? `Searching the files for ${quoted(i.pattern ?? i.query)}…` : "Searching the files…";
  if (/^(Glob|glob|list_dir|list_directory|ls|find_files)$/i.test(n)) return i.path ? `Looking through ${shortPath(i.path)}…` : "Looking through the folder…";
  if (/^(Task|Agent)$/.test(n)) return i.description ? `Handing off: ${String(i.description).slice(0, 60)}…` : "Handing part of the work to a helper…";
  if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet)$/.test(n)) return "Planning the steps…";
  if (/^(WebFetch|web_fetch|fetch)$/i.test(n)) { try { return `Reading ${new URL(String(i.url)).hostname.replace(/^www\./, "")}…`; } catch { return "Reading a web page…"; } }
  if (/web_?search|search_web/i.test(n)) return i.query ? `Searching the web for ${quoted(i.query)}…` : "Searching the web…";
  return null;
}
