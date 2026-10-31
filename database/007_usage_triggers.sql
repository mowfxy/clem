-- Storage use follows each file, as the Cloudflare schema does (cloudflare/schema.sql): a reservation's bytes count as
-- stored once its upload completes, and deleting a file or an expired reservation gives its bytes back.
CREATE OR REPLACE FUNCTION clem_file_ready_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE clem_usage SET stored_bytes=stored_bytes+NEW.bytes,reserved_bytes=reserved_bytes-NEW.bytes WHERE owner_id=NEW.owner_id::text;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS file_ready_usage ON clem_files;
CREATE TRIGGER file_ready_usage AFTER UPDATE OF status ON clem_files FOR EACH ROW
 WHEN (OLD.status='reserved' AND NEW.status='ready') EXECUTE FUNCTION clem_file_ready_usage();

CREATE OR REPLACE FUNCTION clem_file_delete_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE clem_usage SET
  stored_bytes=stored_bytes-CASE WHEN OLD.status IN ('ready','deleting') THEN OLD.bytes ELSE 0 END,
  reserved_bytes=reserved_bytes-CASE WHEN OLD.status='reserved' THEN OLD.bytes ELSE 0 END
 WHERE owner_id=OLD.owner_id::text;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS file_delete_usage ON clem_files;
CREATE TRIGGER file_delete_usage AFTER DELETE ON clem_files FOR EACH ROW EXECUTE FUNCTION clem_file_delete_usage();

-- Bring existing counts in line with the files there are now (they were never moved or given back before this).
UPDATE clem_usage u SET
 stored_bytes=COALESCE((SELECT sum(bytes) FROM clem_files f WHERE f.owner_id::text=u.owner_id AND f.status IN ('ready','deleting')),0),
 reserved_bytes=COALESCE((SELECT sum(bytes) FROM clem_files f WHERE f.owner_id::text=u.owner_id AND f.status='reserved'),0);
