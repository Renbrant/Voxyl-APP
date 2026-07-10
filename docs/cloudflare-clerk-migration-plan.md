# Voxyl Cloudflare + Clerk Migration Plan

## 1. Current Base44 dependency inventory

Voxyl currently depends on Base44 for frontend SDK access, authentication, database-like entities, server functions, file upload, image generation, invite flow, RSS caching, playlist episode caching, and Android/Capacitor token restoration.

Base44 packages and config:

- `@base44/sdk`
- `@base44/vite-plugin`
- `src/api/base44Client.js`
- `src/lib/app-params.js`
- `vite.config.js` Base44 plugin
- `.env.production` and `.env.production.example`

Base44 frontend API surfaces currently used:

- `base44.auth.me`
- `base44.auth.isAuthenticated`
- `base44.auth.updateMe`
- `base44.auth.logout`
- `base44.auth.redirectToLogin`
- `base44.auth.setToken`
- `base44.entities.*`
- `base44.functions.invoke(...)`
- `base44.integrations.Core.UploadFile`
- `base44.integrations.Core.GenerateImage`
- `base44.users.inviteUser`

Base44-hosted URLs and assets:

- `https://voxyl-app.base44.app`
- `https://voxyl.base44.app`
- `https://media.base44.com/images/public/.../voxyllogo.png`

Frontend files that currently import or call Base44 include:

- `src/api/base44Client.js`
- `src/lib/app-params.js`
- `src/lib/AuthContext.jsx`
- `src/lib/authRedirect.js`
- `src/lib/nativeAuthSession.js`
- `src/lib/PageNotFound.jsx`
- `src/lib/PlayerContext.jsx`
- `src/lib/playlistCacheManager.js`
- `src/lib/playlistCoverHelper.js`
- `src/lib/episodeProgressCache.js`
- `src/hooks/useRequireAuth.js`
- `src/pages/Explore.jsx`
- `src/pages/Feed.jsx`
- `src/pages/PlaylistDetail.jsx`
- `src/pages/PlaylistPreview.jsx`
- `src/pages/Playlists.jsx`
- `src/pages/PodcastDetail.jsx`
- `src/pages/Profile.jsx`
- `src/pages/Settings.jsx`
- `src/pages/UserProfile.jsx`
- `src/components/Layout.jsx`
- `src/components/common/BottomNav.jsx`
- `src/components/common/Sidebar.jsx`
- `src/components/explore/AddToPlaylistModal.jsx`
- `src/components/feed/MyPlaylistsContent.jsx`
- `src/components/moderation/ReportBlockMenu.jsx`
- `src/components/notifications/FollowRequestsBell.jsx`
- `src/components/playlist/CreatePlaylistModal.jsx`
- `src/components/playlist/EditPlaylistModal.jsx`
- `src/components/profile/BlockedUsersModal.jsx`
- `src/components/profile/DeleteAccountModal.jsx`
- `src/components/profile/FollowButton.jsx`
- `src/components/profile/FollowRequestsModal.jsx`
- `src/components/profile/InviteFriendModal.jsx`
- `src/components/profile/UsernameSetupModal.jsx`
- `src/components/profile/ShareAppModal.jsx`

## 2. Base44 entities and proposed D1 tables

| Base44 entity | Current purpose | Proposed D1 table |
| --- | --- | --- |
| `User` | User profile metadata: role, username, hidden profile; Base44 auth also provides email/name/picture | `users` with `id`, `clerk_user_id`, legacy Base44 ID, email, name, username, role, profile image, hidden flag |
| `Playlist` | Playlists, RSS feeds, visibility, cover image, counts, denormalized creator fields | `playlists`; keep `rss_feeds` as JSON initially or split later into `playlist_feeds` |
| `PlaylistLike` | Playlist likes and source of `likes_count` | `playlist_likes` with unique `(playlist_id, user_id)` |
| `PodcastLike` | User-saved podcasts | `podcast_likes` with unique `(user_id, feed_url)` |
| `PodcastPlay` | Playback history and trending analytics | `podcast_plays` |
| `EpisodeProgress` | Cross-device playback progress sync | `episode_progress` with unique `(user_id, audio_url)` |
| `Follow` | Follow requests and accepted follow relationships | `follows` with `status` as `pending` or `accepted` |
| `Block` | User block relationships | `blocks` with unique `(blocker_id, blocked_id)` |
| `Report` | Moderation reports | `reports` |
| `Referral` | Invite/referral tracking | `referrals` |
| `RSSCache` | Server-side RSS feed cache | Prefer KV or Cache API; use D1 only if inspection/querying is required |
| `PlaylistEpisodesCache` | Cached assembled playlist episodes | Prefer KV; D1 acceptable for migration parity |

