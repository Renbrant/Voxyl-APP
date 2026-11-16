# Voxyl Documentation

This directory contains current operational, architecture, authentication, release, migration, and platform-specific documentation for Voxyl.

The current beta line is **Voxyl 0.4.x**, with **v0.6.11** as the current source version (unreleased). The previous published Android baseline is **v0.4.13**, which opens Home directly at native startup. Production uses Cloudflare infrastructure with Clerk authentication, and Android uses a process-owned Media3 playback service for persistent audio.

## Start Here

- [Project README](../README.md)
- [Project Architecture](../ARCHITECTURE.md)
- [Changelog](../CHANGELOG.md)
- [Testing Guide](../TESTING_GUIDE.md)
- [Contributing Guide](../CONTRIBUTING.md)
- [Release Process](release-process.md)

## Product / Architecture

- [Project Architecture](../ARCHITECTURE.md)
- [Profile Avatar Model](profile-avatar-model.md)
- [Cloudflare Worker API](../workers/api/README.md)

Current primary product destinations:

```text
Home · Discover · People · Library · Profile
```

The v0.4.x UX phases are documented in `CHANGELOG.md`:

- v0.4.0 — primary navigation;
- v0.4.1 — personalized Home;
- v0.4.2 — Discover redesign;
- v0.4.3 — People social dashboard;
- v0.4.4 — People detail flows and social interactions;
- v0.4.5 — Library dashboard and focused collection views;
- v0.4.6 — Google Play readiness, account deletion, cache isolation, and production hardening;
- v0.4.7 — Continue Listening optimization to 2 episodes and responsive grid;
- v0.4.8 — Cloudflare quota reset countdown and telemetry enhancements;
- v0.4.9 — Playlist skip visualization and outro skip completion recording;
- v0.4.10 — Audio player close control with playback stop and progress persistence.
- v0.4.11 — Native startup bypasses the browser landing page and opens Home directly.
- v0.6.11 — Beta limits raised to 5 playlists per user and 10 podcasts per playlist (unreleased; Worker deploy needed, no migration).
- v0.6.10 — Landing page offers the latest test APK next to the stable one (unreleased; client only, no migration).
- v0.6.9 — Background auto-advance and full episode list: R8 disabled for release, separate `RL_RSS` limit, playlist feeds fetched four at a time (unreleased; Worker deploy needed, no migration).
- v0.6.8 — Back navigation and account sync recovery: no extra history traversal on Back/Forward, sign out on the sync failure screen (unreleased; client only, no migration).
- v0.6.7 — Upload hardening: byte-level image validation, size/dimension limits and per-account quota (unreleased; Worker deploy, no migration).
- v0.6.6 — User enumeration fix: authenticated search and suggestions, no real name for anonymous profile viewers, block-aware profiles (unreleased; Worker deploy, no migration).
- v0.6.5 — Home startup fix: restores the `getCache` import in Feed and adds an import guard test (unreleased; no migration).
- v0.6.4 — Admin configuration: hardcoded admin email removed, `is_admin` exposed to the client (unreleased; Worker needs `ADMIN_CLERK_USER_IDS` or `ADMIN_EMAILS` before deploy; no migration).
- v0.6.3 — Dependency triage: unused dependencies removed, non-breaking audit fixes, Dependabot, `docs/dependency-policy.md` (unreleased; no migration).
- v0.6.2 — Block state synchronization: shared client cache for hidden users and the blocked list, refreshed on every block or unblock (unreleased; client only, no migration).
- v0.6.1 — Android release hardening: HTTPS promotion for feed media, `allowMixedContent` removed, backup disabled, R8 enabled (unreleased; no migration).
- v0.6.0 — Mandatory Terms of Use acceptance (unreleased; migration 0010 adds acceptance columns and legal document rows).
- v0.5.0 — Rate limiting for public routes, RSS/search and authenticated writes (unreleased; no migration).
- v0.4.16 — Server-enforced username validation and case-insensitive uniqueness (Worker deployed; migration 0009 applied).
- v0.4.15 — Authenticated content reports with an admin moderation queue (Worker deployed; migration 0008 applied).
- v0.4.14 — Playlist creation API, atomic beta quotas, idempotent retries and recoverable errors (unreleased; apply migration 0007 before Worker deployment).
- v0.4.13 — Gray skip zones, visible position dots, singular day filters, and total/playable episode duration metadata.
- v0.4.12 — Native audio initialization handles both synchronous and Promise-based app-state listener registrations.

The v0.4.4 People experience adds relationship-aware detail flows for **Following**, **Followers**, **Requests**, and **Suggestions**, direct People search-to-profile navigation, explicit Follow/Follow back/Following/Unfollow states, and Accept/Decline handling for incoming follow requests.

## Authentication and Mobile

- [Android Auth Setup](android-auth-setup.md)
- [Android Manual Auth Callback Test](android-auth-manual-test.md)
- [iOS Native Setup](ios-setup.md)

Android production authentication uses the Clerk Android SDK. Persistent playback is owned by the native Media3 service rather than by Activity/WebView lifecycle.

## Release and Validation

- [Testing Guide](../TESTING_GUIDE.md)
- [Release Process](release-process.md)
- [Contributing Guide](../CONTRIBUTING.md)

The Android release model separates:

1. exact source validation;
2. signed artifact validation and freeze;
3. physical-device install/upgrade/runtime validation;
4. GitHub publication;
5. download-and-hash verification of the public APK;
6. publication evidence that binds source, frozen artifact, release metadata, and public bytes.

The v0.4.4 release demonstrates the distinction between two Android claims:

- **same-version installation smoke:** PASS for the final corrected v0.4.4 APK;
- **literal v0.4.3 → v0.4.4 upgrade:** NOT EXECUTED because the physical device was already on v0.4.4 when the final corrected artifact was frozen.

## Migration History

- [Cloudflare + Clerk Migration Plan — Historical](cloudflare-clerk-migration-plan.md)

The migration plan records the original Base44 dependency inventory and migration design. It is retained for engineering history rather than as a description of current production.

Legacy Base44 tooling may remain in the repository for reconciliation and historical traceability, but Base44 is not the current production application platform.

## Investigation History

Issue-specific investigation documents may remain in the repository for traceability.

Example:

```text
ANALYSIS_ISSUE_63.md
```

Check the related GitHub issue, current source, tests, architecture, and changelog before treating historical investigation findings as current behavior.

`CHANGES.md` is also a historical Issue #42 work log and is not the authoritative project changelog. Use `CHANGELOG.md` for release history.

## Reference

- [Capacitor Live Server Notes](reference/capacitor-live-server-notes.ts)

## Engineering Methodology

AI-assisted engineering work on Voxyl follows:

```text
https://github.com/Renbrant/ai-assisted-development-methodology
```

Generic engineering rules live in that methodology repository. Voxyl-specific architecture, release parameters, product contracts, and operational guidance live here.

The v0.4.4 release closeout also contributed reusable methodology guidance for remote helper bootstrap, Android lifecycle/process boundaries, and OEM-resilient runtime observability.

## Production

Web:

```text
https://v.renbrant.com
```

API:

```text
https://api.voxyl.renbrant.com/api
```

Deployment metadata:

```text
https://v.renbrant.com/version.json
```

Latest Android releases:

```text
https://github.com/Renbrant/Voxyl-APP/releases/latest
```

Current Android release:

```text
Voxyl v0.4.6
versionCode 406
```
