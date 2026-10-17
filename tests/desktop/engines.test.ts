import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CodexEngine, daily, newer, parseVersion, platformBuild} from '../../desktop/engines.ts';

test('versions compare numerically', () => {
  assert.deepEqual(parseVersion('codex-cli 0.160.0'), [0, 160, 0]);
  assert.equal(newer('0.160.0', '0.155.1'), true);
  assert.equal(newer('0.99.0', '0.155.1'), false);
  assert.equal(newer('0.160.0', '0.160.0'), false);
  assert.equal(newer('1.0.0', ''), true);
});

test('the Windows build is read from the official package manifest only', () => {
  const manifest = {optionalDependencies: {'@openai/codex-win32-x64': 'npm:@openai/codex@0.160.0-win32-x64', '@openai/codex-win32-arm64': 'npm:@openai/codex@0.160.0-win32-arm64'}};
  assert.equal(platformBuild(manifest, 'x64'), '0.160.0-win32-x64');
  assert.equal(platformBuild(manifest, 'arm64'), '0.160.0-win32-arm64');
  assert.equal(platformBuild({optionalDependencies: {'@openai/codex-win32-x64': 'npm:evil@1.0.0-win32-x64'}}, 'x64'), null);
  assert.equal(platformBuild({}, 'x64'), null);
});

test('a downloaded Codex is used only while it is newer than the one shipped with Mowr', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mowr-engines-'));
  try {
    for (const version of ['0.150.0', '0.160.0']) {
      await mkdir(join(root, 'engines', 'codex', version, 'bin'), {recursive: true});
      await writeFile(join(root, 'engines', 'codex', version, 'bin', 'codex.exe'), '');
    }
    const engine: any = new CodexEngine('bundled.exe', root);
    engine.bundledVersion = '0.155.1'; engine.pick();
    assert.equal(engine.executable(), join(root, 'engines', 'codex', '0.160.0', 'bin', 'codex.exe'));
    engine.bundledVersion = '0.170.0'; engine.pick();
    assert.equal(engine.executable(), 'bundled.exe');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('daily updates run once a day', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mowr-engines-'));
  try {
    let runs = 0;
    assert.equal(await daily(root, 'grok', async () => { runs++; }), true);
    assert.equal(await daily(root, 'grok', async () => { runs++; }), false);
    assert.equal(runs, 1);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('a damaged stamp file does not stop the daily check for good', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mowr-engines-'));
  try {
    await mkdir(join(root, 'engines'), {recursive: true});
    await writeFile(join(root, 'engines', 'tool-checked.json'), '{"at": 17');
    let runs = 0;
    await daily(root, 'tool', async () => { runs++; });
    assert.equal(runs, 1, 'the check runs instead of throwing');
    await daily(root, 'tool', async () => { runs++; });
    assert.equal(runs, 1, 'and its fresh stamp holds for the day');
  } finally { await rm(root, {recursive: true, force: true}); }
});
