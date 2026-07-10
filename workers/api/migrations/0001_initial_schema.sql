PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  clerk_user_id TEXT UNIQUE,
  legacy_base44_user_id TEXT UNIQUE,
  email TEXT,
  name TEXT,
  username TEXT UNIQUE,
  role TEXT DEFAULT 'user',
  profile_picture TEXT,
  profile_hidden INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  legacy_base44_playlist_id TEXT UNIQUE,
  creator_id TEXT NOT NULL,
  creator_clerk_user_id TEXT,
  creator_legacy_base44_user_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  cover_image TEXT,
  visibility TEXT DEFAULT 'public',
  rss_feeds TEXT,
  likes_count INTEGER DEFAULT 0,
  plays_count INTEGER DEFAULT 0,
  creator_username TEXT,
  creator_picture TEXT,
  creator_hidden INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS playlist_likes (
  id TEXT PRIMARY KEY,
  legacy_base44_playlist_like_id TEXT UNIQUE,
  playlist_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  clerk_user_id TEXT,
  legacy_base44_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (playlist_id, user_id),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS podcast_likes (
  id TEXT PRIMARY KEY,
  legacy_base44_podcast_like_id TEXT UNIQUE,
  user_id TEXT NOT NULL,
  clerk_user_id TEXT,
  legacy_base44_user_id TEXT,
  feed_url TEXT NOT NULL,
  podcast_title TEXT,
  podcast_author TEXT,
  podcast_image TEXT,
  podcast_description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, feed_url),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS podcast_plays (
  id TEXT PRIMARY KEY,
  legacy_base44_podcast_play_id TEXT UNIQUE,
  user_id TEXT,
  clerk_user_id TEXT,
  legacy_base44_user_id TEXT,
  playlist_id TEXT,
  feed_url TEXT,
  podcast_title TEXT,
  episode_title TEXT,
  audio_url TEXT,
  played_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS episode_progress (
  id TEXT PRIMARY KEY,
  legacy_base44_episode_progress_id TEXT UNIQUE,
  user_id TEXT NOT NULL,
  clerk_user_id TEXT,
  legacy_base44_user_id TEXT,
  feed_url TEXT,
  podcast_title TEXT,
  episode_title TEXT,
  audio_url TEXT NOT NULL,
  position_seconds INTEGER DEFAULT 0,
  duration_seconds INTEGER,
  completed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, audio_url),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  legacy_base44_follow_id TEXT UNIQUE,
  follower_id TEXT NOT NULL,
  follower_clerk_user_id TEXT,
  follower_legacy_base44_user_id TEXT,
  following_id TEXT NOT NULL,
  following_clerk_user_id TEXT,
  following_legacy_base44_user_id TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (follower_id, following_id),
  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  legacy_base44_block_id TEXT UNIQUE,
  blocker_id TEXT NOT NULL,
  blocker_clerk_user_id TEXT,
  blocker_legacy_base44_user_id TEXT,
  blocked_id TEXT NOT NULL,
  blocked_clerk_user_id TEXT,
  blocked_legacy_base44_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (blocker_id, blocked_id),
  FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  legacy_base44_report_id TEXT UNIQUE,
  reporter_id TEXT,
  reporter_clerk_user_id TEXT,
  reporter_legacy_base44_user_id TEXT,
  reported_user_id TEXT,
  reported_playlist_id TEXT,
  reason TEXT,
  details TEXT,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reported_playlist_id) REFERENCES playlists(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  legacy_base44_referral_id TEXT UNIQUE,
  inviter_id TEXT,
  inviter_clerk_user_id TEXT,
  inviter_legacy_base44_user_id TEXT,
  invitee_user_id TEXT,
  invitee_clerk_user_id TEXT,
  invitee_legacy_base44_user_id TEXT,
  invitee_email TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inviter_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (invitee_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS rss_cache (
  id TEXT PRIMARY KEY,
  legacy_base44_rss_cache_id TEXT UNIQUE,
  feed_url TEXT NOT NULL UNIQUE,
  response_json TEXT NOT NULL,
  cached_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlist_episodes_cache (
  id TEXT PRIMARY KEY,
  legacy_base44_playlist_episodes_cache_id TEXT UNIQUE,
  playlist_id TEXT NOT NULL,
  cache_key TEXT,
  episodes_json TEXT NOT NULL,
  cached_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (playlist_id, cache_key),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playlists_creator_id ON playlists (creator_id);
CREATE INDEX IF NOT EXISTS idx_playlists_visibility ON playlists (visibility);
CREATE INDEX IF NOT EXISTS idx_playlist_likes_playlist_id ON playlist_likes (playlist_id);
CREATE INDEX IF NOT EXISTS idx_podcast_likes_user_id ON podcast_likes (user_id);
CREATE INDEX IF NOT EXISTS idx_podcast_plays_played_at ON podcast_plays (played_at);
CREATE INDEX IF NOT EXISTS idx_episode_progress_user_id ON episode_progress (user_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower_id_following_id_status ON follows (follower_id, following_id, status);
CREATE INDEX IF NOT EXISTS idx_blocks_blocker_id_blocked_id ON blocks (blocker_id, blocked_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON reports (reporter_id);
CREATE INDEX IF NOT EXISTS idx_referrals_inviter_id_invitee_email ON referrals (inviter_id, invitee_email);
CREATE INDEX IF NOT EXISTS idx_rss_cache_feed_url ON rss_cache (feed_url);
CREATE INDEX IF NOT EXISTS idx_playlist_episodes_cache_playlist_id ON playlist_episodes_cache (playlist_id);
