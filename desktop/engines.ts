import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createWriteStream, existsSync, readdirSync} from 'node:fs';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

// Keeps the provider programs Mowr runs up to date, so a model a person's plan just gained shows up in Mowr too.
// Providers only offer a new model to a program new enough to use it: an old Codex never lists it, whatever the
// account allows. Codex ships inside Mowr, so between Mowr releases Mowr fetches OpenAI's own published Windows build
// of the official @openai/codex package from the npm registry, checks it against the registry's sha512, and runs that
// unmodified build. Claude Code and Grok update with their vendors' own updater and installer.

/** "codex-cli 0.160.0" or "0.160.0-win32-x64" → [0,160,0]; anything else → null. */
export function parseVersion(text: string) {
  const m = String(text).match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
export function newer(a: string, b: string) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x) return false;
  if (!y) return true;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

const TRIPLES: Record<string, string> = {x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc'};
const REGISTRY = 'https://registry.npmjs.org/@openai/codex';
const CHECK_EVERY = 6 * 60 * 60_000;

/** The published Windows build for this PC from the package's `latest` manifest, e.g. "0.160.0-win32-x64". */
export function platformBuild(manifest: any, arch = process.arch) {
  const alias = String(manifest?.optionalDependencies?.[`@openai/codex-win32-${arch}`] || '');
  const version = alias.match(/^npm:@openai\/codex@(\d+\.\d+\.\d+-win32-[a-z0-9]+)$/)?.[1];
  return version && TRIPLES[arch] ? version : null;
}

function run(executable: string, args: string[], timeout: number, cwd?: string) {
  return new Promise<{code: number | null; out: string}>((resolve) => {
    let out = '';
    let child;
    try { child = spawn(executable, args, {cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']}); }
    catch { resolve({code: null, out: ''}); return; }
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => { out = (out + d).slice(-8000); });
    child.stderr.on('data', (d) => { out = (out + d).slice(-8000); });
    child.on('error', () => { clearTimeout(timer); resolve({code: null, out}); });
    child.on('close', (code) => { clearTimeout(timer); resolve({code, out}); });
  });
}

/**
 * The Codex program Mowr runs: the newest of the copy shipped with Mowr and the verified builds downloaded since.
 * `executable()` is read at every start, so an update takes effect on the next Codex process without a restart.
 */
export class CodexEngine {
  private bundled: string;
  private root: string;
  private bundledVersion: string | null = null;
  private current: {path: string; version: string} | null = null;
  private job: Promise<boolean> | null = null;
  /** Called after a newer build is in place, so cached model lists are read again with it. */
  onUpdated: () => void = () => {};
  constructor(bundled: string, root: string) { this.bundled = bundled; this.root = join(root, 'engines', 'codex'); this.pick(); void this.prune(); }
  /**
   * At start no Codex is running yet, so only the newest downloaded build is kept (each is about 420 MB); the build an
   * update replaces stays until then, in case a chat is still using it. Unpacking left behind by a closed Mowr goes too.
   */
  private async prune() {
    const keep = this.current?.version;
    if (!keep) return;
    try {
      for (const entry of readdirSync(this.root, {withFileTypes: true})) {
        if (entry.name === keep || entry.name === 'checked.json') continue;
        if ((entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name) && newer(keep, entry.name)) || entry.name.startsWith('.staging-'))
          await rm(join(this.root, entry.name), {recursive: true, force: true}).catch(() => {});
      }
    } catch { /* nothing installed yet */ }
  }
  private installed() {
    try {
      return readdirSync(this.root, {withFileTypes: true})
        .filter((e) => e.isDirectory() && /^\d+\.\d+\.\d+$/.test(e.name) && existsSync(join(this.root, e.name, 'bin', 'codex.exe')))
        .map((e) => e.name);
    } catch { return []; }
  }
  /** Prefers the newest downloaded build; the shipped copy is used until one exists (and whenever it is newer). */
  private pick() {
    const best = this.installed().sort((a, b) => (newer(a, b) ? -1 : newer(b, a) ? 1 : 0))[0];
    this.current = best && (!this.bundledVersion || newer(best, this.bundledVersion)) ? {path: join(this.root, best, 'bin', 'codex.exe'), version: best} : null;
  }
  executable() { return this.current?.path || this.bundled; }
  /** The version in use. The first call reads the shipped copy's version, so a Mowr update that ships a newer
   *  Codex than the one downloaded earlier switches back to the shipped one. */
  async version() {
    if (!this.bundledVersion) {
      this.bundledVersion = parseVersion((await run(this.bundled, ['--version'], 15000)).out)?.join('.') || null;
      this.pick();
    }
    return this.current?.version || this.bundledVersion;
  }
  /** At most every six hours (ten minutes when forced); never throws. Resolves true when a newer Codex was installed. */
  update(force = false) {
    if (!this.job) this.job = this.check(force).catch((error) => { console.warn('Codex update:', (error as Error)?.message || error); return false; }).finally(() => { this.job = null; });
    return this.job;
  }
  private async check(force: boolean) {
    if (process.platform !== 'win32' || !TRIPLES[process.arch]) return false;
    await mkdir(this.root, {recursive: true});
    const stamp = join(this.root, 'checked.json');
    const last = await lastRun(stamp);
    // A forced check (Refresh in Settings → Models, which also runs on window focus) still waits ten minutes.
    if (Date.now() - last < (force ? 10 * 60_000 : CHECK_EVERY)) return false;
    await writeFile(stamp, JSON.stringify({at: Date.now()}));
    const manifest = await (await fetch(`${REGISTRY}/latest`, {signal: AbortSignal.timeout(20000)})).json();
    const build = platformBuild(manifest);
    if (!build) return false;
    const version = build.replace(/-.*/, '');
    const have = await this.version();
    if (have && !newer(version, have)) return false;
    if (this.installed().includes(version)) { this.pick(); return false; }
    const meta = await (await fetch(`${REGISTRY}/${build}`, {signal: AbortSignal.timeout(20000)})).json();
    const tarball = String(meta?.dist?.tarball || ''), integrity = String(meta?.dist?.integrity || '');
    if (!tarball.startsWith('https://registry.npmjs.org/@openai/codex/-/') || !integrity.startsWith('sha512-')) throw Error('Unexpected package metadata.');
    const staging = join(this.root, '.staging-' + version), archive = staging + '.tgz';
    await rm(staging, {recursive: true, force: true});
    await mkdir(staging, {recursive: true});
    try {
      const response = await fetch(tarball, {signal: AbortSignal.timeout(20 * 60_000)});
      if (!response.ok || !response.body) throw Error('Download failed.');
      const hash = createHash('sha512');
      const body = Readable.fromWeb(response.body as any);
      body.on('data', (chunk) => hash.update(chunk));
      await pipeline(body, createWriteStream(archive));
      if ('sha512-' + hash.digest('base64') !== integrity) throw Error('The download did not match the published checksum.');
      // Only what Codex needs: the program, its helpers and ripgrep. The voice runtime is left out.
      const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      const unpacked = await run(tar, ['-xzf', archive, '-C', staging, '--strip-components=3', '--exclude', '*/codex-resources/voice/*', `package/vendor/${TRIPLES[process.arch]}`], 10 * 60_000);
      if (unpacked.code !== 0) throw Error('Could not unpack Codex.');
      const exe = join(staging, 'bin', 'codex.exe');
      const reported = (await run(exe, ['--version'], 20000, staging)).out;
      if (parseVersion(reported)?.join('.') !== version) throw Error('The new Codex did not start.');
      await rename(staging, join(this.root, version));
    } finally {
      await rm(archive, {force: true}).catch(() => {});
      await rm(staging, {recursive: true, force: true}).catch(() => {});
    }
    this.pick();
    // The build that was in use stays (a running chat may use it); anything older goes.
    const keep = new Set([version, ...(this.current ? [this.current.version] : [])]);
    const previous = this.installed().filter((v) => !keep.has(v)).sort((a, b) => (newer(a, b) ? -1 : 1));
    for (const old of previous.slice(1)) await rm(join(this.root, old), {recursive: true, force: true}).catch(() => {});
    this.onUpdated();
    return true;
  }
}

/** When a check last ran, from its stamp file. A missing or damaged stamp (a write cut short) counts as never, so the
 *  check runs and writes a fresh one instead of failing every time. */
async function lastRun(stamp: string) {
  try { return Number(JSON.parse(await readFile(stamp, 'utf8')).at) || 0; } catch { return 0; }
}

/** Runs `update` at most once a day per program; the time of the last run is kept in `root`. */
export async function daily(root: string, name: string, update: () => Promise<unknown>) {
  const stamp = join(root, 'engines', name + '-checked.json');
  const last = await lastRun(stamp);
  if (Date.now() - last < 24 * 60 * 60_000) return false;
  await mkdir(join(root, 'engines'), {recursive: true});
  await writeFile(stamp, JSON.stringify({at: Date.now()}));
  await update();
  return true;
}
