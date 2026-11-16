# Voxyl Cloudflare Worker API

The Cloudflare Worker is the production backend API for Voxyl.

It replaced the former Base44 backend and serves the web and Android applications.

## Production

Production API:

    https://api.voxyl.renbrant.com/api

Configuration:

    workers/api/wrangler.toml

Source:

    workers/api/src/index.ts

## Infrastructure

The Worker uses:

- Cloudflare D1 through `DB`;
- Cloudflare R2 through `VOXYL_MEDIA`;
- Cloudflare KV through `VOXYL_CACHE`;
- Clerk authentication;
- Podcast Index where configured.

## Responsibilities

The production Worker handles capabilities including:

- health and diagnostics;
- Clerk JWT validation;
- authenticated user resolution;
- profile updates;
- provider-avatar synchronization;
- application media storage through R2;
- playlists and visibility enforcement;
- public profile and playlist responses;
- user search;
- social relationships and follow requests;
- blocks;
- likes and playback persistence;
- podcast discovery;
- RSS retrieval;
- migration compatibility identifiers.

The Worker is not a migration placeholder. It is the active production backend.

## Authentication and Authorization

Protected operations derive the caller from the validated Clerk token.

Client-provided user IDs are not authoritative for ownership.

`CLERK_ISSUER` must match the exact Clerk instance issuer. Session tokens
must carry `iss`, `sub`, `sid`, and finite numeric `iat`, `nbf`, and `exp`
claims. A present `azp` must match `CLERK_AUTHORIZED_PARTIES`; a native token
may omit `azp` when no Origin was sent. Malformed claims fail closed after
signature verification. Keep the production `CLERK_JWT_KEY` current: when it
is set, the Worker uses Clerk's SDK and never retries a rejected token against
another verifier. If it is absent, the Worker uses only the configured HTTPS
issuer's JWKS with a 3-second fetch timeout and a bounded 5-minute in-memory
key cache. A JWKS outage in this mode rejects uncached tokens.

Both modes verify JWTs locally and do not query Clerk for live session status
on every request. A recently revoked session token may therefore remain
usable until its `exp`. Before deploying, confirm the configured token lifetime
in Clerk and whether destructive operations such as account deletion need a
separate live-session check. Do not assume that logging out revokes an already
issued JWT immediately at this Worker.

## Image Uploads

`POST /api/files/upload` (avatars and playlist covers) judges files by their bytes, never by the declared MIME type or file name:

    allowed: JPEG, PNG, WebP (SVG, GIF, HEIC and anything else -> 415 unsupported-image)
    size: 5 MB per file; a declared body over 5 MB + 64 KB is refused before parsing (413 file-too-large)
    dimensions: at most 8192 px per side and 36 megapixels, read from the header (413 image-dimensions)
    quota: at most 40 objects and 100 MB per account (413 storage-quota-exceeded)
    key: profiles/<clerk user id>/<timestamp>-<uuid>.<jpg|png|webp>; the client file name is not used
    metadata: Content-Type comes from the detected format, with a one-year immutable Cache-Control

Old objects are never deleted automatically, because they may still be used as an avatar or a cover. Account deletion removes everything under the account prefix.

Rate limiting: uploads are POST requests, so they fall under the per-user `RL_WRITE` limit described in `wrangler.toml`.

Serving: images are served from `https://voxyl-media.renbrant.com`, a separate origin from the app and the API, so a stored file cannot read the app's storage. Because the Worker stores only verified raster images with a matching Content-Type, no script can be served as an image. For defense in depth, add a Cloudflare Transform Rule on that hostname that sets `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox` (R2 object metadata cannot set these headers). This is a dashboard setting, not part of the repository.

## Admin Access

Admin access is configuration only; no identity is hardcoded in source. A user is an admin when any of these holds:

    users.role = 'admin' in D1
    the user's Clerk id is listed in ADMIN_CLERK_USER_IDS (comma-separated, preferred: ids do not change)
    the user's email is listed in ADMIN_EMAILS (comma-separated, case-insensitive)

