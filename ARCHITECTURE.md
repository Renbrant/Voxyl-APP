# Voxyl Architecture

This document describes the high-level architecture of the Voxyl 0.3.x beta line and the responsibilities of its main components.

---

## Overview

Voxyl is a podcast discovery, playlist, social, and audio playback application.

The project includes:

- A React web application
- A Progressive Web App
- An Android application built with Capacitor
- A Cloudflare Workers backend
- A Cloudflare D1 database
- Cloudflare R2 media storage
- Cloudflare Pages deployment
- Clerk authentication

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
          /           \
         v             v
 Cloudflare D1    Cloudflare R2
   Database       Media Storage
```

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
- Radix UI components

### Responsibilities

The frontend is responsible for:

- User interface
- Public podcast discovery
- Playlist display and management
- Authentication interaction
- Audio player state
- Local episode progress
- Android native integrations
- API communication
- Public and protected route behavior
- Offline and PWA support

The primary frontend source is located in:

```text
src/
```

---

## Application Entry Point

The application startup process is centered around:

```text
src/main.jsx
```

Startup responsibilities include:

- Detecting the runtime environment
- Restoring native authentication state
- Hydrating authentication tokens
- Initializing Clerk when configured
- Importing and mounting the React application
- Preventing protected API requests from running before authentication is ready

Authentication initialization must remain early in the startup sequence.

Moving authentication restoration later in the application lifecycle can cause unauthorized `/api/me` requests and unexpected guest sessions.

---

## Authentication

### Provider

Voxyl uses Clerk for authentication.

Relevant frontend files include:

```text
src/lib/AuthContext.jsx
src/lib/OptionalClerkProvider.jsx
src/lib/clerkConfig.js
src/lib/authRedirect.js
src/lib/nativeAuthCallback.js
src/lib/nativeAuthSession.js
src/lib/nativeTokenStorage.js
src/pages/AuthCallback.jsx
```

### Authentication Flow

Typical web flow:

```text
User
  |
  v
Clerk sign-in
  |
  v
Clerk session
  |
  v
Frontend requests token
  |
  v
Authorization: Bearer <JWT>
  |
  v
Cloudflare Workers API validates token
```

Typical Android flow:

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
Clerk / Google authentication
  |
  v
clerk://com.renbrant.voxyl.callback
  |
  v
Clerk SDK SSOReceiverActivity
  |
  v
Active native Clerk session
  |
  v
Capacitor ClerkNative bridge
  |
  v
NativeClerkAuthProvider
  |
  v
Authorization: Bearer <JWT>
  |
  v
Cloudflare Workers API
```

The Android production flow does not persist Clerk JWTs in localStorage or
Capacitor Preferences. Session lifecycle and credential persistence are owned
by the Clerk Android SDK. The Capacitor bridge requests a token only when the
frontend needs to call the Voxyl API.

The web application continues to use Clerk React. Android intentionally does
not mount Clerk React and instead uses the native Clerk provider.

### Public and Protected Access

Public content should remain available without authentication.

Protected actions include operations such as:

- Creating playlists
- Editing playlists
- Following users
- Liking content
- Managing account settings
- Accessing private user resources

The API must not trust a user ID supplied by the frontend for ownership or authorization decisions.

Authenticated identity must come from the validated Clerk token.

---

## Profile and Avatar Architecture

Voxyl stores user-selected profile photos separately from authentication-provider photos.

### D1 fields

`users.profile_picture`

Stores the raw custom Voxyl profile picture.

`users.clerk_profile_picture`

Stores the current Clerk/provider picture synchronized from the authenticated identity.

The provider image must never overwrite a valid custom Voxyl profile picture.

### Avatar precedence

    custom Voxyl/R2 image
        > Clerk/provider image
        > initials fallback

### `/api/me` synchronization

Authenticated `GET /api/me` may synchronize the current provider image into `users.clerk_profile_picture`.

Important invariants:

- provider synchronization does not modify `users.profile_picture`;
- a failed Clerk Backend API request preserves the existing provider image;
- a successful response indicating no real provider image may clear a stale provider image;
- custom and provider values remain independently recoverable.

Profile updates are owner-scoped from the validated Clerk identity.

### API representation

    custom_profile_picture = raw custom image
    clerk_profile_picture  = raw provider image
    profile_picture        = resolved custom-or-provider image
    picture                = resolved custom-or-provider image

### Frontend rendering

Shared avatar rendering lives in:

    src/components/common/UserAvatar.jsx

It provides initials and broken-image fallback consistently across user surfaces.

### Removing a custom image

The **Use login photo** action clears:

    users.profile_picture = NULL

The resolver then falls through to `users.clerk_profile_picture`.

### Playlist synchronization

`playlists.creator_picture` is a denormalized presentation field.

When the resolved avatar changes, the Worker synchronizes owned playlists server-side.

For additional detail, see `docs/profile-avatar-model.md`.

---

## API Client

