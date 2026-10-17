-- Existing playlists retain NULL keys. Only new create operations participate.
ALTER TABLE playlists ADD COLUMN creation_request_id TEXT;
ALTER TABLE playlists ADD COLUMN creation_request_hash TEXT;

CREATE UNIQUE INDEX idx_playlists_creation_request
  ON playlists (creator_id, creation_request_id)
  WHERE creation_request_id IS NOT NULL;
