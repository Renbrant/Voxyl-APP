# Voxyl Testing Guide

This document describes the current validation strategy for the Voxyl beta line.

It replaces the old Issue #63-specific manual test guide. Historical investigation details remain available in issue-specific documents and GitHub history, but they are not the current project-wide testing contract.

---

## Validation Layers

Voxyl validation is intentionally layered. A green source test suite does not replace runtime validation, and a successful build does not prove release provenance.

The main evidence layers are:

1. focused regression tests;
2. full automated suite;
3. lint and type checking;
4. production web build;
5. runtime/visual validation when behavior changes;
6. physical Android validation for native lifecycle behavior;
7. release artifact identity/provenance/signing checks;
8. true upgrade validation when releasing Android;
9. post-publication byte verification.

---

## Standard Source Validation

For a normal frontend/backend increment, start with focused tests for the changed behavior and then run the full project gates.

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Repository integrity:

```bash
git status
git diff --check
```

Use `npm ci` in clean validation/release worktrees when reproducibility from `package-lock.json` matters.

---

## Current Automated Baseline

The v0.4.3 release candidate completed:

```text
428 / 428 automated tests
38 test suites
ESLint: PASS
Production build: PASS
```

The exact test count is evidence for that release, not a permanent constant. Future changes may legitimately add or remove tests; the requirement is that the discovered current suite passes completely.

---

## UI and Product Runtime Validation

Changes to navigation, responsive layout, loading/error states, or user flows should be exercised in the real application rather than inferred only from unit tests.

Useful viewport classes include:

- narrow mobile;
- standard mobile;
- tablet;
- desktop.

For authenticated experiences, validate with a real authenticated session whenever the feature depends on production-shaped user/social data.

### Current primary navigation

Verify the five canonical destinations when navigation behavior changes:

```text
Home · Discover · People · Library · Profile
```

### Home regressions

When Home behavior changes, validate as applicable:

- For You;
- Trending (90-day activity semantics);
- Last Week (7-day activity semantics);
- Continue Listening;
- recently played content;
- history;
- loading/empty/error/retry states.

### Discover regressions

Discover should remain focused on:

- Playlists;
- Podcasts.

People search should not silently return to Discover.

### People regressions

When social behavior changes, validate:

- Following;
- Followers;
- incoming Requests;
- Suggestions;
- People search;
- summary-count/detail consistency;
- incoming-request badges;
- hidden/block/relationship eligibility rules where affected.

---

## Authentication Validation

Web and Android authentication use different Clerk integration paths and both should be respected in testing.

### Web

Validate as applicable:

- sign in;
- authenticated API calls;
- protected-route behavior;
- sign out;
- session restoration.

### Android

Physical-device validation is required for meaningful changes to:

- Clerk hosted auth;
- system-browser return;
- `clerk://com.renbrant.voxyl.callback`;
- native session restoration;
- logout;
- signed-out cold start;
- Android WebView API authorization/CORS.

Do not infer native auth correctness only from browser tests.

---

## Android Playback Validation

Persistent playback is stateful native behavior and must be tested on a real Android device when its architecture or integration changes.

Important invariants:

- one authoritative process-owned playback engine;
- one MediaSession;
- Activity/WebView recreation does not create a second player;
- UI reconnects to native playback state;
- pause controls the actual active stream;
- stop terminates/clears playback according to product semantics;
- repeated close/reopen cycles do not accumulate orphaned or duplicate audio.

Recommended regression flow:

1. start playback;
2. pause/resume;
3. navigate between product sections;
4. background and foreground the app;
5. remove/recreate the UI as appropriate;
6. reopen Voxyl and confirm control reconnects to the existing session;
7. switch episode;
8. confirm no parallel audio streams;
9. stop and reopen;
10. confirm stopped state remains coherent.

When the change is unrelated to playback but a signed Android release is being prepared, perform a smaller playback smoke to protect this high-risk invariant.

---

## Backend / Social Validation

Backend changes should test both authorization and the final API contract.

For protected operations:

- unauthenticated calls should be rejected;
- ownership must derive from validated Clerk identity;
- client-supplied ownership identifiers must not bypass authorization;
- relationship mutations should be checked against resulting authoritative state.

For People/social work, do not validate only individual helper queries. Confirm that the final API representation and rendered summary/detail behavior agree.

---

## D1 Migration Validation

Schema changes must use a new sequential migration in:

```text
workers/api/migrations/
```

Validate:

- migration syntax;
- behavior on representative existing data;
- preservation of existing rows unless a deliberate migration says otherwise;
- application/API compatibility after migration;
- production deployment separately from source merge.

Do not rewrite the historical meaning of an already-applied migration.

---

## Production Web Validation

A successful merge to `main` is not proof that the corresponding web artifact is running in production.

After production deployment, verify:

```text
https://v.renbrant.com/version.json
```

The deployed metadata should match the intended:

- version;
- full Git SHA;
- branch;
- build artifact.

Then perform a real production smoke for the changed behavior.

---

## Android Release Validation

Android release validation is a separate release-engineering boundary.

Before publication, verify at least:

- exact release source commit;
- `versionName`;
- `versionCode`;
- package `com.renbrant.voxyl`;
- production Clerk configuration availability;
- production signing certificate continuity;
- embedded build/source provenance;
- APK size;
- APK SHA-256.

Once those gates pass, freeze that signed APK. Downstream device or GitHub failures must not cause an unnecessary rebuild of the same valid artifact.

See [docs/release-process.md](docs/release-process.md).

---

## True In-Place Android Upgrade

A true upgrade test requires the device to be on the verified prior production version.

Expected pattern:

```text
previous version installed
        |
        v
adb install -r <frozen-new-apk>
        |
        v
new version installed
```

Validate:

- previous `versionName/versionCode` before mutation;
- `adb install -r` success;
- new `versionName/versionCode`;
- no uninstall;
- no data clear;
- `firstInstallTime` preserved when used as continuity evidence;
- session/user data preserved;
- pulled installed `base.apk` hash matches the frozen release artifact when practical.

If the device is already on the target version, do not describe a same-version reinstall as a true previous-version upgrade.

---

## Post-Publication Verification

For GitHub Android releases, publication is not complete at successful upload.

After publication:

1. verify tag/release identity;
2. verify the expected APK asset exists exactly once;
3. download the published APK into a separate verification location;
4. compare file size with the frozen artifact;
5. compare SHA-256 with the frozen artifact.

This proves that the bytes available to users are the bytes that were validated and tested.

---

## Evidence and Failure Classification

When a validation checkpoint fails, classify the failure before changing product code:

- product defect;
- test defect;
- environment/readiness failure;
- harness/tooling failure;
- methodology compliance failure.

Preserve successful evidence from earlier stages and resume from the smallest technically correct boundary.

Do not repeat expensive validation merely to make the transcript look linear when the underlying source/artifact identity has not changed.

---

## Historical Issue-Specific Tests

Issue-specific testing documents and investigations may remain in repository history for traceability, including the former Issue #63 profile/social test guide.

Treat those as historical evidence. Current acceptance criteria come from:

- the active GitHub issue/PR;
- current source/tests;
- this guide;
- [CONTRIBUTING.md](CONTRIBUTING.md);
- [docs/release-process.md](docs/release-process.md);
- the adopted AI-assisted development methodology.
