# Voxyl Architecture

This document describes the high-level architecture of the current Voxyl **0.4.x beta line** and the responsibilities of its main components.

---

## Overview

Voxyl is a podcast discovery, playlist, social, and audio playback application available as a web/PWA experience and as an Android application.

The production architecture includes:

- React + Vite frontend
- Progressive Web App support
- Android application built with Capacitor
- Cloudflare Pages frontend hosting
- Cloudflare Workers API
- Cloudflare D1 relational data
- Cloudflare R2 media storage
- Cloudflare KV supporting/cache data
- Clerk authentication
- Android Media3 persistent playback

High-level architecture:

```text
Web Browser / Android Application
               |
               v
        React + Vite Frontend
               |
       Clerk session and JWT
               |
               v
     Cloudflare Workers API
       /        |        \
      v         v         v
     D1        R2        KV

Android only:
React / Capacitor UI
       |
       v
VoxylPlaybackPlugin
       |
       v
VoxylPlaybackService
(Media3 MediaSessionService)
```

---

## Product Navigation Architecture

The current application has five canonical primary destinations:

**Home · Discover · People · Library · Profile**

### Home

Home owns personalized and activity-driven listening surfaces:

- For You
- Trending based on 90-day playback activity
- Last Week based on 7-day playback activity
- Continue Listening
- recently played playlists and podcasts
- listening history

### Discover

Discover is intentionally content-focused:

- Playlists
- Podcasts

People search is not part of Discover.

### People

People is the dedicated social surface:

- Following
- Followers
- Requests
- Suggestions
- people search
- incoming-request navigation badges
- relationship-aware public-profile navigation
- explicit Follow, Follow back, Following, and Unfollow states
- Accept/Decline handling for incoming requests

The People dashboard consumes authoritative summary counts from the Worker rather than deriving counts only from rendered client collections.

People detail flows reconcile mutations with the visible social state so request cards, counts, badges, and relationship labels update coherently after a successful action. Relationship authorization remains server-owned; UI state is not an authority boundary.

### Library

Library owns saved and user-managed collections.

### Profile

Profile owns identity, public profile representation, avatar preferences, and account settings.

Public profiles expose social relationship context but do not replace People as the primary social-management destination.

---

## Frontend

### Technologies

- React
- Vite
- React Router
- TanStack React Query
- Capacitor
- Clerk React SDK
- Tailwind CSS
- Radix UI

### Responsibilities

The frontend is responsible for:

- user interface and navigation;
- podcast and playlist discovery;
- personalized Home presentation;
- People/social presentation;
- relationship-aware public-profile presentation;
- playlist display and management;
- authentication interaction;
- web audio/player state;
- Android native playback control/reconnection;
- episode progress and resume surfaces;
- API communication;
- public/protected route behavior;
- PWA/offline support.

Primary source:

```text
src/
```

---

## Application Entry Point

Application startup is centered around:

```text
src/main.jsx
```

Startup responsibilities include:

- detecting runtime environment;
- restoring native authentication state;
- hydrating authentication tokens;
- initializing Clerk when configured;
- mounting the React application;
- preventing protected API requests before authentication readiness.

Authentication restoration must remain early in startup to avoid unauthorized `/api/me` requests and false guest sessions.

---

## Authentication

### Provider

Voxyl uses Clerk.

Relevant frontend/native files include:

```text
src/lib/AuthContext.jsx
src/lib/OptionalClerkProvider.jsx
src/lib/clerkConfig.js
src/lib/nativeClerk.js
android/app/src/main/java/com/renbrant/voxyl/ClerkNativePlugin.java
```

### Web flow

```text
User
  |
  v
Clerk sign-in
  |
  v
Clerk React session
  |
  v
Bearer JWT
  |
  v
Cloudflare Workers API
```

### Android flow

```text
Android app
  |
  v
Clerk Android SDK hosted authentication
  |
  v
System browser
  |
  v
clerk://com.renbrant.voxyl.callback
  |
  v
Clerk native session
  |
  v
Capacitor ClerkNative bridge
  |
  v
Bearer JWT
  |
  v
Cloudflare Workers API
```

The Android production flow does not persist Clerk JWTs in localStorage or Capacitor Preferences. Session lifecycle and credential persistence are owned by the Clerk Android SDK; the bridge obtains a token when the frontend needs to call the API.

The web application uses Clerk React. Android intentionally uses the native Clerk provider.

### Authorization invariant

The API must not trust a user ID supplied by the frontend for ownership or authorization decisions. Authenticated identity comes from the validated Clerk token.

---

## Profile and Avatar Architecture

Voxyl stores user-selected profile photos separately from authentication-provider photos.

D1 fields:

```text
users.profile_picture
users.clerk_profile_picture
```

Avatar precedence:

```text
custom Voxyl/R2 image
    > Clerk/provider image
    > initials fallback
```

Provider synchronization must never overwrite a valid custom Voxyl image.

Shared frontend rendering lives in:

```text
src/components/common/UserAvatar.jsx
```

`playlists.creator_picture` is a denormalized presentation field synchronized server-side when the resolved avatar changes.

See [docs/profile-avatar-model.md](docs/profile-avatar-model.md).

---

## API Client

Frontend API communication is centralized in:

```text
src/api/voxylApiClient.js
```

Responsibilities include:

- API URL resolution;
- bearer-token attachment;
- JSON request/response handling;
- normalized errors;
- public and protected API access;
- People summary access and other feature-specific API contracts.

Production API base URL:

```text
https://api.voxyl.renbrant.com/api
```

---

## Cloudflare Workers API

Primary backend files:

```text
workers/api/src/index.ts
workers/api/wrangler.toml
workers/api/README.md
```

Responsibilities include:

- HTTP routing;
- Clerk JWT validation;
- authenticated user resolution;
- public podcast/playlist reads;
- People/social summary and relationship logic;
- follow/follow-back/unfollow/request mutation authorization;
- D1 database access;
- R2 media integration;
- API response normalization;
- compatibility with migrated Base44 data.

Protected operations must resolve ownership and authorization server-side.

---

## Cloudflare D1

Migrations:

```text
workers/api/migrations/0001_initial_schema.sql
workers/api/migrations/0002_base44_compat_schema.sql
workers/api/migrations/0003_podcast_play_idempotency.sql
workers/api/migrations/0004_clerk_profile_picture.sql
```

D1 stores structured data including:

- users;
- playlists and playlist feeds;
- social relationships and follow requests;
- likes;
- podcast play/activity records;
- reports;
- migrated Base44 identifiers;
- media references.

Legacy Base44 identifiers are compatibility/reconciliation data, not the primary authenticated identity. Clerk user IDs are authoritative for current authenticated operations.

---

## Cloudflare R2

R2 stores application-managed media such as:

- playlist cover images;
- profile images;
- migrated media assets.

R2 URLs should be persisted or returned through consistent API contracts rather than reconstructed independently across frontend components.

---

## Cloudflare KV

KV is used for supporting/cache workloads where appropriate. Durable application relationships and authoritative user/social state belong in D1, not in client-only state or cache.

---

## Data Migration History

The production application no longer depends on Base44. Migration utilities remain for historical traceability and reconciliation.

```text
base44/functions/exportBase44Data/entry.ts
scripts/import-base44-csv-to-d1.mjs
scripts/migrate-base44-files-to-r2.mjs
```

See [docs/cloudflare-clerk-migration-plan.md](docs/cloudflare-clerk-migration-plan.md) for the historical migration design.

---

## Cloudflare Pages and Web Provenance

Production domain:

```text
https://v.renbrant.com
```

Production branch:

```text
main
```

Build command:

```text
npm run build
```

Build output:

```text
dist/
```

The build command generates:

```text
dist/version.json
```

Production verification endpoint:

```text
https://v.renbrant.com/version.json
```

Git state and deployment state are separate. A merged commit is not proof that the matching web artifact is live; production provenance is established by the deployed `version.json` plus runtime smoke.

The Workers API is deployed separately when backend code changes.

---

## Android Application

The Android application uses Capacitor with native Clerk integration and process-owned Media3 playback.

Relevant files include:

```text
android/
capacitor.config.ts
android/app/src/main/java/com/renbrant/voxyl/VoxylApplication.java
android/app/src/main/java/com/renbrant/voxyl/ClerkNativePlugin.java
android/app/src/main/java/com/renbrant/voxyl/MainActivity.java
android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java
android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackService.java
src/lib/nativeClerk.js
src/lib/nativeAudioPlayer.js
src/lib/PlayerContext.jsx
```

### Package identity

```text
com.renbrant.voxyl
```

### Android authentication callback

```text
clerk://com.renbrant.voxyl.callback
```

### WebView origin

```text
https://localhost
```

Worker authorized-party/CORS configuration must include the production Android WebView origin.

Release builds require a Clerk production publishable key (`pk_live_...`). Development Clerk configuration must not silently enter a production Android build.

---

## Persistent Android Playback

Persistent Android playback is a core architectural invariant introduced in v0.3.2 and retained throughout the v0.4.x line.

### Ownership model

```text
Android process
   |
   v
VoxylPlaybackService
   |
   +--> one ExoPlayer / Media3 player authority
   +--> one MediaSession
   +--> authoritative queue/current item/state

Activity / WebView / React UI
   |
   v
VoxylPlaybackPlugin controller bridge
   |
   v
reconnects to the process-owned authority
```

