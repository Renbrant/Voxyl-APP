# Changelog - Voxyl

## v3.0 - July 2026

### 🚀 Major Platform Migration

Voxyl 3.0 represents the largest architectural update since the project began.

This release removes the dependency on the Base44 platform and migrates the application to a fully independent Cloudflare-based infrastructure powered by Clerk authentication, providing better reliability, scalability, security, and long-term maintainability.

---

## 🌐 Cloudflare Infrastructure

### Cloudflare Workers API

- Replaced the Base44 backend with a custom Cloudflare Workers API.
- Added new REST endpoints for authentication, user profiles, playlists, and public resources.
- Improved request performance through Cloudflare's global edge network.
- Established a scalable backend foundation for future development.

### Cloudflare D1 Database

- Migrated the application database to Cloudflare D1.
- Added a Base44 compatibility schema.
- Created automated migration tools for importing existing production data.
- Added safe local and remote SQL migration utilities.

### Cloudflare R2 Storage

- Migrated playlist artwork and media assets from Base44 Storage to Cloudflare R2.
- Added automated media upload scripts.
- Updated all media references to use the new infrastructure.

### Cloudflare Pages

- Production website now runs on Cloudflare Pages.
- Automatic deployments directly from the GitHub `main` branch.
- Automatic deployment version tracking.

---

## 🔐 Authentication

### Clerk Authentication

- Replaced Base44 authentication with Clerk.
- Native Android authentication fully supported.
- Secure JWT validation on the backend.
- Improved session persistence across application restarts.

### Authentication Improvements

- Added a new `/api/me` endpoint backed by Clerk.
- Automatic token hydration during application startup.
- Authentication bridge for seamless migration.
- Improved login restoration after returning from the background.
- More reliable OAuth callback handling.

### Guest Experience

- Public content remains accessible without authentication.
- Authentication required only for protected actions.
- Cleaner login flow and improved redirect behavior.

---

## 📱 Android Improvements

### Native Authentication

- Improved App Links support.
- More reliable OAuth callback handling.
- Better browser-to-app authentication flow.
- Reduced login failures caused by interrupted authentication.

### Session Persistence

- Improved token persistence.
- Better recovery when Android destroys the WebView.
- Significantly reduced unexpected logouts.

---

## 🎧 Audio Player

### Native Playback

- Preserved native background playback.
- Preserved automatic episode progression.
- Improved player state synchronization after authentication changes.

---

## 📦 Data Migration Tools

### Base44 Export

- Added temporary Base44 export functions.
- Added CSV export utilities.
- Added D1 import generators.
- Added remote-safe SQL migration scripts.

### Media Migration

- Added automated R2 upload scripts.
- Automated Base44 media URL replacement.
- Windows-compatible migration utilities.
- Improved migration reliability.

---

## 🧪 Diagnostics

### Authentication Diagnostics

- Added dedicated Clerk diagnostics page.
- Added authentication test endpoints.
- Added end-to-end authentication validation.
- Added playlist endpoint validation.
- Added user profile endpoint validation.

### Deployment Metadata

Every production deployment now automatically generates version metadata.

The application now exposes:

- Application version
- Git commit
- Full commit SHA
- Branch
- Build timestamp

through:

`/version.json`

Example:

```json
{
  "app": "voxyl",
  "version": "3.0.0",
  "git_commit": "baaad333",
  "git_commit_full": "baaad33332c4ed88905757a225e5918bbdf67ce7",
  "branch": "main",
  "built_at": "2026-07-10T13:19:24.469Z"
}
```

---

## 🏗 Project Organization

### Repository Improvements

- Reorganized project documentation.
- Created a dedicated `docs/` directory.
- Added migration documentation.
- Improved repository structure.
- Updated project README.

---

## ⚡ Build & Deployment

### Build Pipeline

- Automatic deployment metadata generation.
- Continuous deployment from GitHub to Cloudflare Pages.
- Improved production build process.
- Cleaner build configuration.

---

## 🔄 Breaking Changes

- Removed Base44 SDK dependency.
- Removed Base44 authentication.
- Removed Base44 backend API.
- Removed Base44 storage dependency.
- Replaced the Base44 API client with the new Voxyl API client.
- Migrated the backend to Cloudflare Workers.
- Migrated authentication to Clerk.

---

## ✨ Additional Improvements

- Improved project structure and maintainability.
- Improved deployment reliability.
- Better authentication performance.
- Better Android session handling.
- Simplified future backend development.
- Complete removal of the Base44 platform dependency.

---

## Previous Versions

### v2.5 - June 2026

#### Responsive Desktop & Tablet Interface

- Added a dedicated desktop and tablet layout.
- Bottom navigation automatically switches to a fixed sidebar on screens wider than 768px.
- Improved content layout with adaptive multi-column grids.
- Larger featured content on large screens.
- Floating mini-player on desktop.
- Mobile experience remains unchanged.

---

### v2.4.1 - June 2026

#### Podcast Metadata Fix

- Fixed an issue where newly discovered podcasts displayed incorrect title, author, and artwork.
- Root cause was a cache-key collision caused by truncated Base64 URLs.
- Feed cache now uses a unique djb2 hash combined with the URL length.

---

### v2.4.0 - June 2026

#### Android Session Persistence

- Fixed a critical issue where users were logged out after returning to the app.
- Added Capacitor `appStateChange` listener to restore sessions.
- Restored `localStorage` automatically from Capacitor Preferences.
- Tokens are now explicitly rehydrated into the authentication SDK.

#### Native OAuth Callback

- Stabilized Google authentication using native Android App Links.
- Authentication callback processing now occurs before the React application is initialized.

---

### v0.2 - April 2026

#### Guest Mode

- Public browsing without authentication.
- Protected actions automatically redirect to login.
- Guest-friendly playlist and profile pages.
- Login shortcut added to the navigation bar.

#### Android Compatibility

- Fixed Google OAuth 403 errors inside Android WebViews.
- Authentication now opens in the system browser.
- Centralized authentication redirect helper.

#### Technical Improvements

- Refactored authentication hooks.
- Removed duplicate SDK imports.
- Improved loading state handling.

---

### v0.1 - April 2026

#### Initial Release

- Podcast feed and discovery.
- Playlist creation and sharing.
- Persistent audio player.
- Episode progress synchronization.
- Social features.
- User profiles.
- RSS feed aggregation.
- Search.
- Offline support.
- PWA support.
- Dark and light themes.
