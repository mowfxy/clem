import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AntigravityProvider, antigravityModels, antigravityUsage, googleSignInUrl, parseAntigravityLevels, parseAntigravityModels, parseUsageReport, replyProblem, ANTIGRAVITY_TOOLS, ANTIGRAVITY_FOLDER_TOOLS} from '../desktop/antigravity.ts';
import {AntigravityEngine, antigravityRelease} from '../desktop/antigravity-engine.ts';
import {UsageLimit} from '../desktop/kinetra-turn.ts';

const fixture = join(import.meta.dirname, 'fixtures', 'fake-antigravity.mjs');
// Runs the fake agent (tests/fixtures/fake-antigravity.mjs) through node instead of Google's agy_acp_server.exe.
class FakeAgent extends AntigravityProvider {
  mode: string;
  constructor(mode = 'ok') { const root = mkdtempSync(join(tmpdir(), 'agy-')); super(root, new AntigravityEngine(root, fixture)); this.mode = mode; }
  async start(_server: string, env: NodeJS.ProcessEnv, cwd: string) { return spawn(process.execPath, [fixture], {cwd, env: {...env, FAKE_AGY: this.mode, ELECTRON_RUN_AS_NODE: ''}, stdio: 'pipe'}) as any; }
  async prompts() { return (await (this as any).live).acp.request('_test/prompts', {}); }
}
const answer = async (p: AntigravityProvider, prompt: string, model = 'antigravity:gemini-3.1-pro', extra: {session?: {id: string; resume: boolean}; effort?: string; options?: any; images?: string[]} = {}) => {
  const events: any[] = [];
  await p.run('11111111-1111-4111-8111-111111111111', prompt, model, (e) => events.push(e), extra.images, extra.session, extra.effort, extra.options);
  return events;
};

test('Google’s release is taken from the ACP registry only when it is Google’s own Windows download', () => {
  const manifest = {id: 'antigravity-acp', version: '1.4.1', distribution: {binary: {'windows-x86_64': {archive: 'https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.4.1-windows-x86_64.zip'}, 'windows-aarch64': {archive: 'https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.4.1-windows-arm64.zip'}}}};
  assert.deepEqual(antigravityRelease(manifest, 'x64'), {version: '1.4.1', url: manifest.distribution.binary['windows-x86_64'].archive});
  assert.equal(antigravityRelease(manifest, 'arm64')?.version, '1.4.1');
  // Another host, another version than listed, another agent: nothing is downloaded.
  assert.equal(antigravityRelease({...manifest, distribution: {binary: {'windows-x86_64': {archive: 'https://example.com/agy-acp-server-1.4.1-windows-x86_64.zip'}}}}, 'x64'), null);
  assert.equal(antigravityRelease({...manifest, version: '1.5.0'}, 'x64'), null);
  assert.equal(antigravityRelease({...manifest, id: 'other'}, 'x64'), null);
});

