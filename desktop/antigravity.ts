import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extname, join, relative, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {AcpClosed, AcpConnection, AcpError} from './acp.ts';
import type {AntigravityEngine} from './antigravity-engine.ts';
import {inlinePictures, keepingAlive, kinetraMcp, NATIVE_NOTE, SERVER_NAME, type NativeEndpoint} from './kinetra-mcp.ts';
import {SessionLost, Transient, UsageLimit} from './kinetra-turn.ts';
import {describeTool, StepCounter} from './tool-status.ts';
import type {UsageSnapshot} from '../core/account-usage.ts';

// Antigravity (Google's Gemini, and the Claude and GPT models Google offers with it) through the person's own Google AI
// plan, the way T3 Code runs it: Google's official Antigravity agent for other apps ("antigravity-acp", desktop/
// antigravity-engine.ts), started unmodified on this PC and spoken to over the Agent Client Protocol, the protocol Google
// built it for. Google's own agent signs the person in (its Google sign-in page opens in the browser), keeps the sign-in
// in its own folder, and talks to Google's services itself. Clem never reads that sign-in, never calls Google's services
// itself, and nothing passes through Clem's servers. Plan usage comes from the agent's own /usage command.

export const ANTIGRAVITY_PREFIX = 'antigravity:';
export type AntigravityModel = {id: string; name: string; description?: string};
export type AntigravityEfforts = Record<string, {levels: string[]; default?: string}>;
export type AntigravityStatus = {installed: boolean; connected: boolean; models: AntigravityModel[]; defaultModel?: string; efforts?: AntigravityEfforts; plan?: string; usage?: UsageSnapshot; version?: string; error?: string};
type Model = {id: string; name: string; provider: string; connected: boolean; context: number; specialties: string[]; tools: string[]; description: string; reasoningEfforts: {reasoningEffort: string; description: string}[]; defaultReasoningEffort: string};

/** One Kinetra request for the native tool: its result, and pictures (files on this PC) that go with it. */
export type AntigravityNative = (request: Record<string, unknown>) => Promise<{result: unknown; pictures: {path: string; mime?: string}[]}>;

/** The options of one of the agent's session settings ("model", "thinking_level"), with nested groups flattened. */
type Choice = {value: string; name: string; description?: string};
function selectOptions(configOptions: any, id: string, category: string): {options: Choice[]; current?: string} {
  const option = (Array.isArray(configOptions) ? configOptions : []).find((o: any) => o?.id === id || o?.category === category);
  if (option?.type !== 'select' || !Array.isArray(option.options)) return {options: []};
  const flat: any[] = option.options.flatMap((o: any) => (Array.isArray(o?.options) ? o.options : [o]));
  const seen = new Set<string>();
  const options = flat.flatMap((o): Choice[] => {
    const value = typeof o?.value === 'string' ? o.value : '';
    if (!/^[A-Za-z0-9._:\/-]{1,120}$/.test(value) || seen.has(value)) return [];
    seen.add(value);
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : value;
    return [{value, name, ...(typeof o.description === 'string' && o.description.trim() ? {description: o.description.trim().slice(0, 200)} : {})}];
  });
  return {options, current: typeof option.currentValue === 'string' ? option.currentValue : undefined};
}
/** The models the agent offers this account, from session/new's `model` setting (or ACP's older `models` list). */
export function parseAntigravityModels(setup: any): {models: AntigravityModel[]; current?: string} {
  const {options, current} = selectOptions(setup?.configOptions, 'model', 'model');
  if (options.length) return {models: options.map((o) => ({id: o.value, name: o.name, ...(o.description ? {description: o.description} : {})})), current};
  const listed = Array.isArray(setup?.models?.availableModels) ? setup.models.availableModels : [];
  const models = listed.filter((m: any) => typeof m?.modelId === 'string' && /^[A-Za-z0-9._:\/-]{1,120}$/.test(m.modelId)).map((m: any) => ({id: m.modelId, name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : m.modelId}));
  return {models, current: typeof setup?.models?.currentModelId === 'string' ? setup.models.currentModelId : undefined};
}
/** The agent's thinking levels for the selected model, lowest first. */
const LEVEL_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'extra_high', 'max'];
export function parseAntigravityLevels(configOptions: any) {
  const {options, current} = selectOptions(configOptions, 'thinking_level', 'thought_level');
  const levels = options.map((o) => o.value).filter((v) => /^[a-z_]{2,16}$/.test(v)).sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b));
  return {levels, current: current && levels.includes(current) ? current : undefined};
}
/** The plan's name from the agent's `_meta.antigravity.tier` (e.g. "Google AI Pro"). */
export function antigravityTier(result: any) {
  const name = result?._meta?.antigravity?.tier?.name;
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : undefined;
}