Important invariants:

- Activity/WebView recreation does not create another playback engine;
- UI reconnection reads native state rather than assuming UI state is authoritative;
- queue/current item/playback position remain owned by the native playback authority while active;
- repeated close/reopen cycles must not create duplicate or orphaned streams;
- stop/pause semantics must control the actual native authority.

The authority described above is process-owned. Activity/task recreation and process death are different lifecycle contracts: process-death restoration or OS media resumption must be tested and claimed separately when required.

Native playback changes require physical-device lifecycle validation because browser-only testing cannot reproduce Android process/service behavior reliably.

---

## Caching and Progress

Browser/local caching supports:

- episode progress;
- RSS/feed data;
- playlist state;
- session recovery;
- offline behavior.

Relevant files include:

```text
src/lib/episodeProgressCache.js
src/lib/playlistCacheManager.js
src/lib/playlistCoverHelper.js
```

Cache keys for podcast feeds must remain collision-resistant.

---

## Service Worker and PWA

PWA behavior is implemented through files such as:

```text
public/sw.js
```

Responsibilities include application-shell caching, offline fallback, controlled asset updates, and installability.

Service-worker changes require careful cache-version handling to avoid stale bundles after deployment.

---

## Configuration

Frontend production configuration:

```text
.env.production
.env.production.example
```

Public frontend values may use the `VITE_` prefix because they are bundled for the browser. Secrets must not use `VITE_`.

Worker configuration lives in:

```text
workers/api/wrangler.toml
```

Cloudflare/Clerk secrets must be configured through the corresponding service/environment and must not be committed.

---

## Repository Structure

```text
Voxyl-APP/
├── android/                 Android Capacitor project
├── base44/                  Historical migration tooling
├── docs/                    Current technical/operational docs
├── patches/                 patch-package fixes
├── promo/                   Marketing/README assets
├── public/                  Static assets and service worker
├── scripts/                 Build/migration utilities
├── screenshot/              Product screenshots
├── src/                     React frontend
├── tests/                   Automated regression suite
├── workers/api/             Cloudflare Workers backend
├── ARCHITECTURE.md          Current architecture
├── CHANGELOG.md             Authoritative release history
├── CONTRIBUTING.md          Engineering workflow
└── TESTING_GUIDE.md         Validation strategy
```

---

## Engineering and Release Principles

### Server-side authorization

Authorization belongs in the Worker, never only in UI state.

### Authoritative data

Counts and relationship state that drive product behavior should come from authoritative backend data rather than inferred client rendering when correctness matters.

### Stateful runtime ownership

Long-lived native capabilities such as Android playback must have one explicit authority independent from Activity/WebView lifecycle.

### Observable deployments

Every production artifact should be traceable to an exact source commit.

### Immutable release artifacts

Once a signed Android artifact passes identity, provenance, signer, size, and SHA-256 gates, downstream validation should consume that frozen artifact rather than rebuild it after unrelated external failures.

### Upgrade validation

A true Android upgrade requires a verified previous-version baseline and an in-place install. Same-version installation is useful evidence but is not the same claim.

### Published-byte verification

An Android GitHub Release is not fully evidenced merely because upload succeeded. The published asset should be downloaded and compared by size and SHA-256 to the validated frozen artifact.

### Methodology

AI-assisted engineering work follows the project-adopted methodology repository:

```text
https://github.com/Renbrant/ai-assisted-development-methodology
```

Project-specific architecture and procedures stay in Voxyl; generic engineering rules belong in the methodology repository.

---

## Current Release Baseline

Current source release baseline:

```text
Voxyl 0.6.12
versionCode 612
```

