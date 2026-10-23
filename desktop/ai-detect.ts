import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Which official AI CLIs are signed in on this PC on their own (outside Clem), for the setup's "Connect your AI" step.
 * Read-only: it only looks whether each CLI's own sign-in file is there (and, for Claude Code, the account's email from
 * its settings), so it spends no tokens, starts no program and never reads a token. Clem keeps its own sign-in for each
 * (desktop/claude.ts, desktop/codex.ts), so connecting one still asks the person once.
 */
export async function detectPcSignIns(home: string) {
  const present = (path: string) => stat(path).then((s) => s.isFile() && s.size > 2, () => false);
  const [codex, claude] = await Promise.all([present(join(home, ".codex", "auth.json")), present(join(home, ".claude", ".credentials.json"))]);
  let email: string | undefined;
  if (claude) {
    try {
      const value = JSON.parse(await readFile(join(home, ".claude.json"), "utf8"))?.oauthAccount?.emailAddress;
      if (typeof value === "string" && /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(value)) email = value;
    } catch { /* no settings file, or not JSON */ }
  }
  return { codex: { signedIn: codex }, claude: { signedIn: claude, ...(email ? { email } : {}) } };
}
