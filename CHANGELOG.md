# Changelog - Voxyl

## Versioning Note - August 2026

Voxyl is still in beta / pre-release development. The active product version was reset from the previous internal 3.x numbering to 0.3.0 so the version more accurately represents the product's maturity before the first stable public release.

Historical entries below retain their original version labels for traceability.

## v0.4.4 - August 2026

### UX Phase 5 - People Detail Flows and Social Interactions

- Completed Issue #75 with detailed social flows inside the dedicated **People** destination.
- Expanded **Following** with explicit Following state, public-profile navigation, and non-dominant Unfollow actions.
- Expanded **Followers** with `Follows you`, `Follow back`, and mutual relationship states.
- Added actionable incoming **Requests** with Accept and Decline behavior plus immediate count/badge reconciliation.
- Added **Suggestions** with clear relationship-aware Follow actions.
- Kept people search owned by People and connected search results directly to public profiles.
- Added relationship-aware public-profile states for Follow, Follow back, Following, and Unfollow.
- Corrected the public-profile shell localization so the validated English runtime no longer mixed Portuguese labels.
- Preserved server-side authorization and avoided expanding the release into chat/messages/stories/feed scope.

### Validation and Android Release

- Full automated suite passed with **447/447 tests**.
- ESLint passed.
- Production web build passed.
- Production Android build and signing passed.
- Production signing-certificate continuity was verified against the official v0.4.3 APK.
- Final corrected Android artifact was frozen at **11,884,417 bytes**.
- Final corrected APK SHA-256: `6C82DDD58D46CD8C73336D1D427EB9DA4951C7E984A558C3B292DA3792DD4DE8`.
- Final corrected APK installed successfully over the already-installed v0.4.4 build with `adb install -r`.
- No uninstall or data clear was performed.
- `firstInstallTime` and authenticated application/session continuity were preserved.
- Installed `base.apk` bytes matched the frozen release artifact exactly.
- Physical-device People flows and public-profile relationship states were validated.
- Corrected public-profile localization received real-device visual validation.
- The persistent Android playback implementation remained byte-identical to the previously accepted v0.3.2 singleton architecture; a final-artifact playback spot-check confirmed a single active stream/service/MediaSession authority.
- Literal `0.4.3 / 403 -> final corrected 0.4.4 / 404` upgrade was **NOT EXECUTED** because the physical device was already on v0.4.4 when the final corrected artifact was frozen.

### GitHub Publication and Provenance

- Source commit: `bc3a47c77c1b8a50939c267904b5dbcd00fe3c56`.
- Android package: `com.renbrant.voxyl`.
- Android versionCode: `404`.
- APK: `Voxyl-v0.4.4-release.apk`.
- APK size: `11884417` bytes.
- APK SHA-256: `6C82DDD58D46CD8C73336D1D427EB9DA4951C7E984A558C3B292DA3792DD4DE8`.
- GitHub tag `v0.4.4` was verified to point exactly to the release source commit.
- GitHub Release was verified public, non-draft, and non-prerelease.
- Exactly one APK asset was published.
- The published APK was downloaded again and verified byte-for-byte against the frozen artifact.
- A separate publication-evidence manifest recorded the final source -> frozen artifact -> public release -> downloaded bytes binding.

### Release-Process Lessons

- Reused the official methodology `Publish-GitHubRelease.ps1` helper rather than reimplementing publication mechanics.
- Documented immutable remote-helper bootstrap for environments without a proven local methodology checkout.
- Clarified Android lifecycle validation boundaries between Activity/task recreation and process-death/media-resumption behavior.
- Hardened Android observability guidance against OEM-specific command/accessibility assumptions.

---

## v0.4.3 - August 2026

### UX Phase 4 - People Social Dashboard

