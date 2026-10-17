/**
 * A bug report's diagnostic logs travel in the case message after this line: staff see them in the portal and the
 * email, and the person's own inbox shows the message without them.
 */
export const LOGS_MARK = "\n\n––––– Diagnostic logs attached by Mowr –––––\n";
export const LOGS_MAX = 60_000;
export function splitLogs(message: string) {
  const at = message.indexOf(LOGS_MARK);
  return at < 0 ? { text: message, logs: "" } : { text: message.slice(0, at), logs: message.slice(at + LOGS_MARK.length) };
}
