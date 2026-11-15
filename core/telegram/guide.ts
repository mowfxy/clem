// What every chat's AI knows about Telegram (docs/DESKTOP.md "Telegram"). Byte-stable, so prompt caching keeps it.
export const TELEGRAM_ACTIONS = ["telegram.sendFile", "telegram.pair"] as const;
export const TELEGRAM_GUIDE = `Telegram: the person can talk to Clem from Telegram; a message that starts with "[From Telegram]" came from there and your reply goes back there, so keep it short.
- {"kinetra":{"action":"telegram.sendFile","file":"<the name of one of their files in Clem, or a CMS file's id or name>","subject":…}}: sends an existing file to their Telegram ("send me lecture 3 slides", "send me my Math notes PDF"); find a CMS file's id with guc.materials first when unsure. Sending only, never making. Telegram takes files up to 50 MB.
- {"kinetra":{"action":"telegram.pair"}}: when they ask to connect, pair or set up Telegram; put the returned clem-card in your reply.`;
