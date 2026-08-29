# Voxyl Privacy Policy and Data Map

## Purpose

This document records the engineering basis for the Voxyl Privacy Policy introduced for Google Play readiness under Issue #103.

It is not a substitute for legal advice. Its purpose is to keep the public policy, application behavior, D1 schema, and future Google Play Data safety answers grounded in the same implementation evidence.

## Publication model

The public policy is available at:

`https://v.renbrant.com/privacy`

The React route is intentionally public and does not require authentication.

The policy is stored in two coordinated forms:

1. `src/data/privacy-policy.json` — the version-controlled payload rendered by the web and Android application.
2. D1 `legal_documents` — a versioned audit record created by `workers/api/migrations/0005_legal_documents.sql`.

The runtime page intentionally renders the bundled file instead of querying D1. This keeps the public legal page available even when authentication or the API is unavailable.

`tests/privacy-policy.test.mjs` verifies that the localized JSON stored in migration `0005` is identical to the bundled policy payload.

Future policy revisions must create a new legal-document version rather than rewriting historical production records.

## Current policy version

- Version: `2026-08-29`
- Effective date: `2026-08-29`
- Locales: `en-US`, `pt-BR`
- Publisher label: `Renbrant`
- Public route: `/privacy`

## Evidence-backed data categories

### Account and identity

Current sources include Clerk authentication plus D1 user records.

Relevant fields include:

- Clerk user identifier;
- email;
- name;
- username;
- custom Voxyl profile image;
- Clerk/provider profile image;
- profile visibility state;
- migration compatibility identifiers.

### User-generated and social data

D1 currently stores data including:

- playlists;
- playlist descriptions and artwork;
- RSS feed references;
- playlist visibility;
- playlist likes;
- podcast likes/saved podcasts;
- follows and pending requests;
- blocks;
- reports;
- referrals/invitation email context.

### Listening and playback data

D1 stores data including:

- podcast/feed metadata;
- played episode title and audio URL;
- playback timestamps/history;
- episode progress;
- duration/completion state.

Android additionally maintains runtime playback state needed by the Media3 playback service.

### User-uploaded media

Custom profile images are uploaded through the authenticated Worker and stored in Cloudflare R2.

### Infrastructure and network data

Voxyl production infrastructure uses Cloudflare Pages, Workers, D1, R2, and KV.

Standard request/network information can be processed by Cloudflare and other network providers while serving and protecting the application.

### External podcast services

Podcast discovery can use Podcast Index.

Podcast publishers, RSS servers, and media hosts are external content providers. Standard network information can be exposed to those providers when content is fetched or streamed as required to deliver the content.

## Android permission evidence

The tracked Android manifest currently declares:

- `android.permission.INTERNET`
- `android.permission.FOREGROUND_SERVICE`
- `android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK`
- `android.permission.WAKE_LOCK`

The tracked manifest does not currently request:

- camera;
- microphone;
- contacts;
- precise location.

The previous policy copy incorrectly described a camera permission. The 2026-08-29 policy removes that stale claim.

## Current third-party runtime services

Evidence in the current architecture supports disclosure of:

- Clerk — authentication and identity;
- Cloudflare — Pages, Workers, D1, R2, KV;
- Podcast Index — podcast discovery when configured;
- podcast/RSS/media hosts — external content delivery.

No Google Play Data safety answer should be finalized solely from this list. Dependency and SDK behavior must still be audited before submission.

## Account deletion blocker

Issue #104 tracks a separate release-blocking finding.

The current frontend has an account-deletion modal, but it calls a `deleteAccount` function route that is not implemented by the current production Worker router. The existing UI must therefore not be used as evidence that complete account deletion already works.

Issue #104 must define and validate:

- D1 deletion/anonymization semantics;
- denormalized and legacy personal-data cleanup;
- Clerk account lifecycle;
- R2 profile-image cleanup;
- external deletion-request URL;
- real web and Android validation.

The Google Play account-deletion declaration and final Privacy Policy deletion wording must be revalidated against the completed #104 behavior before beta submission.

## Google Play Data safety workflow

Before completing the Play Console Data safety form:

1. inventory first-party data flows;
2. inventory SDK/dependency data behavior;
3. classify each data type as collected, shared, optional, or required;
4. record purpose for each collected/shared type;
5. reconcile encryption, deletion, and retention behavior;
6. verify the answers against the current production artifact rather than development assumptions;
7. compare the final Data safety form with the current Privacy Policy.

## Policy update procedure

For a future policy revision:

1. update `src/data/privacy-policy.json`;
2. choose a new immutable policy version/effective date;
3. add a new forward D1 migration containing the exact localized payloads;
4. mark the older D1 records non-current rather than deleting history;
5. update this data map if the underlying data flow changed;
6. run `tests/privacy-policy.test.mjs` and the full default test suite;
7. validate `/privacy` on the deployed public web app and in Android;
8. reconcile Google Play Data safety/account-deletion declarations before release.

Do not silently edit historical D1 policy rows to make them match a newer policy.
