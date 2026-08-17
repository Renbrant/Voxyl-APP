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

## Profile Avatar Model

D1 fields:

    users.profile_picture
    users.clerk_profile_picture

Resolution:

    custom Voxyl/R2 image
        > Clerk/provider image
        > initials fallback

`GET /api/me` may synchronize the provider image without overwriting the custom image.

`PATCH /api/me` updates the authenticated user's Voxyl profile.

Owned playlist `creator_picture` values are synchronized server-side when the resolved avatar changes.

See `docs/profile-avatar-model.md`.

## Database Migrations

Current migration sequence:

    0001_initial_schema.sql
    0002_base44_compat_schema.sql
    0003_podcast_play_idempotency.sql
    0004_clerk_profile_picture.sql

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