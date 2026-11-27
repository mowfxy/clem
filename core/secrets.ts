/**
 * Passwords, keys, card and account numbers never become memory, even when asked: memory syncs to the
 * person's other devices and goes to their AI with every message.
 */
export function looksSecret(text: string) {
  if (/\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|\bxox[abpr]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{30,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return true;
  if (/\b(?:password|passcode|passwd|pwd|pin(?: code)?|api[ _-]?key|secret[ _-]?key|access[ _-]?key|(?:api|access|auth|bearer|refresh)[ _-]?token|private[ _-]?key|recovery (?:code|phrase)|seed phrase|mot de passe|contraseña|passwort|kennwort)\b\s*(?:is|was|=|:|est|es|ist)\s*\S+/i.test(text) || /(?:كلمة السر|كلمة المرور|الرقم السري)\s*(?:هي|:|=)?\s*\S+/u.test(text)) return true;
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text) || /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b/.test(text)) return true;
  // Card numbers: 13 to 19 digits (spaces or dashes allowed) that pass the Luhn check.
  for (const run of text.match(/\b\d(?:[ -]?\d){12,18}\b/g) || []) {
    const digits = run.replace(/\D/g, "");
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}