const effortNames: Record<string, string> = {minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', extra_high: 'Extra high', max: 'Max'};
export function antigravityModels(status: Pick<AntigravityStatus, 'models' | 'defaultModel' | 'efforts'>): Model[] {
  const ordered = [...status.models].sort((a, b) => Number(b.id === status.defaultModel) - Number(a.id === status.defaultModel));
  return ordered.map((m) => {
    const effort = status.efforts?.[m.id];
    const levels = effort?.levels || [];
    return {id: ANTIGRAVITY_PREFIX + m.id, name: m.name, provider: 'Google', connected: true, context: 32000, specialties: [], tools: [], description: m.description || 'On your Google AI plan',
      reasoningEfforts: levels.map((reasoningEffort) => ({reasoningEffort, description: effortNames[reasoningEffort] || reasoningEffort})),
      defaultReasoningEffort: effort?.default && levels.includes(effort.default) ? effort.default : levels.includes('high') ? 'high' : levels[0] || ''};
  });
}

const MONTHS: Record<string, number> = {Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11};
/** "Oct 02, 2026, 10:00 UTC" (the agent's own wording) → seconds; undefined when it says something else. */
function resetTime(text: string) {
  const m = text.match(/([A-Z][a-z]{2}) (\d{1,2}), (\d{4})(?:, (\d{1,2}):(\d{2}) UTC)?/);
  if (!m || MONTHS[m[1]] === undefined) return undefined;
  return Math.round(Date.UTC(Number(m[3]), MONTHS[m[1]], Number(m[2]), Number(m[4] || 0), Number(m[5] || 0)) / 1000);
}
export type AntigravityQuota = {group: string; name: string; remaining: number; resetsAt?: number};
/**
 * The agent's /usage report (Markdown its server writes, without a model call): the session's tokens, and each model
 * group's limits ("- **Gemini Models**" then "  - **Weekly Limit:** 91% remaining (resets Oct 02, 2026, 10:00 UTC)").
 */
export function parseUsageReport(text: string) {
  const quotas: AntigravityQuota[] = [];
  let group = '';
  for (const line of text.split(/\r?\n/)) {
    const top = line.match(/^- \*\*(.+?)\*\*\s*$/);
    if (top) { group = top[1]; continue; }
    const bucket = line.match(/^\s+- \*\*(.+?):\*\*\s*(\d{1,3})% remaining(.*)$/);
    if (bucket && group) quotas.push({group, name: bucket[1], remaining: Math.max(0, Math.min(100, Number(bucket[2]))), ...(resetTime(bucket[3]) ? {resetsAt: resetTime(bucket[3])} : {})});
  }
  const total = text.match(/\*\*Session total:\*\*\s*([\d,]+) tokens(?: \(([^)]*)\))?/);
  const count = (name: string) => Number((total?.[2] || '').match(new RegExp(name + ': ([\\d,]+)'))?.[1]?.replace(/,/g, '') || 0);
  const tokens = total ? {prompt: count('prompt'), completion: count('completion'), thinking: count('thinking'), cached: count('cached'), total: Number(total[1].replace(/,/g, ''))} : undefined;
  return {quotas, tokens};
}
/** How long a limit's window is, from its name: the agent names a five-hour and a weekly window per model group. */
const windowOf = (name: string) => (/week/i.test(name) ? 10080 : /\b5\s*-?\s*h(ou)?r?|five/i.test(name) ? 300 : /day|daily/i.test(name) ? 1440 : /month/i.test(name) ? 43200 : undefined);
/**
 * The plan's usage in the shape ChatGPT's has: the shorter window first, then the weekly one. Gemini's group is the one
 * Antigravity's own models count against; the Claude and GPT models share a group of their own, used when it is the
 * only one reported.
 */
export function antigravityUsage(quotas: AntigravityQuota[]): UsageSnapshot | undefined {
  if (!quotas.length) return undefined;
  const groups = [...new Set(quotas.map((q) => q.group))];
  const group = groups.find((g) => /gemini/i.test(g)) || groups[0];
  const windows = quotas.filter((q) => q.group === group).map((q) => ({q, minutes: windowOf(q.name)})).sort((a, b) => (a.minutes ?? 99999) - (b.minutes ?? 99999));
  const shape = ({q, minutes}: {q: AntigravityQuota; minutes?: number}) => ({usedPercent: 100 - q.remaining, windowDurationMins: minutes ?? 10080, resetsAt: q.resetsAt ?? null});
  return {rateLimits: {primary: shape(windows[0]), ...(windows[1] ? {secondary: shape(windows[1])} : {})}};
}

/**
 * What a turn that ended with this text means. The agent reports a failed turn as a message of its own, not as an
 * error: an exhausted plan ("Usage Limit Reached"), a model error ("Agent execution error: …") and a connection it could
 * not get back ("Agent connection was lost …").
 */
export function replyProblem(text: string): {kind: 'limit' | 'error' | 'transient' | 'signed-out'; message: string; resetsAt?: number} | null {
  const t = text.trim();
  if (/^Usage Limit Reached\b/.test(t)) {
    const delay = t.match(/(?:in|after)\s+((?:\d+\s+(?:day|hour|minute|second)s?(?:,?\s*(?:and\s+)?)?)+)/i)?.[1];
    let seconds = 0;
    for (const [, n, unit] of (delay || '').matchAll(/(\d+)\s+(day|hour|minute|second)/gi)) seconds += Number(n) * ({day: 86400, hour: 3600, minute: 60, second: 1} as Record<string, number>)[unit.toLowerCase()];
    return {kind: 'limit', message: 'Your Google AI plan has no Gemini usage left right now. Try again later or pick another model.', ...(seconds ? {resetsAt: Date.now() + seconds * 1000} : {})};
  }
  if (/^Agent connection was lost\b/.test(t)) return {kind: 'transient', message: 'Gemini lost its connection to Google. Check your internet connection, then send your message again.'};
  if (/^Agent execution error:/.test(t)) {
    if (/RESOURCE_EXHAUSTED|QUOTA|rate limit|\b429\b/i.test(t)) return {kind: 'limit', message: 'Your Google AI plan has no Gemini usage left right now. Try again later or pick another model.'};
    if (/UNAUTHENTICATED|\b401\b|invalid_grant|sign in|logged out/i.test(t)) return {kind: 'signed-out', message: 'Sign in to Gemini again in Settings → Models.'};
    if (/UNAVAILABLE|\b50[234]\b|overloaded|DEADLINE_EXCEEDED|timed? ?out|connection/i.test(t)) return {kind: 'transient', message: 'Gemini is busy right now. Try again in a moment.'};
    if (/SUBSCRIPTION_REQUIRED|not eligible|ineligible/i.test(t)) return {kind: 'error', message: 'Google says this account has no Gemini plan. Check your Google AI plan, or pick another model.'};
    return {kind: 'error', message: 'Gemini could not complete this request. Check Gemini in Settings → Models.'};
  }
  return null;
}

/** A few words on what the agent is doing, from one of its tool calls (null when it says nothing new). */
export function antigravityToolStatus(update: any): string | null {
  const title = String(update?.title || ''), input = update?.rawInput && typeof update.rawInput === 'object' ? update.rawInput : {};
  const mcp = update?._meta?.mcp;
  if (mcp && /kinetra/i.test(String(mcp.server || mcp.tool || ''))) return describeTool('kinetra', input);
  if (/kinetra/i.test(title)) return describeTool('kinetra', input);
  const path = input.AbsolutePath ?? input.TargetFile ?? input.path ?? input.file_path ?? input.DirectoryPath ?? (Array.isArray(update?.locations) ? update.locations[0]?.path : undefined);
  const named = (verb: string) => describeTool(verb, {path});
  switch (update?.kind) {
    case 'read': return path ? named('read_file') : 'Reading a file…';
    case 'edit': return path ? named('edit_file') : 'Editing a file…';
    case 'search': return describeTool(/web/i.test(title) ? 'search_web' : 'grep', {query: input.query ?? input.Query ?? input.pattern ?? input.Pattern});
    case 'fetch': return /search/i.test(title) ? describeTool('search_web', {query: input.query ?? input.Query}) : describeTool('web_fetch', {url: input.url ?? input.Url});
    case 'think': return 'Thinking it through…';
  }
  return title ? null : 'Using a tool…';
}

