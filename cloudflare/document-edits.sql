CREATE TABLE IF NOT EXISTS mowr_document_edits (
 owner_id TEXT NOT NULL,
 file_id TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 content TEXT NOT NULL CHECK(length(content)<=500000),
 PRIMARY KEY(owner_id,file_id)
);
