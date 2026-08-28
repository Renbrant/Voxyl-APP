# Voxyl Authenticated Browser QA

This document defines the project-specific browser QA workflow for validating authenticated Voxyl web UI changes against real Clerk and real Voxyl API data while serving the feature worktree locally.

Generic screenshot mechanics belong in the shared methodology repository. This document owns only Voxyl-specific topology, session policy, and evidence contracts.

## Why this workflow exists

Voxyl web authentication can depend on production-authorized origin behavior. A simple `localhost` browser session is therefore not a reliable substitute for the real authorized origin when validating authenticated UI.

The proven QA topology is:

```text
feature worktree at exact SHA
        |
        v
local HTTPS Vite runtime
        |
        | serves through
        v
https://v.renbrant.com
        |
        | Chrome host resolver maps to 127.0.0.1
        v
persistent isolated Voxyl QA Chrome profile
        |
        v
real Clerk session + real Voxyl API data
        |
        v
fresh CDP target per route/viewport
        |
        v
Capture PASS -> actual image review -> Visual PASS
```

## Fixed project-specific contracts

### Production-authorized QA origin

Use:

`https://v.renbrant.com`

The browser must resolve `v.renbrant.com` to `127.0.0.1` for the local QA session.

The rendered Chrome argument must semantically contain:

`--host-resolver-rules="MAP v.renbrant.com 127.0.0.1"`

Do not assume that a PowerShell argument array preserves an argument containing spaces. Validate the final native argument contract before launching Chrome.

### HTTPS port

The local QA Vite runtime uses HTTPS on port `443` so the browser origin matches the production-authorized origin exactly.

Do not substitute an arbitrary nonstandard HTTPS port when authentication origin validation is part of the test.

### Persistent isolated browser profile

Use a dedicated Voxyl QA browser profile, separate from the user's personal/default Chrome profile.

Established profile path:

`C:\GitHub\_runtime\voxyl-qa-chrome-profile`

The QA profile may preserve a real Clerk session between checkpoints. Do not delete/recreate it merely because a later screenshot or detector fails.

Chrome 136+ remote-debugging flags should not be expected to work reliably against the user's default profile. The QA profile must remain a non-default `--user-data-dir`.

### Persistent QA session manifest

The established runtime session manifest is:

`C:\GitHub\_runtime\voxyl-qa\active-session.json`

The manifest should record enough information to prove the current runtime authority, including at least:

- `source_sha`;
- `worktree`;
- `production_origin`;
- `chrome_profile`;
- `debug_port`;
- `https_port`;
- `vite_pid`;
- capture-helper path/identity;
- authenticated state when established;
- update timestamp when source identity changes.

Before reusing an existing QA runtime, verify the manifest against the exact worktree/SHA being validated.

## Vite configuration rule

A QA HTTPS overlay must **extend the real project Vite configuration**.

Do not replace the project Vite config with a minimal temporary config that drops:

- React plugin configuration;
- `@` aliases;
- other application-owned Vite behavior.

A runtime that serves an HTML shell but cannot resolve the real application imports is not valid Voxyl evidence.

## Environment precedence

When the QA runtime must use real web authentication/API configuration, process environment values must be established deliberately and their effective precedence over dotenv files must be understood.

Do not select a dotenv file merely because it exists. In particular, do not let a test/local value silently override the intended LIVE browser QA configuration.

Never record secret values in screenshot evidence or this document.

## Browser/CDP policy

### One browser lifecycle, many evidence targets

Keep the authenticated QA browser running while its runtime authority remains valid.

Do not restart Chrome between screenshots unless a browser-lifecycle change is itself necessary.

### Fresh target per route/state

For each visual evidence state:

1. build the intended URL;
2. add a unique QA query nonce when useful for cache isolation;
3. create a fresh target through the CDP `/json/new` endpoint;
4. capture from the exact returned `webSocketDebuggerUrl`;
5. close only that target afterward.

Do not reuse an arbitrary pre-existing target.

### Cache isolation

Because the QA profile uses the same origin as deployed Voxyl, stale production client content can otherwise masquerade as the feature runtime.

Use a unique query parameter such as:

`?__voxyl_qa=<unique-value>`

for fresh evidence targets when appropriate.

If stale content remains despite a unique URL, escalate only the browser-cache boundary. Do not destroy the entire profile/authenticated session by default.

## Capture helper

Use the graduated generic methodology helper:

`scripts/Capture-CdpTarget.mjs`

from the current immutable commit of:

`Renbrant/ai-assisted-development-methodology`

Before execution, prove the helper bytes according to `WORKFLOW_GRADUATION_RULES.md` / `scripts/README.md` in the methodology repository.

Do not regenerate the CDP helper inline in chat when the graduated helper is available.

The helper's target-level contract is:

```text
node Capture-CdpTarget.mjs <webSocketDebuggerUrl> <outputPng> <selector> <minimumCount> <requiredText> <forbiddenText> <width> <height> <label>
```

The caller remains responsible for route/viewport choice, target creation/closure, artifact hash/dimension checks, and evidence aggregation.

When invoking the Node helper from Windows PowerShell, do not assume `""` is a safe positional placeholder for `requiredText` or `forbiddenText`. If a probe does not care about one of those positions, use a non-empty harmless sentinel or another invocation method whose empty-argument transport has been explicitly proven. This prevents later positional arguments such as width/height from shifting unexpectedly.

## Semantic readiness rules

Readiness must describe the feature state being validated.

Good examples:

- a minimum number of dashboard cards;
- expected page title;
- expected collection terminology;
- absence of a known error state;
- absence of raw markup that should no longer be visible.

Do **not** use the displayed Voxyl release version as proof that a feature branch is stale or current. Unreleased feature work can legitimately display the previously released version number until release engineering performs the version bump.

## Visual evidence policy

For each capture, record at minimum:

- source SHA;
- route/state label;
- viewport dimensions;
- filename;
- file size;
- SHA-256;
- capture-helper identity;
- Capture PASS/FAIL.

Then upload the actual images to ChatGPT for Visual PASS/FAIL.

Metadata alone is not Visual PASS.

## Preserve already-valid evidence

When a later state fails:

- preserve all earlier screenshots whose runtime/content/artifact gates passed;
- fix only the failed product or harness boundary;
- recapture only states whose visual output could have changed;
- keep provenance honest when a final evidence set contains screenshots from more than one source SHA.

This behavior is mandatory for Voxyl UI validation because it substantially reduces repeated auth/runtime work.

## Source-SHA and branch authority

A clean detached worktree at an exact SHA can be valid for read-only runtime validation.

If a visual finding requires a source change and commit, first ensure the worktree is attached to the intended feature branch without changing the validated source SHA.

Do not start a mutating checkpoint merely because the detached worktree looks clean.

## Capture PASS vs Visual PASS

Use these statuses separately:

- **Capture PASS** — runtime/content gate passed and the requested PNG exists with expected artifact identity/sanity.
- **Visual PASS** — ChatGPT inspected the actual image and accepted the relevant layout/UX contract.

A PR that depends on responsive/visual acceptance should not claim Visual PASS from hashes or detector output alone.

## Proven Issue #76 example

Issue #76 validated:

- `/library` at 390×844;
- `/library` at 768×1024;
- `/library` at 1440×900;
- `/library/my-playlists` at 390×844;
- `/library/followed-playlists` at 390×844;
- `/library/liked-podcasts` at 390×844;
- `/library/downloads` at 390×844.

The workflow successfully preserved prior captures when later findings required:

- correcting Downloads empty-state copy;
- changing `Podcasts` to `Liked podcasts`;
- stripping raw HTML from podcast descriptions;
- repairing a duplicated i18n key discovered during remote diff review.

Only affected states were recaptured after each product change.

The graduated methodology helper was subsequently validated against this same authenticated Voxyl runtime. Its immutable blob identity, Node syntax, fail-closed invalid-width behavior, and a real 390×844 `/library` capture all passed. The helper validation also exposed the Windows PowerShell empty-native-argument transport hazard documented above.

## Recommended next-issue sequence

For future authenticated web UI work:

1. consult the current methodology `main` first;
2. establish the exact feature worktree/SHA;
3. check whether the persistent Voxyl QA runtime/session is still authoritative;
4. reuse it when valid rather than rebuilding auth/runtime infrastructure;
5. use the graduated methodology CDP helper;
6. capture a small route/viewport matrix with semantic readiness gates;
7. preserve partial successes;
8. upload actual changed/missing images for visual review;
9. only after Visual PASS proceed to PR/merge/release boundaries.

The goal is to make authenticated visual QA a repeatable project capability rather than a newly invented chat harness for every issue.