- Completed Issue #74 with a dedicated **People** destination.
- Added four social summary areas: **Following**, **Followers**, **Requests**, and **Suggestions**.
- Moved people search out of Discover and into People.
- Added incoming follow-request badges to primary navigation.
- Added authoritative production-backed People summary counts.
- Preserved explicit incoming-request semantics and social visibility rules.
- Kept Discover focused on podcast and playlist discovery.

### Validation and Android Release

- Full automated suite passed with **428/428 tests** across 38 suites.
- ESLint passed.
- Production web build passed.
- Authenticated Android and desktop People runtime validation passed.
- Signed Android release built as version `0.4.3` / versionCode `403`.
- True in-place Android upgrade from `0.4.2 / 402` to `0.4.3 / 403` passed using `adb install -r`.
- No uninstall or data clear was used.
- `firstInstallTime` was preserved.
- Installed APK bytes matched the frozen release artifact exactly.
- Manual session, People, branding, and playback smoke passed.
- Published GitHub APK was downloaded again and verified byte-for-byte against the frozen/tested artifact.

### Release Provenance

- Source commit: `888af88480390c3d519d54643548dcea3236d9ce`
- Android package: `com.renbrant.voxyl`
- APK: `Voxyl-v0.4.3-release.apk`
- APK SHA-256: `F4D1A47DE7415D81896152C5F8078A20E7E7CBE207C6C160BEAE3868D85C887D`

---

## v0.4.2 - August 2026

### UX Phase 3 - Discover Redesign

- Completed Issue #73.
- Refocused Discover exclusively on **Playlists** and **Podcasts**.
- Removed people search from the normal Discover experience.
- Simplified playlist discovery cards.
- Simplified podcast result cards and descriptions.
- Improved responsive layout and explicit loading/error states.

### Validation and Android Release

- Full automated suite passed with **416/416 tests**.
- ESLint passed.
- Production web build passed.
- Clean Capacitor native regeneration validated.
- Production Android build/signing passed.
- True in-place Android upgrade from `0.4.1 / 401` to `0.4.2 / 402` passed using `adb install -r`.
- No uninstall or data clear was used.
- Installed APK bytes matched the validated release artifact exactly.
- Manual Discover UX, playback, and orphan/duplicate-audio regression smoke passed on a physical device.

### Release Provenance

- Source commit: `dd9821801e4bb4aedaf5118fbab6963e25019b28`
- Android package: `com.renbrant.voxyl`
- APK: `Voxyl-v0.4.2-release.apk`
- APK SHA-256: `C6D3D3000C871AC5D9990CA623526B6933549582DD2E78DBF7D58C687BDA1E3C`

---

## v0.4.1 - August 2026

### UX Phase 2 - Personalized Home

- Added **For You**, **Trending**, and **Last Week** Home views.
- Trending uses real 90-day Voxyl playback activity.
- Last Week uses real 7-day playback activity.
- Added **Continue Listening** with persisted episode progress and direct resume.
- Added recently played playlists and podcasts.
- Added expandable listening history.
- Added explicit loading, empty, error, and retry states.
- Preserved blocked-user filtering across Home content.
- Validated responsive behavior across narrow mobile, standard mobile, tablet, and desktop-width layouts.

### Validation and Android Release

- Full automated suite passed with **404/404 tests** across 33 suites.
- ESLint passed.
- Production build passed.
- Real production Trending and Last Week rankings were validated.
- Signed Android release built with the established Voxyl production certificate.
- True in-place Android upgrade from `0.4.0 / 400` to `0.4.1 / 401` passed.
- Installed APK bytes matched the validated release artifact exactly.
- Manual post-upgrade smoke passed for session/data preservation, Home surfaces, navigation, and playback.

### Release Provenance

- Source commit: `1bfca7a3194db7809150ac14fd4cadb5f28b62ac`
- Android package: `com.renbrant.voxyl`
- APK: `Voxyl-v0.4.1-release.apk`
- APK SHA-256: `900266B574FBD547D2DB9C4BB315C7C44B6AC77DB50F3751AEF13A972D8BBE7E`

---

## v0.4.0 - August 2026