test('models, thinking levels, plan usage and failed turns are read from the agent’s own formats', () => {
  const setup = {configOptions: [{id: 'model', category: 'model', type: 'select', currentValue: 'gemini-3.1-pro', options: [{value: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro'}, {group: 'Other', options: [{value: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6'}]}]}]};
  assert.deepEqual(parseAntigravityModels(setup), {models: [{id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro'}, {id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6'}], current: 'gemini-3.1-pro'});
  assert.deepEqual(parseAntigravityModels({models: {currentModelId: 'a', availableModels: [{modelId: 'a', name: 'A'}]}}), {models: [{id: 'a', name: 'A'}], current: 'a'});
  assert.deepEqual(parseAntigravityLevels([{id: 'thinking_level', category: 'thought_level', type: 'select', currentValue: 'high', options: [{value: 'xhigh'}, {value: 'low'}, {value: 'high'}]}]), {levels: ['low', 'high', 'xhigh'], current: 'high'});
  const listed = antigravityModels({models: [{id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6'}, {id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro'}], defaultModel: 'gemini-3.1-pro', efforts: {'gemini-3.1-pro': {levels: ['low', 'high'], default: 'high'}}});
  assert.deepEqual(listed.map((m) => [m.id, m.provider, m.defaultReasoningEffort]), [['antigravity:gemini-3.1-pro', 'Google', 'high'], ['antigravity:claude-sonnet-4-6', 'Google', '']]);
  const report = parseUsageReport('### Session Usage\n- **Session total:** 1,500 tokens (prompt: 1,200, completion: 200, thinking: 100, cached: 800)\n\n### Quota Limits\n- **Gemini Models**\n  - **5-hour Limit:** 80% remaining (resets Oct 02, 2026, 10:00 UTC)\n  - **Weekly Limit:** 91% remaining (resets Oct 05, 2026)\n- **Claude and GPT models**\n  - **Weekly Limit:** 100% remaining\n');
  assert.deepEqual(report.tokens, {prompt: 1200, completion: 200, thinking: 100, cached: 800, total: 1500});
  assert.equal(report.quotas.length, 3);
  assert.deepEqual(antigravityUsage(report.quotas), {rateLimits: {primary: {usedPercent: 20, windowDurationMins: 300, resetsAt: Date.UTC(2026, 9, 2, 10, 0) / 1000}, secondary: {usedPercent: 9, windowDurationMins: 10080, resetsAt: Date.UTC(2026, 9, 5) / 1000}}});
  assert.equal(replyProblem('Usage Limit Reached\n\nYou have reached your current quota for this period. Your quota resets in 2 hours.')?.kind, 'limit');
  assert.ok(replyProblem('Usage Limit Reached\n\nYour quota resets in 2 hours.')!.resetsAt! > Date.now() + 7_000_000);
  assert.equal(replyProblem('Agent execution error: 503 UNAVAILABLE')?.kind, 'transient');
  assert.equal(replyProblem('Agent connection was lost and could not be re-established: x')?.kind, 'transient');
  assert.equal(replyProblem('Here is your answer.'), null);
  // Only Google's own sign-in page, returning to this PC, is ever opened.
  assert.ok(googleSignInUrl('https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A57464%2F&state=s'));
  assert.equal(googleSignInUrl('https://accounts.google.com.evil.example/o/oauth2/v2/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A57464%2F'), null);
  assert.equal(googleSignInUrl('https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fexample.com%2F'), null);
});

test('status: signed in with the account’s models, thinking levels, plan and usage', async () => {
  const p = new FakeAgent('ok');
  try {
    const s = await p.status(true);
    assert.equal(s.installed, true); assert.equal(s.connected, true);
    assert.deepEqual(s.models.map((m) => m.id), ['gemini-3.1-pro', 'gemini-3.5-flash', 'claude-sonnet-4-6']);
    assert.equal(s.defaultModel, 'gemini-3.1-pro');
    assert.deepEqual(s.efforts, {'gemini-3.1-pro': {levels: ['low', 'high'], default: 'high'}, 'gemini-3.5-flash': {levels: ['low', 'high'], default: 'high'}});
    assert.equal(s.plan, 'Google AI Pro');
    assert.equal(s.usage?.rateLimits?.primary?.usedPercent, 20);
  } finally { p.stop(); }
});

test('signed out: the check says so at once and never opens a sign-in page', async () => {
  const p = new FakeAgent('signed-out');
  try {
    const s = await p.status(true);
    assert.equal(s.installed, true); assert.equal(s.connected, false); assert.equal(s.error, undefined);
    let opened = '';
    await p.login((url) => { opened = url; });
    for (let i = 0; i < 100 && !opened; i++) await new Promise((r) => setTimeout(r, 50));
    assert.match(opened, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  } finally { p.stop(); }
});

test('not installed: the status says so', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-'));
  const p = new AntigravityProvider(root, new AntigravityEngine(root, join(root, 'missing.exe')));
  assert.deepEqual(await p.status(true), {installed: false, connected: false, models: []});
});

test('an answer streams, picks the model and thinking level, and carries Mowr’s rules and tool list', async () => {
  const p = new FakeAgent('ok');
  try {
    const events = await answer(p, 'Hi', 'antigravity:gemini-3.5-flash', {effort: 'low', options: {system: 'MOWR RULES'}});
    assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'Hello from gemini-3.5-flash at low.');
    assert.ok(events.some((e) => e.type === 'partial' && e.text === 'Hello ' && e.fresh));
    assert.ok(events.some((e) => e.type === 'status' && e.text === 'Thinking it through…'));
    assert.ok(events.some((e) => e.type === 'context' && e.tokens === 4321));
    assert.equal(events.at(-1).type, 'done');
    const [sent] = await p.prompts();
    assert.match(sent.system, /^MOWR RULES/);
    assert.deepEqual(sent.tools, ANTIGRAVITY_TOOLS);
    // A level the model does not list is left to the agent's default rather than failing the request.
    const other = await answer(p, 'Hi', 'antigravity:claude-sonnet-4-6', {effort: 'low'});
    assert.equal(other.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'Hello from claude-sonnet-4-6.');
    await assert.rejects(answer(p, 'Hi', 'antigravity:not-a-model'), /not available on your plan/);
  } finally { p.stop(); }
});

