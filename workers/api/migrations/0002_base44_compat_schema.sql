PRAGMA foreign_keys = ON;

-- 0002_base44_compat_schema.sql
-- Adds non-destructive Base44 compatibility fields needed before importing real data.
-- Rollback note: D1 migrations are generally forward-only. To roll back this migration,
-- create a follow-up migration that rebuilds affected tables without these columns, then
-- copies retained data across. Do not attempt destructive rollback on production data.

-- Users: preserve Base44 auth/profile metadata separately from Clerk-oriented columns.
ALTER TABLE users ADD COLUMN base44_created_date TEXT;
ALTER TABLE users ADD COLUMN base44_updated_date TEXT;
ALTER TABLE users ADD COLUMN base44_full_name TEXT;
ALTER TABLE users ADD COLUMN base44_picture TEXT;
ALTER TABLE users ADD COLUMN base44_avatar_url TEXT;
ALTER TABLE users ADD COLUMN base44_photo_url TEXT;
ALTER TABLE users ADD COLUMN auth_provider TEXT;
ALTER TABLE users ADD COLUMN imported_at TEXT;

-- Playlists: add Base44 fields used by frontend and Base44 functions but absent in 0001.
ALTER TABLE playlists ADD COLUMN base44_name TEXT;
ALTER TABLE playlists ADD COLUMN creator_name TEXT;
ALTER TABLE playlists ADD COLUMN creator_email TEXT;
ALTER TABLE playlists ADD COLUMN is_public INTEGER;
ALTER TABLE playlists ADD COLUMN max_duration INTEGER DEFAULT 0;
ALTER TABLE playlists ADD COLUMN time_filter_hours INTEGER DEFAULT 0;
ALTER TABLE playlists ADD COLUMN episodes_sort_order TEXT DEFAULT 'newest_first';
ALTER TABLE playlists ADD COLUMN share_token TEXT;
ALTER TABLE playlists ADD COLUMN reports_count INTEGER DEFAULT 0;
ALTER TABLE playlists ADD COLUMN base44_created_date TEXT;
ALTER TABLE playlists ADD COLUMN base44_updated_date TEXT;
ALTER TABLE playlists ADD COLUMN imported_at TEXT;

-- Playlist likes: preserve Base44 denormalized user metadata and source timestamps.
ALTER TABLE playlist_likes ADD COLUMN user_email TEXT;
ALTER TABLE playlist_likes ADD COLUMN base44_created_date TEXT;
ALTER TABLE playlist_likes ADD COLUMN base44_updated_date TEXT;
ALTER TABLE playlist_likes ADD COLUMN imported_at TEXT;

-- Podcast likes: preserve Base44 denormalized user metadata and source timestamps.
ALTER TABLE podcast_likes ADD COLUMN user_email TEXT;
ALTER TABLE podcast_likes ADD COLUMN base44_created_date TEXT;
ALTER TABLE podcast_likes ADD COLUMN base44_updated_date TEXT;
ALTER TABLE podcast_likes ADD COLUMN imported_at TEXT;

-- Podcast plays: Base44 stores podcast_image and played_at-oriented history.
ALTER TABLE podcast_plays ADD COLUMN podcast_image TEXT;
ALTER TABLE podcast_plays ADD COLUMN base44_created_date TEXT;
ALTER TABLE podcast_plays ADD COLUMN base44_updated_date TEXT;
ALTER TABLE podcast_plays ADD COLUMN imported_at TEXT;

-- Episode progress: Base44/frontend use finished and last_played_at; 0001 used completed.
ALTER TABLE episode_progress ADD COLUMN finished INTEGER DEFAULT 0;
ALTER TABLE episode_progress ADD COLUMN last_played_at TEXT;
ALTER TABLE episode_progress ADD COLUMN base44_created_date TEXT;
ALTER TABLE episode_progress ADD COLUMN base44_updated_date TEXT;
ALTER TABLE episode_progress ADD COLUMN imported_at TEXT;

-- Follows: preserve denormalized names/emails used by follower/following UI.
ALTER TABLE follows ADD COLUMN follower_email TEXT;
ALTER TABLE follows ADD COLUMN follower_name TEXT;
ALTER TABLE follows ADD COLUMN follower_username TEXT;
ALTER TABLE follows ADD COLUMN following_email TEXT;
ALTER TABLE follows ADD COLUMN base44_created_date TEXT;
ALTER TABLE follows ADD COLUMN base44_updated_date TEXT;
ALTER TABLE follows ADD COLUMN imported_at TEXT;

-- Blocks: preserve denormalized blocked user details shown in settings/moderation UI.
ALTER TABLE blocks ADD COLUMN blocker_email TEXT;
ALTER TABLE blocks ADD COLUMN blocked_email TEXT;
ALTER TABLE blocks ADD COLUMN blocked_name TEXT;
ALTER TABLE blocks ADD COLUMN base44_created_date TEXT;
ALTER TABLE blocks ADD COLUMN base44_updated_date TEXT;
ALTER TABLE blocks ADD COLUMN imported_at TEXT;

-- Reports: preserve Base44 report shape and public moderation context.
ALTER TABLE reports ADD COLUMN reporter_email TEXT;
ALTER TABLE reports ADD COLUMN reported_user_email TEXT;
ALTER TABLE reports ADD COLUMN content_type TEXT;
ALTER TABLE reports ADD COLUMN content_id TEXT;
ALTER TABLE reports ADD COLUMN content_title TEXT;
ALTER TABLE reports ADD COLUMN base44_created_date TEXT;
ALTER TABLE reports ADD COLUMN base44_updated_date TEXT;
ALTER TABLE reports ADD COLUMN imported_at TEXT;

