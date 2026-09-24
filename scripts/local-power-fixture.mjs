// A believable local workspace for browser checks and demo recordings: one Biology subject with a
// linked notes folder, flashcards, and past chats, behind a scripted desktop bridge.
// Replies are scripted; nothing here calls a model.
import { createServer } from "vite";
import { mockLocalStorage } from "./fixture-local-storage.mjs";
import { specPrinter, worksheetSpec, handoutPdf } from "./fixture-docs.mjs";
export { worksheetSpec };

export const FOLDER = { id: "4b7c1d7e-2f0a-4e59-9a57-0f7f2d7a9c11", scope: "subject:bio", path: "C:\\Users\\Sam\\Documents\\Biology 101" };
export const notes = {
  "Week 3 - Cell biology.md": `# Week 3 — Cell biology

## Organelles
- Nucleus: holds DNA and controls the cell.
- Mitochondria: TODO
- Ribosomes: build proteins from amino acids.
- Golgi apparatus: packages and ships proteins.

## Membranes
The cell membrane is a phospholipid bilayer. It is selectively permeable,
so small non-polar molecules cross easily while ions need channel proteins.

## Questions for Friday
- Why do muscle cells have more mitochondria?
- What happens to a plant cell in pure water?
`,
  "lab/osmosis-lab.md": `# Osmosis lab — potato cylinders

| Sucrose (M) | Mass change (%) |
|---|---|
| 0.0 | +18 |
| 0.2 | +6 |
| 0.4 | -4 |
| 0.6 | -13 |

Conclusion: the isotonic point is near 0.33 M sucrose.
`,
  "glossary.md": `# Glossary

Osmosis — diffusion of water across a selectively permeable membrane.
Isotonic — equal solute concentration on both sides of a membrane.
ATP — the cell's energy currency, made mostly in mitochondria.
`,
};

export const editReply = `Here is the note with the gap filled and a short summary on top.

\`\`\`edit
{"path":"Week 3 - Cell biology.md","find":"# Week 3 — Cell biology\\n\\n## Organelles\\n- Nucleus: holds DNA and controls the cell.\\n- Mitochondria: TODO","replace":"# Week 3 — Cell biology\\n\\n> **Summary:** organelles split the cell's work — DNA in the nucleus, energy in mitochondria, proteins from ribosomes and the Golgi. Membranes decide what gets in.\\n\\n## Organelles\\n- Nucleus: holds DNA and controls the cell.\\n- Mitochondria: make ATP through cellular respiration — the cell's power plants.","summary":"Add a summary and fill in the mitochondria note"}
\`\`\`

Muscle cells need lots of ATP, which is why they carry so many mitochondria — that answers your first Friday question too.`;

const now = Date.UTC(2026, 8, 24, 15, 0);
export const workspace = {
  name: "Sam",
  spaces: [{ id: "bio", name: "Biology 101", kind: "subject", description: "Cells, genetics and evolution — midterm in October.", memory: "", sources: ["syllabus"], examDate: "2026-10-20", folders: [{ id: "f-worksheets", name: "Worksheets", parentId: null, created: now - 5 * 864e5 }, { id: "f-papers", name: "Past papers", parentId: null, created: now - 5 * 864e5 }] }],
  files: [{ id: "syllabus", name: "Biology 101 syllabus.txt", size: 180, type: "text/plain", created: now - 9 * 864e5, spaceId: "bio" }],
  chats: [
    { id: "c-osmosis", title: "Osmosis lab write-up", spaceId: "bio", updated: now - 2 * 864e5, messages: [{ id: "m1", role: "user", content: "Help me explain why the potato gained mass in pure water." }, { id: "m2", role: "assistant", content: "Water moved into the potato by osmosis because the cells were hypertonic to pure water, so the cylinders gained mass." }] },
    { id: "c-krebs", title: "Krebs cycle in plain words", spaceId: "bio", updated: now - 5 * 864e5, messages: [{ id: "m3", role: "user", content: "Explain the Krebs cycle simply." }, { id: "m4", role: "assistant", content: "The Krebs cycle runs inside mitochondria and strips electrons from acetyl-CoA to make ATP, NADH and CO2." }] },
  ],
  studySets: [{ id: "set-cells", spaceId: "bio", kind: "flashcards", title: "Cell organelles", created: now - 3 * 864e5, attempts: [], items: [
    { question: "Which organelle makes most of the cell's ATP?", answer: "Mitochondria" },
    { question: "What builds proteins?", answer: "Ribosomes" },
    { question: "What packages and ships proteins?", answer: "The Golgi apparatus" },
    { question: "What does selectively permeable mean?", answer: "Only some molecules can cross the membrane freely." },
    { question: "What is osmosis?", answer: "Diffusion of water across a selectively permeable membrane." },
  ] }],
};

