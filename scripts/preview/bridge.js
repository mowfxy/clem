// Dev-only stand-in for the desktop main process, so scripts/preview/project.html boots the real app shell in a plain
// browser: a signed-in, set-up account, the local workspace API kept in this tab's localStorage, and a scripted AI that
// speaks the coordinator protocol (core/coordinator.ts). Open /scripts/preview/project.html?reset to start over.
const KEY = "clem-preview-state", FILES = "clem-preview-files";
if (location.search.includes("reset")) { localStorage.removeItem(KEY); localStorage.removeItem(FILES); history.replaceState(null, "", location.pathname + location.hash); }

const day = 864e5, now = Date.now();
const PROJECT = "7d3f9a2e-5b1c-4e8a-9f60-2c4d8e1b7a35";
const models = [
  { id: "claude:sonnet", name: "Claude Sonnet", provider: "Anthropic", connected: true, context: 200000, specialties: [], tools: [], isDefault: true },
  { id: "claude:opus", name: "Claude Opus", provider: "Anthropic", connected: true, context: 200000, specialties: [], tools: [] },
  { id: "claude:haiku", name: "Claude Haiku", provider: "Anthropic", connected: true, context: 200000, specialties: [], tools: [] },
  { id: "codex:gpt-5.5", name: "GPT-5.5", provider: "OpenAI", connected: true, context: 272000, specialties: [], tools: [], defaultReasoningEffort: "medium", reasoningEfforts: [{ reasoningEffort: "low", description: "Low" }, { reasoningEffort: "medium", description: "Medium" }, { reasoningEffort: "high", description: "High" }] },
];
const memoryFile = `# Project memory

One fact per line: date, tags, then the fact. Clem reads only the lines that matter to each message.

- 2026-10-27 #launch #deadline | The Studio plan launches on December 3.
- 2026-10-27 #pricing | Studio costs 12 euros a month, 99 a year.
- 2026-10-28 #audience | The launch speaks to students first, then small teams.
- 2026-10-29 #tone #copy | Copy stays plain and calm: no hype words, no exclamation marks.
- 2026-10-30 #channels | Launch channels: the email list (8,400 people), the blog and Product Hunt.
- 2026-10-31 #competitors | Main competitors are Notion AI and Mem; both charge 10 to 15 dollars a month.
`;
const msg = (from, content, at, extra = {}) => ({ id: crypto.randomUUID(), from, content, at, ...extra });
function seed() {
  const t1 = crypto.randomUUID(), t2 = crypto.randomUUID(), t3 = crypto.randomUUID();
  const ask = msg("you", "We're launching Studio on Dec 3. Can you get a competitor scan going and a first draft of the landing page hero?", now - 2 * day);
  const handoff = msg("coordinator", "On it. Researcher is scanning Notion AI and Mem for pricing and positioning, and Writer is drafting three hero options in the calm tone we agreed.", now - 2 * day + 4e3, { threads: [t1, t2] });
  const brief1 = msg("coordinator", "Compare Notion AI and Mem with Studio (12 €/month): price, who each is for, and the one claim each leads with. Keep it to a table plus three takeaways.", now - 2 * day + 5e3, { reactions: [{ emoji: "👀", by: "researcher" }] });
  const brief2 = msg("coordinator", "Write three hero options (headline + one line) for the Studio landing page. Audience: students first. Tone: plain and calm, no hype, no exclamation marks.", now - 2 * day + 5e3, { reactions: [{ emoji: "✅", by: "writer" }] });
  const research = msg("researcher", "| | Price | For | Leads with |\n|---|---|---|---|\n| Notion AI | $10/mo add-on | Teams already in Notion | \"Your connected workspace\" |\n| Mem | $14.99/mo | Individuals, notes | \"AI that organizes for you\" |\n| **Studio** | 12 €/mo | Students, then small teams | — |\n\n1. Both lead with *organising*; nobody leads with **studying from your own files**.\n2. Studio sits between them on price, so the yearly plan (99 €) is the stronger hook.\n3. Neither mentions working offline or keeping files on your PC.", now - 2 * day + 40e3);
  const draft = msg("writer", "**1. Your notes, finally working for you.**\nStudy from your own files, in one calm place.\n\n**2. Bring the course. Clem brings the rest.**\nFlashcards, plans and answers from what you already have.\n\n**3. Think in one place.**\nYour subjects, files and AI, kept together on your PC.", now - 2 * day + 52e3, { reactions: [{ emoji: "❤️", by: "you" }] });
  const closing = msg("coordinator", "Both are back.\n\n- **Gap to own:** competitors sell *organising*; nobody leads with studying from your own files. Option 2 of the hero says exactly that.\n- **Price:** we're between Notion AI and Mem, so lead with the 99 € yearly plan.\n- **Hero:** I'd ship option 2, with option 3 as the page's closing line.\n\nWant the Critic to pressure-test option 2 against the competitor claims?", now - 2 * day + 60e3, { reactions: [{ emoji: "🎉", by: "you" }] });
  const yes = msg("you", "yes please, and keep the yearly price front and centre", now - day);
  const handoff2 = msg("coordinator", "Sent to the Critic, with the yearly price as a fixed constraint.", now - day + 3e3, { threads: [t3], remembered: 1 });
  const critique = msg("critic", "1. **\"Clem brings the rest\" is vague.** Say what: \"Clem makes the flashcards and the plan.\"\n2. **The yearly price is missing from the hero.** Add \"99 € a year\" under the button, not in the headline.\n3. **\"Bring the course\"** reads as uploading a whole course; students think in lectures. Try \"Bring your lectures.\"", now - day + 30e3);
  const closing2 = msg("coordinator", "Critic's three fixes, applied:\n\n> **Bring your lectures. Clem makes the flashcards and the plan.**\n> Study from your own files, in one calm place. *99 € a year.*\n\nI saved the yearly-price rule to memory so every later draft keeps it.", now - day + 36e3);
  const thanks = msg("you", "perfect, thanks", now - day + 60e3, { reactions: [{ emoji: "🙏", by: "coordinator" }] });
  return {
    name: "Mo", memory: "", quiet: false, studySets: [], plans: [], skills: [], visuals: [], automations: [], files: [],
    spaces: [{ id: PROJECT, name: "Studio launch", kind: "project", description: "Everything for the Studio plan launch on December 3.", memory: "Lead every page with the yearly price.", sources: [], team: { coordinatorModel: "claude:sonnet" } }],
    chats: [],
    rooms: [{ spaceId: PROJECT, messages: [ask, handoff, closing, yes, handoff2, closing2, thanks], threads: [
      { id: t1, agent: "Researcher", title: "Competitor scan", status: "done", created: now - 2 * day, updated: research.at, from: handoff.id, summary: "Both competitors lead with organising; nobody leads with studying from your own files.", messages: [brief1, research] },
      { id: t2, agent: "Writer", title: "Hero options", status: "done", created: now - 2 * day, updated: draft.at, from: handoff.id, summary: "Three calm hero options; option 2 names studying from your own files.", messages: [brief2, draft] },
      { id: t3, agent: "Critic", title: "Pressure-test hero option 2", status: "done", created: now - day, updated: critique.at, from: handoff2.id, summary: "Three fixes: say what Clem makes, add the yearly price, say lectures.", messages: [msg("coordinator", "Pressure-test hero option 2 (\"Bring the course. Clem brings the rest.\") against the competitor claims. The 99 € yearly price must appear. List problems with fixes.", now - day + 4e3), critique] },
    ] }],
  };
}