### UX Phase 1 - Primary Navigation

- Completed Issue #71, establishing the new primary navigation shell.
- Defined five canonical destinations: **Home · Discover · People · Library · Profile**.
- Added canonical `/discover`, `/people`, `/library`, and `/profile` routes.
- Preserved legacy `/explore` and `/playlists` URLs through compatibility redirects.
- Centralized navigation metadata so desktop and mobile renderers use one shared contract.
- Preserved primary navigation while viewing standalone playlist details.

### Branding

- Applied the transparent Voxyl symbol to the in-app sidebar and loading state.
- Preserved the installed Android and PWA application icons.

### Production Reconciliation

- Reconciled the validated v0.4.0 navigation line with the transparent-logo fix.
- Restored `main` as the authoritative v0.4.0 source at `d39c00df6e2a5613723d7669b69c4f5f64dedd57`.
- Rebuilt and explicitly deployed that exact artifact after an older v0.3.2 artifact temporarily returned to production.
- Verified production metadata against version `0.4.0`, the full Git SHA, and branch `main`.

### Validation

- Full automated suite passed with 378 tests and 0 failures.
- ESLint validation passed.
- Production build completed with exact artifact provenance.
- Real production smoke testing confirmed v0.4.0 and Home · Discover · People · Library · Profile.

---

## v0.3.2 - August 2026

### Persistent Android Playback

- Fixed Issue #81, where Android UI recreation could leave an orphaned audio session playing in the background.
- Replaced Activity-owned playback with a single process-owned Media3 `MediaSessionService`.
- Added a reconnectable Capacitor controller bridge instead of creating a second player after Activity recreation.
- Preserved queue identity, autoplay policy, current item, and playback state across UI recreation.
- Added native next/previous queue navigation and persistent state restoration.
- Prevented duplicate parallel audio sessions when Voxyl is reopened.
- Added lightweight native position/duration polling while retaining full state restoration during reconnection.

### Versioning

- Advanced the beta line to v0.3.2 before the v0.4 UX milestone.

---

## v0.3.1 - August 2026

### Android Clerk Authentication

- Fixed Issue #67, where Android authentication could return the external browser to localhost instead of Voxyl.
- Added Clerk Android SDK hosted authentication.
- Added a Capacitor native Clerk bridge for sign-in, token retrieval, session state, and logout.
- Separated Android native Clerk authentication from the Clerk React web provider.
- Production Android builds now require a Clerk Production publishable key.
- Added the native callback clerk://com.renbrant.voxyl.callback.
- Preserved the existing Android package identity and release signing certificate.

### Android API and CORS

- Added the actual Android WebView origin, https://localhost, to Worker authorized parties and CORS handling.
- Retained capacitor://localhost as an allowed Capacitor origin.
- Added regression coverage for Android WebView CORS preflight requests.

### Session and Logout

- Restored authenticated Clerk sessions across Android cold starts.
- Routed Settings logout through the active AuthContext.
- Native logout now clears the Clerk Android session.
- Logout returns the user to Home instead of leaving protected Settings visible.
- Signed-out state remains signed out after an Android cold start.

### Validation

- Full automated suite passed with 330 tests and 0 failures.
- Production frontend build completed successfully.
- Signed Android release APK built as version 0.3.1 / versionCode 301.
- Release APK signature validated against the existing Voxyl production signing certificate.
- Physical Android validation confirmed fresh login, automatic callback, /api/me profile loading, authenticated cold-start restore, logout, Home navigation, and signed-out cold start.

---
## v0.3.0 - August 2026

### Beta Versioning

- Reset the active pre-release product version from the previous internal `3.0.0` numbering to `0.3.0`.
- Preserved historical version labels for traceability.
- Centralized visible application version reporting from `package.json`.
- Kept Android `versionCode` monotonic while changing `versionName` to `0.3.0`.

### Profile and Social Repair

