PRAGMA foreign_keys = ON;

-- 0003_podcast_play_idempotency.sql
-- Adds client-provided idempotency for new playback analytics without changing
-- imported legacy rows. Playlist lifetime counters are incremented only by
-- successful future inserts that reference a playlist.

ALTER TABLE podcast_plays ADD COLUMN client_event_id TEXT;

CREATE UNIQUE INDEX idx_podcast_plays_client_event_id
  ON podcast_plays (client_event_id)
  WHERE client_event_id IS NOT NULL;

CREATE TRIGGER trg_podcast_plays_increment_playlist_count
AFTER INSERT ON podcast_plays
WHEN NEW.playlist_id IS NOT NULL
 AND NEW.client_event_id IS NOT NULL
BEGIN
  UPDATE playlists
  SET plays_count = COALESCE(plays_count, 0) + 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.playlist_id;
END;