// ---------------------------------------------------------------- the local workspace API
const files = new Map(Object.entries(JSON.parse(localStorage.getItem(FILES) || "{}")));
if (!localStorage.getItem(KEY)) { localStorage.setItem(KEY, JSON.stringify(seed())); files.set("project-memory-" + PROJECT, memoryFile); }
const keepFiles = () => { try { localStorage.setItem(FILES, JSON.stringify(Object.fromEntries([...files].filter(([, v]) => typeof v === "string")))); } catch {} };
keepFiles();
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  const method = (init.method || "GET").toUpperCase(), json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
  const path = url.pathname.slice(5);
  if (path === "local/state") {
    if (method === "PUT") { localStorage.setItem(KEY, typeof init.body === "string" ? init.body : await new Response(init.body).text()); return json({ ok: true }); }
    return json(JSON.parse(localStorage.getItem(KEY) || "null"));
  }
  if (path.startsWith("local/files/")) {
    const id = decodeURIComponent(path.slice(12));
    if (method === "PUT") { const blob = new Blob([init.body]); files.set(id, blob.size < 400_000 && /^(project-memory|spec-)/.test(id) ? await blob.text() : blob); keepFiles(); return json({ ok: true }); }
    if (method === "DELETE") { files.delete(id); keepFiles(); return json({ ok: true }); }
    return files.has(id) ? new Response(files.get(id)) : new Response("", { status: 404 });
  }
  if (path === "models") return json(models);
  if (path === "auth/session") return json({ user: { id: "preview-owner", email: "you@example.com" }, auth: true });
  return json({});
};