- Completed the production repair tracked by Issues #63 and #35.
- Fixed user-search rendering after the Base44-to-Cloudflare migration.
- Restored follower and following identity display.
- Restored follow-request create, accept, reject, cancel, unfollow, and follow-back flows.
- Removed the Follow SQL regression caused by references to nonexistent columns.
- Validated social state between separate authenticated accounts.
- Validated profile-photo upload and persistence through Cloudflare R2.

### Clerk / Provider Avatar Model

- Added `users.clerk_profile_picture` through migration `0004_clerk_profile_picture.sql`.
- Kept custom Voxyl/R2 images separate from authentication-provider images.
- Established avatar precedence:
  1. custom Voxyl profile photo
  2. Clerk/provider profile photo
  3. initials fallback
- Prevented provider synchronization from overwriting a custom photo.
- Restored the provider image automatically when the custom image is removed.
- Added shared `UserAvatar` rendering and broken-image fallback.
- Applied resolved-avatar behavior across Profile, public profiles, Explore/search, and follow surfaces.
- Moved playlist `creator_picture` propagation to the Worker.

### Production Validation

- PR #64 validated the social/profile regression repair.
- PR #65 delivered the final Clerk/provider avatar architecture.
- Production frontend validated at version `0.3.0`.
- Production merge commit validated at `dfdd5654`.
- D1 user count remained unchanged.
- All 8 owned playlists tested matched the final custom avatar.
- Full automated suite passed with 329 tests and 0 failures.
- Issues #35 and #63 were closed as completed.

---

## v3.0 - July 2026

### 🚀 Major Platform Migration

Voxyl 3.0 represents the largest architectural update since the project began.

This release removes the dependency on the Base44 platform and migrates the application to a fully independent Cloudflare-based infrastructure powered by Clerk authentication, providing better reliability, scalability, security, and long-term maintainability.

---

## 🌐 Cloudflare Infrastructure

### Cloudflare Workers API

- Replaced the Base44 backend with a custom Cloudflare Workers API.
- Added new REST endpoints for authentication, user profiles, playlists, and public resources.
- Improved request performance through Cloudflare's global edge network.
- Established a scalable backend foundation for future development.

### Cloudflare D1 Database

- Migrated the application database to Cloudflare D1.
- Added a Base44 compatibility schema.
- Created automated migration tools for importing existing production data.
- Added safe local and remote SQL migration utilities.

### Cloudflare R2 Storage

- Migrated playlist artwork and media assets from Base44 Storage to Cloudflare R2.
- Added automated media upload scripts.
- Updated all media references to use the new infrastructure.

### Cloudflare Pages

- Production website now runs on Cloudflare Pages.
- Automatic deployments directly from the GitHub `main` branch.
- Automatic deployment version tracking.

---

## 🔐 Authentication

### Clerk Authentication

- Replaced Base44 authentication with Clerk.
- Native Android authentication fully supported.
- Secure JWT validation on the backend.
- Improved session persistence across application restarts.

### Authentication Improvements

- Added a new `/api/me` endpoint backed by Clerk.
- Automatic token hydration during application startup.
- Authentication bridge for seamless migration.
- Improved login restoration after returning from the background.
- More reliable OAuth callback handling.

### Guest Experience

- Public content remains accessible without authentication.
- Authentication required only for protected actions.
- Cleaner login flow and improved redirect behavior.

---

## 📱 Android Improvements

### Native Authentication

- Improved App Links support.
- More reliable OAuth callback handling.
- Better browser-to-app authentication flow.
- Reduced login failures caused by interrupted authentication.

### Session Persistence

- Improved token persistence.
- Better recovery when Android destroys the WebView.
- Significantly reduced unexpected logouts.

---

## 🎧 Audio Player

### Native Playback

- Preserved native background playback.
- Preserved automatic episode progression.
- Improved player state synchronization after authentication changes.

---

## 📦 Data Migration Tools

### Base44 Export

- Added temporary Base44 export functions.
- Added CSV export utilities.
- Added D1 import generators.
- Added remote-safe SQL migration scripts.

