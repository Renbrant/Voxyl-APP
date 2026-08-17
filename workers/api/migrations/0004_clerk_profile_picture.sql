PRAGMA foreign_keys = ON;

-- 0004_clerk_profile_picture.sql
-- Keeps the authentication-provider avatar separate from a user-selected
-- Voxyl profile picture.
--
-- Avatar precedence:
--   1. users.profile_picture        = custom Voxyl/R2 picture
--   2. users.clerk_profile_picture  = Clerk/Google provider picture
--   3. UI fallback                  = generic user avatar
--
-- This allows a custom picture to override the login-provider picture without
-- losing the provider picture, so removing the custom picture can restore it.

ALTER TABLE users ADD COLUMN clerk_profile_picture TEXT;