The v0.6.12 candidate signs out of the native Clerk session after account deletion on Android (issue #104).
The v0.6.11 candidate raises the beta limits for standard accounts to 5 playlists and 10 podcasts per playlist (from 2 and 5), in the Worker and in the client modals.

The v0.6.10 candidate adds a test APK download to the landing page next to the stable v0.4.13 APK, labeled with the source version.

The v0.6.9 candidate restores background auto-advance and the full episode list: R8 is disabled again for release builds until background playback is validated on a device, RSS fetch has its own rate limit (`RL_RSS`, 300 per minute) separate from podcast search, playlist feeds are fetched at most four at a time, and playlist cards no longer fetch feeds for their cover.

The v0.6.8 candidate removes the custom `popstate` handler so React Router owns Back/Forward (issue #117) and adds a sign-out action to the account sync failure screen (issue #140).

The v0.6.7 candidate hardens image uploads (issue #116): type, extension and dimensions are decided from the file bytes, request and file sizes are bounded, and each account has an object and byte quota.

The v0.6.6 candidate closes anonymous user enumeration (issue #144): `searchUsers` and the new `getUserSuggestions` require a session, search needs two or more characters and escapes wildcards, anonymous profiles omit the real name, and blocks hide profiles and playlists in both directions.

The v0.6.5 candidate fixes a signed-in startup crash on Home caused by a missing `getCache` import in v0.6.2.

The v0.6.4 candidate removes the hardcoded admin email (issue #145): admin access comes from the D1 role, `ADMIN_CLERK_USER_IDS` or `ADMIN_EMAILS`, and the client reads `is_admin` from `/api/me`.

The v0.6.3 candidate removes unused dependencies and applies non-breaking audit fixes (issue #115); see `docs/dependency-policy.md`.

The v0.6.2 candidate centralizes the client block state (issue #48). Hidden-user ids and the outbound block list live in TanStack Query (`src/lib/blocks.js`, keys under `['blocks', ...]`); Home, Discover, People, Settings and the Blocked Users modal read the same cache entries, and every block or unblock calls `refreshBlockQueries`, which invalidates them together with the block-dependent feeds. Content is matched to hidden users only by the canonical `creator_id`. The Settings blocked count loads on open instead of waiting for the modal.

The v0.6.1 candidate hardens the Android release (issue #146). The Worker rewrites plain-HTTP enclosure and artwork URLs to HTTPS in `absolutePublicUrl`, so the WebView and the native player never receive cleartext media. `allowMixedContent` is removed from `capacitor.config.ts`. `android:allowBackup` is `false`, so the Clerk session and WebView storage are not included in cloud backup or device transfer. R8 and resource shrinking are enabled for the release build, with keep rules for the Capacitor plugin bridge and the audio plugin in `android/app/proguard-rules.pro`. These changes need device validation: release AAB playback in the background, lock-screen controls, and Clerk sign-in.

The v0.6.0 candidate requires every account to accept the Terms of Use before creating playlists, uploading files or claiming a username. `POST /api/me/accept-terms` records the accepted version in `users.terms_accepted_version` and `terms_accepted_at` (migration 0010). Requests without acceptance receive `403` with `code: terms-not-accepted`; a version that is no longer current receives `409` with `code: terms-version-mismatch`. The legal text is a draft pending legal review.

The v0.5.0 candidate adds rate limiting through the Workers Rate Limiting API. Three bindings (`RL_PUBLIC`, `RL_EXPENSIVE`, `RL_WRITE`) are declared in `workers/api/wrangler.toml`. The dispatcher checks them before routing: podcast search and RSS fetch are limited per user when the caller is authenticated and per IP otherwise, public discovery routes are limited per IP, and authenticated writes are limited per user. A limited request returns 429 with `code: rate-limited` and `Retry-After: 60`. A missing binding disables enforcement, so local development and tests run unlimited. Clients do not retry 429 responses automatically.

The v0.4.16 candidate moves username validation to the Worker. `PATCH /api/me` now normalizes the handle (trimmed, leading `@` removed, lowercased), enforces length, character and reserved-name rules, and claims it with a precondition guarded by the case-insensitive unique index added in migration 0009, so concurrent claims cannot share a handle. An unavailable handle returns `409` with code `username-taken` and no information about the account that holds it. `playlists.creator_username` is updated in the same D1 batch as the claim. The browser no longer checks availability itself: the generic `User` entity client and the non-existent `syncUsername` function call were removed, and the setup modal reads its text from the i18n catalog.

The v0.4.15 candidate adds authenticated content reporting. `POST /api/reports` derives the reporter from the verified Clerk session, resolves the reported user and content title on the server, enforces one open report per reporter and content with a partial unique index (migration 0008), increments `playlists.reports_count` in the same D1 batch only when the insert happened, and limits each account to 20 reports per day. `GET /api/admin/reports` and `PATCH /api/admin/reports/:id` back the moderation queue in `/admin` and require an administrator. The generic `Report` entity client was removed from the frontend.

The v0.4.14 candidate adds authenticated playlist creation, atomic beta quotas and persisted per-owner idempotency. Migration 0007 adds nullable request keys/hashes without modifying existing playlist data. The frontend retains operation keys for retries and bounds creation requests to 20 seconds. The previous playback presentation behavior remains intact.

The v0.4.12 source fixes the native audio bridge initialization failure observed on the Android device: the legacy App bridge returns a listener handle synchronously, so calling `.catch()` on its result throws before playback readiness. Awaiting the registration directly accepts handles and Promises. The optional app-state listener is guarded independently so its failure does not disable the Media3 player. Native startup continues to open `/app`; browser root entry continues to show the landing page.