export const fixtureModels = [
  { id: "gpt-5.5", name: "GPT-5.5", provider: "OpenAI", connected: true, context: 32000, specialties: [], tools: [], isDefault: true, defaultReasoningEffort: "medium", reasoningEfforts: [{ reasoningEffort: "medium", description: "Medium" }] },
  { id: "claude:sonnet", name: "Claude Sonnet", provider: "Anthropic", connected: true, context: 32000, specialties: [], tools: [] },
];

/** What the model returns when asked to edit the Mowr-made worksheet ("make it harder…"). */
export const harderWorksheet = {
  ...worksheetSpec,
  subtitle: "Biology 101 · Week 3 · Extension",
  sections: [
    { heading: "Organelles", text: "1. Explain why a cell with damaged mitochondria cannot sustain active transport.\n\n2. Ribosomes are found free in the cytoplasm and on the rough ER. Compare what each group makes.\n\n3. Trace the path of a secreted protein from the ribosome to the cell surface." },
    { heading: "Membranes", text: "4. Explain what *selectively permeable* means. Why can oxygen cross the membrane freely while sodium ions cannot?\n\n5. A plant cell is placed in pure water. Predict what happens, and explain why it does not burst." },
    { heading: "Challenge", text: "6. Muscle cells contain far more mitochondria than skin cells. Use respiration to explain why, with one calculation." },
    { heading: "Answer key", text: "1. Active transport needs ATP from respiration. 2. Free: proteins used in the cell; rough ER: proteins for export or membranes. 3. Ribosome → rough ER → Golgi → vesicle → membrane. 4. Small non-polar molecules dissolve through the bilayer; ions need channels. 5. It becomes turgid; the cell wall resists expansion. 6. More ATP demand for contraction." },
  ],
};
export const handoutEdits = { summary: "Moved the due date to Monday and made question 2 more precise.", edits: [{ page: 1, find: "Due Friday 26 September", replace: "Due Monday 29 September" }, { page: 1, find: "2. Estimate the concentration at which the mass does not change.", replace: "2. Estimate the isotonic point to two decimal places." }] };

