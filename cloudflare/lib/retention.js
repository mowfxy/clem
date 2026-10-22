// The account worker's hourly cleanup of mail records kept in D1 (see server/retention.ts for the Zoho mailbox).
// Opt-outs are kept: they are how "Stop update emails" keeps working.
const DAY = 86_400_000;
export const MAIL_RECORD_DAYS = 21, CLOSED_CASE_DAYS = 16;

export async function purgeMailRecords(env, now = Date.now()) {
  const records = new Date(now - MAIL_RECORD_DAYS * DAY).toISOString();
  // The daily /api/cron clears a case's mail from Zoho 14 days after it closed, finding it by these rows, so they stay
  // two more days (two more daily runs) before going.
  const closed = new Date(now - CLOSED_CASE_DAYS * DAY).toISOString();
  const stale = "SELECT case_id FROM clem_support_state WHERE status='closed' AND updated_at<?";
  await env.DB.batch([
    env.DB.prepare("DELETE FROM clem_email_log WHERE sent_at<?").bind(records),
    env.DB.prepare("DELETE FROM clem_email_challenges WHERE expires_at<?").bind(new Date(now).toISOString()),
    env.DB.prepare("DELETE FROM desktop_audit_log WHERE action='email.send' AND created_at<?").bind(records),
    env.DB.prepare(`DELETE FROM clem_support_messages WHERE case_id IN (${stale})`).bind(closed),
    env.DB.prepare(`DELETE FROM clem_support WHERE id IN (${stale})`).bind(closed),
    env.DB.prepare("DELETE FROM clem_support_state WHERE status='closed' AND updated_at<?").bind(closed),
  ]);
}
