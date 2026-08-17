# Voxyl Profile Avatar Model

This document defines the canonical profile-avatar behavior for Voxyl.

## Canonical Data

Custom Voxyl/R2 image:

    users.profile_picture

Clerk/provider image:

    users.clerk_profile_picture

The provider field was added by:

    workers/api/migrations/0004_clerk_profile_picture.sql

## Resolution Order

    1. users.profile_picture
    2. users.clerk_profile_picture
    3. initials fallback

In practical terms:

    custom Voxyl/R2
        > Clerk/provider
        > initials

## Provider Synchronization

Authenticated `/api/me` resolution may synchronize `users.clerk_profile_picture`.

Provider synchronization must never overwrite `users.profile_picture`.

If the Clerk Backend API request fails, the previously stored provider image is preserved.

If Clerk successfully reports that the user no longer has a real provider image, a stale provider value may be cleared.

## API Representation

Conceptually:

    custom_profile_picture = raw custom image
    clerk_profile_picture  = raw provider image
    profile_picture        = resolved custom-or-provider image
    picture                = resolved custom-or-provider image

Public profile, user-search, and social responses use the same resolution semantics.

## Custom Upload

A custom image follows:

    POST /api/files/upload
        -> Cloudflare R2
        -> file_url
        -> PATCH /api/me
        -> users.profile_picture

The update is scoped to the authenticated Clerk identity.

## Use Login Photo

The **Use login photo** action clears the custom image:

    PATCH /api/me
    profile_picture = null

The resolver then falls through to `users.clerk_profile_picture`.

The provider URL is not copied into the custom field.

## Frontend Rendering

Shared rendering lives in:

    src/components/common/UserAvatar.jsx

It centralizes:

- resolved-image rendering;
- initials;
- external-image handling;
- broken-image fallback.

Validated surfaces include Profile, public profiles, Explore/search, followers, following, and pending follow requests.

## Playlist Creator Picture

`playlists.creator_picture` is a denormalized presentation field.

The Worker synchronizes owned playlists when the resolved avatar changes.

The canonical user row remains the source of truth.

## Safety Invariants

1. Custom media takes precedence.
2. Provider synchronization does not overwrite custom media.
3. Custom and provider values remain separate.
4. Profile updates are owner-scoped.
5. Public responses expose safe profile data only.
6. Broken images fall back to initials.
7. Playlist creator pictures use the same resolved-avatar semantics.
8. Provider-fetch failure is not interpreted as provider-image deletion.

## Production Validation — August 2026

The validated transition was:

    provider synchronized
        -> custom remains preferred
        -> custom cleared
        -> provider restored
        -> custom uploaded again
        -> custom becomes preferred

Final D1 state:

    has_custom_picture     = 1
    has_clerk_picture      = 1
    custom_overrides_clerk = 1

Playlist state:

    owned_playlists                    = 8
    playlists_matching_custom_picture = 8

The full automated suite completed with:

    329 passed
    0 failed

## Related Work

- Issue #35
- Issue #63
- PR #64
- PR #65
- migration `0004_clerk_profile_picture.sql`

## Related Documentation

- [Architecture](../ARCHITECTURE.md)
- [Worker API](../workers/api/README.md)
- [Documentation Index](README.md)
- [Cloudflare + Clerk Migration Plan — Historical](cloudflare-clerk-migration-plan.md)