/** Starts Vite, installs the fake desktop bridge and opens the workspace. Returns helpers. */
export async function openFixture(browser, { port = 5198, viewport = { width: 1440, height: 900 }, replies = [editReply], recordVideo, models = fixtureModels, initScripts = [], deviceScaleFactor = 1 } = {}) {
  const server = await createServer({ server: { host: "127.0.0.1", port, strictPort: true }, logLevel: "error" });
  await server.listen();
  const print = await specPrinter(browser);
  const [worksheet, handout] = [await print(worksheetSpec), await handoutPdf(browser)];
  const context = await browser.newContext({ viewport, deviceScaleFactor, recordVideo });
  for (const script of initScripts) await context.addInitScript(script);
  const page = await context.newPage();
  const t0 = Date.now();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("__renderSpec", async (json) => Array.from(await print(JSON.parse(json))));
  await page.addInitScript(({ FOLDER, notes, replies, harderWorksheet, handoutEdits, worksheetSpec }) => {
    const chat = new Set(), folder = new Set(), pack = new Set();
    const files = { ...notes };
    window.requests = [];
    window.drags = [];
    window.fireFolder = (event) => { for (const fn of folder) fn(event); };
    window.firePack = (bytes, name) => { for (const fn of pack) fn({ bytes, name }); };
    window.writeNote = (path, text) => { files[path] = text; };
    const stream = (id, text, extra) => {
      let i = 0;
      const tick = () => { for (const fn of chat) fn({ id, type: "delta", text: text.slice(i, i + 24) }); i += 24; if (i < text.length) setTimeout(tick, 22); else { extra?.(); for (const fn of chat) fn({ id, type: "done" }); } };
      setTimeout(tick, 500);
    };
    const put = (id, body) => fetch("/api/local/files/" + id, { method: "PUT", body, headers: { "X-Mowr-Owner": "fixture-owner" } });
    const search = (q) => {
      const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
      return Object.entries(files).filter(([p, t]) => terms.every((x) => (p + " " + t).toLowerCase().includes(x))).map(([p, t]) => {
        const low = t.toLowerCase(), at = Math.max(0, low.indexOf(terms[0])), from = Math.max(0, at - 40), text = t.slice(from, from + 150).replace(/\s+/g, " ");
        const marks = []; for (const x of terms) { let i = text.toLowerCase().indexOf(x); while (i >= 0) { marks.push([i, i + x.length]); i = text.toLowerCase().indexOf(x, i + x.length); } }
        marks.sort((a, b) => a[0] - b[0]);
        return { folderId: FOLDER.id, scope: FOLDER.scope, folder: "Biology 101", path: p, score: 20, snippet: { text: (from ? "…" : "") + text, marks: marks.map(([a, b]) => [a + (from ? 1 : 0), b + (from ? 1 : 0)]), line: t.slice(0, at).split("\n").length } };
      });
    };
    window.mowrDesktop = {
      onAuth: () => () => {}, onAttachment: () => () => {}, onCapture: () => () => {},
      onChat: (fn) => { chat.add(fn); return () => chat.delete(fn); },
      onFolder: (fn) => { folder.add(fn); return () => folder.delete(fn); },
      onPack: (fn) => { pack.add(fn); return () => pack.delete(fn); },
      startDrag: (path) => window.drags.push(path),
      invoke: async (r) => {
        window.requests.push(r);
        switch (r.action) {
          case "essentialSync": return { skills: r.skills, notes: r.notes };
          case "providerAccounts": return { accounts: [], active: null, autoSwitch: false };
          case "folders": return r.scope === FOLDER.scope ? [FOLDER] : [];
          case "foldersAll": return [FOLDER];
          case "folderChanges": return [];
          case "folderWatch": return { enabled: true, watching: 1 };
          case "folderTree": return { ...FOLDER, files: Object.keys(files).sort().map((path) => ({ path, size: files[path].length, mtime: 1 })) };
          case "folderSearch": return search(r.query);
          case "folderFileRead": if (!(r.path in files)) throw Error("That file is not in a linked folder for this conversation."); return { path: r.path, text: files[r.path] };
          case "folderEditApply": { const before = files[r.path]; if (!before.includes(r.find)) throw Error("The text to replace was not found."); files[r.path] = before.replace(r.find, r.replace); return { id: "22222222-2222-4222-8222-222222222222", added: 3, removed: 1 }; }
          case "pdfRender": return { bytes: new Uint8Array(await window.__renderSpec(r.spec)) };
          case "shareSave": window.lastShare = r.data; return { path: "C:\\Users\\Sam\\Downloads\\Mowr\\" + r.name, name: r.name };
          case "shareReveal": return { ok: true };
          case "chat": {
            const system = r.messages[0]?.content || "", all = r.messages.map((m) => m.content).join("\n");
            if (system.includes("You edit a document that Mowr typeset")) stream(r.id, JSON.stringify({ summary: "Made every question harder and added an answer key.", spec: harderWorksheet }));
            else if (system.includes("You edit an existing PDF in place")) stream(r.id, JSON.stringify(handoutEdits));
            else if (/worksheet PDF/.test(all)) {
              const id = crypto.randomUUID(), spec = { ...worksheetSpec, title: "Week 3 worksheet", subtitle: "Biology 101 · Cells and membranes" };
              stream(r.id, "Here is a worksheet on cells and membranes, with space for your answers. I saved it as a PDF.", async () => {
                const bytes = new Uint8Array(await window.__renderSpec(JSON.stringify(spec)));
                await put(id, bytes); await put("spec-" + id, JSON.stringify(spec));
                const file = { id, name: "Week 3 worksheet.pdf", size: bytes.length, type: "application/pdf", created: Date.now(), spaceId: r.scope.split(":")[1], made: true };
                window.dispatchEvent(new CustomEvent("mowr:artifact", { detail: { id: r.id, type: "artifact", file, scope: r.scope } }));
              });
            } else stream(r.id, replies.shift() || "Done.");
            return { started: true };
          }
          default: return {};
        }
      },
    };
  }, { FOLDER, notes, replies, harderWorksheet, handoutEdits, worksheetSpec });
  await page.route("**/fixture", (r) => r.fulfill({ contentType: "text/html", body: '<!doctype html><div class="desktop-titlebar"></div><div class="desktop-content"><div id="root"></div></div><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/revamp.css"><link rel="stylesheet" href="/src/production.css"><link rel="stylesheet" href="/src/desktop/desktop.css">' }));
  await page.route("**/api/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.includes("/api/local/")) return r.fallback();
    return r.fulfill({ json: path.endsWith("auth/session") ? { user: { id: "fixture-owner", email: "sam@example.com" }, auth: true } : path.endsWith("models") ? models : {} });
  });
  await mockLocalStorage(page);
  await page.goto(`http://127.0.0.1:${port}/fixture`);
  await page.evaluate(async ({ workspace, worksheet, handout, worksheetSpec }) => {
    const { default: RefreshRuntime } = await import("/@react-refresh");
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (t) => t; window.__vite_plugin_react_preamble_installed__ = true;
    const store = await import("/src/store.ts");
    store.setStorageNamespace("fixture-owner");
    await store.storeBlob("syllabus", new File(["Biology 101 covers cells, membranes, osmosis, respiration, genetics and evolution. Midterm on 20 October."], "Biology 101 syllabus.txt", { type: "text/plain" }));
    await store.storeBlob("worksheet", new Blob([new Uint8Array(worksheet)], { type: "application/pdf" }));
    await store.storeBlob("spec-worksheet", new Blob([JSON.stringify(worksheetSpec)], { type: "application/json" }));
    await store.storeBlob("handout", new Blob([new Uint8Array(handout)], { type: "application/pdf" }));
    const files = [...workspace.files,
      { id: "worksheet", name: "Cell biology worksheet.pdf", size: worksheet.length, type: "application/pdf", created: Date.now() - 2 * 864e5, spaceId: "bio", folderId: "f-worksheets", made: true },
      { id: "handout", name: "Osmosis lab handout.pdf", size: handout.length, type: "application/pdf", created: Date.now() - 864e5, spaceId: "bio", folderId: null }];
    await store.saveState({ ...store.emptyState, ...workspace, files });
    location.hash = "/app";
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { default: App } = await import("/src/App.tsx");
    window.__root = ReactDOM.createRoot(document.getElementById("root"));
    window.__root.render(React.createElement(App, {}));
  }, { workspace, worksheet: Array.from(worksheet), handout: Array.from(handout), worksheetSpec });
  await page.locator(".greeting-row").waitFor();
  return { page, context, errors, t0, close: async () => { await context.close(); await server.close(); } };
}
