import { randomUUID } from "node:crypto";
export type MemoryKind = "fact" | "preference" | "inference" | "temporary";
export type Memory = {
  id: string;
  scope: string;
  key: string;
  text: string;
  kind: MemoryKind;
  confirmed: boolean;
  confidence: number;
  source: { id: string; locator: string; at: string };
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  supersededBy?: string;
  derivedFrom: string[];
  sharedWith: string[];
  embedding?: number[];
};
export type MemoryState = { enabled: boolean; records: Memory[] };
export function putMemory(
  state: MemoryState,
  input: Omit<Memory, "id" | "createdAt" | "updatedAt" | "supersededBy">,
  now = new Date().toISOString(),
) {
  if (!state.enabled) throw Error("Memory is disabled.");
  if (
    !input.source.id ||
    !input.source.locator ||
    !Number.isFinite(Date.parse(input.source.at))
  )
    throw Error("Memory needs a source and timestamp.");
  if (
    !input.text.trim() ||
    input.text.length > 2000 ||
    input.confidence < 0 ||
    input.confidence > 1
  )
    throw Error("Invalid memory.");
  if (
    !input.confirmed &&
    input.kind !== "inference" &&
    input.kind !== "temporary"
  )
    throw Error("Facts and preferences require explicit confirmation.");
  if (input.kind === "temporary" && !input.expiresAt)
    throw Error("Temporary memory must expire.");
  const duplicate = state.records.find(
    (m) =>
      m.scope === input.scope &&
      m.key === input.key &&
      m.text === input.text &&
      m.kind === input.kind &&
      JSON.stringify([...m.sharedWith].sort()) === JSON.stringify([...input.sharedWith].sort()) &&
      !m.supersededBy,
  );
  if (duplicate) return state;
  const record: Memory = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  const records = state.records.map((m) =>
    m.scope === input.scope &&
    m.key === input.key &&
    !m.supersededBy &&
    input.confirmed
      ? { ...m, supersededBy: record.id, updatedAt: now }
      : m,
  );
  return pruneMemory({ ...state, records: [...records, record] }, Date.parse(now));
}
/** Memory syncs as one collection of at most 1000 records; staying well under it keeps sync working. */
export const MEMORY_LIMIT = 800;
const DAY = 86_400_000;
/**
 * Drops what Clem no longer uses: replaced records after 30 days (at most 100 kept for history) and records that expired
 * over 30 days ago. If still over the limit, the oldest go first: replaced, then learned, then confirmed.
 */
export function pruneMemory(state: MemoryState, now = Date.now()): MemoryState {
  const old = (at: string | undefined) => !!at && now - Date.parse(at) > 30 * DAY;
  const replaced = state.records.filter((m) => m.supersededBy).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const drop = new Set(replaced.filter((m, i) => i >= 100 || old(m.updatedAt)).map((m) => m.id));
  for (const m of state.records) if (old(m.expiresAt)) drop.add(m.id);
  let records = drop.size ? state.records.filter((m) => !drop.has(m.id)) : state.records;
  if (records.length > MEMORY_LIMIT) {
    const rank = (m: Memory) => (m.supersededBy ? 0 : m.confirmed ? 2 : 1);
    const keep = new Set([...records].sort((a, b) => rank(b) - rank(a) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, MEMORY_LIMIT).map((m) => m.id));
    records = records.filter((m) => keep.has(m.id));
  }
  return records === state.records ? state : { ...state, records };
}
/** Deletion propagates through derived records. Retrieval uses the same canonical store, with no stale cache. */
export function forgetMemory(state: MemoryState, ids: string[]) {
  const deleted = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of state.records)
      if (!deleted.has(m.id) && m.derivedFrom.some((id) => deleted.has(id))) {
        deleted.add(m.id);
        changed = true;
      }
  }
  return {
    ...state,
    records: state.records
      .filter((m) => !deleted.has(m.id))
      .map((m) =>
        m.supersededBy && deleted.has(m.supersededBy)
          ? { ...m, supersededBy: "forgotten" }
          : m,
      ),
  };
}
export function forgetSource(state: MemoryState, sourceId: string) {
  return forgetMemory(
    state,
    state.records.filter((m) => m.source.id === sourceId).map((m) => m.id),
  );
}
/**
 * A deleted chat takes with it what Clem only learned from it (and anything tied to that chat alone);
 * what the person kept stays, as the delete dialog promises.
 */
