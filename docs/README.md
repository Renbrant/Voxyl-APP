# Voxyl Documentation

This directory contains current operational, architecture, authentication, release, migration, and platform-specific documentation for Voxyl.

The current beta line is **Voxyl 0.4.x**, with **v0.4.4** as the latest Android release. Production uses Cloudflare infrastructure with Clerk authentication, and Android uses a process-owned Media3 playback service for persistent audio.

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
- v0.4.4 — People detail flows and social interactions.

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
Voxyl v0.4.4
versionCode 404
source bc3a47c77c1b8a50939c267904b5dbcd00fe3c56
APK SHA-256 6C82DDD58D46CD8C73336D1D427EB9DA4951C7E984A558C3B292DA3792DD4DE8
```
