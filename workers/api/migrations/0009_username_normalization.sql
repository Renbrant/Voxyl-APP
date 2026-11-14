-- Normalizes stored usernames and enforces case-insensitive uniqueness.
--
-- The username flow previously validated availability in the browser, so the
-- database only had the case-sensitive UNIQUE constraint created in 0001.
-- "Renato" and "renato" could both be claimed, and nothing stopped two
-- concurrent requests from claiming the same handle.
--
-- Order matters here: collisions are resolved before the lowercase rewrite,
-- otherwise lowercasing "Renato" would hit the existing UNIQUE constraint when
-- "renato" already exists.

-- 1. Resolve case-insensitive collisions. The earliest row keeps the handle;
--    later rows get a short suffix derived from their own id, so the result is
--    deterministic and the affected users can pick a new handle in the app.
UPDATE users
SET username = users.username || '-' || LOWER(SUBSTR(REPLACE(users.id, '-', ''), 1, 6)),
    updated_at = CURRENT_TIMESTAMP
WHERE users.username IS NOT NULL
  AND TRIM(users.username) <> ''
  AND EXISTS (
    SELECT 1
    FROM users other
    WHERE other.id <> users.id
      AND other.username IS NOT NULL
      AND TRIM(other.username) <> ''
      AND LOWER(TRIM(other.username)) = LOWER(TRIM(users.username))
      AND (COALESCE(other.created_at, ''), other.id) < (COALESCE(users.created_at, ''), users.id)
  );

-- 2. Store every username trimmed and lowercased, matching what the Worker
--    now accepts.
UPDATE users
SET username = LOWER(TRIM(username)),
    updated_at = CURRENT_TIMESTAMP
WHERE username IS NOT NULL
  AND TRIM(username) <> ''
  AND username <> LOWER(TRIM(username));

-- 3. Treat whitespace-only usernames as unset.
UPDATE users
SET username = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE username IS NOT NULL
  AND TRIM(username) = '';

-- 4. Enforce case-insensitive uniqueness for every claimed handle.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
  ON users (LOWER(username))
  WHERE username IS NOT NULL AND TRIM(username) <> '';

-- 5. Keep playlist creator handles aligned with the rewritten usernames.
UPDATE playlists
SET creator_username = (
      SELECT owner.username
      FROM users owner
      WHERE owner.id = playlists.creator_id
    )
WHERE creator_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM users owner
    WHERE owner.id = playlists.creator_id
      AND COALESCE(owner.username, '') <> COALESCE(playlists.creator_username, '')
  );