### Media Migration

- Added automated R2 upload scripts.
- Automated Base44 media URL replacement.
- Windows-compatible migration utilities.
- Improved migration reliability.

---

## 🧪 Diagnostics

### Authentication Diagnostics

- Added dedicated Clerk diagnostics page.
- Added authentication test endpoints.
- Added end-to-end authentication validation.
- Added playlist endpoint validation.
- Added user profile endpoint validation.

### Deployment Metadata

Every production deployment now automatically generates version metadata.

The application now exposes:

- Application version
- Git commit
- Full commit SHA
- Branch
- Build timestamp

through:

`/version.json`

Example:

```json
{
  "app": "voxyl",
  "version": "3.0.0",
  "git_commit": "baaad333",
  "git_commit_full": "baaad33332c4ed88905757a225e5918bbdf67ce7",
  "branch": "main",
  "built_at": "2026-07-10T13:19:24.469Z"
}
```

---

## 🏗 Project Organization

### Repository Improvements

- Reorganized project documentation.
- Created a dedicated `docs/` directory.
- Added migration documentation.
- Improved repository structure.
- Updated project README.

---

## ⚡ Build & Deployment

### Build Pipeline

- Automatic deployment metadata generation.
- Continuous deployment from GitHub to Cloudflare Pages.
- Improved production build process.
- Cleaner build configuration.

---

## 🔄 Breaking Changes

- Removed Base44 SDK dependency.
- Removed Base44 authentication.
- Removed Base44 backend API.
- Removed Base44 storage dependency.
- Replaced the Base44 API client with the new Voxyl API client.
- Migrated the backend to Cloudflare Workers.
- Migrated authentication to Clerk.

---

## ✨ Additional Improvements

- Improved project structure and maintainability.
- Improved deployment reliability.
- Better authentication performance.
- Better Android session handling.
- Simplified future backend development.
- Complete removal of the Base44 platform dependency.

---

## Previous Versions

### v2.5 - June 2026

#### Responsive Desktop & Tablet Interface

- Added a dedicated desktop and tablet layout.
- Bottom navigation automatically switches to a fixed sidebar on screens wider than 768px.
- Improved content layout with adaptive multi-column grids.
- Larger featured content on large screens.
- Floating mini-player on desktop.
- Mobile experience remains unchanged.

---

### v2.4.1 - June 2026

#### Podcast Metadata Fix

- Fixed an issue where newly discovered podcasts displayed incorrect title, author, and artwork.
- Root cause was a cache-key collision caused by truncated Base64 URLs.
- Feed cache now uses a unique djb2 hash combined with the URL length.

---

### v2.4.0 - June 2026

#### Android Session Persistence

- Fixed a critical issue where users were logged out after returning to the app.
- Added Capacitor `appStateChange` listener to restore sessions.
- Restored `localStorage` automatically from Capacitor Preferences.
- Tokens are now explicitly rehydrated into the authentication SDK.

#### Native OAuth Callback

- Stabilized Google authentication using native Android App Links.
- Authentication callback processing now occurs before the React application is initialized.

---

### v0.2 - April 2026

#### Guest Mode

- Public browsing without authentication.
- Protected actions automatically redirect to login.
- Guest-friendly playlist and profile pages.
- Login shortcut added to the navigation bar.

#### Android Compatibility

- Fixed Google OAuth 403 errors inside Android WebViews.
- Authentication now opens in the system browser.
- Centralized authentication redirect helper.

#### Technical Improvements

- Refactored authentication hooks.
- Removed duplicate SDK imports.
- Improved loading state handling.

---

### v0.1 - April 2026

#### Initial Release

- Podcast feed and discovery.
- Playlist creation and sharing.
- Persistent audio player.
- Episode progress synchronization.
- Social features.
- User profiles.
- RSS feed aggregation.
- Search.
- Offline support.
- PWA support.
- Dark and light themes.
