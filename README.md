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

**[Download the latest Voxyl APK](https://github.com/Renbrant/Voxyl-APP/releases/latest)**

Android releases are distributed directly through GitHub while Voxyl remains in beta.

> Android may ask you to allow installation from unknown sources because the app is not currently distributed through Google Play.

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

The v0.4.4 release candidate completed **447/447 automated tests**, ESLint, and the production build before Android packaging and physical-device validation.

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

**Voxyl 0.4.4 — Beta**

Android versionCode: **404**

The v0.4.4 milestone completes UX Phase 5 with detailed **Following**, **Followers**, **Requests**, and **Suggestions** flows, relationship-aware public profiles, direct people search/profile navigation, and explicit follow-request actions.

Release source: `bc3a47c77c1b8a50939c267904b5dbcd00fe3c56`

Release APK SHA-256: `6C82DDD58D46CD8C73336D1D427EB9DA4951C7E984A558C3B292DA3792DD4DE8`

**[View the v0.4.4 GitHub Release](https://github.com/Renbrant/Voxyl-APP/releases/tag/v0.4.4)**

Thank you for helping shape the future of social podcasting.
