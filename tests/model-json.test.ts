import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelJson } from '../core/model-json.ts';

test('raw line breaks and tabs inside strings are read as text', () => {
  const raw = '```json\n{"summary":"Fixed lecture 4.\nAdded\tan example","sections":[{"title":"A"}]}\n```';
  assert.deepEqual(parseModelJson(raw), { summary: 'Fixed lecture 4.\nAdded\tan example', sections: [{ title: 'A' }] });
});

test('LaTeX keeps its backslashes, real escapes stay escapes', () => {
  const v = parseModelJson<{ m: string }>(String.raw`Here: {"m":"$\frac{a}{b} + \alpha + \beta + \theta + \sum_i x_i$\nNext line \"q\""}`);
  assert.equal(v.m, String.raw`$\frac{a}{b} + \alpha + \beta + \theta + \sum_i x_i$` + '\nNext line "q"');
});

test('valid JSON is unchanged, including doubled backslashes', () => {
  const v = parseModelJson<{ a: string; n: number }>(String.raw`{"a":"\\frac and é","n":2}`);
  assert.deepEqual(v, { a: String.raw`\frac and é`, n: 2 });
});

test('a reply without JSON still fails with the given reason', () => {
  assert.throws(() => parseModelJson('sorry', 'none here'), /none here/);
  assert.throws(() => parseModelJson('{"a": }'));
});

test('a list reply is read as a list; a bracket in prose before an object is not', () => {
  assert.deepEqual(parseModelJson('[{"label":"x"}]'), [{ label: 'x' }]);
  assert.deepEqual(parseModelJson('Done, see [1]: {"summary":"ok"}'), { summary: 'ok' });
});