// ---------------------------------------------------------------- a scripted AI for the coordinator and its agents
const listeners = new Set();
const send = (event) => { for (const fn of listeners) fn(event); };
const live = new Map();
function stream(id, text) {
  let i = 0;
  const tick = () => { if (!live.has(id)) return; send({ id, type: "delta", text: text.slice(i, i + 18) }); i += 18; if (i < text.length) live.set(id, setTimeout(tick, 16)); else { live.delete(id); send({ id, type: "done" }); } };
  live.set(id, setTimeout(tick, 650));
}
function coordinator(system, messages) {
  const last = messages.at(-1)?.content || "";
  const team = [{ name: "Researcher" }, { name: "Writer" }];
  if (last.startsWith("(Memory search results)")) return "Here's what's in the project memory: " + (last.split("\n").slice(1, 3).join(" ").replace(/- \([^)]*\) /g, "").trim() || "nothing on that yet.");
  if (last.startsWith("(Thread reports")) {
    const names = [...last.matchAll(/^### ([^·\n]+) · /gm)].map((m) => m[1].trim());
    return `${names.join(" and ")} ${names.length > 1 ? "are" : "is"} back. The short version:\n\n- **The gap:** everyone sells organising; nobody leads with studying from your own files.\n- **Subject line:** *Bring your lectures. We'll make the flashcards.*\n- **Price:** 99 € a year goes in the first line of the email, as the memory says.\n\nWant the Critic to check it before it goes to the 8,400 people on the list?`;
  }
  if (/^(thanks|thank you|ty|ok|okay|cool|great|perfect|nice|👍|❤️)[\s!.,]*\w{0,8}[\s!.]*$/i.test(last.trim())) return "[[react: 🙏]]";
  if (/\b(what did we|remind me|recall|what was)\b/i.test(last)) return "[[recall: " + last.replace(/[^\w\s]/g, "").slice(0, 60) + "]]";
  const remember = /\b(remember|from now on|always|decided|budget is|deadline)\b/i.test(last) ? `\n[[remember: note | ${last.replace(/^(please )?remember( that)?:?\s*/i, "").replace(/\s+/g, " ").slice(0, 160)}]]` : "";
  if (remember && last.length < 140) return "Noted — I've saved that to the project memory." + remember;
  if (/\b(thread|subagent|agent)\b/i.test(last) || last.length > 60 || /\b(plan|research|draft|write|compare|review|check|scan|analy[sz]e|design|estimate)\b/i.test(last)) {
    const pick = team.slice(0, Math.min(2, team.length));
    const titles = ["Find what works", "Draft it", "Check it"];
    return `On it. ${pick.map((a) => a.name).join(" and ")} ${pick.length > 1 ? "are" : "is"} taking a first pass; I'll pull it together when they report back.\n` +
      pick.map((a, i) => `[[thread: ${a.name} | ${titles[i]} | ${last}\nWork from the project memory and keep it short.]]`).join("\n") + remember;
  }
  return "Short answer: yes — and it fits what's already in the project memory. Want me to open a thread on any of it?" + remember;
}
function agent(system, messages) {
  const name = /working as: ([^.\n]+)\./.exec(system)?.[1].trim() || "Agent";
  const last = messages.at(-1)?.content || "";
  const said = last.replace(/^\(The person, not the coordinator:\)\s*/, "");
  if (/^(thanks|ok|okay|great|perfect)\b/i.test(said.trim())) return "[[react: 👍]]";
  const bodies = {
    Researcher: "Three things stand out:\n\n1. **Positioning:** every competitor leads with organising notes; none lead with studying from your own files.\n2. **Price:** the market sits at 10–15 a month, so 12 € is in range and the yearly plan is the real hook.\n3. **Gap:** nobody mentions offline use or files staying on your PC.",
    Writer: "**Bring your lectures. Clem makes the flashcards and the plan.**\nStudy from your own files, in one calm place. 99 € a year.\n\nAlternative: **Your notes, finally working for you.**",
    Critic: "1. **The claim is untested.** Add one line of proof (\"from 3 lectures to 40 cards in a minute\").\n2. **The price needs a comparison.** \"Less than a coffee a week\" lands better than the number alone.\n3. **Cut the second sentence;** it repeats the headline.",
  };
  const summaries = { Researcher: "Everyone sells organising; studying from your own files is the open gap.", Writer: "A hero built on lectures, with the 99 € yearly price.", Critic: "Three fixes: add proof, compare the price, cut the repeat." };
  const body = bodies[name] || "Done. Here is the result, short and ready to use.";
  return (last.startsWith("(The person") ? "Good call — adjusted:\n\n" : "") + body + "\n[[summary: " + (summaries[name] || "Done.") + "]]";
}
window.clemDesktop = {
  onAuth: () => () => {}, onAttachment: () => () => {}, onCapture: () => () => {}, onFolder: () => () => {}, onPack: () => () => {}, onOpen: () => () => {}, onUpdate: () => () => {}, onCode: () => () => {},
  onChat: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  setWindowTone: () => {},
  background: async () => ({ keepRunning: true, startWithWindows: false }),
  update: async () => ({ automatic: true, version: "0.3.14", supported: false, phase: "idle" }),
  invoke: async (r) => {
    switch (r.action) {
      case "status": return { configured: true, user: { id: "preview-owner", email: "you@example.com", name: "Mo" }, setup: { step: 4, username: "mo", displayName: "Mo", memory: true }, entitlement: { active: true, reason: "free" } };
      case "securityInfo": return { email: "you@example.com", verified: true, factors: [], identities: [], google: false, password: true };
      case "essentialSync": return { skills: r.skills, notes: r.notes };
      case "providerAccounts": return { accounts: [], active: null, autoSwitch: false };
      case "folders": case "foldersAll": case "folderChanges": return [];
      case "memoryList": return [];
      case "cancel": { clearTimeout(live.get(r.id)); live.delete(r.id); return {}; }
      case "chat": {
        const system = r.messages.find((m) => m.role === "system")?.content || "", rest = r.messages.filter((m) => m.role !== "system");
        stream(r.id, system.startsWith("You are the coordinator") ? coordinator(system, rest) : /^You are a subagent/.test(system) ? agent(system, rest) : "Done.");
        return { started: true };
      }
      default: return {};
    }
  },
};