Migration rule for user IDs:

- Store both the old Base44 user ID and the Clerk user ID during migration.
- Use Clerk user ID as the long-term auth identity.
- Keep legacy Base44 IDs until all old data, links, follows, playlists, and referrals have been verified.

## 3. Base44 functions and proposed Worker API routes

| Base44 function | Current behavior | Proposed Cloudflare Worker route |
| --- | --- | --- |
| `cancelFollowRequest` | Deletes a follow request by `followId` or `targetUserId` if caller is follower | `DELETE /api/follows/request` |
| `cleanupInactivePlaylists` | Admin-only cleanup of playlists inactive for 3 years | Scheduled Worker cron plus admin route |
| `deleteAccount` | Anonymizes playlists, deletes likes, plays, progress, follows, blocks, referrals, reports, hides profile | `POST /api/account/delete` |
| `fetchRSSFeed` | Auth-required SSRF-protected RSS fetch/parser with cache | `POST /api/rss/fetch` |
| `getPublicUserProfile` | Returns safe public user profile fields | `GET /api/users/:id/public` |
| `getTopPlaylistsByPlayback` | Public playlist ranking from recent plays | `GET /api/discovery/top-playlists` |
| `getTopPodcastsByPlayback` | Public podcast ranking from public playlists and recent plays | `GET /api/discovery/top-podcasts` |
| `getUserPlaylists` | Returns playlists visible to caller by owner/follow/visibility rules | `GET /api/users/:id/playlists` |
| `incrementPlaylistPlays` | Increments playlist play count | `POST /api/playlists/:id/play` |
| `proxyAudio` | Auth-required SSRF-safe audio redirect resolver | `POST /api/audio/resolve` |
| `recordPodcastPlay` | Records or updates an episode play; currently allows visitor as `VISITOR` | `POST /api/podcast-plays` |
| `requestFollow` | Creates pending follow request | `POST /api/follows/request` |
| `respondToFollowRequest` | Accepts or declines pending follow request | `POST /api/follows/respond` |
| `searchPodcasts` | Auth-required Podcast Index search using `PODCAST_INDEX_API_KEY` and `PODCAST_INDEX_API_SECRET` | `POST /api/podcasts/search` |
| `searchUsers` | Auth-required user search excluding hidden/current user | `GET /api/users/search` |
| `syncUsername` | Copies changed username into existing playlists | `POST /api/users/me/username` or part of profile update transaction |
| `togglePlaylistLike` | Toggles playlist like and recounts likes | `POST /api/playlists/:id/like` |

Worker API requirements:

- Validate Clerk session JWT on all authenticated routes.
- Enforce authorization in Workers, replacing Base44 RLS.
- Use D1 transactions for like toggles, profile updates, follow responses, delete account, and count updates.
- Keep public discovery endpoints carefully filtered to public playlists only.
- Keep SSRF protections in RSS and audio resolver routes.

## 4. Auth migration plan from Base44 to Clerk

Current Base44 auth responsibilities:

- Determine logged-in user with `base44.auth.me`.
- Check auth state with `base44.auth.isAuthenticated`.
- Redirect to Base44 login with `base44.auth.redirectToLogin`.
- Logout with `base44.auth.logout`.
- Update user profile metadata with `base44.auth.updateMe`.
- Persist native token using `base44_access_token`.
- Restore native sessions by injecting Base44 token into the SDK.

Clerk replacement plan:

- Add Clerk as the source of truth for authentication and Google OAuth.
- Use Clerk user/session state in the React app.
- Create a D1 `users` profile row for every Clerk user.
- Store app-specific fields in D1: username, profile visibility, role, legacy Base44 ID, profile image URL.
- Use Clerk session JWTs for Worker authorization.
- Replace Base44 auth redirects with Clerk sign-in/sign-out flows.
- Replace `auth.updateMe` with a profile update route that updates D1 and, where needed, Clerk user metadata.
- Replace Base44 invite flow with either Clerk invitations or Voxyl-owned referral records in D1.

Recommended auth adapter:

- Introduce a local auth/API abstraction before removing Base44.
- Keep the frontend behavior stable while swapping implementation behind the adapter.
- Do not remove Base44 auth code until Clerk web auth and Android auth are both verified.

## 5. Storage migration plan from Base44 UploadFile to Cloudflare R2

Current Base44 storage/integration usage:

- Profile photo upload uses `base44.integrations.Core.UploadFile`.
- Playlist cover upload uses `base44.integrations.Core.UploadFile`.
- Playlist cover image generation uses `base44.integrations.Core.GenerateImage`.
- Uploaded URLs are stored in user/profile and playlist fields.
- Some app logo assets are hardcoded to `media.base44.com`.

R2 replacement plan:

- Create an R2 bucket for Voxyl media.
- Add Worker upload endpoints for profile photos and playlist covers.
- Store R2 object keys and public URLs in D1.
- Validate file type, size, authenticated owner, and intended media purpose in the Worker.
- Prefer deterministic paths such as:
  - `users/{clerk_user_id}/profile/{uuid}.jpg`
  - `playlists/{playlist_id}/cover/{uuid}.jpg`
- Move hardcoded Base44 logo assets into repo static assets or R2.

Image generation replacement options:

- Phase 1: disable or hide generated playlist covers during migration.
- Phase 2: add Cloudflare Workers AI image generation if quality/cost is acceptable.
- Alternative: integrate another image provider later behind `POST /api/images/generate`.

## 6. RSS/cache migration plan to Cloudflare KV or Cache API

Current cache mechanisms:

- `RSSCache` Base44 entity stores JSON-stringified feed data with `cached_at`.
- `PlaylistEpisodesCache` Base44 entity stores assembled playlist episode data.
- Frontend also uses localStorage caches for feeds, playlist episodes, playback progress, downloads, and saved content.

Cloudflare replacement:

- Use KV or Cache API for RSS fetch results.
- Use KV for playlist episode cache keyed by playlist ID and hash.
- Keep frontend localStorage caches as the fast local layer.
- Keep Worker-side RSS cache TTL near current behavior:
  - RSS cache: 1 hour server-side.
  - Frontend feed cache: 30 days localStorage.
  - Playlist episode cache: 1 hour localStorage.
- Preserve stale cache fallback for RSS fetch failures.
- Preserve SSRF protection before touching network and before following redirects.

Recommended cache split:

- KV: RSS payloads and playlist episode payloads that need persistence across requests.
- Cache API: short-lived HTTP response caching where URL and auth behavior are simple.
- D1: only metadata that must be queried or audited.

## 7. Android/Capacitor auth callback risks

Current Base44-specific native flow:

- `authRedirect.js` opens Base44 login in Capacitor Browser.
- Login redirects through `https://voxyl-app.base44.app/?native_auth_callback=1`.
- `main.jsx` detects `native_auth_callback=1`.
- Token is extracted from `access_token`, `access_tc`, or `token`.
- App redirects to `com.renbrant.voxyl://auth/callback`.
- `nativeAuthCallback.js` stores token in localStorage and Capacitor Preferences.
- `nativeAuthSession.js` restores Base44 auth by injecting token into Base44 SDK and verifying `base44.auth.me`.
- Android manifest supports both App Link and custom scheme callbacks.

Risks when moving to Clerk:

- Clerk may not return a Base44-style `access_token` in the same callback shape.
- Clerk native/Capacitor OAuth behavior must be tested before removing Base44 flow.
- Stored token key `base44_access_token` must be replaced safely without breaking cold-start sessions.
- App Link and custom scheme redirect URLs must be configured in Clerk.
- Logout must clear Clerk state, localStorage, and Capacitor Preferences.
- Android cold start, browser close, App Link launch, and custom scheme launch need full manual testing.

Native migration requirement:

- Do not remove Base44 native auth code until Clerk login, logout, session restore, cold start, and callback handling are verified on Android.