/**
 * The agent's own tools Clem keeps, by their built-in names: in a chat, opening the pictures and PDFs a message names and
 * the web; in a working folder of the person's files (desktop/ai-workspace.ts), its file tools there too. Its terminal,
 * subagents, browser, image generation and questions stay off. Kinetra is an MCP tool, which the list does not govern.
 */
export const ANTIGRAVITY_TOOLS = ['view_file', 'search_web', 'read_url_content', 'finish'];
export const ANTIGRAVITY_FOLDER_TOOLS = ['view_file', 'list_directory', 'search_directory', 'find_file', 'create_file', 'edit_file', 'search_web', 'read_url_content', 'finish'];
export const ANTIGRAVITY_NOTE = 'IN CLEM: your own tools are only for opening the pictures and PDFs a message names (view_file) and for the web. Files, documents, figures and calculations go only through Clem\'s {"kinetra":…} requests: never read other files on this PC. When a message names several pictures or PDF page ranges, open all of them in the same step (one call each, sent together).';
export const ANTIGRAVITY_FOLDER_NOTE = 'IN CLEM: your working folder holds the person\'s files; list, search, read and write them with your own file tools, as in any project. Run no commands. Never read files outside the working folder. When you need several files or page ranges, open them in the same step (one call each, sent together).';
/** NATIVE_NOTE as Antigravity names an MCP tool (server, then tool). */
export const ANTIGRAVITY_NATIVE_NOTE = NATIVE_NOTE;
/** The most of one Kinetra result the agent passes to the model, in bytes (a guide or a passage of a file goes whole). */
export const ANTIGRAVITY_MAX_OUTPUT_BYTES = 4_000_000;
/** Without any word from the agent for this long an answer is taken as stuck (a native Kinetra call keeps it alive). */
export const ANTIGRAVITY_IDLE_LIMIT = 10 * 60_000;
/**
 * An agent with no answer running is closed after this long; its sessions stay on disk and resume in the next one.
 * Starting it again unpacks it (about 11 s on this PC) and opening a session again costs about 3 s, so it stays for as
 * long as a chat keeps its session (desktop/chat-sessions.ts KEEP_MS).
 */
const PROCESS_IDLE = 55 * 60_000;
/** A process that has held this many sessions is closed once idle, since the agent keeps every one in memory. */
const PROCESS_SESSIONS = 40;

class SignedOut extends Error {}
/** The agent's two ways of handing out its Google sign-in page: through BROWSER (Clem's helper, below), or printed. */
const URL_MARKER = '__CLEM_ANTIGRAVITY_URL__', URL_PRINTED = 'Open the following link to authenticate the ACP server: ';
/** Google's sign-in page, as the agent builds it, with a loopback return address on this PC. */
export function googleSignInUrl(text: string) {
  try {
    const url = new URL(text.trim());
    const back = url.searchParams.get('redirect_uri') || '';
    return url.origin === 'https://accounts.google.com' && url.pathname === '/o/oauth2/v2/auth' && !url.username && !url.password && /^http:\/\/127\.0\.0\.1:\d{4,5}\/$/.test(back) ? url.href : null;
  } catch { return null; }
}
const signedOut = /authentication required|not authenticated|logged out|sign in again|unauthenticated|invalid_grant|onboarding failed/i;
function friendly(detail: string) {
  if (signedOut.test(detail)) return 'Sign in to Gemini again in Settings → Models.';
  if (/SUBSCRIPTION_REQUIRED/.test(detail)) return 'Google says this account has no Gemini plan. Check your Google AI plan.';
  if (/model/i.test(detail) && /unavailable|not (found|available|supported)|unknown/i.test(detail)) return 'This Gemini model is not available on your plan. Pick another one.';
  return 'Gemini could not complete this request. Check Gemini in Settings → Models.';
}
const MIME: Record<string, string> = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp', '.gif': 'image/gif'};
/** Where one turn's PDFs sit in the agent's working folder: kept for the whole turn, so a later step can open more pages. */
export const antigravityPdfPath = (turn: string, index: number, name: string) => `.pdfs-${turn}/${index + 1}-${name.replace(/\.pdf$/i, '').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 80)}.pdf`;
const inside = (root: string, path: string) => { const r = relative(resolve(root), resolve(path)); return r === '' || (!r.startsWith('..') && !/^[a-z]:/i.test(r)); };

/**
 * A session the process holds: where it works, whether it may write there, and its Kinetra endpoint, which lives as long
 * as the session and is routed to whichever answer runs on it now (`route`), so a chat's next message goes on without
 * opening the session again.
 */
type Held = {cwd: string; folder: boolean; endpoint?: NativeEndpoint; route?: {id: string; native: AntigravityNative}; ended?: boolean};
type Live = {acp: AcpConnection; child: ChildProcessWithoutNullStreams; tier?: string; version?: string;
  sessions: Map<string, Held>; opened: number; idle?: ReturnType<typeof setTimeout>};
/** What a session is opened with: its folder, Clem's rules for it, whether it may write there, and whether Kinetra is a tool. */
export type AntigravitySpec = {cwd: string; system?: string; folder: boolean; native: boolean};
const specKey = (spec: AntigravitySpec) => JSON.stringify([spec.cwd, spec.system || '', spec.folder, spec.native]);

