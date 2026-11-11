-- Manual only (no npm script runs it): deletes the per-person bot tokens the first Telegram (removed 6 October 2026)
-- kept in provider_links. Telegram is back since 11 November 2026 as one Clem bot whose tables are in
-- telegram-schema.sql; this file never touches them.
DELETE FROM provider_links WHERE kind = 'telegram';
