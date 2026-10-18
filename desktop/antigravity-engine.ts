import {spawn} from 'node:child_process';
import {createWriteStream, existsSync, readdirSync} from 'node:fs';
import {mkdir, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {newer} from './engines.ts';

// Google's official Antigravity agent for other apps: the "antigravity-acp" server Google publishes in the Agent Client
// Protocol registry (github.com/agentclientprotocol/registry), the same program T3 Code and other ACP clients run.
// Mowr reads the registry's listing for the newest version, downloads Google's own Windows build from dl.google.com when
// the person clicks Install, checks that both programs carry Google's valid code signature, and runs them unmodified.
// Nothing is bundled or redistributed, and Mowr never calls Google's services itself.

export const ANTIGRAVITY_REGISTRY = 'https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json';
const PLATFORMS: Record<string, {key: string; file: string}> = {x64: {key: 'windows-x86_64', file: 'x86_64'}, arm64: {key: 'windows-aarch64', file: 'arm64'}};
export const ANTIGRAVITY_FILES = {server: 'agy_acp_server.exe', harness: 'localharness_external.exe'};
/** The largest download accepted (Google's Windows archive is about 130 MB). */
const MAX_ARCHIVE = 1_000_000_000;

/** This PC's build from the registry listing, only when it is Google's own download of the version listed. */
export function antigravityRelease(manifest: any, arch = process.arch) {
  const platform = PLATFORMS[arch];
  const version = String(manifest?.version || '');
  const archive = String(manifest?.distribution?.binary?.[platform?.key || '']?.archive || '');
  if (!platform || manifest?.id !== 'antigravity-acp' || !/^\d+\.\d+\.\d+$/.test(version)) return null;
  const expected = `https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-${version}-windows-${platform.file}.zip`;
  return archive === expected ? {version, url: archive} : null;
}

function run(executable: string, args: string[], timeout: number) {
  return new Promise<{code: number | null; out: string}>((resolve) => {
    let out = '';
    let child;
    try { child = spawn(executable, args, {windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']}); }
    catch { resolve({code: null, out: ''}); return; }
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => { out = (out + d).slice(-20000); });
    child.stderr.on('data', (d) => { out = (out + d).slice(-20000); });
    child.on('error', () => { clearTimeout(timer); resolve({code: null, out}); });
    child.on('close', (code) => { clearTimeout(timer); resolve({code, out}); });
  });
}

/** Whether every file carries a valid Authenticode signature issued to Google LLC (Windows checks the chain itself). */
export async function signedByGoogle(paths: string[]) {
  const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
  const script = `Get-AuthenticodeSignature -LiteralPath ${list} | ForEach-Object { [pscustomobject]@{s=[string]$_.Status;n=[string]$_.SignerCertificate.Subject} } | ConvertTo-Json -Compress`;
  const {code, out} = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 60000);
  if (code !== 0) return false;
  try {
    const parsed = JSON.parse(out.trim());
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.length === paths.length && rows.every((r: any) => r?.s === 'Valid' && /^CN=Google LLC,/.test(String(r?.n || '')));
  } catch { return false; }
}

export type AntigravityInstall = {version: string; server: string; harness: string};

/**
 * The Antigravity agent Mowr runs, kept in `<data>/engines/antigravity/<version>` (shared by every Antigravity account).
 * `MOWR_ANTIGRAVITY_EXECUTABLE` points at another copy of agy_acp_server.exe (its harness beside it) instead.
 */
export class AntigravityEngine {
  private root: string;
  private configured: string | undefined;
  private job: Promise<AntigravityInstall> | null = null;
  constructor(local: string, configured = process.env.MOWR_ANTIGRAVITY_EXECUTABLE) { this.root = join(local, 'engines', 'antigravity'); this.configured = configured; void this.prune(); }
  private versions() {
    try {
      return readdirSync(this.root, {withFileTypes: true})
        .filter((e) => e.isDirectory() && /^\d+\.\d+\.\d+$/.test(e.name) && existsSync(join(this.root, e.name, ANTIGRAVITY_FILES.server)) && existsSync(join(this.root, e.name, ANTIGRAVITY_FILES.harness)))
        .map((e) => e.name).sort((a, b) => (newer(a, b) ? -1 : newer(b, a) ? 1 : 0));
    } catch { return []; }
  }
  /** The newest installed copy, read at every start, so an update takes effect on the next agent without a restart. */
  installed(): AntigravityInstall | null {
    if (this.configured) return existsSync(this.configured) ? {version: 'custom', server: this.configured, harness: join(this.configured, '..', ANTIGRAVITY_FILES.harness)} : null;
    const best = this.versions()[0];
    return best ? {version: best, server: join(this.root, best, ANTIGRAVITY_FILES.server), harness: join(this.root, best, ANTIGRAVITY_FILES.harness)} : null;
  }
  /** At start no agent is running yet: only the newest copy is kept (each is about 230 MB), and unpacking left behind goes. */
  private async prune() {
    const keep = this.versions()[0];
    try {
      for (const entry of readdirSync(this.root, {withFileTypes: true}))
        if ((keep && entry.name !== keep && /^\d+\.\d+\.\d+$/.test(entry.name)) || entry.name.startsWith('.staging-')) await rm(join(this.root, entry.name), {recursive: true, force: true}).catch(() => {});
    } catch { /* nothing installed yet */ }
  }
  /** Installs (or updates to) the newest version; a second click joins the install that is running. */
  install() {
    this.job ??= this.fetch().finally(() => { this.job = null; });
    return this.job;
  }
  /** Updates an installed agent when Google lists a newer one; never throws. Resolves true when a newer one was installed. */
  async update() {
    const have = this.installed();
    if (!have || this.configured) return false;
    try { return (await this.install()).version !== have.version; }
    catch (error) { console.warn('Antigravity update:', (error as Error)?.message || error); return false; }
  }
  private async fetch(): Promise<AntigravityInstall> {
    if (process.platform !== 'win32' || !PLATFORMS[process.arch]) throw Error('Antigravity is available for Windows on x64 and Arm PCs.');
    let manifest: any;
    try { manifest = await (await fetch(ANTIGRAVITY_REGISTRY, {signal: AbortSignal.timeout(20000)})).json(); }
    catch { throw Error('Couldn’t reach the Antigravity download. Check your internet connection and try again.'); }
    const release = antigravityRelease(manifest);
    if (!release) throw Error('Google’s Antigravity download is not available right now. Try again later.');
    const have = this.installed();
    if (have && have.version !== 'custom' && !newer(release.version, have.version)) return have;
    await mkdir(this.root, {recursive: true});
    const staging = join(this.root, '.staging-' + release.version), archive = staging + '.zip';
    await rm(staging, {recursive: true, force: true});
    await mkdir(staging, {recursive: true});
    try {
      let response: Response;
      try { response = await fetch(release.url, {signal: AbortSignal.timeout(30 * 60_000)}); }
      catch { throw Error('Couldn’t reach the Antigravity download. Check your internet connection and try again.'); }
      // Google's own download host, wherever it redirected within Google.
      if (!response.ok || !response.body || !/^https:\/\/([a-z0-9-]+\.)*(google\.com|gvt1\.com)\//.test(response.url)) throw Error('The Antigravity download failed. Try again.');
      if (Number(response.headers.get('content-length') || 0) > MAX_ARCHIVE) throw Error('The Antigravity download is larger than expected.');
      let bytes = 0;
      const body = Readable.fromWeb(response.body as any);
      body.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_ARCHIVE) body.destroy(Error('The Antigravity download is larger than expected.')); });
      await pipeline(body, createWriteStream(archive));
      // Windows' own tar reads zip archives; only the two programs are taken out.
      const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      const unpacked = await run(tar, ['-xf', archive, '-C', staging, ANTIGRAVITY_FILES.server, ANTIGRAVITY_FILES.harness], 10 * 60_000);
      const server = join(staging, ANTIGRAVITY_FILES.server), harness = join(staging, ANTIGRAVITY_FILES.harness);
      if (unpacked.code !== 0 || !existsSync(server) || !existsSync(harness)) throw Error('Antigravity didn’t finish installing. Try again, or contact support@mowrai.com.');
      if (!(await signedByGoogle([server, harness]))) throw Error('The Antigravity download is not signed by Google, so Mowr did not install it.');
      await rm(join(this.root, release.version), {recursive: true, force: true});
      await rename(staging, join(this.root, release.version));
    } finally {
      await rm(archive, {force: true}).catch(() => {});
      await rm(staging, {recursive: true, force: true}).catch(() => {});
    }
    // The copy that was in use stays until the next start (an answer may be running on it); anything older goes.
    for (const old of this.versions().slice(2)) await rm(join(this.root, old), {recursive: true, force: true}).catch(() => {});
    return this.installed()!;
  }
}
