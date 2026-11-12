// vps.run_command: which shell commands run at once and which wait for the person's one tap (docs/GUC-VPS-ENGINE.md
// "VPS"). Conservative: a command runs at once only when every part of it is a known read-only command used read-only.
// Anything unknown, any redirection into a file, substitution, sudo or a known destructive word asks first. Pure.

/** Read-only commands; some only with the subcommands listed. */
const SAFE: Record<string, true | RegExp> = {
  ls: true, ll: true, cat: true, head: true, tail: true, df: true, du: true, free: true, uptime: true, uname: true, whoami: true, id: true, pwd: true,
  echo: true, printf: true, date: true, hostname: true, ps: true, pgrep: true, grep: true, egrep: true, fgrep: true, rg: true, wc: true, stat: true, file: true,
  which: true, type: true, printenv: true, journalctl: true, lsblk: true, nproc: true, lscpu: true, lsb_release: true, tree: true, readlink: true,
  realpath: true, basename: true, dirname: true, sha256sum: true, md5sum: true, sort: true, uniq: true, cut: true, tr: true, column: true, test: true,
  true: true, ss: true, netstat: true, ping: true, ip: /^(a|addr|address|r|route|link)?(\s|$)/, top: /^-b/, vmstat: true, iostat: true, w: true, last: true,
  env: /^$/, node: /^(-v|--version)$/, npm: /^(-v|--version|ls|list|view)\b/, python3: /^(-V|--version)$/, git: /^(status|log|diff|show|branch|remote -v)\b/,
  systemctl: /^(status|is-active|is-enabled|is-failed|list-units|list-timers|show|cat)\b/, service: /^\S+ status$/,
  docker: /^(ps|logs|images|inspect|stats --no-stream|version|info|compose (ps|logs|ls|config))\b/, "docker-compose": /^(ps|logs|config)\b/,
  find: true, sed: true, awk: true, curl: true, wget: /^(-q )?(-O ?- |--spider )/, cd: true,
};

/** Flags and words that turn an otherwise safe command into a write. */
const UNSAFE_USE: [RegExp, string][] = [
  [/^find\b.*\s-(delete|exec|execdir|ok|fprint)\b/, "find that deletes or runs commands"],
  [/^sed\b.*\s-(i|-in-place)/, "sed editing files in place"],
  [/^awk\b.*\b(system|print\s*>)/, "awk that writes or runs commands"],
  [/^curl\b.*\s(-X|--request|-d|--data\S*|-F|--form|-T|--upload-file|-o|-O|--output|--remote-name)\b/, "curl that sends or saves data"],
];

export type CommandCheck = { destructive: boolean; reason?: string };

/** Splits a command line on ; && || | and newlines (outside quotes). */
function parts(cmd: string) {
  const out: string[] = []; let cur = "", q: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === ";" || c === "\n" || c === "|" || (c === "&" && cmd[i + 1] === "&")) { out.push(cur); cur = ""; if (cmd[i + 1] === c) i++; continue; }
    if (c === "&") { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

export function classifyCommand(command: string): CommandCheck {
  const cmd = command.trim();
  if (!cmd) return { destructive: true, reason: "empty command" };
  if (/\$\(|`|<\(|>\(/.test(cmd)) return { destructive: true, reason: "runs a nested command" };
  // Redirection into anything but /dev/null writes a file.
  if (/(^|[^\d&])>{1,2}\|?\s*(?!\/dev\/null\b)\S/.test(cmd.replace(/\d?>&\d/g, "")) || /(^|\s)\d>{1,2}\s*(?!\/dev\/null\b|&)\S/.test(cmd)) return { destructive: true, reason: "writes to a file" };
  for (const part of parts(cmd)) {
    const words = part.replace(/^(\w+=\S*\s+)+/, "");
    const [name, ...rest] = words.split(/\s+/), args = rest.join(" ");
    if (name === "sudo" || name === "su" || name === "doas") return { destructive: true, reason: "runs as the administrator" };
    const rule = SAFE[name];
    if (!rule) return { destructive: true, reason: `"${name}" can change the server` };
    if (rule instanceof RegExp && !rule.test(args)) return { destructive: true, reason: `"${(name + " " + (rest[0] || "")).trim()}" can change the server` };
    const bad = UNSAFE_USE.find(([re]) => re.test(words));
    if (bad) return { destructive: true, reason: bad[1] };
  }
  return { destructive: false };
}

/** What vps.run_command sends back: at most this many characters of output. */
export const OUTPUT_CAP = 8000;
export function capOutput(text: string, cap = OUTPUT_CAP) {
  return text.length <= cap ? { text, truncated: false } : { text: text.slice(0, cap / 4) + `\n…(${text.length - cap} characters cut)…\n` + text.slice(-(cap * 3) / 4), truncated: true };
}
