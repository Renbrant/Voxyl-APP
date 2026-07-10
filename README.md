# Voxyl: Social Podcast Playlists

**Voxyl** is a modern social podcast platform designed to give listeners more control over how they discover, organize, and enjoy long-form audio.

By combining traditional RSS technology with social curation, Voxyl allows users to build personalized podcast playlists, follow other listeners, discover new content, and enjoy a consistent listening experience across web and Android.

<p align="center">
  <img src="promo/banner.png" width="100%" alt="Voxyl banner">
</p>

---

## Try It Out

Voxyl is currently in beta.

You can access the production web application here:

**[Open Voxyl Web App](https://v.renbrant.com/)**

Production deployment metadata is available at:

**[View Current Deployment Version](https://v.renbrant.com/version.json)**

---

## Key Features

- **Smart RSS Aggregation:** Combine up to 5 RSS feeds into a single playlist.
- **Custom Podcast Playlists:** Create personalized collections from multiple podcast sources.
- **Social Discovery:** Follow users and discover playlists curated by the community.
- **Guest Mode:** Explore public playlists and trending content without creating an account.
- **Flexible Visibility:** Set playlists as public, followers-only, or private.
- **Advanced Playback:** Resume episodes, track progress, autoplay the next episode, and continue listening across navigation.
- **Native Android Playback:** Background audio support through Capacitor and native audio integration.
- **Episode Filtering:** Filter episodes by publication date and maximum duration.
- **Feed-Level Controls:** Configure intro and outro skip values for individual feeds.
- **Responsive Interface:** Optimized layouts for mobile, tablet, and desktop.
- **Theme Support:** Light, Dark, and System-Automatic themes.
- **PWA Support:** Installable web experience with partial offline support.

---

## Screenshots

<p align="center">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/1.png" width="200" alt="Voxyl screenshot 1">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/2.png" width="200" alt="Voxyl screenshot 2">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/3.png" width="200" alt="Voxyl screenshot 3">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/4.png" width="200" alt="Voxyl screenshot 4">
</p>

<p align="center">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/5.png" width="200" alt="Voxyl screenshot 5">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/6.png" width="200" alt="Voxyl screenshot 6">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/7.png" width="200" alt="Voxyl screenshot 7">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/8.png" width="200" alt="Voxyl screenshot 8">
</p>

---

## Voxyl 3.0

Voxyl 3.0 introduced the largest architectural change in the project so far.

The application was migrated away from Base44 and now runs on an independent infrastructure built with Cloudflare and Clerk.

Major changes include:

- Cloudflare Pages for frontend hosting
- Cloudflare Workers for the API
- Cloudflare D1 for structured application data
- Cloudflare R2 for media storage
- Cloudflare KV for caching support
- Clerk for authentication
- Automated deployments from the GitHub `main` branch
- Automated production version tracking
- Migration tools for legacy Base44 data and media
- Improved Android authentication and session handling

For the full release history, see the [Changelog](CHANGELOG.md).

---

## Architecture

```text
Web Browser / Android App
            |
            v
      React + Vite
            |
            v
   Cloudflare Pages
            |
            v
 Cloudflare Workers API
       /      |      \
      v       v       v
     D1      R2      KV
            |
            v
      Clerk Authentication
```

### Frontend

- React
- Vite
- React Router
- TanStack React Query
- Tailwind CSS
- Radix UI
- Capacitor

### Backend

- Cloudflare Workers
- Cloudflare D1
- Cloudflare R2
- Cloudflare KV

### Authentication

- Clerk

### Mobile

- Capacitor
- Native Android project
- Native background audio integration

For a detailed technical overview, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Production Services

### Web Application

```text
https://v.renbrant.com
```

### API

```text
https://api.voxyl.renbrant.com/api
```

### Deployment Metadata

```text
https://v.renbrant.com/version.json
```

The deployment metadata endpoint reports:

- Application version
- Short Git commit
- Full Git commit
- Deployment branch
- Build timestamp

---

## Project Structure

```text
android/                 Native Android Capacitor project
base44/                  Temporary legacy migration tooling
docs/                    Setup, authentication, and technical documentation
patches/                 patch-package fixes applied after npm install
promo/                   Marketing assets used by the README
public/                  Static assets, icons, and PWA files
scripts/                 Build and migration utilities
screenshot/              Product and store screenshots
src/                     React frontend application
workers/api/             Cloudflare Workers backend
ARCHITECTURE.md          System architecture documentation
CHANGELOG.md             Release history
CONTRIBUTING.md          Contribution and commit conventions
capacitor.config.ts      Capacitor configuration
package.json             Project dependencies and scripts
vite.config.js           Vite build configuration
```

---

## Development

### Requirements

- Node.js
- npm
- Git

### Install Dependencies

```bash
npm install
```

### Run Locally

```bash
npm run dev
```

### Production Build

```bash
npm run build
```

### Preview the Production Build

```bash
npm run preview
```

---

## Validation

Useful checks:

```bash
npm run lint
npm run typecheck
npm run build
```

Check repository consistency:

```bash
git status
git diff --check
```

---

## Android Development

For Android work:

```bash
npm run build
npx cap sync android
```

Then open the Android project in Android Studio or build it using Gradle.

Native Android changes should be tested on a real device, especially when they affect:

- Authentication callbacks
- Session restoration
- Background audio
- Automatic next-episode playback
- App Links
- Browser-to-app redirects

---

## Deployment

The production frontend is deployed automatically through Cloudflare Pages.

Every push to the `main` branch triggers:

```text
GitHub
   |
   v
Cloudflare Pages Build
   |
   v
Production Deployment
   |
   v
https://v.renbrant.com
```

The build process also generates:

```text
/version.json
```

Use this endpoint to confirm exactly which commit is running in production.

---

## Data Migration

Voxyl 3.0 includes tools for migrating legacy Base44 data.

### D1 Import

```text
scripts/import-base44-csv-to-d1.mjs
```

### R2 Media Migration

```text
scripts/migrate-base44-files-to-r2.mjs
```

### Legacy Export Function

```text
base44/functions/exportBase44Data/entry.ts
```

These tools were created to support the transition from Base44 to Cloudflare infrastructure.

---

## Documentation

- [Changelog](CHANGELOG.md)
- [Architecture](ARCHITECTURE.md)
- [Contributing Guide](CONTRIBUTING.md)
- [Documentation Index](docs/README.md)
- [Android OAuth Setup](docs/android-auth-setup.md)
- [Android Manual Auth Callback Test](docs/android-auth-manual-test.md)
- [iOS Native Setup](docs/ios-setup.md)
- [Cloudflare and Clerk Migration Plan](docs/cloudflare-clerk-migration-plan.md)

---

## Contributing

Contributions should follow the project workflow and Conventional Commits standard.

Example:

```text
feat(player): add playback speed control
fix(auth): restore Clerk token during startup
docs(readme): update Voxyl 3.0 documentation
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete guide.

---

## Support and Bug Reporting

This repository is the official support hub for Voxyl.

To report a bug or suggest an improvement:

**[Open a GitHub Issue](https://github.com/Renbrant/Voxyl-APP/issues)**

When reporting a problem, include:

- Steps to reproduce
- Expected behavior
- Actual behavior
- Browser or device
- Screenshots or logs
- Production version from `/version.json`

---

## Privacy and Safety

Voxyl is built with privacy and user control in mind.

- **Data Minimization:** Only the data required for account and application functionality is collected.
- **Account Control:** Users can manage or delete their account through Profile Settings.
- **Server-Side Authorization:** Protected operations are validated by the backend.
- **Secure Authentication:** Authentication is handled through Clerk.
- **Public Data Minimization:** Public endpoints expose only the fields needed for the public experience.

Privacy information is available inside the application at:

**[Voxyl Privacy Policy](https://v.renbrant.com/privacy)**

---

## Technology Providers

Voxyl uses the following services:

- **Cloudflare Pages** for frontend hosting
- **Cloudflare Workers** for backend API execution
- **Cloudflare D1** for relational data
- **Cloudflare R2** for media storage
- **Cloudflare KV** for caching and supporting data
- **Clerk** for authentication
- **Podcast Index** for podcast discovery data
- **Capacitor** for native mobile integration

Base44 is no longer used as the production application platform. Some legacy migration files remain temporarily in the repository to support data validation and historical migration workflows.

---

## About the Developer

Voxyl is developed by **Renato Brant**, a Brazilian Mechatronic Engineer based in Colorado.

Renato is passionate about technology, automation, media, and building practical digital products. He also hosts the **[Brant Channel](https://www.youtube.com/@Brant_Channel)** on YouTube.

Voxyl combines a background in technology with a desire to create a more organized, flexible, and social way to discover and consume long-form audio content.

---

## Current Version

**Voxyl 3.0.0 — Beta**

Voxyl 3.0 introduced the new Cloudflare and Clerk architecture, improved Android authentication, automated deployments, and complete production version traceability.

Thank you for helping shape the future of social podcasting.
