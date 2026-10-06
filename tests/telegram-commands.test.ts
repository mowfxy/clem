import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TELEGRAM_COMMANDS, fileRequest, helpText, matchFiles, pickSpace, spaceLabel, telegramCommand } from '../core/telegram-commands.ts';

const spaces = [
  { scope: 'subject:a1', name: 'Electric Circuits', kind: 'subject' as const },
  { scope: 'subject:b2', name: 'Physics', kind: 'subject' as const },
  { scope: 'project:c3', name: 'Thesis', kind: 'project' as const },
];

test('commands are read with or without the bot name, and unknown ones are left for the AI', () => {
  assert.deepEqual(telegramCommand('/new'), { name: 'new', arg: '' });
  assert.deepEqual(telegramCommand('/space@MowrBot  Physics '), { name: 'space', arg: 'Physics' });
  assert.deepEqual(telegramCommand('/PDF notes on\nlecture 3'), { name: 'pdf', arg: 'notes on\nlecture 3' });
  assert.equal(telegramCommand('/unknown thing'), undefined);
  assert.equal(telegramCommand('what is /new?'), undefined);
});

test('Telegram accepts every command name and menu text', () => {
  for (const c of TELEGRAM_COMMANDS) {
    assert.match(c.name, /^[a-z0-9_]{1,32}$/);
    assert.ok(c.menu.length >= 3 && c.menu.length <= 256);
    assert.ok(helpText().includes(c.usage));
  }
});

test('/space finds a space by number, name, start of name or part of it', () => {
  assert.equal(pickSpace('2', spaces), spaces[1]);
  assert.equal(pickSpace('physics', spaces), spaces[1]);
  assert.equal(pickSpace('elec', spaces), spaces[0]);
  assert.equal(pickSpace('circuits', spaces), spaces[0]);
  assert.equal(pickSpace('workspace', spaces), 'workspace');
  assert.equal(pickSpace('9', spaces), undefined);
  assert.equal(pickSpace('chemistry', spaces), undefined);
  assert.equal(spaceLabel('project:c3', spaces), 'project “Thesis”');
  assert.equal(spaceLabel('user:me', spaces), 'your whole workspace');
});

test('file commands become requests only when there is something to make', () => {
  assert.equal(fileRequest('pdf', 'lecture 3 summary'), 'Create a PDF: lecture 3 summary');
  assert.match(fileRequest('slides', 'op amps')!, /PowerPoint/);
  assert.equal(fileRequest('pdf', ''), undefined);
  assert.equal(fileRequest('new', 'x'), undefined);
});

test('/files and /get match every word of the name, an exact name first', () => {
  const files = [{ path: 'Lectures/Lecture 3 - Nodal.pdf' }, { path: 'Lectures/Lecture 13.pdf' }, { path: 'Sheets/Sheet 3.pdf' }, { path: 'Lecture 3.pdf' }];
  assert.deepEqual(matchFiles(files, 'lecture 3').map((f) => f.path), ['Lecture 3.pdf', 'Lectures/Lecture 3 - Nodal.pdf']);
  assert.deepEqual(matchFiles(files, 'Lecture 3.pdf').map((f) => f.path), ['Lecture 3.pdf']);
  assert.deepEqual(matchFiles(files, 'nodal').map((f) => f.path), ['Lectures/Lecture 3 - Nodal.pdf']);
});

test("/model and /thinking pick from the models the accounts offer, by tap, number, name or level", async () => {
  const { pickModel, pickEffort, modelMenu, thinkingMenu, MODEL_PICK, THINKING_PICK, telegramCommand } = await import("../core/telegram-commands.ts");
  const models = [
    { id: "gpt-5.5", name: "GPT-5.5", reasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }, { reasoningEffort: "high" }, { reasoningEffort: "xhigh" }], defaultReasoningEffort: "medium" },
    { id: "claude:opus", name: "Claude Opus 5.5", reasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }], defaultReasoningEffort: "high" },
    { id: "claude:haiku", name: "Claude Haiku 4.5", reasoningEfforts: [] },
  ];
  assert.deepEqual(telegramCommand("/model opus"), { name: "model", arg: "opus" });
  assert.deepEqual(telegramCommand("/thinking"), { name: "thinking", arg: "" });
  assert.equal(pickModel("2", models)?.id, "claude:opus");
  assert.equal(pickModel("opus", models)?.id, "claude:opus");
  assert.equal(pickModel("gpt-5.5", models)?.id, "gpt-5.5");
  assert.equal(pickModel("gemini", models), undefined);
  assert.equal(pickEffort("extra high", models[0]), "xhigh");
  assert.equal(pickEffort("High", models[1]), "high");
  assert.equal(pickEffort("medium", models[1]), undefined, "a level the model does not offer");
  assert.equal(pickEffort("default", models[1]), "");
  const menu = modelMenu(models, "claude:opus");
  assert.match(menu.text, /2\. Claude Opus 5\.5 ← current/);
  assert.deepEqual(menu.buttons.flat().map((b) => b.data), models.map((m) => MODEL_PICK + m.id));
  assert.ok(menu.buttons.flat().some((b) => b.text === "✓ Claude Opus 5.5"));
  const levels = thinkingMenu(models[0], "high");
  assert.deepEqual(levels.buttons.flat().map((b) => b.data), [THINKING_PICK + "default", THINKING_PICK + "low", THINKING_PICK + "medium", THINKING_PICK + "high", THINKING_PICK + "xhigh"]);
  assert.ok(levels.buttons.flat().some((b) => b.text === "✓ High"));
  assert.equal(thinkingMenu(models[2], undefined).buttons.length, 0, "a model without levels has nothing to pick");
  assert.match(modelMenu([], undefined).text, /Connect ChatGPT, Claude or Grok/);
});
