import {spawn, spawnSync} from 'node:child_process';
import {relative, resolve} from 'node:path';

// Google's agent (desktop/antigravity.ts) runs as a small launcher that starts the real agent, which starts a helper per
// session. When Clem ended without closing them (a crash, Windows signing out, or the launcher leaving as Clem's pipes
// closed, before taskkill could walk the tree from it), the agent and its helpers went on running with nobody to talk
// to: on one PC five such agents held about 1.3 GB. Clem's own engines folder is the only place looked in, and only
// processes whose parent has gone are ended, so an agent another running program started is never touched.

export type ProcessRow = {pid: number; ppid: number; path: string};

const inside = (root: string, path: string) => {
  const r = relative(resolve(root), resolve(path));
  return !!path && r !== '' && !r.startsWith('..') && !/^[a-z]:/i.test(r);
};

/** The processes from `root` whose parent no longer runs (each one's own helpers go with it). */
export function orphanedAgents(processes: ProcessRow[], root: string) {
  const running = new Set(processes.map((p) => p.pid));
  return processes.filter((p) => inside(root, p.path) && !running.has(p.ppid)).map((p) => p.pid);
}

/** Every process on this PC with its parent, and the program path of those from `root` (Windows only). */
export function listProcesses(root: string) {
  const script = `$r='${resolve(root).replace(/'/g, "''")}\\';Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{i=[int]$_.ProcessId;p=[int]$_.ParentProcessId;x=$(if ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($r, [StringComparison]::OrdinalIgnoreCase)) { $_.ExecutablePath } else { '' })} } | ConvertTo-Json -Compress`;
  return new Promise<ProcessRow[]>((done) => {
    let out = '';
    let child;
    try { child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore']}); }
    catch { done([]); return; }
    const timer = setTimeout(() => child.kill(), 60_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => { out += d; });
    child.on('error', () => { clearTimeout(timer); done([]); });
    child.on('close', () => {
      clearTimeout(timer);
      try { done((JSON.parse(out) as {i: number; p: number; x: string}[]).map((r) => ({pid: r.i, ppid: r.p, path: r.x || ''}))); }
      catch { done([]); }
    });
  });
}

/** Ends the agents a closed Clem left running from `root`. Resolves how many were ended; never throws. */
export async function endOrphanedAgents(root: string) {
  if (process.platform !== 'win32') return 0;
  const orphans = orphanedAgents(await listProcesses(root), root);
  for (const pid of orphans) spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'}).on('error', () => {});
  if (orphans.length) console.log(`[agents] ended ${orphans.length} agent process${orphans.length === 1 ? '' : 'es'} a closed Clem left running`);
  return orphans.length;
}

/** Ends a process and everything it started before returning, for when Clem is quitting and cannot wait. */
export function endTreeNow(pid: number | undefined) {
  if (!pid) return;
  try { spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore', timeout: 5000}); } catch { /* already gone */ }
}
