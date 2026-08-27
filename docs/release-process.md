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
Voxyl 0.4.3
Android versionCode 403
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

---

## Manual Android Smoke

After the automatic upgrade gate, manually validate the highest-risk product behaviors for the release.

Typical smoke includes:

- existing authenticated session remains valid;
- primary navigation opens correctly;
- release-specific feature works;
- Voxyl branding renders correctly;
- play/pause works;
- close/reopen does not create orphaned or duplicate audio;
- native playback remains controllable.

For People-related releases, include:

- People root;
- Following;
- Followers;
- Requests;
- Suggestions;
- people search;
- summary/detail consistency.

---

## GitHub Release Publication

Before GitHub publication:

- revalidate the frozen APK hash/size;
- verify GitHub authentication;
- verify `origin/main` still resolves to the intended source commit;
- inspect local tag, remote tag, and release state for idempotent publication/recovery.

The release tag must resolve to the exact validated source commit.

Publish the **already frozen APK**. Do not rebuild just before upload.

The generic methodology helper `scripts/Publish-GitHubRelease.ps1` supports asset verification when used from the methodology repository.

---

## Post-Publication Byte Verification

Publication is incomplete until the public artifact is independently verified.

After GitHub Release creation:

1. verify release tag/title/draft/prerelease state;
2. verify the expected APK exists exactly once;
3. verify GitHub-reported size;
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

Persist a publication evidence manifest when practical.

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
5. downloaded asset matches frozen bytes.

If a late stage fails, inspect the existing state and resume from the first missing/invalid boundary.

Do not blindly:

- rebuild;
- delete a correct tag;
- recreate a correct release;
- upload duplicate assets;
- repeat a true upgrade test whose artifact/source identity has not changed.

---

## Current Reference Release

The first release completed with the full freeze → true-upgrade → publish → public-byte-verification chain documented here is:

```text
Voxyl v0.4.3
source commit 888af88480390c3d519d54643548dcea3236d9ce
versionCode 403
APK Voxyl-v0.4.3-release.apk
SHA-256 F4D1A47DE7415D81896152C5F8078A20E7E7CBE207C6C160BEAE3868D85C887D
```

The public GitHub release asset was downloaded after publication and verified byte-for-byte against the frozen/tested artifact.