export function forgetChat(state: MemoryState, chatId: string) {
  const source = "chat:" + chatId;
  return forgetMemory(state, state.records.filter((m) => !m.confirmed && (m.source.id === source || m.scope === source)).map((m) => m.id));
}
/** Facts about the person themselves (name, role, level, preferences) apply in every chat and space. */
export const PROFILE_SCOPE = "user:me";
const STOP = new Set("the a an and or but of to in on for with at by from is are was were be been it this that these those what which who how why when where can could would should do does did i me my you your we our they them their he she his her its as if then than so not no yes please about into over under up down out just also very more most some any all each user users has have had".split(" "));
/** Crude stemming: "explanations"/"explaining" and "explain" should meet. */
const stem = (w: string) => w.replace(/(?:ations?|ings?|ers?|ies|es|s|ed|ly|ment)$/u, "") || w;
const terms = (text: string) => [...new Set((text.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []).filter((t) => !STOP.has(t)).map(stem).filter((t) => t.length > 1))];
/** Share of meaningful words two sentences have in common (0 to 1). */
export function similarity(a: string, b: string) {
  const x = new Set(terms(a)), y = new Set(terms(b));
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / (x.size + y.size - shared);
}
function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) return 0;
  const dot = a.reduce((sum, x, i) => sum + x * b[i], 0),
    norm = Math.hypot(...a) * Math.hypot(...b);
  return norm ? dot / norm : 0;
}
/**
 * Memory for one request. Preferences and profile facts always apply (they describe the person, not the
 * topic) and so do this space's own facts, but each kind has its own share of the budget so one kind never
 * crowds out the others; records that match the request rank first and are limited only by the budget.
 * When a key holds both a kept record and a newer learned one ("2nd year" kept, "3rd year now" learned),
 * only the newer applies until the person keeps or forgets it.
 */
export function retrieveMemory(
  state: MemoryState,
  scope: string,
  query: string,
  {
    budget = 6000,
    now = Date.now(),
    embedding,
  }: { budget?: number; now?: number; embedding?: number[] } = {},
) {
  if (!state.enabled) return [];
  const wanted = terms(query);
  const live = (m: Memory) => !m.supersededBy && (!m.expiresAt || Date.parse(m.expiresAt) > now);
  const newest = new Map<string, Memory>();
  for (const m of state.records)
    if (live(m) && (m.scope === scope || m.sharedWith.includes(scope) || m.scope === PROFILE_SCOPE)) {
      const slot = m.scope + "\u0000" + m.key, held = newest.get(slot);
      if (!held || m.updatedAt > held.updatedAt) newest.set(slot, m);
    }
  type Group = "preference" | "profile" | "space";
  const ranked = [...newest.values()]
    .map((m) => {
      const words = terms(m.text + " " + m.key);
      const overlap = wanted.reduce((n, t) => n + (words.some((w) => w === t || (t.length > 3 && w.length > 3 && (w.startsWith(t) || t.startsWith(w)))) ? 1 : 0), 0);
      const group: Group = isPreference(m) ? "preference" : m.scope === PROFILE_SCOPE ? "profile" : "space";
      const ageDays = (now - Date.parse(m.updatedAt)) / 86_400_000;
      const close = embedding && m.embedding ? Math.max(0, cosine(embedding, m.embedding)) : 0;
      const score =
        (group === "preference" ? 3 : group === "profile" ? 1 : 0) + overlap * 1.5 + (m.confirmed ? 0.5 : 0) + Math.max(0, 0.5 - ageDays / 120) + close * 3;
      return { memory: m, score, group, matched: overlap > 0 || close > 0.3 };
    })
    .sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt));
  // Records that do not match the request may use at most this share of the budget per kind.
  const share: Record<Group, number> = { preference: 0.4, profile: 0.35, space: 0.35 };
  const usedBy: Record<Group, number> = { preference: 0, profile: 0, space: 0 };
  let used = 0;
  const seen = new Set<string>(), kept: string[] = [];
  return ranked.flatMap(({ memory, group, matched }) => {
    const text = memory.text.trim().toLowerCase(), size = memory.text.length;
    // The same thing under two keys (said in two chats) is sent once: the higher-ranked one.
    if (seen.has(text) || used + size > budget || kept.some((k) => similarity(k, text) >= 0.8)) return [];
    if (!matched && usedBy[group] + size > budget * share[group]) return [];
    used += size;
    usedBy[group] += size;
    seen.add(text);
    kept.push(text);
    const { embedding, ...record } = memory;
    return [record];
  });
}
/** How the person wants answers: a confirmed preference, or one learned from what they asked for or corrected. */
export const isPreference = (m: Pick<Memory, "kind" | "key">) => m.kind === "preference" || m.key.startsWith("pref:");
/** Where a memory applies, as the model reads it: about the user, this subject/project/chat, or shared from another space. */
function whereLabel(memoryScope: string, scope?: string) {
  if (memoryScope === PROFILE_SCOPE) return "about the user";
  const kind = memoryScope.split(":")[0];
  const noun = kind === "subject" || kind === "project" || kind === "chat" ? kind : "space";
  if (!scope || memoryScope === scope) return "this " + noun;
  return "shared by the user from another " + noun;
}
/**
 * Compact lines for the model, preferences first: how the user wants answers matters on every
 * turn, while facts matter when they are relevant. Far fewer tokens than records.
 */
