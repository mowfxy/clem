// A command that could change the server, asked in words, once (docs/GUC-VPS-ENGINE.md "VPS"): on Telegram, where no
// one can tap a card, Clem says in one plain message exactly what it will run and asks; the model reads whether the
// answer says yes and runs it (desktop/engine/thread-tools.ts heldAsk), anything else drops it. The command
// classification is core/vps/commands.ts's. Pure.

export type VpsAsk = { kind: "run"; command: string; reason?: string; at: number } | { kind: "write"; path: string; content: string; at: number };

/** What could go wrong for Clem itself or for the person's way in, said plainly in the question. */
export function dangers(command: string): string[] {
  const c = command.replace(/\s+/g, " ");
  const out: string[] = [];
  if (/\brm\b[^;&|]*(\bclem\b|~\/clem|\$HOME\/clem|\/files\b|\/state\b)/i.test(c) || /docker (compose )?(down|rm)\b[^;&|]*(-v\b|--volumes)/.test(c) || /docker volume (rm|prune)/.test(c) || /\b(dropdb|drop database)\b/i.test(c))
    out.push("This deletes Clem's own data on the server (its files or its database), and it can't be undone.");
  else if (/\brm\b[^;&|]*\s-\w*[rR]/.test(c) && /\s(\/|~|\$HOME)(\s|$)/.test(c)) out.push("This deletes a whole folder tree, and it can't be undone.");
  if (/(systemctl (--user )?(stop|disable|mask) clem|docker (compose )?(stop|down|kill)\b|kill(all)? .*node|pkill .*node)/.test(c)) out.push("This stops Clem's worker: Telegram goes quiet and nothing runs on a timer until it starts again.");
  if (/\b(reboot|shutdown|poweroff|halt)\b/.test(c)) out.push("This restarts or turns off the server: Clem is unreachable until it's back.");
  if (/(authorized_keys|sshd_config|\.ssh\b)/.test(c) || /\b(passwd|usermod|userdel|deluser|chpasswd)\b/.test(c) || /\bufw\b.*\b(enable|deny|reject|delete)\b|\biptables\b|\bnft\b|systemctl \S+ (ssh|sshd)\b/.test(c))
    out.push("This changes how you sign in to the server or which connections it accepts: done wrong, it can lock you (and Clem) out.");
  return out;
}

/** The question, one plain message: exactly what will run, why it needs asking, what could go wrong. */
export function askQuestion(a: VpsAsk) {
  if (a.kind === "write") return `To do that I'll replace this file on your VPS: ${a.path}\n\nIt already exists, so its current contents will be gone. Say yes to replace it.`;
  const why = a.reason ? ` (it ${a.reason.replace(/^"(.+)" can change the server$/, "uses $1, which can change the server").replace(/^runs as the administrator$/, "runs as the administrator").replace(/^writes to a file$/, "writes to a file")})` : "";
  return [`To do that I'll run this on your VPS${why}:`, "```\n" + a.command + "\n```", ...dangers(a.command), "Say yes to run it."].join("\n\n");
}

/** What ran, in one plain message. */
export function ranReport(a: VpsAsk, r: { exitCode?: number; output?: string; error?: string; ok?: boolean }) {
  if (r.error) return `That didn't run: ${r.error}`;
  if (a.kind === "write") return `Replaced ${a.path}.`;
  const out = (r.output || "").trim();
  return `${r.exitCode === 0 ? "Done." : `It finished with exit code ${r.exitCode}.`}${out ? "\n\n```\n" + out + "\n```" : " It printed nothing."}`;
}
