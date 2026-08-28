# Voxyl Release Process

This document describes the **project-specific** release flow for Voxyl.

Generic release-engineering rules are governed by the adopted methodology repository:

```text
https://github.com/Renbrant/ai-assisted-development-methodology
```

This document records Voxyl-specific identities, release boundaries, validation expectations, and artifact flow.

---

## Release Systems Are Separate

Voxyl has separate release surfaces:

- **Web frontend** — Cloudflare Pages;
- **Backend API** — Cloudflare Workers;
- **Android** — signed APK published through GitHub Releases.

A merge to `main` is not automatically proof that all three surfaces are deployed or validated.

Treat each surface as an independently observable state.

---

## Authoritative Source

The release source must be pinned to an exact full Git commit SHA.

Before producing a release artifact:

1. fetch `origin/main`;
2. record the exact full SHA;
3. use an isolated clean worktree when practical;
4. refuse to continue if `origin/main` moves unexpectedly;
5. preserve provenance from that exact source through the built artifact.

Do not use a short SHA as the authoritative identity.

---

## Version Identities

Current beta versioning uses:

```text
0.MINOR.PATCH
```

Android also maintains a monotonic integer `versionCode`.

Example:

```text
Voxyl 0.4.4
Android versionCode 404
Package com.renbrant.voxyl
```

Release metadata must agree across:

- `package.json`;
- `package-lock.json` root package metadata;
- `android/app/build.gradle`;
- generated `version.json` artifacts.

---

## Clean Release Worktree

A release worktree does not inherit ignored/generated state from a long-lived checkout.

Before build execution, establish the required environment explicitly, including as applicable:

- `npm ci` dependencies;
- Android SDK discovery;
- required Capacitor-generated/native plugin state;
- production Clerk publishable configuration;
- signing keystore/tooling.

For a clean Android release preparation, use:

```text
npx cap sync android
```

when complete native plugin regeneration is required.

If `cap sync` reports tracked changes, classify them before continuing. Proven LF/CRLF-only noise may be restored; semantic generated changes require normal source review/commit before release.

---

## Production Configuration

Android release builds require Clerk production configuration.

The production Clerk publishable key must use the production form:

```text
pk_live_...
```

The key value must not be printed in release logs.

Temporary environment overrides must preserve and restore the caller's original process environment state.

---

## Android Build and Artifact Validation

The Android release must be validated beyond Gradle success.

Verify at least:

- package ID `com.renbrant.voxyl`;
- expected `versionName`;
- expected `versionCode`;
- production signing certificate continuity;
- embedded/source provenance when supported;
- APK size;
- APK SHA-256.

When signer continuity matters, compare against the previous official published Voxyl APK rather than an arbitrary local build.

---

## Artifact Freeze

Once the signed APK passes identity, provenance, signing, size, and SHA-256 validation, copy/designate it as the **frozen release artifact**.

After freeze:

- downstream device failures do not justify rebuilding it;
- GitHub authentication/publication failures do not justify rebuilding it;
- each downstream consumer rechecks the frozen SHA-256 before mutation;
- rebuilding is justified only when an artifact-producing input materially changes.

Persist an artifact evidence manifest when practical.

Recommended fields:

```text
release/version
full source SHA
package ID
versionName
versionCode
artifact path/name
artifact size
artifact SHA-256
signer fingerprint
embedded provenance
validation status
```

Downstream install, smoke, publication, and post-publication verification should consume or cross-check this manifest instead of repeatedly retyping release constants.

---

## Android Readiness Gate

Immediately before device mutation:

1. verify ADB is available;
2. verify the intended device is connected;
3. verify it is online and authorized;
4. require exactly one intended authorized target or select the target explicitly;
5. verify the expected previous Voxyl version when a true upgrade is required.

A readiness failure preserves the frozen artifact and all upstream release evidence.

---

## True In-Place Upgrade

A true Android upgrade test requires a verified previous production version on the device.

Use:

```text
adb install -r <frozen-apk>
```

Do not uninstall the app or clear data for the normal upgrade test.

Validate:

- previous version before mutation;
- install success;
- target version after install;
- package identity unchanged;
- session/data preservation;
- `firstInstallTime` continuity when used as evidence;
- installed APK byte identity against the frozen artifact when practical.

A same-version reinstall is useful evidence but must not be called a previous-version upgrade.

### v0.4.4 example

The final corrected v0.4.4 artifact was installed over an already-installed v0.4.4 build.

Therefore the recorded result is:

```text
same-version 0.4.4 -> 0.4.4 install smoke: PASS
installed APK byte identity: EXACT
session/data continuity: PASS
literal 0.4.3 -> final corrected 0.4.4 upgrade: NOT EXECUTED
```

The prior-version upgrade was not manufactured by destructive downgrade.

---

## Manual Android Smoke

After the automatic install/upgrade gate, validate the highest-risk product behaviors for the release.

Typical smoke includes:

- existing authenticated session remains valid;
- primary navigation opens correctly;
- release-specific feature works;
- Voxyl branding renders correctly;
- play/pause works from a valid loaded media item;
- close/reopen does not create orphaned or duplicate audio;
- native playback remains controllable.

For People-related releases, include:

- People root;
- Following;
- Followers;
- Requests;
- Suggestions;
- people search;
- public-profile navigation;
- Follow / Follow back / Following / Unfollow states;
- Accept/Decline handling when safe pending requests exist;
- summary/detail/count/badge consistency.

Do not manufacture unsafe relationship state simply to exercise a mutation. Record a path as not executed when a safe precondition is unavailable.

---

## Stateful Android Validation Boundaries

Voxyl's persistent Android playback authority is process-owned. Lifecycle tests must distinguish:

