// Stands in for Google's Antigravity agent (antigravity-acp) in tests, matching its wire format: ACP over stdin and
// stdout, its sign-in link printed to stderr, the model and thinking-level session settings, failed turns reported as
// message text, and the /usage report its server writes itself.
// FAKE_AGY = ok (default) | signed-out | limit | native | tools | permission
import {stdin, stdout, stderr, env, exit} from 'node:process';
const mode = env.FAKE_AGY || 'ok';
for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS']) if (env[key]) { stderr.write(`Clem must not pass ${key}\n`); exit(9); }
if (!env.GEMINI_HOME || !env.ANTIGRAVITY_HARNESS_PATH) { stderr.write('GEMINI_HOME and ANTIGRAVITY_HARNESS_PATH are needed\n'); exit(9); }
const send = (m) => stdout.write(JSON.stringify({jsonrpc: '2.0', ...m}) + '\n');
const update = (sessionId, u) => send({method: 'session/update', params: {sessionId, update: u}});
const say = (sessionId, text) => update(sessionId, {sessionUpdate: 'agent_message_chunk', content: {type: 'text', text}});
let nextOwn = 1000;
const waiting = new Map();
const ask = (method, params) => new Promise((resolve) => { const id = nextOwn++; waiting.set(id, resolve); send({id, method, params}); });
const sessions = new Map();
let n = 0;
const models = (current) => ({id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: current, options: [{value: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro'}, {value: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash'}, {value: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6'}]});
const levels = (model, current) => model === 'claude-sonnet-4-6' ? [] : [{id: 'thinking_level', name: 'Thinking', category: 'thought_level', type: 'select', currentValue: current || 'high', options: [{value: 'high', name: 'High'}, {value: 'low', name: 'Low'}]}];
const options = (s) => [models(s.model), ...levels(s.model, s.level)];
async function prompt(id, {sessionId, prompt: blocks}) {
  const s = sessions.get(sessionId);
  if (!s) return send({id, error: {code: -32002, message: 'Session not found'}});
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (text === '/usage') {
    say(sessionId, `### Session Usage\n- **Session total:** 1,500 tokens (prompt: 1,200, completion: 200, thinking: 100, cached: 800)\n\n### Quota Limits\n- **Gemini Models**\n  - **5-hour Limit:** 80% remaining (resets Oct 02, 2026, 10:00 UTC)\n  - **Weekly Limit:** 91% remaining (resets Oct 05, 2026)\n- **Claude and GPT models**\n  - **Weekly Limit:** 100% remaining\n`);
    return send({id, result: {stopReason: 'end_turn'}});
  }
  s.prompts.push({text, blocks, model: s.model, level: s.level, system: s.system, tools: s.tools});
  if (mode === 'limit') { say(sessionId, 'Usage Limit Reached\n\nYou have reached your current quota for this period. Your quota resets in 2 hours.'); return send({id, result: {stopReason: 'end_turn'}}); }
  update(sessionId, {sessionUpdate: 'agent_thought_chunk', content: {type: 'text', text: 'hmm'}});
  if (mode === 'tools' || mode === 'permission') {
    say(sessionId, 'I will look at the file first.');
    update(sessionId, {sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Viewing notes.md', kind: 'read', status: 'pending', rawInput: {AbsolutePath: s.cwd + '/notes.md'}});
    update(sessionId, {sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed'});
  }
  if (mode === 'permission') {
    const outside = await ask('session/request_permission', {sessionId, options: [{optionId: 'allow', name: 'Allow', kind: 'allow_once'}, {optionId: 'deny', name: 'Deny', kind: 'reject_once'}], toolCall: {toolCallId: 'e1', title: 'Edit', kind: 'edit', locations: [{path: 'C:/Windows/system.ini'}]}});
    const shell = await ask('session/request_permission', {sessionId, options: [{optionId: 'allow', name: 'Allow', kind: 'allow_once'}, {optionId: 'deny', name: 'Deny', kind: 'reject_once'}], toolCall: {toolCallId: 'x1', title: 'Run command', kind: 'execute'}});
    const web = await ask('session/request_permission', {sessionId, options: [{optionId: 'allow_always', name: 'Allow Always', kind: 'allow_always'}, {optionId: 'allow', name: 'Allow', kind: 'allow_once'}, {optionId: 'deny', name: 'Deny', kind: 'reject_once'}], toolCall: {toolCallId: 'w1', title: 'Search the web', kind: 'fetch'}});
    const trust = await ask('session/request_permission', {sessionId, options: [{optionId: 'trust', name: 'Trust Workspace', kind: 'allow_once'}, {optionId: 'deny', name: "Don't Trust", kind: 'reject_once'}], toolCall: {toolCallId: 'interaction_ab12', title: 'Trust?'}});
    const pick = (r) => r?.outcome?.optionId || r?.outcome?.outcome;
    say(sessionId, `outside=${pick(outside)} shell=${pick(shell)} web=${pick(web)} trust=${pick(trust)}`);
    return send({id, result: {stopReason: 'end_turn'}});
  }
  if (mode === 'native') {
    const server = s.mcp.find((m) => m.name === 'kinetra');
    const auth = server.headers.find((h) => h.name === 'Authorization').value;
    update(sessionId, {sessionUpdate: 'tool_call', toolCallId: 'k1', title: 'kinetra', kind: 'other', status: 'pending', rawInput: {action: 'help'}, _meta: {mcp: {server: 'kinetra', tool: 'kinetra'}}});
    const r = await fetch(server.url, {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: auth}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'kinetra', arguments: {action: 'help'}}})}).then((x) => x.text());
    say(sessionId, 'Tool said: ' + (r.match(/"text":"((?:[^"\\]|\\.)*)"/)?.[1] || r).slice(0, 200));
    return send({id, result: {stopReason: 'end_turn'}});
  }
  update(sessionId, {sessionUpdate: 'usage_update', used: 4321, size: 1000000});
  say(sessionId, 'Hello ');
  say(sessionId, `from ${s.model}${s.level ? ' at ' + s.level : ''}.`);
  send({id, result: {stopReason: 'end_turn'}});
}
let buffer = '';
stdin.setEncoding('utf8');
stdin.on('data', (part) => {
  buffer += part;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.id !== undefined && !m.method) { waiting.get(m.id)?.(m.result); waiting.delete(m.id); continue; }
    const {id, method, params} = m;
    if (method === 'initialize') send({id, result: {protocolVersion: 1, agentCapabilities: {loadSession: true, promptCapabilities: {image: true, audio: true, embeddedContext: true}, mcpCapabilities: {http: true}, sessionCapabilities: {resume: {}}, auth: {logout: {}}}, agentInfo: {name: 'antigravity-acp', version: '9.9.9'}}});
    else if (method === 'authenticate') {
      if (mode === 'signed-out') stderr.write('Open the following link to authenticate the ACP server: https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=x&redirect_uri=http%3A%2F%2F127.0.0.1%3A57464%2F&state=s\n');
      else send({id, result: {_meta: {antigravity: {tier: {name: 'Google AI Pro', id: 'g1-pro-tier'}}}}});
    }
    else if (method === 'session/new' || method === 'session/resume') {
      const sessionId = method === 'session/new' ? '00000000-0000-4000-8000-' + String(++n).padStart(12, '0') : params.sessionId;
      const s = sessions.get(sessionId) || {cwd: params.cwd, model: 'gemini-3.1-pro', level: undefined, prompts: []};
      Object.assign(s, {cwd: params.cwd, mcp: params.mcpServers || [], system: params._meta?.antigravity?.systemPrompt?.append, tools: params._meta?.antigravity?.enabledTools, resumed: method === 'session/resume'});
      sessions.set(sessionId, s);
      send({id, result: {...(method === 'session/new' ? {sessionId} : {}), configOptions: options(s), _meta: {antigravity: {tier: {name: 'Google AI Pro'}}}}});
    }
    else if (method === 'session/set_config_option') {
      const s = sessions.get(params.sessionId);
      if (params.configId === 'model') { if (!models().options.some((o) => o.value === params.value)) { send({id, error: {code: -32602, message: 'unknown model'}}); continue; } s.model = params.value; s.level = undefined; }
      else s.level = params.value;
      send({id, result: {configOptions: options(s)}});
    }
    else if (method === 'session/prompt') void prompt(id, params);
    else if (method === 'session/cancel') {}
    else if (method === '_test/prompts') send({id, result: [...sessions.values()].flatMap((s) => s.prompts.map((p) => ({...p, resumed: s.resumed})))});
    else if (method === 'logout') send({id, result: {}});
    else if (id !== undefined) send({id, error: {code: -32601, message: 'Method not found'}});
  }
});
stdin.on('end', () => exit(0));
