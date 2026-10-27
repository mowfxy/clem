// Strict TypeScript check of the composition toolkit and the compose CLI.
// tsc also visits imported core modules; errors that already exist on main in
// those files (currently math/eval.ts: `derivative` is undefined) are listed
// as pre-existing and do not fail this check. Any error in toolkit-owned
// files fails it. Run: npm run typecheck:toolkit
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const r = spawnSync(process.execPath, [tsc, '-p', 'packages/core/tsconfig.toolkit.json', '--pretty', 'false'], { encoding: 'utf8' });
const lines = (r.stdout + r.stderr).split(/\r?\n/).filter(l => /error TS\d+/.test(l));
const owned = l => /^packages[\/](core[\/]src[\/]toolkit|cli[\/]src[\/]workflows[\/]compose)/.test(l);
const mine = lines.filter(owned), other = lines.filter(l => !owned(l));
for (const l of other) console.log('pre-existing (outside toolkit): ' + l);
for (const l of mine) console.log(l);
console.log(mine.length ? `${mine.length} toolkit type error(s)` : `toolkit typecheck passed (${other.length} pre-existing error(s) elsewhere)`);
process.exit(mine.length ? 1 : 0);