-- Referrals: preserve inviter metadata and playlist share context.
ALTER TABLE referrals ADD COLUMN inviter_email TEXT;
ALTER TABLE referrals ADD COLUMN inviter_name TEXT;
ALTER TABLE referrals ADD COLUMN playlist_id TEXT;
ALTER TABLE referrals ADD COLUMN base44_created_date TEXT;
ALTER TABLE referrals ADD COLUMN base44_updated_date TEXT;
ALTER TABLE referrals ADD COLUMN imported_at TEXT;

-- RSS cache: Base44 uses data as the JSON payload field.
ALTER TABLE rss_cache ADD COLUMN data TEXT;
ALTER TABLE rss_cache ADD COLUMN base44_created_date TEXT;
ALTER TABLE rss_cache ADD COLUMN base44_updated_date TEXT;
ALTER TABLE rss_cache ADD COLUMN imported_at TEXT;

-- Playlist episode cache: Base44 uses episodes_hash, episodes_data, and last_updated.
ALTER TABLE playlist_episodes_cache ADD COLUMN episodes_hash TEXT;
ALTER TABLE playlist_episodes_cache ADD COLUMN episodes_data TEXT;
ALTER TABLE playlist_episodes_cache ADD COLUMN last_updated TEXT;
ALTER TABLE playlist_episodes_cache ADD COLUMN base44_created_date TEXT;
ALTER TABLE playlist_episodes_cache ADD COLUMN base44_updated_date TEXT;
ALTER TABLE playlist_episodes_cache ADD COLUMN imported_at TEXT;

-- Import and lookup indexes. These use new names only, so they should not conflict with 0001.
CREATE INDEX idx_users_base44_created_date ON users (base44_created_date);
CREATE INDEX idx_users_imported_at ON users (imported_at);

CREATE INDEX idx_playlists_creator_legacy_base44_user_id ON playlists (creator_legacy_base44_user_id);
CREATE INDEX idx_playlists_share_token ON playlists (share_token);
CREATE INDEX idx_playlists_is_public ON playlists (is_public);
CREATE INDEX idx_playlists_base44_created_date ON playlists (base44_created_date);
CREATE INDEX idx_playlists_imported_at ON playlists (imported_at);
CREATE INDEX idx_playlists_visibility_created_at ON playlists (visibility, created_at);

CREATE INDEX idx_playlist_likes_legacy_base44_user_id ON playlist_likes (legacy_base44_user_id);
CREATE INDEX idx_playlist_likes_imported_at ON playlist_likes (imported_at);

CREATE INDEX idx_podcast_likes_legacy_base44_user_id ON podcast_likes (legacy_base44_user_id);
CREATE INDEX idx_podcast_likes_feed_url ON podcast_likes (feed_url);
CREATE INDEX idx_podcast_likes_imported_at ON podcast_likes (imported_at);

CREATE INDEX idx_podcast_plays_legacy_base44_user_id ON podcast_plays (legacy_base44_user_id);
CREATE INDEX idx_podcast_plays_feed_url ON podcast_plays (feed_url);
CREATE INDEX idx_podcast_plays_audio_url ON podcast_plays (audio_url);
CREATE INDEX idx_podcast_plays_imported_at ON podcast_plays (imported_at);

CREATE INDEX idx_episode_progress_legacy_base44_user_id ON episode_progress (legacy_base44_user_id);
CREATE INDEX idx_episode_progress_audio_url ON episode_progress (audio_url);
CREATE INDEX idx_episode_progress_last_played_at ON episode_progress (last_played_at);
CREATE INDEX idx_episode_progress_imported_at ON episode_progress (imported_at);

CREATE INDEX idx_follows_follower_legacy_base44_user_id ON follows (follower_legacy_base44_user_id);
CREATE INDEX idx_follows_following_legacy_base44_user_id ON follows (following_legacy_base44_user_id);
CREATE INDEX idx_follows_status ON follows (status);
CREATE INDEX idx_follows_imported_at ON follows (imported_at);

CREATE INDEX idx_blocks_blocker_legacy_base44_user_id ON blocks (blocker_legacy_base44_user_id);
CREATE INDEX idx_blocks_blocked_legacy_base44_user_id ON blocks (blocked_legacy_base44_user_id);
CREATE INDEX idx_blocks_imported_at ON blocks (imported_at);

CREATE INDEX idx_reports_reporter_legacy_base44_user_id ON reports (reporter_legacy_base44_user_id);
CREATE INDEX idx_reports_content_type_content_id ON reports (content_type, content_id);
CREATE INDEX idx_reports_status ON reports (status);
CREATE INDEX idx_reports_imported_at ON reports (imported_at);

CREATE INDEX idx_referrals_inviter_legacy_base44_user_id ON referrals (inviter_legacy_base44_user_id);
CREATE INDEX idx_referrals_invitee_legacy_base44_user_id ON referrals (invitee_legacy_base44_user_id);
CREATE INDEX idx_referrals_playlist_id ON referrals (playlist_id);
CREATE INDEX idx_referrals_imported_at ON referrals (imported_at);

CREATE INDEX idx_rss_cache_imported_at ON rss_cache (imported_at);

CREATE INDEX idx_playlist_episodes_cache_legacy_base44_playlist_episodes_cache_id
  ON playlist_episodes_cache (legacy_base44_playlist_episodes_cache_id);
CREATE INDEX idx_playlist_episodes_cache_imported_at ON playlist_episodes_cache (imported_at);
