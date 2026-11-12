-- Google Calendar (read-only) is its own Google connection beside Drive (docs/MAIN-THREAD.md "Calendar, reminders and study time").
ALTER TABLE clem_credentials DROP CONSTRAINT IF EXISTS clem_credentials_provider_check;
ALTER TABLE clem_credentials ADD CONSTRAINT clem_credentials_provider_check CHECK (provider IN ('openai','anthropic','google','xai','drive','github','calendar'));
