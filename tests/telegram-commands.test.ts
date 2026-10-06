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
