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

The People dashboard consumes authoritative summary counts from the Worker rather than deriving counts only from rendered client collections.

### Library

Library owns saved and user-managed collections.

### Profile

Profile owns identity, public profile representation, avatar preferences, and account settings.

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

Current documented Android release:

```text
Voxyl 0.4.3
versionCode 403
source 888af88480390c3d519d54643548dcea3236d9ce
```

The v0.4.3 milestone completes UX Phase 4 with the dedicated People dashboard while preserving the Cloudflare/Clerk platform and process-owned Media3 playback foundations.