The frontend communicates with the Voxyl backend through:

```text
src/api/voxylApiClient.js
```

The previous Base44 API client was removed during the Cloudflare/Clerk migration and is no longer used by the production application.

The API client is responsible for:

- Resolving the configured API URL
- Attaching authentication tokens
- Handling JSON requests and responses
- Normalizing errors
- Supporting public and protected endpoints

Production API base URL:

```text
https://api.voxyl.renbrant.com/api
```

---

## Cloudflare Workers API

The backend is implemented as a Cloudflare Worker.

Primary files:

```text
workers/api/src/index.ts
workers/api/wrangler.toml
workers/api/README.md
```

### Responsibilities

The Worker handles:

- HTTP routing
- Authentication validation
- Public playlist reads
- Authenticated user resolution
- D1 database access
- R2 media integration
- API response normalization
- Compatibility with migrated Base44 data

### API Security

Protected endpoints must:

1. Read the bearer token.
2. Validate the token with Clerk.
3. Resolve the authenticated Clerk user ID.
4. Perform authorization on the server.
5. Ignore client-provided ownership claims.

Public endpoints should return only fields safe for unauthenticated access.

---

## Cloudflare D1

Cloudflare D1 stores structured application data.

Schema and migrations are located in:

```text
workers/api/migrations/
```

Current migration sequence:

```text
0001_initial_schema.sql
0002_base44_compat_schema.sql
0003_podcast_play_idempotency.sql
0004_clerk_profile_picture.sql
```

### Stored Data

D1 is intended to store data such as:

- Users
- Playlists
- Playlist feeds
- Playlist ownership
- Social relationships
- Likes
- Follow requests
- Reports
- Migrated Base44 identifiers
- Media references

### Compatibility Fields

Voxyl 0.3.x preserves selected legacy Base44 identifiers to support:

- Data reconciliation
- Migration validation
- Existing public links
- Ownership mapping
- Gradual removal of legacy dependencies

Legacy identifiers should not be used as the primary authentication identity.

Clerk user IDs are the authoritative identity for new authenticated operations.

---

## Cloudflare R2

Cloudflare R2 stores media previously hosted by Base44.

Typical content includes:

- Playlist cover images
- Imported media assets
- Application-managed images

Migration tooling:

```text
scripts/migrate-base44-files-to-r2.mjs
```

R2 URLs should be stored in D1 or returned by the API rather than constructed inconsistently in frontend components.

---

## Data Migration

The Voxyl 0.3.x repository retains migration tooling for reconciliation, validation, and historical support.

### Base44 Export

```text
base44/functions/exportBase44Data/entry.ts
```

This function was introduced to extract legacy production data from Base44.

It should be treated as migration tooling, not part of the long-term application architecture.

### D1 Import

```text
scripts/import-base44-csv-to-d1.mjs
```

Responsibilities include:

- Reading exported Base44 data
- Normalizing legacy fields
- Generating D1-compatible SQL
- Supporting Windows execution
- Producing remote-safe import output

### Media Migration

```text
scripts/migrate-base44-files-to-r2.mjs
```

Responsibilities include:

- Locating Base44 media references
- Uploading assets to R2
- Replacing legacy media URLs
- Supporting remote migration workflows

Migration output should be reviewed before being applied to production.

---

## Cloudflare Pages

The web frontend is deployed through Cloudflare Pages.

Production branch:

```text
main
```

Build command:

```text
npm run build
```

Build output directory:

```text
dist
```

Production domain:

```text
https://v.renbrant.com
```

Every push to `main` triggers an automatic production deployment.

---

## Build Metadata

The build command runs:

```text
vite build && node scripts/generate-version.mjs
```

The version generator creates:

```text
dist/version.json
```

Metadata sources include:

- `package.json` version
- `CF_PAGES_COMMIT_SHA`
- `CF_PAGES_BRANCH`
- Local Git information as fallback
- Build timestamp

Production version verification:

```powershell
curl.exe -s https://v.renbrant.com/version.json
```

This endpoint is the authoritative way to determine which Git commit is running in production.

---

## Android Application

The Android application uses Capacitor.

Relevant files and directories:

```text
android/
capacitor.config.ts
android/app/src/main/java/com/renbrant/voxyl/VoxylApplication.java
android/app/src/main/java/com/renbrant/voxyl/ClerkNativePlugin.java
android/app/src/main/java/com/renbrant/voxyl/MainActivity.java
src/lib/nativeClerk.js
src/lib/AuthContext.jsx
src/lib/OptionalClerkProvider.jsx
src/lib/nativeAudioPlayer.js
```

Legacy Base44-era native authentication helpers may remain temporarily in the
repository for compatibility during migration cleanup, but they are not the
active Clerk Android authentication path.

### Android Responsibilities

The native layer supports:

- System browser authentication
- App Links and callback handling
- Persistent native preferences
- Background audio
- Native audio queue management
- Application state events
- Session restoration

### Android Package

