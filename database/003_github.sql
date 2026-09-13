ALTER TABLE mowr_credentials DROP CONSTRAINT IF EXISTS mowr_credentials_provider_check;
ALTER TABLE mowr_credentials ADD CONSTRAINT mowr_credentials_provider_check CHECK (provider IN ('openai','anthropic','google','xai','drive','github'));
