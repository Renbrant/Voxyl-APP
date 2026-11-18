# Voxyl: Social Podcast Playlists

**Voxyl** is a social podcast platform for discovering, organizing, sharing, and listening to long-form audio across web and Android.

It combines traditional RSS podcast feeds with personalized activity, playlist curation, and social discovery so listeners can build their own listening experience instead of relying only on a single recommendation feed.

<p align="center">
  <img src="promo/banner.png" width="100%" alt="Voxyl banner">
</p>

---

## Try It Out

Voxyl is currently in **beta**.

### 🌐 Web

**[Open Voxyl Web App](https://v.renbrant.com/)**

### 🤖 Android

**[Download the Voxyl Android test build (APK)](https://github.com/Renbrant/Voxyl-APP/releases/download/android-test/Voxyl-test.apk)**

> **This is a test build.** It is a signed release build published for testing before each Google Play upload, so it may be unstable or ahead of what is on the store. The release notes of the [`android-test` pre-release](https://github.com/Renbrant/Voxyl-APP/releases/tag/android-test) state the exact version and commit.

The link always points to the most recent test build, which is replaced each time the Android release workflow runs.

> Android may ask you to allow installation from unknown sources because the test build is not distributed through Google Play.

Production web deployment metadata is available at:

**[https://v.renbrant.com/version.json](https://v.renbrant.com/version.json)**

---

## Current Product Experience

Voxyl uses five primary destinations:

**Home · Discover · People · Library · Profile**

### Home

Home is personalized around listening activity.

- **For You** — personalized listening surfaces.
- **Trending** — podcast and playlist activity based on the last 90 days.
- **Last Week** — recent activity based on the last 7 days.
- **Continue Listening** — resume episodes with persisted progress.
- Recently played playlists and podcasts.
- Expandable listening history.

### Discover

Discover is intentionally focused on content rather than people.

- **Playlists** — browse community-created podcast playlists.
- **Podcasts** — search and discover podcasts.
- Simplified discovery cards and responsive layouts.

People search no longer belongs to Discover.

### People

People is Voxyl's dedicated social destination.

- **Following** — people you follow, with explicit Following state and access to public profiles.
- **Followers** — people who follow you, including Follows you, Follow back, and mutual relationship states.
- **Requests** — incoming follow requests with Accept and Decline actions and immediate count/badge reconciliation.
- **Suggestions** — eligible people you may want to follow.
- People search lives directly inside the People experience and opens public profiles.
- Public profiles expose relationship-aware Follow, Follow back, Following, and Unfollow states.
- Incoming request counts can surface as navigation badges.

### Library

Library is the primary destination for the listener's saved and owned collections.

### Profile

Profile contains the user's identity, public profile information, account settings, and avatar preferences.

---

## Key Features

- **Smart RSS Aggregation:** Combine up to 5 RSS feeds into a playlist.
- **Custom Podcast Playlists:** Build personalized collections from multiple podcast sources.
- **Social Discovery:** Follow listeners, manage requests, and discover community-curated content.
- **Personalized Home:** For You, 90-day Trending, 7-day Last Week, Continue Listening, and listening history.
- **Dedicated People Experience:** Following, Followers, Requests, Suggestions, people search, relationship-aware public profiles, and follow-request actions.
- **Profile Identity:** Use a Clerk/provider profile image, optionally override it with a custom Voxyl/R2 image, and fall back to initials.
- **Guest Mode:** Explore public content without creating an account.
- **Flexible Visibility:** Set playlists as public, followers-only, or private.
- **Advanced Playback:** Resume episodes, track progress, autoplay the next episode, and continue listening across navigation.
- **Persistent Android Playback:** One process-owned Media3 playback authority with queue/state restoration across Activity and WebView recreation.
- **Episode Filtering:** Filter episodes by publication date and maximum duration.
- **Feed-Level Controls:** Configure intro and outro skip values for individual feeds.
- **Responsive Interface:** Mobile, tablet, and desktop layouts.
- **Theme Support:** Light, Dark, and System-Automatic themes.
- **PWA Support:** Installable web experience with partial offline support.

---

## Screenshots

<p align="center">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/1.png" width="200" alt="Voxyl screenshot 1">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/2.png" width="200" alt="Voxyl screenshot 2">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/3.png" width="200" alt="Voxyl screenshot 3">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/4.png" width="200" alt="Voxyl screenshot 4">
</p>

<p align="center">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/5.png" width="200" alt="Voxyl screenshot 5">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/6.png" width="200" alt="Voxyl screenshot 6">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/7.png" width="200" alt="Voxyl screenshot 7">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/8.png" width="200" alt="Voxyl screenshot 8">
</p>

---

## Current Beta Line: v0.4.x

The 0.4.x line is the UX-focused phase of the Voxyl beta, built on the independent Cloudflare + Clerk platform established during the 0.3.x line.

| Version | UX phase | Main change |
|---|---|---|
| **v0.4.0** | Phase 1 | Five-destination primary navigation: Home · Discover · People · Library · Profile |
| **v0.4.1** | Phase 2 | Personalized and activity-driven Home |
| **v0.4.2** | Phase 3 | Discover focused on Playlists and Podcasts |
| **v0.4.3** | Phase 4 | Dedicated People social dashboard and people search |
| **v0.4.4** | Phase 5 | People detail flows, relationship-aware public profiles, and social interactions |
| **v0.4.5** | Phase 6 | Library dashboard, focused saved-content destinations, and content organization |
| **v0.4.6** | Hardening | Google Play compliance, account deletion, cache isolation, and D1 optimization |
| **v0.4.7** | Maintenance | Home feed Continue Listening optimization to 2 episodes and responsive grid |
| **v0.4.8** | Telemetry | Cloudflare quota reset countdown timer and reset telemetry |
| **v0.4.9** | Player | Playlist skip visualization and outro skip completion recording |
| **v0.4.10** | Player | Audio player close control with playback stop and progress persistence |
| **v0.4.11** | Android | Native startup opens Home directly; the landing page remains a browser entry |
| **v0.4.12** | Android player | Native audio initialization accepts legacy listener handles and optional lifecycle listener failures |
| **v0.4.13** | Playback presentation | Gray skip zones, visible position dots, singular day filters and total/playable episode durations |

| **v0.4.14** | Playlist creation (unreleased) | Authenticated creation API, atomic beta limits, safe retries and recoverable save errors |
| **v0.4.15** | Content reports (Worker deployed) | Authenticated `POST /api/reports`, one open report per reporter and content, admin moderation queue, recoverable report errors |
| **v0.4.16** | Username validation (Worker deployed) | Server-enforced normalization and rules, case-insensitive uniqueness under concurrency, conflict responses without user enumeration |
| **v0.6.14** | Landing page beta APK only (unreleased) | Landing page drops the v0.4.13 APK and offers only the beta APK |
| **v0.6.13** | Beta tester page (unreleased) | New /beta page explains how to join the Google Play closed test through the voxyl-beta-testers Google Group |
| **v0.6.12** | Account deletion sign-out on Android (unreleased) | After deleting the account, the app signs out of the native session and returns to the start screen |
| **v0.6.11** | Higher beta limits (unreleased) | 5 playlists per user and 10 podcasts per playlist |
| **v0.6.10** | Landing page test APK (unreleased) | Landing page offers the latest test APK, labeled as a test version |
| **v0.6.9** | Background auto-advance and episode list (unreleased) | R8 disabled for release until validated on a device; RSS fetch gets its own rate limit; playlist feeds fetched four at a time |
| **v0.6.8** | Back navigation and sync recovery (unreleased) | Browser Back/Forward traverses history once; account sync failure screen offers sign out |
| **v0.6.7** | Upload hardening (unreleased) | Images validated by content; JPEG/PNG/WebP only; size, dimension and per-account quota limits |
| **v0.6.6** | User enumeration fix (unreleased) | Search and suggestions require sign-in; anonymous profiles omit the real name; blocks hide profiles both ways |
| **v0.6.5** | Home startup fix (unreleased) | Fixes the signed-in crash on Home caused by a missing import; adds an import guard test |
| **v0.6.4** | Admin configuration (unreleased) | No hardcoded admin email; admin from D1 role, `ADMIN_CLERK_USER_IDS` or `ADMIN_EMAILS`; client reads `is_admin` |
| **v0.6.3** | Dependency triage (unreleased) | 16 unused dependencies removed; non-breaking audit fixes; Dependabot enabled; audit down from 33 to 2 moderate findings |
| **v0.6.2** | Block state synchronization (unreleased) | One shared client cache for hidden users and the blocked list; every block or unblock refreshes Home, Discover, People and Settings; blocked count loads on open |
| **v0.6.1** | Android release hardening | Feed media promoted to HTTPS; WebView mixed content disabled; Android backup disabled; R8 enabled for release |
| **v0.6.0** | Terms of Use acceptance (unreleased) | Accounts must accept the current Terms of Use before creating playlists, uploading files or claiming a username (migration 0010) |
| **v0.5.0** | Rate limiting (unreleased) | Per-IP limits on public discovery, RSS and search; per-user limits on authenticated writes; 429 responses with Retry-After |

The persistent Android playback architecture introduced in v0.3.2 remains the native playback foundation for the current beta line.

For complete release history, see [CHANGELOG.md](CHANGELOG.md).

---

## Architecture

```text
Web Browser / Android App
            |
            v
      React + Vite
            |
            v
   Cloudflare Pages
            |
            v
 Cloudflare Workers API
       /      |      \
      v       v       v
     D1      R2      KV
            |
            v
      Clerk Authentication
```

### Frontend

- React
- Vite
- React Router
- TanStack React Query
- Tailwind CSS
- Radix UI
- Capacitor

### Backend

- Cloudflare Workers
- Cloudflare D1
- Cloudflare R2
- Cloudflare KV

### Authentication

- Clerk React SDK for web.
- Clerk Android SDK for native Android authentication.
- Cloudflare Worker JWT validation.

### Android

- Capacitor native shell.
- Native Clerk authentication bridge.
- Media3 `MediaSessionService` playback authority.
- Reconnectable frontend/native playback bridge.

For the detailed architecture, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Production Services

| Service | Production endpoint |
|---|---|
| Web | `https://v.renbrant.com` |
| API | `https://api.voxyl.renbrant.com/api` |
| Deployment metadata | `https://v.renbrant.com/version.json` |

`version.json` reports the application version, Git commit, branch, and build timestamp for the deployed web artifact.

---

## Project Structure

```text
android/                 Native Android Capacitor project
base44/                  Legacy migration tooling retained for history/reconciliation
docs/                    Current technical and operational documentation
patches/                 patch-package fixes applied after npm install
promo/                   README/marketing assets
public/                  Static assets, icons, and PWA files
scripts/                 Build and migration utilities
screenshot/              Product screenshots
src/                     React frontend application
tests/                   Automated regression suite
workers/api/             Cloudflare Workers backend
ARCHITECTURE.md          System architecture documentation
CHANGELOG.md             Authoritative release history
CONTRIBUTING.md          Contribution and engineering workflow
TESTING_GUIDE.md         Current validation strategy
```

---

## Development

### Requirements

- Node.js
- npm
- Git

### Install dependencies

```bash
npm install
```

For reproducible validation from the lockfile, prefer:

```bash
npm ci
```

### Run locally

```bash
npm run dev
```

### Production build

```bash
npm run build
```

### Preview production build

```bash
npm run preview
```

---

## Validation

The standard source-level validation set is:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Repository consistency checks:

```bash
git status
git diff --check
```

The v0.4.6 release candidate completed **490/490 automated tests**, ESLint, and the production build before Android packaging and physical-device validation.

For the current testing model, see [TESTING_GUIDE.md](TESTING_GUIDE.md).

---

## Android Development

For Android work:

```bash
npm run build
npx cap sync android
```

Native Android changes should be validated on a physical device when they affect:

- Clerk hosted authentication and callbacks;
- session restoration and logout;
- Media3 playback authority;
- background/foreground lifecycle behavior;
- queue restoration and automatic next-episode playback;
- app close/reopen behavior;
- release upgrade compatibility.

The production package ID is:

```text
com.renbrant.voxyl
```

See [docs/release-process.md](docs/release-process.md) for the Android release evidence model.

---

## Deployment

The production web frontend is deployed through Cloudflare Pages from `main`.

```text
GitHub main
   |
   v
Cloudflare Pages build
   |
   +--> npm build
   +--> generate version.json
   |
   v
https://v.renbrant.com
```

Git state and deployment state are separate evidence boundaries. A merge is not enough to prove the intended artifact is live; verify the custom-domain `version.json` after deployment.

The Workers API is deployed separately when backend code changes.

---

## Data Migration History

Voxyl no longer uses Base44 as the production application platform. Legacy migration utilities remain in the repository for historical traceability and reconciliation.

Key migration utilities include:

```text
scripts/import-base44-csv-to-d1.mjs
scripts/migrate-base44-files-to-r2.mjs
base44/functions/exportBase44Data/entry.ts
```

The historical migration design is retained in [docs/cloudflare-clerk-migration-plan.md](docs/cloudflare-clerk-migration-plan.md).

---

## Documentation

- [Documentation Index](docs/README.md)
- [Architecture](ARCHITECTURE.md)
- [Changelog](CHANGELOG.md)
- [Testing Guide](TESTING_GUIDE.md)
- [Contributing Guide](CONTRIBUTING.md)
- [Release Process](docs/release-process.md)
- [Profile Avatar Model](docs/profile-avatar-model.md)
- [Android Auth Setup](docs/android-auth-setup.md)
- [Android Manual Auth Test](docs/android-auth-manual-test.md)
- [iOS Native Setup](docs/ios-setup.md)
- [Cloudflare + Clerk Migration Plan — Historical](docs/cloudflare-clerk-migration-plan.md)

---

## Engineering Methodology

AI-assisted engineering work on Voxyl follows the repository:

**[Renbrant/ai-assisted-development-methodology](https://github.com/Renbrant/ai-assisted-development-methodology)**

The methodology governs branch isolation, source editing, validation, PowerShell delivery, runtime evidence, release engineering, provenance, and publication boundaries.

Project-specific workflow remains documented in this repository; generic engineering rules live in the methodology repository.

---

## Support and Bug Reporting

This repository is the official support hub for Voxyl.

**[Open a GitHub Issue](https://github.com/Renbrant/Voxyl-APP/issues)**

Useful bug reports include:

- steps to reproduce;
- expected behavior;
- actual behavior;
- browser/device;
- screenshots or logs;
- deployed version from `/version.json`.

---

## Privacy and Safety

Voxyl is built around explicit user control and server-side authorization.

- Protected operations are authorized by the Worker.
- Authentication is handled through Clerk.
- Public endpoints expose only fields required for public experiences.
- Users can manage account and profile settings inside Voxyl.

**[Voxyl Privacy Policy](https://v.renbrant.com/privacy)**

---

## Technology Providers

- **Cloudflare Pages** — frontend hosting
- **Cloudflare Workers** — backend API
- **Cloudflare D1** — relational data
- **Cloudflare R2** — media storage
- **Cloudflare KV** — caching/supporting data
- **Clerk** — authentication
- **Podcast Index** — podcast discovery data
- **Capacitor** — native mobile integration
- **Android Media3** — persistent native playback architecture

---

## Current Version

**Voxyl 0.6.14 — Beta** (unreleased)

Android source versionCode: **614**

The v0.6.14 candidate removes the v0.4.13 APK from the landing page, which now offers only the beta APK labeled with the source version. The v0.6.13 candidate adds a public /beta page, linked from the landing page, that walks Android users through joining the Google Play closed test (join the voxyl-beta-testers Google Group, accept the Play testing invitation, install from Google Play); no email is collected by Voxyl. The v0.6.12 candidate fixes account deletion on Android: after a successful deletion the app now signs out through the platform-aware auth context (native Clerk on Android) and returns to the start screen (issue #104). The v0.6.11 candidate raises the beta limits to 5 playlists per user and 10 podcasts per playlist. The v0.6.10 candidate adds a "test version" APK download to the landing page, next to the stable v0.4.13 APK. The v0.6.9 candidate fixes two regressions seen on the test APK: the next episode did not start with the screen off (R8 is disabled again for release builds), and playlists and podcasts did not show all episodes because RSS fetches were rejected by the 20 per minute search limit (RSS now has its own `RL_RSS` limit of 300 per minute, playlist feeds are fetched four at a time and playlist cards no longer fetch feeds). The v0.6.8 candidate fixes the extra history step on browser Back/Forward (issue #117) and lets users sign out from the account sync failure screen (issue #140). The v0.6.7 candidate validates uploaded images by their bytes (JPEG, PNG, WebP only), bounds size and dimensions and adds a per-account storage quota (issue #116). The v0.6.6 candidate closes anonymous user enumeration: user search and suggestions require sign-in, anonymous profiles omit the real name, and blocked users cannot open each other's profiles (issue #144). The v0.6.5 candidate fixes a signed-in startup crash on Home (a missing import introduced in v0.6.2). The v0.6.4 candidate removes the hardcoded admin email: admins are configured with `ADMIN_CLERK_USER_IDS`, `ADMIN_EMAILS` or the D1 role (issue #145). The v0.6.3 candidate removes 16 unused dependencies and applies non-breaking audit fixes, leaving 2 moderate `react-router` advisories that do not apply to this SPA (issue #115). The v0.6.2 candidate synchronizes blocked-user state on the client (issue #48): Home, Discover, People, Settings and the Blocked Users modal share one query cache, and every block or unblock refreshes them together. The v0.6.1 candidate hardens the Android release: the Worker promotes plain-HTTP feed media to HTTPS, the WebView no longer allows mixed content, Android backup is disabled so the session is not copied to another device, and R8 shrinking is enabled for release builds (issue #146). The v0.6.0 candidate requires acceptance of the Terms of Use before playlist creation, file upload and username claims (issue #142). The Worker returns `403 terms-not-accepted` until the current version is accepted through `POST /api/me/accept-terms`. The v0.5.0 candidate adds rate limiting (issue #143). Anonymous discovery and RSS/search routes are limited per IP, and authenticated writes per user; a limited request returns 429 with `Retry-After: 60`. Limits are declared in `workers/api/wrangler.toml`. The v0.4.16 candidate moves username validation to the Worker (issue #56). `PATCH /api/me` normalizes the handle, enforces length, character and reserved-name rules, and claims it behind a precondition and a case-insensitive unique index, so two concurrent requests cannot share a handle. Unavailable handles return `409` without revealing the account that holds them, and owned playlists keep their creator handle in sync. The browser no longer performs its own availability lookup. It also contains the v0.4.15 content reporting work, whose Worker is already deployed, and the v0.4.14 playlist creation work. The previous Android baseline is v0.4.13. Deployment and signed APK/AAB packaging require separate validation.

Before deploying the Worker, apply migration `0009_username_normalization.sql`. It resolves case-insensitive handle collisions, rewrites stored handles as trimmed lowercase and creates the unique index the claim relies on.

Before deploying the Worker, apply migration `0007_playlist_creation_idempotency.sql`. Creation enforces the beta limits of 5 playlists and 10 podcasts per playlist (raised from 2 and 5 in v0.6.11) for standard accounts; administrator status is resolved on the server. A local easter-egg flag no longer grants extra creation capacity. Existing playlists are preserved.


**[View the v0.4.12 GitHub Release](https://github.com/Renbrant/Voxyl-APP/releases/tag/v0.4.12)**

Thank you for helping shape the future of social podcasting.
