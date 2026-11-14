# Changelog - Voxyl

## Versioning Note - August 2026

Voxyl is still in beta / pre-release development. The active product version was reset from the previous internal 3.x numbering to 0.3.0 so the version more accurately represents the product's maturity before the first stable public release.

Historical entries below retain their original version labels for traceability.

## v0.6.5 - November 2026 (Unreleased)

### Fix signed-in startup crash on Home

- v0.6.2 (issue #48) dropped the `getCache` import from `src/pages/Feed.jsx` while the saved-likes `initialData` still called it. For a signed-in user this threw `ReferenceError: getCache is not defined` during render, and the app showed the startup error screen on web and Android. Signed-out sessions were not affected. Restored the import.
- Added `tests/imports-declared.test.mjs`, which fails when a known helper (cache, React Query and block helpers) is called in `src/` without being imported or declared. ESLint's `no-undef` is not enforced here, so this class of error previously surfaced only at runtime.
- Versions 0.6.2 to 0.6.4 should not be used for the web or Android client; the Worker is unaffected.

## v0.6.4 - November 2026 (Unreleased)

### Remove the hardcoded admin identity (issue #145)

- The Worker no longer compares against a literal email address. `isUserAdmin` grants admin from `users.role = 'admin'`, `ADMIN_CLERK_USER_IDS` (preferred) or `ADMIN_EMAILS`, and ignores empty entries.
- `GET /api/me` and `PATCH /api/me` return `is_admin`. The Admin page, Sidebar, Settings, playlist modals and the 404 page use it instead of repeating the rule on the client. Authorization stays on the Worker.
- Playlist feed limits, the playlist creation limit and the follows query use the same `isUserAdmin` criterion.
- Added `tests/no-hardcoded-identities.test.mjs`, which fails when a personal email address appears in `src/` or `workers/api/src/` (published support and privacy data excluded), and rewrote `tests/admin-metrics.test.mjs` around configured admins.
- **Deploy note:** configure `ADMIN_CLERK_USER_IDS` or `ADMIN_EMAILS` (or set `role = 'admin'` in D1) before deploying the Worker, otherwise nobody can open `/admin`. Documented in `workers/api/README.md`.
- No migration.

## v0.6.3 - November 2026 (Unreleased)

### Dependency triage (issue #115)

- Removed 16 direct dependencies that nothing imports: `@hookform/resolvers`, `@radix-ui/react-toast`, `@stripe/react-stripe-js`, `@stripe/stripe-js`, `canvas-confetti`, `fast-xml-parser`, `html2canvas`, `jspdf`, `lodash`, `moment`, `react-hot-toast`, `react-leaflet`, `react-markdown`, `react-quill`, `three` and `zod`. This also drops the transitive packages behind the critical `jspdf` advisory.
- Applied the non-breaking `npm audit fix` (no `--force`). The audit went from 33 findings (3 critical, 16 high) to 2 moderate.
- The 2 remaining findings are in `react-router` 6.x and affect server-side hydration only, which this SPA does not use. The fix is a React Router 7 migration, tracked separately.
- `npm ci` still applies the `@capgo/capacitor-native-audio` patch.
- Added Dependabot for weekly grouped npm updates and monthly GitHub Actions updates, and documented the policy in `docs/dependency-policy.md`.
- No application behavior change and no migration.

## v0.6.2 - November 2026 (Unreleased)

### Block state synchronization (issue #48)

- Hidden-user ids and the outbound block list now live in one TanStack Query cache (`src/lib/blocks.js`) instead of per-screen state and a separate local cache.
- Home, Discover, People, Settings and the Blocked Users modal read the same entries, so a block or unblock made anywhere is reflected everywhere without a reload.
- Blocking from a profile, the report menu or the follow-requests modal, and unblocking from the modal, call `refreshBlockQueries`, which invalidates the hidden-user and blocked-list queries together with the block-dependent feeds.
- Content is matched to hidden users only by the canonical `creator_id`; usernames and display names are never treated as identities.
- The Settings blocked count loads when Settings opens instead of waiting for the modal, and the modal shows an error when an unblock fails.
- Added `tests/blocks-client.test.mjs` covering the helpers, the invalidation behavior and the wiring of each screen.
- Server-side filtering of content endpoints for blocked users is not part of this change.
- Client only; no Worker behavior change and no migration.

## v0.6.1 - November 2026 (Unreleased)

### Android release hardening (issue #146)

- Feed enclosure and artwork URLs with `http://` are promoted to `https://` by the Worker.
- `allowMixedContent` is removed from the Capacitor configuration.
- `android:allowBackup` is `false`, so session storage is not backed up or transferred.
- R8 minification and resource shrinking are enabled for release builds, with keep rules added to `proguard-rules.pro`.

Device validation (release AAB playback, lock-screen controls, Clerk sign-in) is still required.

## v0.6.0 - November 2026 (Unreleased)

### Mandatory Terms of Use (issue #142)

- Accounts must accept the current Terms of Use before creating playlists, uploading files or claiming a username.
- `POST /api/me/accept-terms` records the accepted version and timestamp; migration 0010 adds the columns and the legal document rows.
- The Worker returns `403 terms-not-accepted` without acceptance and `409 terms-version-mismatch` for a stale version.
- Adds a public Terms page and a footer link. The legal text is a draft pending legal review.

## v0.5.0 - November 2026 (Unreleased)

### Rate limiting (issue #143)

- Added per-route rate limits through the Workers Rate Limiting API, declared in `workers/api/wrangler.toml` as `RL_PUBLIC` (60 requests per minute), `RL_EXPENSIVE` (20 per minute) and `RL_WRITE` (30 per minute).
- Podcast search and RSS fetch are limited per authenticated user, or per client IP for anonymous callers. Public discovery routes (user search, public profiles, public playlists) are limited per IP. Authenticated writes are limited per user across routes.
- A limited request returns `429` with `code: rate-limited` and `Retry-After: 60`, and keeps the CORS headers so the browser can read it.
- A missing binding disables enforcement, so local development and tests run unlimited. An unverifiable token is treated as anonymous and never turns the check into a 500.
- The client does not retry 429 responses automatically, and playlist creation and upload show a rate limit message.
- Wrangler is now a pinned devDependency (4.162.0), so `npx wrangler` uses the version that supports `[[ratelimits]]`.
- Added `tests/rate-limit-worker.test.mjs` and `tests/rate-limit-client.test.mjs`.

## v0.4.16 - November 2026 (Worker deployed)

### Usernames / Secure Validation (issue #56)

- `PATCH /api/me` now accepts `username`. The previous handler silently ignored the field, so the browser's save never persisted a handle.
- Normalization is server-side: the handle is trimmed, a leading `@` is removed and the value is lowercased before any check, so every client stores the same canonical form.
- Server-side rules: 3 to 30 characters, `a-z`, `0-9` and `_` only, and a small reserved list (`admin`, `voxyl`, `support`, …) that would allow impersonating the product. Invalid input returns `400` with code `invalid-username`.
- Uniqueness is case-insensitive and enforced under concurrency. The claim runs with a `NOT EXISTS` precondition inside a D1 batch, and migration `0009_username_normalization.sql` adds a unique index on `LOWER(username)` as the second guard. An unavailable handle returns `409` with code `username-taken`.
- Conflict responses carry no information about the account holding the handle, so the endpoint cannot be used to enumerate users.
- `playlists.creator_username` is updated in the same batch as the claim, and the update is a no-op when the claim is refused.
- Migration `0009_username_normalization.sql` resolves pre-existing case-insensitive collisions (the earliest account keeps the handle; later ones get a deterministic suffix derived from their id), rewrites stored handles as trimmed lowercase, clears whitespace-only handles and realigns playlist creator handles.
- Removed the generic `User` entity client from the frontend, along with the browser-side availability lookup and the call to the `syncUsername` function, which had no Worker route and always failed silently.
- The username modal now reports server errors instead of assuming success, and reads its text from the i18n catalog (pt/en/es) rather than hardcoded Portuguese.
- Added `tests/username-worker.test.mjs`: 25 tests covering normalization, rule enforcement, case-insensitive conflicts, concurrent claims, creator handle sync, migration behavior and the client helpers, against a real SQLite database built from the repository migrations.

## v0.4.15 - November 2026 (Worker deployed)

### Moderation / Content Reports (issue #55)

- Added authenticated `POST /api/reports`. The reporter comes from the verified Clerk session; the reported user and content title are resolved on the server, and client-sent identity or status fields are ignored. Private playlists the reporter cannot open return 404; reporting your own content is rejected.
- Added migration `0008_report_moderation.sql`: legacy duplicate open reports are marked `duplicate`, then a partial unique index allows one open report per reporter and content. Repeated or concurrent submissions return `duplicate: true` without a second row.
- `playlists.reports_count` is now incremented in the same D1 batch and only when the report row was actually inserted (previously the browser read and rewrote the counter, which the Worker rejected for non-owners).
- Each account can send at most 20 reports per day (HTTP 429 `rate-limited`).
- Added `GET /api/admin/reports` and `PATCH /api/admin/reports/:id` (administrators only; resolve or dismiss) and a "Denúncias" tab in `/admin`. Lists show usernames, never e-mail addresses.
- The report form no longer stays on "Enviando..." when the request fails: errors are shown and the form can be retried. Report and block menu text moved to `i18n` (pt/en/es). `Report` was removed from the generic entity client.
- Added `tests/report-worker.test.mjs`, which runs the Worker against a real SQLite database built from the migrations.
- Deploy order: apply migration `0008` and deploy the Worker before shipping the new web/Android build.

## v0.4.14 - October 2026 (Unreleased)

### Playlist Management

- Added owner-authorized DELETE routes; D1 cascades likes/episode caches and preserves play/report history with detached references, freeing beta quota immediately.
- Delete failures now restore controls and show an alert; successful edits/deletes invalidate collection caches, and deletion from details returns to My Playlists.
- Enforced 5-feed / 100-admin-feed limits on growth during edits while allowing legacy over-limit playlists to be maintained or reduced.
- Removed unavailable AI cover generation; image upload now reports failures and always restores its control.
- Kept v0.4.14 / Android 414 as a continuation of unmerged PR #141.

### Playlist Creation

- Implemented authenticated playlist creation through the existing entity route and playlist aliases, including empty playlists for “save and find podcasts”.
- Derive creator identity, avatar, counters and share tokens on the server; validate fields and enforce atomic standard beta limits of 2 playlists / 5 podcasts. Existing playlists are preserved; local easter-egg storage is no longer treated as extra creation entitlement.
- Added non-destructive migration 0007 for per-owner idempotency keys and payload hashes. Retries return the original playlist instead of inserting duplicates.
- Both creation forms now preserve inputs, display actionable errors and restore their controls after failure; creation requests have a 20-second timeout covering token acquisition and fetch.
- Refresh owned-playlist and profile caches only after confirmed success. The legacy Android 0.4.13 payload remains supported by the endpoint.
- Added real-SQLite Worker integration tests and executable frontend handler/retry/timeout tests.
- Synchronized source version to v0.4.14 / Android versionCode 414. Apply migration 0007 before Worker deployment; signed Android packaging and device/Play Store validation remain pending.
- This change addresses playlist creation in #108/#140; the separate account-sync/logout recovery work from #140 remains open.

## v0.4.13 - October 2026 (Unreleased)

### Playback Presentation

- Skipped intro/outro sections use gray instead of orange on player and episode timelines, including mobile playlist rows.
- Added position dots to the floating player and prevented episode position dots from being clipped.
- Playlist age filters use singular `1 day` / `1 dia` and plural for other counts.
- Episode metadata shows normalized total duration from playback, saved progress, or RSS. Episodes with cuts also show playable duration in quotes, e.g. `30:00 "25:00"`.
- If no duration is known yet, omit the duration entirely. Real audio duration is used as soon as playback metadata becomes available; no extra audio downloads are triggered to probe durations.
- Source metadata synchronized to v0.4.13 / Android versionCode 413. Web deployment, APK packaging and release publication remain pending.

## v0.4.12 - October 2026

### Native Audio Initialization

- Fixed `App.addListener(...).catch is not a function`, which aborted native audio initialization and disabled both Play All and individual-episode playback.
- Accept both synchronous legacy App listener handles and Promise-returning registration methods.
- Treat app-state registration as optional so a rejected registration cannot disable the process-owned playback service.
- Added executable bridge regression tests for legacy handles, Promise handles, rejected Promises, synchronous errors, listener cleanup, foreground restoration and subsequent playback.
- Synchronized source version metadata to v0.4.12 / Android versionCode 412.
- Corrected APK device playback validation and publication are pending; latest published Android APK remains v0.4.11.

## v0.4.11 - October 2026

### Native Startup Route

- Android and other Capacitor native platforms open Home at `/app` when launched at `/`.
- The browser and browser-installed PWA continue to render the public landing page at `/`.
- Native root redirection preserves search parameters and fragments and replaces the root history entry.
- Native deep links and existing app routes keep their destinations.
- Synchronized source version metadata across web, Android (`versionCode 411`), API Worker, documentation and regression tests.
- Published Android APK v0.4.11 from source commit `3a58d5a1d5add3813e71953dc5bd23c1e40f1f9e`, retaining the v0.4.10 replacement signing certificate for in-place updates.
- Updated the landing page's direct APK link and labels to v0.4.11.

## v0.4.10 - October 2026

### Audio Player Close Control and Safe Playback Termination

- **Audio Player Close Action**: Added a close button (`X`) to both the full and minimized floating audio players, allowing users to stop playback and dismiss the player on demand.
- **Reliable Progress Persistence**: Ensured that triggering close immediately flushes and persists current episode listening progress to cache and database before tearing down playback.
- **Complete Playback Cleanup**: Clears active audio streams, releases screen wake locks, resets media session states, cancels in-flight transition guards, and resets playback queues cleanly on web and native Android runtimes.
- **Player and Skip Localization**: Localized audio player controls (minimize/close tooltips and accessibility labels), playlist skip indicators, timeline badges, publication date formats, and playlist skip management modals according to selected language preference (English and Portuguese).
- Synchronized release version metadata across web, Android (`versionCode 410`), API Worker, and test suites.

## v0.4.9 - October 2026

### Playlist Skip Visualization and Outro Skip Completion

- **Scrubber Skip Visual Representation**: Added visual indicators on episode progress bars (in both the floating audio player and playlist episode rows) showing skipped intro and outro sections in distinct amber colors when playlist skip rules are active.
- **Player Skip Badges**: Added subtle skip duration indicators (`⚡ -Xs início • -Ys fim`) in the player timeline for instant feedback.
- **Outro Skip Full Completion Recording**: Guaranteed that when an episode reaches the end-skip threshold and skips the outro, it is immediately recorded as finished/played in database and local cache, whether autoplay is enabled or disabled and even at the end of the queue.
- **Subtle Outro-Skipped Indicators**: Added a subtle visual indicator on completed episode checkmarks and metadata rows (`• ouvido (final pulado)`) showing the episode was completed with its outro skipped by playlist configuration.
- Synchronized release version metadata across web, Android (`versionCode 409`), API Worker, and test suites.

## v0.4.8 - October 2026

### Cloudflare Quota Reset Countdown and Telemetry Enhancements

- **Cloudflare Quota Reset Countdown**: Added a real-time countdown timer to the Admin dashboard displaying the exact remaining time until Cloudflare daily quotas reset at 00:00 UTC with localized next-reset times.
- **Telemetry Enhancements**: Added `resetAt` metadata to Cloudflare telemetry responses in the Worker API.
- Synchronized release version metadata across web, Android (`versionCode 408`), API Worker, and test suites.

## v0.4.7 - October 2026

### Home Feed Refinements and Version Alignment

- Refined the Home feed Continue Listening section to display only the 2 latest unfinished episodes instead of 6, providing a cleaner and more actionable resume experience.
- Adjusted the Continue Listening responsive grid to 2 columns on larger screens, eliminating blank third slots.
- Added optional `limit` parameter to `getContinueListeningItems`.
- Synchronized release version metadata across web, Android (`versionCode 407`), API Worker, and test suites.

## v0.4.6 - October 2026

### Google Play Readiness, Security, and Production Hardening

- Added public Voxyl landing page, configured application entry routing under `/app`, and updated primary navigation.
- Added secure account deletion for Google Play compliance (`/account-deletion` route and settings modal).
- Published and versioned bilingual (`en-US` and `pt-BR`) Privacy Policy at `/privacy` with D1 audit records.
- Isolated private playlist and download caches per authenticated account.
- Retired persisted legacy authentication credentials and tightened Clerk session-token validation in the Cloudflare Worker.
- Fixed recurring D1 writes during account synchronization: read-only `GET /api/me` execution once an identity is linked.
- Synchronized release version metadata across web, Android (`versionCode 406`), API Worker, and regression suites.

## v0.4.5 - August 2026

### UX Phase 6 - Library Dashboard and Content Organization

- Added the Library dashboard with focused destinations for owned playlists, liked playlists, liked podcasts, and downloads.
- Preserved playlist management and existing create, update, and delete flows.
- Polished liked-podcast presentation and description rendering.

### Android Release

- Published Android version `0.4.5` / versionCode `405` from source commit `5a9922a301ba1272d1cae8707f0834c2e2f343d9`.
- Published `Voxyl-v0.4.5-release.apk` at 11,884,417 bytes with SHA-256 `644981A20FBC7E1E9A7A623930C7AB3373429860EFCA6B26A73F62E219D0DB67`.
- Completed 455/455 release tests, ESLint, production web build, Android build/alignment/signing, signer continuity, a true `0.4.4 / 404 -> 0.4.5 / 405` physical-device upgrade, and authenticated Library smoke validation.

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