```text
com.renbrant.voxyl
```

### Android Clerk Authentication

Production Android authentication uses Clerk hosted auth through the Clerk
Android SDK.

Package:

```text
com.renbrant.voxyl
```

Native Clerk callback:

```text
clerk://com.renbrant.voxyl.callback
```

The Clerk SDK registers and handles this callback through its
SSOReceiverActivity; Voxyl does not manually forward this callback through
MainActivity.

The Android WebView uses this origin:

```text
https://localhost
```

The Worker authorized-party/CORS configuration must therefore include
https://localhost. capacitor://localhost remains allowed for Capacitor
compatibility but is not the origin observed from the production Android
WebView during physical-device testing.

Release builds require a Clerk Production publishable key (pk_live_...).
Debug and release Clerk configuration are separated in the Android Gradle
configuration so a release build cannot silently ship with a Development
publishable key.

Authentication state is exposed to React through ClerkNativePlugin and
src/lib/nativeClerk.js. Login, token retrieval, logout, and session restore
all pass through the active AuthContext provider.

---

## Audio Player

The player architecture combines React state with native Android playback.

Relevant files include:

```text
src/lib/PlayerContext.jsx
src/lib/nativeAudioPlayer.js
src/components/player/
```

Responsibilities include:

- Current episode state
- Playback controls
- Queue management
- Episode progress
- Background playback
- Automatic next-episode playback
- Native-to-web synchronization
- Player persistence across navigation

Native Android playback behavior must be tested on a real device because browser testing does not reproduce background execution restrictions.

---

## Caching

Voxyl uses several caching layers.

### Browser and Local Cache

Used for:

- Episode progress
- RSS feed data
- Playlist state
- Session recovery
- Offline behavior

Relevant files include:

```text
src/lib/episodeProgressCache.js
src/lib/playlistCacheManager.js
src/lib/playlistCoverHelper.js
```

Cache keys must be collision-resistant.

Podcast feed URLs must not be identified using truncated Base64 values because different URLs may share the same prefix.

---

## Service Worker and PWA

PWA behavior is implemented through files such as:

```text
public/sw.js
```

Responsibilities include:

- Application shell caching
- Offline fallback behavior
- Controlled asset updates
- PWA installation support

Service worker changes require careful cache-version handling to avoid serving stale application bundles after deployment.

---

## Configuration

### Frontend Production Configuration

```text
.env.production
.env.production.example
```

Public frontend configuration may include:

```text
VITE_VOXYL_API_URL
VITE_CLERK_PUBLISHABLE_KEY
```

Only public values may use the `VITE_` prefix because Vite exposes them to the browser bundle.

### Worker Configuration

```text
workers/api/wrangler.toml
```

This file defines:

- Worker name
- Custom domains
- D1 bindings
- R2 bindings
- KV bindings
- Non-secret Worker configuration

Secrets must be configured through Cloudflare and must not be committed.

---

## Repository Structure

```text
Voxyl-APP/
├── android/                 Android Capacitor project
├── base44/                  Temporary legacy migration tooling
├── docs/                    Technical and setup documentation
├── public/                  Static assets and service worker
├── scripts/                 Build and migration utilities
├── src/                     React frontend
├── workers/api/             Cloudflare Workers backend
├── ARCHITECTURE.md          Architecture documentation
├── CHANGELOG.md             Release history
├── CONTRIBUTING.md          Contribution conventions
├── capacitor.config.ts      Capacitor configuration
├── package.json             Frontend dependencies and scripts
└── vite.config.js           Vite configuration
```

---

## Deployment Flow

```text
Developer
   |
   v
Git commit
   |
   v
Push to main
   |
   v
Cloudflare Pages build
   |
   +--> npm install
   |
   +--> vite build
   |
   +--> generate version.json
   |
   v
Deploy dist/
   |
   v
https://v.renbrant.com
```

The Workers API is deployed separately from the Pages frontend when backend code changes.

---

## Architectural Principles

### Server-Side Authorization

Authorization must be enforced by the Worker, never only by the UI.

### Public Data Minimization

Public endpoints should expose only the fields required by the public experience.

### Platform Independence

The system should avoid introducing another tightly coupled proprietary application backend.

Cloudflare services and Clerk should remain behind clear application abstractions.

### Migration Safety

Production migrations should be:

- Repeatable where possible
- Reviewable
- Backed up
- Tested locally
- Applied in controlled steps

### Observable Deployments

Every production build must remain traceable to an exact Git commit.

### Mobile Reliability

Authentication, background audio, and session restoration must be designed for Android lifecycle behavior rather than browser-only assumptions.

---

## Future Architecture Work

Potential future improvements include:

- Removing temporary Base44 export code after migration validation
- Expanding automated API tests
- Adding Worker deployment automation
- Adding D1 migration validation in CI
- Adding structured API logging
- Adding error monitoring
- Adding automated Android build validation
- Documenting backup and disaster recovery procedures
- Formalizing API versioning