Set the values as Worker secrets or variables, for example `npx wrangler secret put ADMIN_CLERK_USER_IDS --config workers/api/wrangler.toml`, before deploying a release that depends on them. `GET /api/me` returns `is_admin` so the client can show or hide admin entry points; every admin route still checks the role on the Worker.

## Profile Avatar Model

D1 fields:

    users.profile_picture
    users.clerk_profile_picture

Resolution:

    custom Voxyl/R2 image
        > Clerk/provider image
        > initials fallback

`GET /api/me` may synchronize the provider image without overwriting the custom image.

Once the verified Clerk ID is linked to its D1 user, normal `GET /api/me`
requests are read-only. Identity migration writes run only when a real account
link or orphan reconciliation is required. This protects the D1 rows-written
budget from recurring account-sync batches.

`PATCH /api/me` updates the authenticated user's Voxyl profile.

Owned playlist `creator_picture` values are synchronized server-side when the resolved avatar changes.

See `docs/profile-avatar-model.md`.

## Database Migrations

Current migration sequence:

    0001_initial_schema.sql
    0002_base44_compat_schema.sql
    0003_podcast_play_idempotency.sql
    0004_clerk_profile_picture.sql
    0005_legal_documents.sql
    0006_legal_document_support_email.sql

Migration directory:

    workers/api/migrations/

List remote migrations:

    npx wrangler d1 migrations list voxyl-db --remote --config workers/api/wrangler.toml

Apply a reviewed migration:

    npx wrangler d1 migrations apply voxyl-db --remote --config workers/api/wrangler.toml

Take and verify a production database backup before applying schema changes.

## Development

Install:

    npm install

Worker dry-run:

    npx wrangler deploy --dry-run --strict --config workers/api/wrangler.toml

## Deployment

Production Worker deployment:

    npx wrangler deploy --strict --config workers/api/wrangler.toml

Apply required D1 migrations before deploying Worker code that depends on the new schema.

## Security Principles

- Resolve ownership from authenticated Clerk identity.
- Keep public DTOs intentionally minimal.
- Keep uploads authenticated and owner-scoped.
- Do not overwrite custom application data during provider synchronization.
- Treat Base44 IDs as migration compatibility identifiers, not authentication identity.

## Related Documentation

- [Project Architecture](../../ARCHITECTURE.md)
- [Profile Avatar Model](../../docs/profile-avatar-model.md)
- [Documentation Index](../../docs/README.md)
- [Cloudflare + Clerk Migration Plan — Historical](../../docs/cloudflare-clerk-migration-plan.md)

## Rate limits

The Worker applies per-route limits through the Workers Rate Limiting API. The bindings are declared in `wrangler.toml` (`[[ratelimits]]`) and require Wrangler 4.36 or later; the repository pins Wrangler 4.162.0 as a devDependency.

| Binding | Routes | Key | Limit |
|---|---|---|---|
| `RL_PUBLIC` | `searchUsers`, `getPublicUserProfile`, `getUserPlaylists` | client IP | 60 / 60 s |
| `RL_EXPENSIVE` | podcast search | user id when authenticated, otherwise client IP | 20 / 60 s |
| `RL_RSS` | RSS fetch (opening a playlist fetches every feed in it) | user id when authenticated, otherwise client IP | 300 / 60 s |
| `RL_WRITE` | every authenticated `POST`, `PATCH`, `PUT` and `DELETE` | user id | 30 / 60 s |

A limited request returns `429` with `{ "ok": false, "code": "rate-limited" }` and `Retry-After: 60`. The response keeps the CORS headers. A missing binding disables enforcement, which is how local development and the test suite run. Limits are starting values; calibrate them against real traffic before tightening, and note that a single playlist open can issue one RSS fetch per feed.