test('the reply is what the agent writes after its last tool, and tool steps are counted', async () => {
  const p = new FakeAgent('tools');
  try {
    const events = await answer(p, 'Read my notes');
    assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'Hello from gemini-3.1-pro.');
    assert.ok(events.some((e) => e.type === 'status' && /^Reading .*notes\.md…$/.test(e.text)));
    assert.deepEqual(events.find((e) => e.type === 'toolsteps'), {id: '11111111-1111-4111-8111-111111111111', type: 'toolsteps', steps: 1, calls: 1});
  } finally { p.stop(); }
});

test('permissions follow the answer’s rules: no writing outside the folder, no commands, never trusting a folder', async () => {
  const p = new FakeAgent('permission');
  try {
    const folder = mkdtempSync(join(tmpdir(), 'agy-work-'));
    const events = await answer(p, 'Edit', 'antigravity:gemini-3.1-pro', {options: {workspace: {root: folder}}});
    assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'outside=deny shell=deny web=allow trust=deny');
    assert.deepEqual((await p.prompts())[0].tools, ANTIGRAVITY_FOLDER_TOOLS);
  } finally { p.stop(); }
});

test('an exhausted plan is a usage limit, so Mowr can move to another account', async () => {
  const p = new FakeAgent('limit');
  try {
    await assert.rejects(answer(p, 'Hi'), (error: unknown) => error instanceof UsageLimit && !!(error as UsageLimit).resetsAt);
  } finally { p.stop(); }
});

test('a kept session goes on in the same agent session, and its tokens come from the agent’s /usage', async () => {
  const p = new FakeAgent('ok');
  try {
    await answer(p, 'First', 'antigravity:gemini-3.1-pro', {session: {id: 'chat-1', resume: false}});
    await answer(p, 'Second', 'antigravity:gemini-3.1-pro', {session: {id: 'chat-1', resume: true}});
    const sent = await p.prompts();
    assert.deepEqual(sent.map((x: any) => x.text), ['First', 'Second']);
    assert.deepEqual(await p.sessionTokens('chat-1'), {input: 400, cacheRead: 800, cacheWrite: 0, output: 300});
    // A session Mowr never started cannot be resumed: the loop resends everything instead.
    await assert.rejects(answer(p, 'Third', 'antigravity:gemini-3.1-pro', {session: {id: 'unknown', resume: true}}), /no longer has this session/);
  } finally { p.stop(); }
});

test('pictures go as images and PDFs as attached files, each PDF once per session', async () => {
  const p = new FakeAgent('ok');
  try {
    const dir = mkdtempSync(join(tmpdir(), 'agy-pic-'));
    const picture = join(dir, 'a.png');
    writeFileSync(picture, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const pdf = {name: 'Week 3.pdf', data: new Uint8Array([0x25, 0x50, 0x44, 0x46])};
    await answer(p, 'Look', 'antigravity:gemini-3.1-pro', {images: [picture], session: {id: 'chat-2', resume: false}, options: {pdfs: [pdf]}});
    await answer(p, 'Again', 'antigravity:gemini-3.1-pro', {session: {id: 'chat-2', resume: true}, options: {pdfs: [pdf]}});
    const [first, second] = await p.prompts();
    assert.deepEqual(first.blocks.map((b: any) => b.type), ['text', 'image', 'resource_link']);
    assert.equal(first.blocks[1].mimeType, 'image/png');
    assert.match(first.blocks[2].uri, /^file:\/\/.*Week%203\.pdf$/);
    assert.deepEqual(second.blocks.map((b: any) => b.type), ['text']);
  } finally { p.stop(); }
});

test('Kinetra is a native MCP tool of the session, reached over this answer’s own endpoint', async () => {
  const p = new FakeAgent('native');
  try {
    const calls: any[] = [];
    const events = await answer(p, 'Use Kinetra', 'antigravity:gemini-3.1-pro', {options: {native: async (request: any) => { calls.push(request); return {result: {guide: 'KINETRA GUIDE'}, pictures: []}; }}});
    assert.deepEqual(calls, [{action: 'help'}]);
    assert.match(events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), /KINETRA GUIDE/);
    assert.ok(events.some((e) => e.type === 'status' && /Kinetra/.test(e.text)));
  } finally { p.stop(); }
});
