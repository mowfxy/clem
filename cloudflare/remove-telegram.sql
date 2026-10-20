-- Telegram was removed from Clem. Deletes the bot connections earlier versions kept with accounts (sealed bot tokens and
-- paired chats) and the shared-bot relay tables, if they were ever created.
DELETE FROM provider_links WHERE kind = 'telegram';
DROP TABLE IF EXISTS telegram_inbox;
DROP TABLE IF EXISTS telegram_pairings;
DROP TABLE IF EXISTS telegram_links;
