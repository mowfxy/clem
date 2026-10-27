import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPatch, revisedSpec, revisedText, revisedElements, withRetry, Settled } from '../core/edit-patch.ts';
import { parseModelJson } from '../core/model-json.ts';
import { normalizeMath } from '../core/math-markdown.ts';

const spec = () => ({
  title: 'Math 301',
  font: 'Times',
  sections: [
    { heading: 'Partials', text: 'Old 1' },
    { heading: 'Chain rule', text: 'Old 2', figure: { module: 'm', fn: 'f', args: [] }, caption: 'A tree' },
    { heading: 'Table', text: 'Old 3' },
  ],
});

test('a section is replaced as written: quotes, backslashes and $$ need no escaping', () => {
  const raw = [
    'SUMMARY: Fixed the table formulas.',
    '@@@ SECTION 3',
    '| Pattern | Formula |',
    '|---|---|',
    '| Error "percentage" | $dQ = \\sum \\left\\lvert \\frac{\\partial Q}{\\partial x_i}\\right\\rvert dx_i$ |',
  ].join('\n');
  const { summary, spec: next } = revisedSpec(spec(), raw);
  assert.equal(summary, 'Fixed the table formulas.');
  assert.equal(next.sections[2].heading, 'Table');
  assert.match(next.sections[2].text!, /Error "percentage" \| \$dQ = \\sum \\left\\lvert \\frac/);
  // Untouched sections, figures and fields stay exactly as they were.
  assert.deepEqual(next.sections[1], spec().sections[1]);
  assert.equal(next.font, 'Times');
});

test('numbers always mean the sections as sent, so a delete does not shift later edits', () => {
  const raw = 'SUMMARY: s\n@@@ DELETE 1\n@@@ SECTION 3\nHEADING: Tables\nNew 3\n@@@ INSERT AFTER 0\nHEADING: Intro\nHello\n@@@ CAPTION 2\nA chain-rule tree\n@@@ SET title\nMath 301 Guide';
  const next = revisedSpec(spec(), raw).spec;
  assert.deepEqual(next.sections.map((s) => s.heading), ['Intro', 'Chain rule', 'Tables']);
  assert.equal(next.sections[2].text, 'New 3');
  assert.equal(next.sections[1].caption, 'A chain-rule tree');
  assert.equal(next.title, 'Math 301 Guide');
});

test('a heading-only SECTION keeps the text; bad numbers and commands are explained', () => {
  assert.equal(revisedSpec(spec(), '@@@ SECTION 1\nHEADING: Partial derivatives').spec.sections[0].text, 'Old 1');
  assert.throws(() => revisedSpec(spec(), '@@@ SECTION 9\nx'), /sections 1 to 3/);
  assert.throws(() => revisedSpec(spec(), '@@@ REWRITE 1\nx'), /not an edit Clem knows/);
  assert.throws(() => revisedSpec(spec(), 'Sure! Here is the document.'), /no @@@ edit blocks/);
});

test('the older JSON reply and a fenced reply are still read', () => {
  const json = JSON.stringify({ summary: 'j', spec: { ...spec(), title: 'T2' } });
  assert.equal(revisedSpec(spec(), json).spec.title, 'T2');
  assert.equal(revisedSpec(spec(), '```text\nSUMMARY: f\n@@@ SECTION 1\nNew\n```').spec.sections[0].text, 'New');
  assert.equal(readPatch('**SUMMARY:** bold\n@@@ DELETE 2').summary, 'bold');
});

test('text files take REPLACE/WITH pairs and FILE', () => {
  const file = 'a = "1"\nb = 2\nc = 3\n';
  const raw = 'SUMMARY: bump\n@@@ REPLACE\nb = 2\n@@@ WITH\nb = "two"\n@@@ REPLACE\nc = 3\n@@@ WITH\nc = 4';
  assert.equal(revisedText(file, raw).text, 'a = "1"\nb = "two"\nc = 4\n');
  assert.equal(revisedText(file, '@@@ FILE\nonly').text, 'only\n');
  assert.throws(() => revisedText(file, '@@@ REPLACE\nzzz\n@@@ WITH\ny'), /not in the file/);
  assert.throws(() => revisedText(file, '@@@ REPLACE\nb = 2'), /followed by/);
});

test('office elements', () => {
  assert.deepEqual(revisedElements('SUMMARY: s\n@@@ ELEMENT 4\nHe said "hi"\n@@@ ELEMENT 7\nTwo\nlines').edits, [{ i: 4, text: 'He said "hi"' }, { i: 7, text: 'Two\nlines' }]);
});

test('an unusable reply is sent back once with the reason; a settled one is not', async () => {
  const seen: string[][] = [];
  const replies = ['garbage', 'SUMMARY: ok\n@@@ SECTION 1\nFine'];
  const out = await withRetry(async (m) => { seen.push(m.map((x) => x.role)); return replies.shift()!; }, [{ role: 'user', content: 'go' }], (raw) => revisedSpec(spec(), raw));
  assert.equal(out.spec.sections[0].text, 'Fine');
  assert.deepEqual(seen[1], ['user', 'assistant', 'user']);
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; return 'x'; }, [], () => { throw new Settled('nothing to change'); }), /nothing to change/);
  assert.equal(calls, 1);
});

test('JSON with quotes the model forgot to escape is still read', () => {
  const raw = '{"summary":"Fixed the "inconclusive" case","spec":{"title":"A \\"B\\"","sections":[{"text":"say "hi", then go"}]}}';
  const v = parseModelJson(raw);
  assert.equal(v.summary, 'Fixed the "inconclusive" case');
  assert.equal(v.spec.title, 'A "B"');
  assert.equal(v.spec.sections[0].text, 'say "hi", then go');
});

test('bars inside maths in a table row no longer split the cell', () => {
  const md = '| Pattern | Formula |\n|---|---|\n| Error | $$dQ = \\sum \\left|\\frac{\\partial Q}{\\partial x_i}\\right| dx_i$$ |\n| Rate | $D_u f = \\nabla f \\cdot \\frac{v}{|v|}$ and $\\|\\nabla f\\|$ |\n\nOutside |x| $|x|$ stays.';
  const out = normalizeMath(md);
  const rows = out.split('\n');
  assert.equal(rows[2], '| Error | $$dQ = \\sum \\left\\vert \\frac{\\partial Q}{\\partial x_i}\\right\\vert  dx_i$$ |');
  assert.ok(!/\$\$[^$]*\|[^$]*\$\$/.test(rows[3]), rows[3]);
  assert.match(rows[3], /\\Vert \\nabla f\\Vert/);
  assert.match(out, /Outside \|x\| \$\$\|x\|\$\$ stays\./);
  assert.equal(normalizeMath('| a |\n|---|\n| \\[x^2\\] |').split('\n')[2], '| $$x^2$$ |');
});
