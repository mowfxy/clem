// SSH keys and host keys for the VPS connector. Keys are made here (ed25519) or pasted; either way the private key is
// kept only in the Vault (desktop) and never reaches the window, a log or a prompt.
import { createHash } from "node:crypto";
import ssh2 from "ssh2";

export type KeyPair = { privateKey: string; publicKey: string };

/** A new ed25519 key, comment "clem". */
export function generateKey(comment = "clem"): KeyPair {
  const k = ssh2.utils.generateKeyPairSync("ed25519", { comment });
  return { privateKey: k.private, publicKey: k.public.trim() };
}

/** The public key line of a pasted private key; throws a plain error when it can't be read. */
export function publicOf(privateKey: string, passphrase?: string): string {
  const parsed = ssh2.utils.parseKey(privateKey.trim(), passphrase);
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!key || key instanceof Error) throw Error(/encrypt|passphrase/i.test(String((key as Error)?.message)) ? "This key needs its passphrase." : "That doesn't look like a private SSH key.");
  if (!key.isPrivateKey()) throw Error("That is a public key. Paste the private key (it starts with -----BEGIN).");
  return `${key.type} ${key.getPublicSSH().toString("base64")} ${key.comment || "clem"}`.trim();
}

/** OpenSSH's "SHA256:…" fingerprint of a host key (the raw key blob ssh2 hands the verifier). */
export const fingerprint = (blob: Buffer | Uint8Array) => "SHA256:" + createHash("sha256").update(blob).digest("base64").replace(/=+$/, "");

/** Trust on first use: no stored fingerprint trusts this one (and the caller stores it); a different one is refused. */
export function checkHostKey(stored: string | undefined, presented: string): { ok: true; first: boolean } | { ok: false; error: string } {
  if (!stored) return { ok: true, first: true };
  if (stored === presented) return { ok: true, first: false };
  return { ok: false, error: `This server's identity changed (it was ${stored}, now ${presented}). If you rebuilt the server, forget it in Settings → Connectors → VPS and connect again; otherwise someone may be in the way, so don't connect.` };
}