```text
Activity/WebView recreation
Task/Recents dismissal with process survival
Service recreation
Process death and process restart
OS/media-resumption behavior after process death
```

These are different contracts.

Before a stateful playback test, declare which boundary is being exercised. If the PID changes unexpectedly in a test that assumes process survival, classify the process transition before continuing.

A newly recreated `VoxylPlaybackService`/`MediaSession` can be healthy and singleton while containing no currently loaded media item. A blind OS `MEDIA_PLAY` command after process death is therefore not by itself proof of a Voxyl regression.

Android observability also varies by OS/OEM. Do not rely on one accessibility class, one `dumpsys` line shape, or one launcher text match as the sole invariant. Preserve saved XML/screenshots/runtime output after detector failures and diagnose those artifacts before repeating a mutation.

---

## GitHub Release Publication

Before GitHub publication:

- revalidate the frozen APK hash/size;
- verify GitHub authentication;
- verify `origin/main` still resolves to the intended source commit;
- inspect local tag, remote tag, and release state for idempotent publication/recovery.

The release tag must resolve to the exact validated source commit.

Publish the **already frozen APK**. Do not rebuild just before upload.

The generic methodology helper `scripts/Publish-GitHubRelease.ps1` is the preferred publication mechanism for this boundary because it already implements the mechanical tag/release/asset/race/public-byte checks.

### Obtaining the official helper

Do not assume the methodology repository exists at a particular local filesystem path.

Before invoking the helper, prove how its bytes are being sourced:

1. resolve the current methodology `main` commit;
2. if a local methodology checkout is explicitly known and verified, use the helper from that checkout after proving it corresponds to the intended methodology commit;
3. if no local checkout is proven, obtain the helper directly from GitHub at the pinned immutable methodology commit;
4. verify the downloaded helper against the expected Git blob identity before execution;
5. record the methodology commit/helper identity in publication evidence when practical.

Do not invent an intermediate helper-export mechanism or assume an unverified path merely because a local checkout would be convenient.

For v0.4.4, the successful chain was:

```text
current methodology commit
        -> exact Publish-GitHubRelease.ps1 blob
        -> verified local helper bytes
        -> official helper execution
        -> frozen APK publication
        -> public-byte verification
```

---

## Post-Publication Byte Verification

Publication is incomplete until the public artifact is independently verified.

After GitHub Release creation:

1. verify release tag/title/draft/prerelease state;
2. verify the expected APK exists exactly once;
3. verify GitHub-reported size/digest when available;
4. download the published APK into a separate verification directory;
5. calculate its SHA-256;
6. compare downloaded size and SHA-256 with the frozen artifact.

Success proves:

```text
validated source
      -> frozen signed APK
      -> GitHub release asset
      -> downloaded public APK
```

are bound to the same artifact bytes.

Persist a publication evidence manifest after this verification succeeds.

Recommended publication-evidence fields include:

```text
release/tag
release URL
target/source SHA
verified remote tag target
published asset name
frozen artifact size/SHA-256
downloaded asset size/SHA-256
explicit byte-identity result
draft/prerelease/latest state
runtime/install/upgrade status
methodology/helper identity when material
publication verification timestamp
```

---

## Web Release

The frontend production surface is:

```text
https://v.renbrant.com
```

Deployment metadata:

```text
https://v.renbrant.com/version.json
```

After deployment, verify that the production endpoint reports the intended:

- application version;
- full Git SHA;
- `main` branch;
- build metadata.

Then perform a production runtime smoke.

A merge/push alone does not prove the matching web artifact is live.

---

## Worker Release

The Workers API is a separate production boundary.

When backend code changes:

- validate backend tests/contracts;
- deploy the Worker deliberately;
- verify the production endpoint behavior;
- perform feature-specific authenticated runtime checks when required.

A frontend release does not prove the Worker is on the matching backend revision.

---

## Partial Failure Recovery

Treat release publication as a state machine.

Observable states include:

1. frozen artifact exists;
2. tag exists and points to expected source;
3. GitHub Release exists in intended state;
4. asset exists exactly once;
5. downloaded asset matches frozen bytes;
6. publication evidence manifest records the verified public binding.

If a late stage fails, inspect the existing state and resume from the first missing/invalid boundary.

Do not blindly:

- rebuild;
- delete a correct tag;
- recreate a correct release;
- upload duplicate assets;
- repeat a true upgrade test whose artifact/source identity has not changed;
- regenerate large publication harnesses when the official helper already owns the mechanical sequence.

Repeated harness/tooling failures should trigger a redesign of the mechanism, not another layer of ad hoc wrapper logic.

---

## Current Reference Release

The current Android reference release is:

```text
Voxyl v0.4.4
source commit bc3a47c77c1b8a50939c267904b5dbcd00fe3c56
versionCode 404
APK Voxyl-v0.4.4-release.apk
size 11884417 bytes
SHA-256 6C82DDD58D46CD8C73336D1D427EB9DA4951C7E984A558C3B292DA3792DD4DE8
```

The GitHub tag points to the exact source commit, the Release is public and non-prerelease, exactly one APK asset is present, GitHub reports the same size/digest, and the helper downloaded the public asset again and verified exact byte identity against the frozen APK.

Validation classification for the final corrected artifact:

```text
source/tests/lint/build: PASS
artifact identity/signing/freeze: PASS
same-version physical install: PASS
public-profile visual validation: PASS
playback singleton architecture: unchanged from accepted v0.3.2 implementation, with final-artifact playback spot-check
literal 0.4.3 -> final corrected 0.4.4 upgrade: NOT EXECUTED
GitHub publication/public-byte verification: PASS
```
