# Voxyl Documentation

This directory contains current operational, architecture, migration, authentication, and platform-specific documentation for Voxyl.

Production currently runs on Cloudflare infrastructure with Clerk authentication.

## Architecture

- [Project Architecture](../ARCHITECTURE.md)
- [Profile Avatar Model](profile-avatar-model.md)
- [Cloudflare Worker API](../workers/api/README.md)

## Authentication and Mobile

- [Android OAuth Setup](android-auth-setup.md)
- [Android Manual Auth Callback Test](android-auth-manual-test.md)
- [iOS Native Setup](ios-setup.md)

## Migration History

- [Cloudflare + Clerk Migration Plan — Historical](cloudflare-clerk-migration-plan.md)

The migration plan records the original Base44 dependency inventory and migration design. It is retained for engineering history rather than as a description of current production.

## Investigation History

Issue-specific investigation documents may remain in the repository for traceability.

Example:

    ANALYSIS_ISSUE_63.md

Check the related GitHub issue and changelog before treating historical investigation findings as current behavior.

## Reference

- [Capacitor Live Server Notes](reference/capacitor-live-server-notes.ts)

## Production

Web:

    https://v.renbrant.com

API:

    https://api.voxyl.renbrant.com/api

Deployment metadata:

    https://v.renbrant.com/version.json