## 8. Recommended phased migration order

1. **Preparation and contracts**
   - Define D1 schema for all Base44 entities.
   - Define Worker API route contracts.
   - Decide legacy Base44 ID to Clerk ID mapping.
   - Keep Base44 fully operational.

2. **Cloudflare foundation**
   - Create Worker project, D1 database, KV namespace, and R2 bucket.
   - Add secrets for Podcast Index and Clerk verification.
   - Implement health check and auth verification route.

3. **Clerk web auth**
   - Add Clerk provider and web login/logout flow.
   - Create D1 user profile sync.
   - Preserve guest browsing behavior.

4. **Read-only API migration**
   - Port public profiles, playlist reads, user playlists, discovery, and podcast search.
   - Compare responses against current Base44 behavior.

5. **Write API migration**
   - Port playlist CRUD, likes, follows, blocks, reports, referrals, and progress sync.
   - Use D1 transactions where counts or multiple tables are involved.

6. **RSS and playback migration**
   - Port RSS fetch/cache and Podcast Index search.
   - Port playback progress and podcast play recording.
   - Validate trending behavior.

7. **R2 media migration**
   - Port profile photo and playlist cover uploads.
   - Replace Base44 media URLs.
   - Decide image generation replacement.

8. **Android/Capacitor migration**
   - Replace Base44 native token flow with Clerk-compatible flow.
   - Test Android login, logout, callback, cold start, and session restore.

9. **Base44 removal**
   - Remove Base44 SDK, plugin, env vars, and old routes only after web and Android are both tested.
   - Archive or delete `base44/` only after data migration is complete and verified.

## 9. Migration checklist

- [ ] Export Base44 entity data.
- [ ] Export or preserve Base44-uploaded media URLs.
- [ ] Create D1 schema.
- [ ] Create D1 indexes and unique constraints.
- [ ] Create Clerk app and configure Google login.
- [ ] Configure Clerk JWT verification for Workers.
- [ ] Create Cloudflare Worker API shell.
- [ ] Create Cloudflare D1 database.
- [ ] Create Cloudflare KV namespace for RSS/cache.
- [ ] Create Cloudflare R2 bucket for uploads.
- [ ] Add Worker secrets for Podcast Index API credentials.
- [ ] Add Worker secrets/config for Clerk verification.
- [ ] Implement `users` sync from Clerk to D1.
- [ ] Implement read-only playlist/profile/discovery APIs.
- [ ] Implement RSS fetch with SSRF protection and cache fallback.
- [ ] Implement podcast search through Worker.
- [ ] Implement playlist create/update/delete APIs.
- [ ] Implement playlist like toggle with transaction.
- [ ] Implement podcast like create/delete APIs.
- [ ] Implement follow request/cancel/respond APIs.
- [ ] Implement block and report APIs.
- [ ] Implement episode progress load/save APIs.
- [ ] Implement podcast play recording and playlist play increment APIs.
- [ ] Implement R2 upload endpoint for profile photos.
- [ ] Implement R2 upload endpoint for playlist covers.
- [ ] Replace Base44 logo/media URLs.
- [ ] Decide whether to defer or replace image generation.
- [ ] Migrate Android auth callback to Clerk-compatible flow.
- [ ] Test web guest mode.
- [ ] Test web login/logout.
- [ ] Test web playlist creation/editing/deletion.
- [ ] Test web RSS fetch/search/playback.
- [ ] Test web social flows: follow, accept, cancel, block, report.
- [ ] Test Android login.
- [ ] Test Android logout.
- [ ] Test Android cold start session restore.
- [ ] Test Android App Link/custom scheme callback.
- [ ] Verify no frontend calls still depend on Base44.
- [ ] Verify no Worker route depends on Base44.
- [ ] Only then remove Base44 packages, plugin, env vars, and code.

## 10. Explicit Base44 removal rule

Do not remove Base44 until both of these are true:

- The web app has been fully tested against Clerk + Cloudflare.
- The Android/Capacitor app has been fully tested against Clerk + Cloudflare, including login, logout, callback handling, and cold-start session restore.

Until both are verified, Base44 code should remain available as a fallback reference and migration safety net.