export class AntigravityProvider {
  private engine: AntigravityEngine;
  private root: string;
  /** The agent's GEMINI_HOME for this account: its sign-in, settings and sessions, apart from any other Antigravity app. */
  private home: string;
  private live: Promise<Live> | null = null;
  /** Clem's session ids (chosen before a session starts) → the agent's own, which it picks itself. */
  private agentIds = new Map<string, string>();
  /** Sessions Clem is done with; their files are removed once the process holding them has closed. */
  private dropped = new Set<string>();
  /** PDFs each session has been handed already, so a kept chat attaches each one once. */
  private attached = new Map<string, Set<string>>();
  /** Running answers: their agent session, and a way to restart their inactivity limit. */
  private active = new Map<string, {session?: string; touch: () => void; text: (piece: string, update: any) => void}>();
  private statusCache: {at: number; value: AntigravityStatus} | null = null;
  private modelsAt = 0;
  private usageStale = false;
  private loginChild: Promise<Live> | null = null;
  /** Every agent process of this account, started or still starting (a sign-in waits on the person for minutes). */
  private processes = new Set<Live>();
  /** The session /usage is asked in (no model call); it lives with the process. */
  private probe: {session: string; live: Live} | null = null;
  /**
   * A session opened ahead for the next new chat message: the agent takes about three seconds to open one (it starts a
   * helper for each), which the person would otherwise wait for at every new chat. `lastSpec` is what chats open.
   */
  private spare: {key: string; live: Live; session: Promise<string>} | null = null;
  private lastSpec: AntigravitySpec | undefined;
  constructor(root: string, engine: AntigravityEngine) { this.root = root; this.engine = engine; this.home = join(root, 'home'); }
  private workspace() { return join(this.root, 'workspace'); }
  /** The agent unpacks itself (about 1 GB) into its temporary folder at each start, members up to 120 characters deep: the
   *  folder is short, so Windows' 260-character limit holds, and it is this account's own, so a leftover can be cleared. */
  private temp() { return join(tmpdir(), 'clem-agy', createHash('sha256').update(this.root).digest('hex').slice(0, 10)); }
  /** Only what Windows and the agent need: an API key or Google Cloud setting in the environment would bypass the plan. */
  private env(harness: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'ProgramData', 'ProgramFiles', 'COMSPEC', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS']) if (process.env[key]) env[key] = process.env[key];
    // The agent opens its sign-in page with Python's webbrowser, which runs BROWSER: Clem's helper hands the address
    // back on stderr instead, so Clem opens it (a check that just reads the status never opens a browser at all).
    const helper = `process.stderr.write("${URL_MARKER}"+JSON.stringify(process.argv[1])+"\\n",()=>process.exit(0))`;
    const quote = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
    return {...env, GEMINI_HOME: this.home, AGY_ACP_FORCE_FILE_STORAGE: '1', ANTIGRAVITY_HARNESS_PATH: harness, PYTHONUNBUFFERED: '1', NO_COLOR: '1',
      BROWSER: [process.execPath.replace(/\\/g, '/'), '-e', helper, '--', '%s'].map(quote).join(' '), ELECTRON_RUN_AS_NODE: '1', TEMP: this.temp(), TMP: this.temp()};
  }
  // Test seam: tests swap this for a fake agent.
  async start(server: string, env: NodeJS.ProcessEnv, cwd: string) { return spawn(server, [], {cwd, env, shell: false, windowsHide: true, stdio: 'pipe'}); }
  /** Starts the agent and signs it in. `login`: Google's sign-in page may open (the person asked to sign in). */
  private async open(login?: (url: string) => void): Promise<Live> {
    const install = this.engine.installed();
    if (!install) throw Error('Install Gemini first (Settings → Models).');
    const acpDir = join(this.home, 'antigravity-acp');
    await mkdir(acpDir, {recursive: true});
    await mkdir(this.workspace(), {recursive: true});
    // Only Google's own sign-in, chosen in its settings; never a hook or MCP server of another app's (this home is Clem's own).
    await writeFile(join(acpDir, 'settings.json'), JSON.stringify({auth: {type: 'oauth-personal'}}) + '\n');
    await Promise.all(['hooks.json', 'mcp_config.json', 'skills'].map((name) => rm(join(this.home, 'config', name), {recursive: true, force: true}).catch(() => {})));
    // No agent of this account runs now: whatever an earlier one left in its temporary folder can go.
    await rm(this.temp(), {recursive: true, force: true}).catch(() => {});
    await mkdir(this.temp(), {recursive: true});
    let child: ChildProcessWithoutNullStreams;
    try { child = await this.start(install.server, this.env(install.harness), this.workspace()); }
    catch { throw Error('Gemini could not start. Install it again in Settings → Models.'); }
    const acp = new AcpConnection(child);
    const live: Live = {acp, child, sessions: new Map(), opened: 0};
    this.processes.add(live);
    child.on('close', () => this.processes.delete(live));
    let pageShown = false, failSignIn: (error: Error) => void = () => {};
    const signIn = new Promise<never>((_, reject) => { failSignIn = reject; });
    signIn.catch(() => {});
    let pending = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (part: string) => {
      pending = (pending + part).slice(-40000);
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        const found = line.startsWith(URL_MARKER) ? (() => { try { return String(JSON.parse(line.slice(URL_MARKER.length))); } catch { return ''; } })() : line.startsWith(URL_PRINTED) ? line.slice(URL_PRINTED.length) : '';
        const url = found && googleSignInUrl(found);
        if (!url) continue;
        // Signed out: a status check stops here rather than wait on a sign-in nobody asked for.
        if (!login) { failSignIn(new SignedOut('Sign in to Gemini first (Settings → Models).')); continue; }
        if (!pageShown) { pageShown = true; login(url); }
      }
    });
    acp.onRequest = (method, params) => this.answerAgent(live, method, params);
    acp.onNotification = (method, params) => { if (method === 'session/update') this.update(params); };
    acp.onActivity = () => { for (const run of this.active.values()) run.touch(); };
    acp.onClose = () => {
      if (this.probe?.live === live) this.probe = null;
      if (this.spare?.live === live) this.spare = null;
      for (const held of live.sessions.values()) held.endpoint?.close();
      // Once its harness has let go of the files too.
      setTimeout(() => void this.sweep(), 2000).unref?.();
    };
    try {
      // The first start unpacks the agent, which can take a while on a slow disk.
      const init = await Promise.race([acp.request('initialize', {protocolVersion: 1, clientCapabilities: {fs: {readTextFile: false, writeTextFile: false}, terminal: false}, clientInfo: {name: 'clem', title: 'Clem', version: '1'}}, 180_000), signIn]);
      live.version = typeof init?.agentInfo?.version === 'string' ? init.agentInfo.version : undefined;
      const auth = await Promise.race([acp.request('authenticate', {methodId: 'oauth-personal'}, login ? 15 * 60_000 : 90_000), signIn]);
      live.tier = antigravityTier(auth);
      return live;
    } catch (error) {
      this.kill(live);
      if (error instanceof SignedOut || (error instanceof AcpError && (error.code === -32000 || signedOut.test(error.message)))) throw new SignedOut(login ? 'Google sign-in did not finish. Try again.' : 'Sign in to Gemini first (Settings → Models).');
      if (error instanceof AcpClosed) throw Error('Gemini could not start. Install it again in Settings → Models.');
      throw error;
    }
  }
  /** The running, signed-in agent; one is started when none runs. */
  private ready(): Promise<Live> {
    // One agent per account at a time (they would share its folders): none starts while a sign-in waits for the person.
    if (!this.live && this.loginChild) return Promise.reject(new SignedOut('Finish signing in to Google in your browser.'));
    if (!this.live) {
      const opening = this.open();
      this.live = opening;
      opening.then((live) => { live.child.on('close', () => { if (this.live === opening) this.live = null; }); this.rest(live); }, () => { if (this.live === opening) this.live = null; });
    }
    return this.live;
  }
  /** An idle agent is closed after a while (and sooner once it holds many sessions). */
  private rest(live: Live) {
    clearTimeout(live.idle);
    if (this.active.size) return;
    live.idle = setTimeout(() => { if (!this.active.size) this.kill(live); }, live.opened >= PROCESS_SESSIONS ? 5_000 : PROCESS_IDLE);
    live.idle.unref?.();
  }
  /** Ends the agent with everything it started (its harness and helpers), which a plain kill would leave running. */
  private kill(live: Live) {
    clearTimeout(live.idle);
    if (live.child.pid) spawn('taskkill.exe', ['/PID', String(live.child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'}).on('error', () => live.child.kill());
    else live.child.kill();
  }
  /** Removes the files of the sessions Clem is done with, once no running process holds them (Windows keeps them locked). */
  private async sweep() {
    if (!this.dropped.size) return;
    const live = this.live ? await this.live.catch(() => null) : null;
    const held = live && !live.acp.closed ? live.sessions : new Map();
    const ids = [...this.dropped].filter((id) => !held.has(id));
    for (const id of ids) this.dropped.delete(id);
    if (!ids.length) return;
    for (const folder of ['conversations', 'brain']) {
      const base = join(this.home, 'antigravity-acp', folder);
      for (const entry of await readdir(base).catch(() => [] as string[])) if (ids.some((id) => entry.includes(id))) await rm(join(base, entry), {recursive: true, force: true}).catch(() => {});
    }
  }
  /** The agent's own requests: its permission questions are answered by the answer's rules, and nothing else is offered. */
  private async answerAgent(live: Live, method: string, params: any) {
    if (method !== 'session/request_permission') throw Object.assign(Error('Not supported'), {code: -32601});
    const call = params?.toolCall || {}, options: any[] = Array.isArray(params?.options) ? params.options : [];
    const pick = (kind: string) => options.find((o) => o?.kind === kind && typeof o.optionId === 'string')?.optionId;
    const reject = () => { const id = pick('reject_once'); return id ? {outcome: {outcome: 'selected', optionId: id}} : {outcome: {outcome: 'cancelled'}}; };
    // A question for the person (trust a folder's hooks, pick an option): Clem never trusts, and nobody is asked mid-answer.
    if (String(call.toolCallId || '').startsWith('interaction_')) return reject();
    const session = live.sessions.get(String(params?.sessionId || ''));
    const mcp = call?._meta?.mcp;
    const kinetra = !!mcp && String(mcp.server || '') === SERVER_NAME || /kinetra/i.test(String(call.title || ''));
    const paths = (Array.isArray(call.locations) ? call.locations : []).map((l: any) => String(l?.path || '')).filter(Boolean);
    let allowed = false;
    if (kinetra) allowed = true;
    else if (['read', 'search', 'fetch', 'think'].includes(call.kind)) allowed = true;
    // Writing only in a working folder of the person's files, and only inside it.
    else if (['edit', 'delete', 'move'].includes(call.kind)) allowed = !!session?.folder && paths.length > 0 && paths.every((p: string) => inside(session.cwd, p));
    if (!allowed) return reject();
    const id = pick('allow_once') || pick('allow_always');
    return id ? {outcome: {outcome: 'selected', optionId: id}} : {outcome: {outcome: 'cancelled'}};
  }
  /** One session/update: passed to the answer that owns the session. */
  private update(params: any) {
    const session = String(params?.sessionId || '');
    for (const run of this.active.values()) if (run.session === session) { run.touch(); run.text('', params?.update); }
  }
  /** The last check while it is recent: each step of a tool loop reuses it instead of starting the agent's checks again. */
  private recentStatus() { return this.statusCache && Date.now() - this.statusCache.at < 10 * 60_000 ? this.statusCache.value : undefined; }
  /** The last check an answer may start on without waiting (up to a day old), checked again once the answer is done. */
  private knownStatus() { return this.statusCache && Date.now() - this.statusCache.at < 24 * 60 * 60_000 ? this.statusCache.value : undefined; }
  private recheck() { if (this.statusCache && !this.recentStatus()) void this.status(true).catch(() => {}); }
  /** Gets this account ready for a message: the agent is started (it takes a few seconds) and its sign-in checked. */
  prepare(ahead = false, spec?: AntigravitySpec) {
    if (spec) this.lastSpec = spec;
    const check = ahead ? !this.recentStatus() : !this.knownStatus();
    const started = check ? this.status() : this.engine.installed() ? this.ready() : undefined;
    // Once the agent runs (signed in), the next message's session is opened ahead.
    void started?.then(() => { if (this.statusCache?.value.connected !== false && this.lastSpec) this.fillSpare(this.lastSpec); }).catch(() => {});
  }
  /** The rules a session is opened with (its system-prompt addition), and its tools. */
  private meta(spec: AntigravitySpec, endpoint: boolean) {
    const rules = spec.system ? spec.system + '\n\n' + (spec.folder ? ANTIGRAVITY_FOLDER_NOTE : ANTIGRAVITY_NOTE) : undefined;
    return {antigravity: {...(rules ? {systemPrompt: {append: (endpoint ? ANTIGRAVITY_NATIVE_NOTE : '') + rules}} : {}), enabledTools: spec.folder ? ANTIGRAVITY_FOLDER_TOOLS : ANTIGRAVITY_TOOLS, ...(endpoint ? {eagerMcpServers: [SERVER_NAME], mcpMaxOutputBytes: ANTIGRAVITY_MAX_OUTPUT_BYTES} : {})}};
  }
  /** A held session's Kinetra endpoint: each call goes to the answer running on the session now. */
  private endpointFor(held: Held) {
    return kinetraMcp.open((request) => {
      const route = held.route;
      if (!route) return Promise.reject(Error('No answer is running in this conversation.'));
      return keepingAlive(() => inlinePictures(route.native, (path) => readFile(path))(request), () => this.active.get(route.id)?.touch());
    });
  }
  /** Opens (session/new) or reopens (session/resume) a session in this process, with its own Kinetra endpoint when it uses tools. */
  private async openSession(live: Live, spec: AntigravitySpec, resume?: string): Promise<string> {
    await mkdir(spec.cwd, {recursive: true});
    const held: Held = {cwd: spec.cwd, folder: spec.folder};
    if (spec.native) held.endpoint = await this.endpointFor(held);
    const mcpServers = held.endpoint ? [{type: 'http', name: SERVER_NAME, url: held.endpoint.url, headers: [{name: 'Authorization', value: `Bearer ${held.endpoint.token}`}]}] : [];
    try {
      let id = resume;
      if (resume) await live.acp.request('session/resume', {sessionId: resume, cwd: spec.cwd, mcpServers, _meta: this.meta(spec, !!held.endpoint)}, 120_000);
      else id = String((await live.acp.request('session/new', {cwd: spec.cwd, mcpServers, _meta: this.meta(spec, !!held.endpoint)}, 120_000))?.sessionId || '');
      if (!id) throw Error('Gemini could not start a conversation.');
      live.sessions.get(id)?.endpoint?.close();
      live.sessions.set(id, held);
      if (!resume) live.opened++;
      return id;
    } catch (error) { held.endpoint?.close(); throw error; }
  }
  /** Opens the next chat message's session ahead, unless one like it is ready (or opening) in the running agent. */
  private fillSpare(spec: AntigravitySpec) {
    const key = specKey(spec);
    void this.ready().then((live) => {
      if (live.acp.closed || this.spare?.live === live && this.spare.key === key) return;
      // A spare opened for other rules (or in an agent that has since closed) is not used.
      const old = this.spare;
      if (old) void old.session.then((id) => { this.dropped.add(id); this.release(id); }, () => {});
      const session = this.openSession(live, spec);
      const spare = {key, live, session};
      this.spare = spare;
      session.then(() => this.rest(live), () => { if (this.spare === spare) this.spare = null; });
    }).catch(() => {});
  }
  /** The spare session, when it was opened with these rules in this agent; the next one is opened at once. */
  private async takeSpare(live: Live, spec: AntigravitySpec) {
    const spare = this.spare;
    if (!spare || spare.live !== live || spare.key !== specKey(spec) || live.acp.closed) return undefined;
    this.spare = null;
    const id = await spare.session.catch(() => undefined);
    return id && live.sessions.has(id) ? id : undefined;
  }
  /** A session Clem is done with: its endpoint closes (the agent keeps the session itself until it closes). */
  private release(agentSession: string) {
    void this.live?.then((live) => { const held = live.sessions.get(agentSession); if (held) { held.endpoint?.close(); held.endpoint = undefined; held.route = undefined; held.ended = true; } }, () => {});
  }
  private statusRequest: Promise<AntigravityStatus> | null = null;
  /** One check at a time: callers that arrive while one runs share it. */
  async status(force = false): Promise<AntigravityStatus> {
    if (!force && !this.usageStale && this.statusCache && Date.now() - this.statusCache.at < 30000) return this.statusCache.value;
    this.statusRequest ??= this.readStatus(force).finally(() => { this.statusRequest = null; });
    return this.statusRequest;
  }
  private async readStatus(force: boolean): Promise<AntigravityStatus> {
    this.usageStale = false;
    const install = this.engine.installed();
    let value: AntigravityStatus;
    if (!install) value = {installed: false, connected: false, models: []};
    else {
      try {
        const live = await this.ready();
        const before = this.statusCache?.value;
        // The model list is read again every few minutes (and on Refresh); the plan's usage at every check.
        const listAgain = force && Date.now() - this.modelsAt > 60_000 || Date.now() - this.modelsAt > 5 * 60_000 || !before?.connected || !before.models.length;
        const models = listAgain ? await this.listModels(live) : {models: before!.models, defaultModel: before!.defaultModel, efforts: before!.efforts, tier: before!.plan};
        const report = await this.usageReport(live).catch(() => undefined);
        const usage = report ? antigravityUsage(report.quotas) : before?.usage;
        value = {installed: true, connected: models.models.length > 0, models: models.models, defaultModel: models.defaultModel, ...(models.efforts && Object.keys(models.efforts).length ? {efforts: models.efforts} : {}), ...(models.tier || live.tier ? {plan: models.tier || live.tier} : {}), ...(usage ? {usage} : {}), ...(live.version ? {version: live.version} : {}), ...(models.models.length ? {} : {error: 'Gemini lists no models for this Google account.'})};
      } catch (error) {
        value = {installed: true, connected: false, models: [], ...(error instanceof SignedOut ? {} : {error: friendly((error as Error).message || '')})};
      }
    }
    this.statusCache = {at: Date.now(), value};
    return value;
  }
  /** The account's models and each one's thinking levels, from a session that is never prompted. */
  private async listModels(live: Live) {
    const cwd = join(this.root, 'probe');
    await mkdir(cwd, {recursive: true});
    const setup = await live.acp.request('session/new', {cwd, mcpServers: [], _meta: {antigravity: {enabledTools: []}}}, 120_000);
    const session = String(setup?.sessionId || '');
    live.sessions.set(session, {cwd, folder: false});
    live.opened++;
    this.dropped.add(session);
    const {models, current} = parseAntigravityModels(setup);
    const efforts: AntigravityEfforts = {};
    // Thinking levels belong to the selected model: each model is selected in turn and its levels read.
    let options = setup?.configOptions;
    for (const model of models) {
      if (model.id !== current) options = (await live.acp.request('session/set_config_option', {sessionId: session, configId: 'model', value: model.id}, 30_000).catch(() => null))?.configOptions;
      if (!options) continue;
      const {levels, current: level} = parseAntigravityLevels(options);
      if (levels.length) efforts[model.id] = {levels, default: level};
    }
    this.modelsAt = Date.now();
    this.probe = {session, live};
    return {models, defaultModel: current, efforts, tier: antigravityTier(setup)};
  }
  /** The agent's own /usage report, which its server answers itself (no model call, no usage spent). */
  private async usageReport(live: Live, session?: string) {
    if (!session) {
      if (this.probe?.live !== live) await this.listModels(live);
      session = this.probe!.session;
    }
    let text = '';
    const id = 'usage-' + randomUUID();
    this.active.set(id, {session, touch: () => {}, text: (_, update) => { if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') text += update.content.text || ''; }});
    try { await live.acp.request('session/prompt', {sessionId: session, prompt: [{type: 'text', text: '/usage'}]}, 60_000); }
    finally { this.active.delete(id); this.rest(live); }
    return parseUsageReport(text);
  }
  async usage() { return (await this.status()).usage; }
  forget() { this.statusCache = null; this.modelsAt = 0; }
  /** Opens Google's sign-in page in the browser; the agent finishes the sign-in itself when the person is done. */
  async login(openUrl: (url: string) => void) {
    if (!this.engine.installed()) throw Error('Install Gemini first (Settings → Models).');
    if (this.busy) throw Error('Finish or stop the answer using this account first.');
    // A sign-in replaces whatever runs for this account (a signed-out agent, or an earlier sign-in still waiting).
    for (const live of this.processes) this.kill(live);
    this.live = null; this.loginChild = null; this.probe = null;
    const opening = this.open(openUrl);
    this.loginChild = opening;
    this.statusCache = null;
    opening.then((live) => {
      if (this.loginChild !== opening) { this.kill(live); return; }
      this.loginChild = null; this.live = opening; this.statusCache = null; this.modelsAt = 0;
      live.child.on('close', () => { if (this.live === opening) this.live = null; });
      this.rest(live);
    }, () => { if (this.loginChild === opening) this.loginChild = null; this.statusCache = null; });
    return {started: true};
  }
  /** Signs this account out with the agent's own logout, which clears its stored Google sign-in. */
  async logout() {
    this.statusCache = null;
    const live = await (this.live || this.open().catch(() => null));
    if (!live) { await rm(join(this.home, 'antigravity-acp', 'acp_token.json'), {force: true}).catch(() => {}); return; }
    await live.acp.request('logout', {}, 60_000).catch(() => {});
    this.live = null; this.probe = null;
    this.kill(live);
  }
  /**
   * One answer step. Pictures go as images, the conversation's PDFs as files the agent opens itself (saved in its
   * folder, attached once per session), `system` as the agent's own system-prompt addition, and `native` (Kinetra's
   * tool calls for this reply) as an MCP server of the session, so a Kinetra request never ends the agent's turn.
   * `session`: Clem's id for the session that carries a tool loop (and a chat's later messages).
   */
  async run(id: string, prompt: string, model: string, emit: (event: any) => void, images: string[] = [], session?: {id: string; resume: boolean}, effort?: string, {system, pdfs = [], workspace, native}: {system?: string; pdfs?: {name: string; data: Uint8Array}[]; workspace?: {root: string}; native?: AntigravityNative} = {}) {
    const slug = model.slice(ANTIGRAVITY_PREFIX.length);
    let status = this.knownStatus() || await this.status();
    if (!status.connected || !status.models.some((m) => m.id === slug)) status = await this.status(true);
    if (!status.installed) throw Error('Install Gemini first (Settings → Models).');
    if (!status.connected) throw Error(status.error || 'Sign in to Gemini first (Settings → Models).');
    if (!status.models.some((m) => m.id === slug)) throw Error('This Gemini model is not available on your plan. Pick another one.');
    if (effort && !status.efforts?.[slug]?.levels.includes(effort)) effort = undefined;
    const cwd = workspace?.root || this.workspace();
    await mkdir(cwd, {recursive: true});
    let live: Live;
    try { live = await this.ready(); } catch (error) { this.statusCache = null; throw error instanceof SignedOut ? Error('Sign in to Gemini again in Settings → Models.') : error; }
    clearTimeout(live.idle);
    const spec: AntigravitySpec = {cwd, system, folder: !!workspace, native: !!native};
    let agentSession: string | undefined;
    let held: Held | undefined;
    const counter = new StepCounter();
    let stepKey = randomUUID(), fresh = true, segment = '', last = '', said = '', timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectIdle: (error: Error) => void = () => {};
    const idle = new Promise<never>((_, reject) => { rejectIdle = reject; });
    idle.catch(() => {});
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; if (agentSession) live.acp.notify('session/cancel', {sessionId: agentSession}); rejectIdle(Error('Gemini took too long to respond.')); }, ANTIGRAVITY_IDLE_LIMIT); };
    const read = (_: string, update: any) => {
      switch (update?.sessionUpdate) {
        case 'agent_message_chunk': {
          const piece = update.content?.type === 'text' ? String(update.content.text || '') : '';
          if (!piece) return;
          segment += piece;
          emit({id, type: 'partial', text: piece, fresh});
          // The answer itself shows as it is written: no status line under it.
          if (fresh && segment.trim()) emit({id, type: 'status', text: ''});
          fresh = false;
          return;
        }
        case 'agent_thought_chunk': emit({id, type: 'status', text: 'Thinking it through…'}); return;
        case 'tool_call': {
          // Text before a tool call was a note on the work; the reply is what the agent writes after its last tool.
          if (segment.trim()) last = segment;
          segment = ''; fresh = true;
          counter.add(stepKey, String(update.toolCallId || randomUUID()));
          const text = antigravityToolStatus(update);
          if (text && text !== said) { said = text; emit({id, type: 'status', text}); }
          return;
        }
        case 'tool_call_update': if (update.status === 'completed' || update.status === 'failed') stepKey = randomUUID(); return;
        case 'usage_update': if (typeof update.used === 'number') emit({id, type: 'context', tokens: update.used}); return;
      }
    };
    this.active.set(id, {touch, text: read});
    const turnPdfs = join(cwd, '.pdfs-' + id);
    try {
      // A kept session goes on in the process that holds it, with the Kinetra endpoint it was opened with; after a restart
      // (or when it was opened without the tool) it is resumed from the agent's own files. A session the agent no longer
      // has starts again with everything (SessionLost).
      if (session?.resume) {
        agentSession = this.agentIds.get(session.id);
        if (!agentSession) throw new SessionLost('Gemini no longer has this session.');
        const there = live.sessions.get(agentSession);
        if (!there || there.ended || (native && !there.endpoint) || there.cwd !== cwd) {
          try { await this.openSession(live, spec, agentSession); }
          catch (error) { if (error instanceof AcpClosed) throw new Transient('Gemini stopped.'); throw new SessionLost('Gemini no longer has this session.'); }
        }
      } else {
        // A new chat message takes the session opened ahead for it, and the next one is opened meanwhile.
        agentSession = await this.takeSpare(live, spec);
        if (!agentSession) {
          try { agentSession = await this.openSession(live, spec); }
          catch (error) { if (error instanceof AcpClosed) throw new Transient('Gemini stopped.'); throw error; }
        }
        if (session) this.agentIds.set(session.id, agentSession); else this.dropped.add(agentSession);
      }
      held = live.sessions.get(agentSession)!;
      held.route = native ? {id, native} : undefined;
      this.active.get(id)!.session = agentSession;
      try {
        const chosen = await live.acp.request('session/set_config_option', {sessionId: agentSession, configId: 'model', value: slug}, 30_000);
        if (effort && parseAntigravityLevels(chosen?.configOptions).levels.includes(effort)) await live.acp.request('session/set_config_option', {sessionId: agentSession, configId: 'thinking_level', value: effort}, 30_000).catch(() => {});
      } catch (error) {
        if (error instanceof AcpClosed) throw new Transient('Gemini stopped.');
        throw Error('This Gemini model is not available on your plan. Pick another one.');
      }
      const blocks: any[] = [{type: 'text', text: prompt}];
      for (const path of images) blocks.push({type: 'image', mimeType: MIME[extname(path).toLowerCase()] || 'image/png', data: (await readFile(path)).toString('base64')});
      if (pdfs.length) {
        await mkdir(turnPdfs, {recursive: true});
        const seen = this.attached.get(agentSession) || new Set<string>();
        this.attached.set(agentSession, seen);
        for (const [index, pdf] of pdfs.entries()) {
          const path = join(cwd, antigravityPdfPath(id, index, pdf.name));
          await stat(path).catch(() => writeFile(path, pdf.data));
          const key = pdf.name + ':' + pdf.data.length;
          if (seen.has(key)) continue;
          seen.add(key);
          blocks.push({type: 'resource_link', uri: pathToFileURL(path).href, name: pdf.name, mimeType: 'application/pdf'});
        }
      }
      touch();
      let result: any;
      try { result = await Promise.race([live.acp.request('session/prompt', {sessionId: agentSession, prompt: blocks}), idle]); }
      catch (error) {
        if (timedOut) throw error;
        if (error instanceof AcpClosed) throw new Transient('Gemini stopped.');
        if (error instanceof AcpError && (error.code === -32000 || signedOut.test(error.message))) { this.statusCache = null; throw Error('Sign in to Gemini again in Settings → Models.'); }
        if (error instanceof AcpError && session?.resume && /session not found/i.test(error.message)) throw new SessionLost('Gemini no longer has this session.');
        throw Error(friendly((error as Error).message || ''));
      }
      if (counter.calls) emit({id, type: 'toolsteps', steps: counter.steps, calls: counter.calls});
      if (result?.stopReason === 'cancelled') throw Error('Request cancelled');
      const reply = segment.trim() ? segment : last;
      const problem = replyProblem(reply);
      if (problem?.kind === 'limit') throw new UsageLimit(problem.message, problem.resetsAt);
      if (problem?.kind === 'transient') throw new Transient(problem.message);
      if (problem?.kind === 'signed-out') { this.statusCache = null; throw Error(problem.message); }
      if (problem) throw Error(problem.message);
      if (result?.stopReason === 'refusal') throw Error('Gemini declined this request.');
      if (!reply.trim()) throw Error('Gemini could not complete this request. Check Gemini in Settings → Models.');
      this.usageStale = true;
      emit({id, type: 'delta', text: reply}); emit({id, type: 'done'});
    } finally {
      clearTimeout(timer);
      this.active.delete(id);
      if (held?.route?.id === id) held.route = undefined;
      // A session nothing keeps (a side job's, a tool loop's first try) closes its endpoint now.
      if (agentSession && this.dropped.has(agentSession)) this.release(agentSession);
      // The next chat message's session is opened once this answer is done (not beside it).
      if (native && workspace && !live.acp.closed) { this.lastSpec = spec; this.fillSpare(spec); }
      this.rest(live);
      this.recheck();
    }
  }
  /** Removes a turn's PDFs from the working folder once its answer is done. */
  async dropPdfs(turn: string) { if (/^[0-9a-f-]{36}$/i.test(turn)) await rm(join(this.workspace(), '.pdfs-' + turn), {recursive: true, force: true}).catch(() => {}); }
  /**
   * The tokens a session has used so far, from the agent's own /usage report on it (its prompt count includes the cached
   * part); undefined when the session is not running. The same report refreshes the plan's usage.
   */
  async sessionTokens(sessionId: string): Promise<{input: number; cacheRead: number; cacheWrite: number; output: number} | undefined> {
    const agent = this.agentIds.get(sessionId);
    const live = this.live && await this.live.catch(() => null);
    if (!agent || !live || !live.sessions.has(agent)) return undefined;
    const report = await this.usageReport(live, agent).catch(() => undefined);
    if (report?.quotas.length && this.statusCache) this.statusCache.value = {...this.statusCache.value, usage: antigravityUsage(report.quotas)};
    const t = report?.tokens;
    if (!t) return undefined;
    return {input: Math.max(0, t.prompt - t.cached), cacheRead: t.cached, cacheWrite: 0, output: t.completion + t.thinking};
  }
  /** A session Clem is done with: its files go once no process holds it. */
  async endSession(sessionId: string) {
    const agent = this.agentIds.get(sessionId);
    if (!agent || process.env.CLEM_KEEP_SESSIONS) return;
    this.agentIds.delete(sessionId);
    this.attached.delete(agent);
    this.dropped.add(agent);
    this.release(agent);
    await this.sweep();
  }
  /** Whether a request is running on this account (an account is never switched or removed mid-answer). */
  get busy() { return [...this.active.keys()].some((id) => !id.startsWith('usage-')); }
  cancel(id: string) {
    const run = this.active.get(id);
    if (run?.session) void this.live?.then((live) => live.acp.notify('session/cancel', {sessionId: run.session}), () => {});
  }
  stop() {
    for (const live of this.processes) this.kill(live);
    this.live = null; this.loginChild = null; this.probe = null;
  }
}