export function memoryLines(records: Omit<Memory, "embedding">[], scope?: string) {
  const line = (m: Omit<Memory, "embedding">) => `- ${m.text.trim()} (${whereLabel(m.scope, scope)}; ${m.confirmed ? "confirmed" : "learned from conversation"}; ${m.updatedAt.slice(0, 10)}${m.expiresAt ? "; until " + m.expiresAt.slice(0, 10) : ""})`;
  const prefs = records.filter(isPreference), facts = records.filter((m) => !isPreference(m));
  return [
    prefs.length ? "How the user wants answers (follow these every time unless they ask otherwise now):\n" + prefs.map(line).join("\n") : "",
    facts.length ? (prefs.length ? "About the user and their work:\n" : "") + facts.map(line).join("\n") : "",
  ].filter(Boolean).join("\n");
}
/**
 * The same cues in the other languages people use Clem in (Arabic, French, Spanish, German). Arabic has no
 * word boundaries in JavaScript's \b, so its cues match at the start of a word instead.
 */
const otherLanguages = [
  /(?:^|[\s،.؟!"'(])(?:أنا|انا|اسمي|إسمي|أدرس|ادرس|أعمل|اعمل|أشتغل|اشتغل|أفضّل|أفضل أن|افضل ان|أحب|احب|أكره|اكره|عندي|لدي|لديّ|تخصصي|جامعتي|كليتي|امتحاني|اختباري|رسالتي|مستواي|هدفي|وظيفتي|تذكر|تذكّر|احفظ|من الآن|من الان|دائما|دائماً|لا تستخدم|لا تكتب|جاوب|أجب|اجب|رد علي|ردّ علي|اكتب لي|طويل جدا|طويلة جدا|اختصر)/u,
  /\b(?:je suis|j'?ai|je travaille|j'?étudie|je prépare|je préfère|j'?aime|je n'?aime pas|mon (?:nom|travail|métier|prof|professeur|examen|mémoire|niveau|objectif)|ma (?:thèse|classe|filière|fac|langue)|mes (?:examens|cours|étudiants)|souviens-toi|retiens|à partir de maintenant|désormais|réponds en|réponds toujours|trop long|plus court)\b/iu,
  /\b(?:soy|estoy|trabajo|estudio|prefiero|me gusta|no me gusta|mi (?:nombre|trabajo|profesor|examen|tesis|nivel|objetivo|carrera)|mis (?:exámenes|clases|alumnos)|recuerda|a partir de ahora|de ahora en adelante|responde en|responde siempre|demasiado largo|más corto)\b/iu,
  /\b(?:ich bin|ich arbeite|ich studiere|ich bevorzuge|ich mag|mein(?:e|en)? (?:name|beruf|job|professor|prüfung|thesis|niveau|ziel|studium)|merk dir|merke dir|ab jetzt|von nun an|antworte (?:auf|immer)|zu lang|kürzer)\b/iu,
];
/**
 * Cheap gate: only messages where the person describes themselves or states a standing preference are worth a memory
 * pass (a side call on their own plan). Requests are not: "I want you to summarise this", "I'd like a table", "I have
 * to submit the report tomorrow", "I'm working on question 2" and "my project is due on the 3rd" are one piece of work,
 * whose plan lives in a ```plan block. An exam and its date still count: they stay true until the exam.
 */
export function mentionsSelf(text: string) {
  return correctsStyle(text) || otherLanguages.some((cue) => cue.test(text)) || /\b(i work|i study|i teach|i live|i moved|my (?:name|job|role|major|degree|course|class|classes|exams?|goal|goals|level|company|team|field|background|school|university|college|teacher|professor|boss|thesis|research|students?|kids?|business|startup|native language|first language)|i have (?:an? |my )(?:[\w-]+ ){0,2}(?:exams?|tests?|midterms?|finals|quiz|interview|degree|job|background|kids?|children|students?|class(?:es)?|dyslexia|adhd)|(?:i'?m|i am) (?:from|based in|in (?:year|grade|my))|i speak|i'?d (?:rather|prefer)|i would (?:rather|prefer)|i want (?:answers|replies|responses)|i run|i own|i graduated|(?:i'?m|i am) (?:taking|applying|\d{1,2} years? old)|i prefer|i like|i love|i hate|i dislike|i don'?t like|i usually|i always|i never|i struggle|call me|from now on|going forward|i'?ve been (?:a|an|teaching|working as|studying|learning)|(?:i'?m|i am) (?:a|an|studying|learning|preparing))\b/i.test(text) || explicitRemember(text);
}
/** Corrections and standing instructions about answers ("shorter please", "stop using bullet points", "answer in Arabic"). */
export function correctsStyle(text: string) {
  return /\b(?:(?:too|way too|much too) (?:long|short|wordy|vague|technical|simple|basic|formal|casual)|(?:shorter|longer|simpler|briefer|more concise|more detailed?|less detail|more examples|fewer (?:words|bullets|emojis)) (?:please|next time|answers?|replies|responses)|(?:stop|don'?t|do not|never|avoid) (?:using|use|saying|say|adding|add|writing|write|including|include|giving|give)\b|(?:always|please always|from now on) (?:use|answer|reply|write|respond|include|give|explain|show|cite|keep)|(?:answer|reply|respond|write|explain) (?:in|using) (?:arabic|english|french|german|spanish|italian|turkish|urdu|hindi|chinese|japanese|korean|portuguese|russian|dutch|british english|american english|simple english|plain english|metric|imperial|si units|latex|markdown|bullet points|tables?|steps)|i (?:only )?(?:want|need|like) (?:short|long|detailed|brief|simple|step[- ]by[- ]step|concise)|my (?:exams?|tests?|midterms?|finals|thesis|dissertation|teacher|professor|supervisor|boss|manager|interview|course|curriculum|syllabus) (?:is|are|was|will|on|in|at))/i.test(text);
}
/**
 * The person's own "remember that…" as a memory, used when extraction returns nothing: their words,
 * lightly cleaned, about them. Preferences ("I prefer…", "always…") keep answering in that style.
 */
export function rememberedWords(text: string): Learned[] {
  const words = text
    .replace(/^\s*(?:please\s+|pls\s+)?(?:can you\s+|could you\s+)?(?:save|add|put|store|write|keep)\s+(?:this|that|it|the following)?\s*(?:in|to|into)\s+(?:your|the|my|this|clem'?s)?\s*(?:(?:project|subject|long[- ]term)\s+)?memor(?:y|ies)\b(?:\s+that\b)?[\s:,-]*/i, "")
    .replace(/^\s*(?:please\s+|pls\s+)?(?:remember|note|keep in mind|memori[sz]e|don'?t forget)(?:\s+(?:that|this|in (?:your|the|my|this) (?:\w+ )?memory))?[\s:,-]*/i, "")
    .replace(/[\s,;-]*(?:(?:in|to|into)\s+(?:your|the|my|this|clem'?s)?\s*(?:(?:project|subject|long[- ]term)\s+)?memor(?:y|ies))\s*[.!]*$/i, "")
    .replace(/^\s*(?:من فضلك\s+|رجاء\s+)?(?:تذكر|تذكّر|احفظ)(?:\s+أن|\s+ان)?[\s:،,-]*/u, "")
    .replace(/^\s*(?:souviens-toi (?:que|de)|retiens que|recuerda (?:que|esto)|merke? dir)[\s:,-]*/iu, "")
    .replace(/\s+/g, " ").trim().replace(/[.!]*$/, "");
  if (words.length < 3 || words.length > 400 || looksSecret(words)) return [];
  const preference = /\b(prefer|like|want|always|never|don'?t|please|answer|reply|explain|write|use)\b/i.test(words) || /(?:أفضل|أفضّل|أريد|اريد|دائما|دائماً|لا تستخدم|لا تكتب|جاوب|أجب|اجب|اكتب|استخدم)/u.test(words) || /\b(?:préfère|toujours|jamais|réponds|prefiero|siempre|nunca|responde|bevorzuge|immer|niemals|antworte)\b/iu.test(words);
  const key = (preference ? "pref:" : "note:") + (words.toLowerCase().match(/[\p{L}\p{N}]+/gu) || ["note"]).slice(0, 5).join("-");
  // "save this to the project memory" belongs to the subject or project the chat is in.
  const about = /\b(?:project|subject|course|class)\s+memor(?:y|ies)\b/i.test(text) ? "space" : "user";
  return [{ key: key.slice(0, 60), text: words[0].toUpperCase() + words.slice(1) + ".", kind: preference ? "preference" : "fact", about }];
}
/**
 * The person asking Clem to remember something: "remember that…", "remember: …", "remember I…", "keep in mind
 * my…". A question ("Remember the Krebs cycle steps?", "Do you remember…") is not an instruction, and neither
 * is "Remember the formula for…", which asks about the topic, not the person.
 */
export function explicitRemember(text: string) {
  const t = text.trim();
  // "can you save this to the project memory?" asks for it even as a question.
  if (/^(?:please\s+|pls\s+)?(?:can you\s+|could you\s+)?(?:save|add|put|store|write|keep)\b[^.?!\n]{0,80}?\b(?:in|to|into)\s+(?:your|the|my|this|clem'?s)?\s*(?:(?:project|subject|long[- ]term)\s+)?memor(?:y|ies)\b/i.test(t)) return true;
  if (/[?؟]\s*$/.test(t)) return false;
  return /^(?:please\s+|pls\s+)?(?:(?:remember|keep in mind)\s*(?::|\bthat\b|\b(?:i|i'm|im|i've|i'd|my|me|to|for next time|this|these|the following|in (?:your|the|my|this) (?:\w+ )?memory)\b)|note\s+(?:that\s+)?(?:i|i'm|im|i've|my|me)\b|memori[sz]e\b|don'?t forget\b)/i.test(t) ||
    /^(?:من فضلك\s+|رجاء\s+)?(?:تذكر|تذكّر|احفظ)(?:\s+أن|\s+ان|\s*:|\s+أني|\s+انني|\s+إني)/u.test(t) ||
    /^(?:souviens-toi (?:que|de)|retiens que|recuerda (?:que|esto)|merk dir|merke dir)\b/iu.test(t);
}
/**
 * A standing instruction about answers ("from now on answer in Arabic", "going forward, no bullet points"). It
 * confirms the preferences it states, but facts said alongside it are still only learned.
 */
export function standingInstruction(text: string) {
  return /\b(?:from now on|going forward|in future|in the future|for all future)\b[,:\s]+(?:please\s+)?(?:always|never|don'?t|do not|stop|avoid|use|answer|reply|respond|write|explain|keep|give|call|make|be|show|include|i\b|my\b)/i.test(text) ||
    /(?:من الآن|من الان)(?:\s+فصاعدا|\s+فصاعداً)?[،,\s]+/u.test(text) ||
    /\b(?:à partir de maintenant|désormais|a partir de ahora|de ahora en adelante|ab jetzt|von nun an)\b/iu.test(text);
}
/**
 * Passwords, keys, card and account numbers never become memory, even when asked: memory syncs to the
 * person's other devices and goes to their AI with every message.
 */
export function looksSecret(text: string) {
  if (/\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|\bxox[abpr]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{30,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return true;
  if (/\b(?:password|passcode|passwd|pwd|pin(?: code)?|api[ _-]?key|secret[ _-]?key|access[ _-]?key|(?:api|access|auth|bearer|refresh)[ _-]?token|private[ _-]?key|recovery (?:code|phrase)|seed phrase|mot de passe|contraseña|passwort|kennwort)\b\s*(?:is|was|=|:|est|es|ist)\s*\S+/i.test(text) || /(?:كلمة السر|كلمة المرور|الرقم السري)\s*(?:هي|:|=)?\s*\S+/u.test(text)) return true;
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text) || /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b/.test(text)) return true;
  // Card numbers: 13 to 19 digits (spaces or dashes allowed) that pass the Luhn check.
  for (const run of text.match(/\b\d(?:[ -]?\d){12,18}\b/g) || []) {
    const digits = run.replace(/\D/g, "");
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}
export const extractionInstructions = `You maintain a private memory of durable facts about the user, so future answers fit them. From the user's latest message, extract only lasting information about the USER: identity (name, role, field, level, school/company), lasting goals (a degree, a career aim), fixed dates of exams and similar milestones, and stable preferences about how they want answers (length, tone, language, format, units, level of detail, words or styles to avoid). A correction of the previous answer ("too long", "stop using bullet points", "answer in Arabic") is a preference when it reads as a standing wish rather than a one-off edit. The previous answer is given only so corrections make sense; never store anything the assistant said. Ignore the topic of the question itself and one-off requests. A request is not a preference: how they want THIS answer, plan, document or task built ("make the plan work backward from my deadlines", "one block per subject", "use worksheets 1–5") describes that one piece of work, so store nothing from it; only a wish stated for answers in general ("always…", "from now on…", "I prefer…" about how Clem answers) is a preference. Never store plans, schedules, study timetables, to-do lists, steps, outlines, drafts or what they intend to do when; from such a message keep at most the fixed facts underneath it (an exam and its date). A deadline for one piece of work (a lab report due tomorrow, an assignment, a project due on the 3rd) belongs to that task, not to memory. When unsure whether something will still matter in a month, leave it out. All this applies except when the user explicitly asks to remember, save or note something ("remember this", "save this to the project memory", "don't forget that…"): then store exactly what they asked to keep, even about the topic or the project, resolving "this" or "that" from the previous answer, as "space" when they name the project or subject memory or it is about the course or project rather than about them. Never store secrets, passwords, health, financial, or other sensitive details unless the user explicitly asked you to remember them. The message may be in any language: write "text" in the language the user wrote in, and "key" in short English.
Return ONLY JSON: {"memories":[{"key":"short-stable-key","text":"one sentence in third person, e.g. The user is a second-year physics student. When it has several parts (exams, preferences), write a short lead, a colon, then the parts separated by semicolons, each with its own date, e.g. The user has exams: DSA midterm on October 22; Physics 3 on October 25.","kind":"fact"|"preference","about":"user"|"space","until":"YYYY-MM-DD (optional)"}]}. "about":"space" only for facts tied to the current project or subject. For time-bound facts (an exam, a thesis defence, a trip) set "until" to the day after it ends; leave it out for lasting facts. Reuse an existing key when the new information updates or contradicts it. Return {"memories":[]} when there is nothing durable. At most 5 items.`;
export type Learned = { key: string; text: string; kind: "fact" | "preference"; about: "user" | "space"; until?: string };
export function parseExtraction(raw: string): Learned[] {
  const json = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: any;
  try { value = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(value?.memories)) return [];
  return value.memories.slice(0, 5).flatMap((m: any) =>
    typeof m?.text === "string" && m.text.trim().length > 5 && m.text.length <= 400 && typeof m.key === "string" && /^[\p{L}\p{N}_ .:-]{1,60}$/u.test(m.key) &&
    ["fact", "preference"].includes(m.kind) && ["user", "space"].includes(m.about)
      ? [{ key: m.key.trim().toLowerCase().replace(/\s+/g, "-"), text: m.text.trim(), kind: m.kind, about: m.about,
          ...(typeof m.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.until) && Number.isFinite(Date.parse(m.until)) ? { until: m.until } : {}) }]
      : [],
  );
}
/**
 * Stores what a conversation revealed. Learned items are unconfirmed ("inference") until the
 * person keeps them; an explicit "remember that…" is the person's own instruction and is confirmed, and a
 * standing instruction ("from now on…", explicit: "preferences") confirms only the preferences it states.
 * A new item with the same key replaces the older learned one, so memory tracks change. Secrets are never kept.
 */
export function learnMemories(state: MemoryState, items: Learned[], context: { scope: string; sourceId: string; explicit: boolean | "preferences"; now?: string }) {
  if (!state.enabled) return state;
  const now = context.now || new Date().toISOString();
  for (const item of items) {
    if (looksSecret(item.text)) continue;
    const confirmed = context.explicit === true || (context.explicit === "preferences" && item.kind === "preference");
    const scope = item.about === "user" ? PROFILE_SCOPE : context.scope;
    // Learned preferences keep a "pref:" key so they apply on every turn before the person confirms them.
    const key = item.kind === "preference" && !item.key.startsWith("pref:") ? ("pref:" + item.key).slice(0, 100) : item.key;
    const expiresAt = item.until && Date.parse(item.until) > Date.parse(now) ? new Date(item.until).toISOString() : undefined;
    const live = state.records.filter((m) => m.scope === scope && !m.supersededBy && (!m.expiresAt || Date.parse(m.expiresAt) > Date.parse(now)));
    // Said again: the memory is still true, so it stays fresh (recency ranks it and pruning keeps it) and a learned one
    // grows more certain. Nothing new is stored.
    const same = live.find((m) => m.key === key && m.text.trim().toLowerCase() === item.text.toLowerCase());
    if (same) {
      state = { ...state, records: state.records.map((m) => (m.id === same.id ? { ...m, updatedAt: now, ...(m.confirmed ? {} : { confidence: Math.min(0.95, m.confidence + 0.1) }) } : m)) };
      continue;
    }
    // The same thing said differently under another key updates that memory instead of sitting beside it.
    const similar = live.find((m) => m.key !== key && !m.confirmed && isPreference(m) === (item.kind === "preference") && similarity(m.text, item.text) >= 0.6);
    state = { ...state, records: state.records.filter((m) => !(m.scope === scope && m.key === key && !m.confirmed && !m.supersededBy)) };
    state = putMemory(state, {
      scope,
      key,
      text: item.text,
      kind: confirmed ? item.kind : expiresAt ? "temporary" : "inference",
      confirmed,
      confidence: confirmed ? 1 : 0.7,
      source: { id: context.sourceId, locator: confirmed ? "You asked Clem to remember this in a chat" : "Learned from your message in a chat", at: now },
      ...(expiresAt ? { expiresAt } : {}),
      derivedFrom: [],
      sharedWith: [],
    }, now);
    const added = state.records.at(-1)!;
    if (similar && added.text === item.text)
      state = { ...state, records: state.records.map((m) => (m.id === similar.id ? { ...m, supersededBy: added.id, updatedAt: now } : m)) };
  }
  // Keep learned memory bounded: the oldest unconfirmed items go first.
  const learned = state.records.filter((m) => !m.confirmed).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  if (learned.length > 200) {
    const drop = new Set(learned.slice(0, learned.length - 200).map((m) => m.id));
    state = { ...state, records: state.records.filter((m) => !drop.has(m.id)) };
  }
  return state;
}
/** Keeping a learned item makes it a confirmed fact or preference; a dated one (an exam, a deadline) keeps its date. */
export function confirmMemory(state: MemoryState, id: string, now = new Date().toISOString()) {
  const record = state.records.find((m) => m.id === id && !m.supersededBy);
  if (!record) throw Error("That memory no longer exists.");
  if (record.confirmed) return state;
  const kind: MemoryKind = record.kind === "temporary" && record.expiresAt ? "temporary" : isPreference(record) || /\b(prefer|likes?|wants?|style|format|length|tone)\b/i.test(record.text) ? "preference" : "fact";
  return putMemory({ ...state, records: state.records.filter((m) => m.id !== id) }, { ...record, kind, confirmed: true, confidence: 1, source: { ...record.source, locator: "Kept by you in memory settings", at: now } }, now);
}

/**
 * The person's own change to one memory: new words, a new home (about them everywhere, or one subject or project),
 * or other spaces that should use it too. Changing it is keeping it, so a learned memory becomes confirmed.
 */
export function updateMemory(state: MemoryState, id: string, change: { text?: string; scope?: string; sharedWith?: string[] }, now = new Date().toISOString()) {
  const record = state.records.find((m) => m.id === id && !m.supersededBy);
  if (!record) throw Error("That memory no longer exists.");
  const text = (change.text ?? record.text).replace(/\s+/g, " ").trim();
  if (!text) throw Error("A memory needs some words.");
  if (looksSecret(text)) throw Error("That looks like a password, key or account number. Clem never keeps those in memory.");
  const scope = change.scope ?? record.scope;
  // Something about the person already applies everywhere; a space's memory is never shared into itself or into chats.
  const sharedWith = scope === PROFILE_SCOPE ? [] : [...new Set((change.sharedWith ?? record.sharedWith).filter((s) => s !== scope && /^(?:project|subject):/.test(s)))].slice(0, 10);
  if (text === record.text && scope === record.scope && JSON.stringify([...sharedWith].sort()) === JSON.stringify([...record.sharedWith].sort()) && record.confirmed) return state;
  // A memory moved into another space keeps its own key there, so it never replaces an unrelated memory that happens to share it.
  const taken = scope !== record.scope && state.records.some((m) => m.scope === scope && m.key === record.key && !m.supersededBy);
  const key = taken ? (record.key + ":" + randomUUID().slice(0, 8)).slice(0, 100) : record.key;
  const kind: MemoryKind = record.kind === "temporary" && record.expiresAt ? "temporary" : record.kind === "inference" ? (isPreference(record) ? "preference" : "fact") : record.kind;
  const { id: _id, createdAt: _created, updatedAt: _updated, supersededBy: _replaced, embedding, ...rest } = record;
  const next = putMemory({ ...state, records: state.records.filter((m) => m.id !== id) }, {
    ...rest,
    ...(text === record.text && embedding ? { embedding } : {}),
    scope, key, text, kind, sharedWith,
    confirmed: true,
    confidence: 1,
    source: { ...record.source, locator: "Changed by you in memory", at: now },
  }, now);
  // Records that pointed at the old one (what it replaced, what was derived from it) follow it to its new id. When the
  // same memory already lived there, that one stays and stands in for it.
  const before = new Set(state.records.map((m) => m.id));
  const added = next.records.find((m) => !before.has(m.id)) || next.records.find((m) => m.scope === scope && m.text === text && !m.supersededBy);
  if (!added) return next;
  return { ...next, records: next.records.map((m) => ({
    ...m,
    ...(m.supersededBy === id ? { supersededBy: added.id } : {}),
    ...(m.derivedFrom.includes(id) ? { derivedFrom: m.derivedFrom.map((d) => (d === id ? added.id : d)) } : {}),
  })) };
}
/** A space's memory that is shared into other spaces stops being shared there when that space is deleted. */
export function unshareScope(state: MemoryState, scope: string) {
  if (!state.records.some((m) => m.sharedWith.includes(scope))) return state;
  return { ...state, records: state.records.map((m) => (m.sharedWith.includes(scope) ? { ...m, sharedWith: m.sharedWith.filter((s) => s !== scope) } : m)) };
}
/**
 * What the AI saved when the person asked it to remember something: each ```memory block of its answer holds
 * {"remember":[{"text":"…","about":"user"|"space","kind"?:"fact"|"preference"}]}. The AI resolves "this" from the
 * conversation, so these are kept as the person's own instruction (confirmed).
 */
export function memoryBlocks(answer: string): Learned[] {
  const items: Learned[] = [];
  for (const [, body] of answer.matchAll(/^[ \t]*```memory[^\n]*\n([\s\S]*?)\n[ \t]*```/gm)) {
    let value: any;
    try { value = JSON.parse(body); } catch { continue; }
    for (const m of [value?.remember ?? value].flat().slice(0, 5)) {
      const text = typeof m?.text === "string" ? m.text.replace(/\s+/g, " ").trim() : "";
      if (text.length < 4 || text.length > 400 || looksSecret(text)) continue;
      const kind = m.kind === "preference" ? "preference" : "fact";
      const key = (kind === "preference" ? "pref:" : "note:") + (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || ["note"]).slice(0, 5).join("-");
      items.push({ key: key.slice(0, 60), text, kind, about: m.about === "space" ? "space" : "user" });
    }
  }
  return items.slice(0, 10);
}
