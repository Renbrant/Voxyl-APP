# Contributing to Voxyl

Thank you for contributing to Voxyl.

This document defines the development workflow, branch naming, commit conventions, testing expectations, and release process used by the project.

---

## Development Workflow

The `main` branch represents the production-ready version of Voxyl.

Whenever practical, new work should be developed in a dedicated branch and merged into `main` only after validation.

Typical workflow:

```text
main
  ├── feature/new-feature
  ├── fix/android-login
  ├── refactor/auth-context
  ├── docs/changelog
  └── infra/cloudflare
```

Recommended steps:

1. Update the local `main` branch.
2. Create a dedicated branch.
3. Make focused changes.
4. Run the appropriate validation commands.
5. Commit using the Conventional Commits format.
6. Push the branch.
7. Merge into `main` after testing.
8. Verify the production deployment.

---

## Branch Naming

Use lowercase names with hyphens.

### Features

```text
feature/<description>
```

Examples:

```text
feature/playback-speed
feature/share-playlists
feature/offline-downloads
```

### Bug Fixes

```text
fix/<description>
```

Examples:

```text
fix/android-auth
fix/player-autoplay
fix/rss-cache
```

### Refactoring

```text
refactor/<description>
```

Examples:

```text
refactor/auth-context
refactor/player-cache
refactor/api-client
```

### Documentation

```text
docs/<description>
```

Examples:

```text
docs/changelog
docs/architecture
docs/deployment-guide
```

### Infrastructure

```text
infra/<description>
```

Examples:

```text
infra/cloudflare
infra/r2-storage
infra/d1-migrations
```

### Build and CI

```text
build/<description>
ci/<description>
```

Examples:

```text
build/android-capacitor
ci/cloudflare-pages
```

---

## Commit Convention

Voxyl follows the Conventional Commits format:

```text
<type>(<scope>): <summary>
```

Examples:

```text
feat(auth): add Clerk authentication
fix(android): restore session after app restart
docs(changelog): document Voxyl 3.0 release
build(cloudflare): automate deployment metadata
infra(d1): add compatibility schema
refactor(api): remove Base44 client
perf(feed): optimize RSS cache
test(auth): validate Clerk authentication
```

---

## Commit Types

| Type | Purpose |
|---|---|
| `feat` | New functionality |
| `fix` | Bug fix |
| `docs` | Documentation-only change |
| `refactor` | Internal code restructuring without behavior changes |
| `perf` | Performance improvement |
| `build` | Build system or packaging change |
| `infra` | Infrastructure or hosting change |
| `test` | Tests and test infrastructure |
| `style` | Visual, formatting, or UI-only changes |
| `deps` | Dependency updates |
| `ci` | Continuous integration and deployment automation |
| `chore` | Maintenance not covered by another type |

---

## Common Scopes

Recommended scopes include:

```text
api
auth
android
player
feed
playlist
profile
cache
rss
ui
cloudflare
workers
d1
r2
pages
docs
deps
```

Choose the smallest scope that accurately describes the change.

---

## Commit Rules

### Keep commits focused

Good:

```text
feat(player): add playback speed control
```

Avoid:

```text
misc updates
```

### Use imperative mood

Good:

```text
add
remove
fix
improve
update
refactor
```

Avoid:

```text
added
fixed
changing
```

### Keep the summary concise

The first line should normally remain under 72 characters.

Use a commit body when additional context is needed.

Example:

```text
fix(auth): restore Clerk token during startup

Hydrate the Clerk session before importing the main application so
protected API requests do not run without an authorization token.
```

---

## Pull Requests

A Pull Request should explain:

- The problem or goal
- The implemented solution
- Important architectural decisions
- Testing performed
- Screenshots for UI changes
- Migration steps, when applicable
- Breaking changes, when applicable
- Known limitations or follow-up work

Do not merge a Pull Request while required validation is failing.

---

## Local Validation

Install dependencies:

```powershell
npm install
```

Run a production build:

```powershell
npm run build
```

Run linting when the affected code is covered by the current lint configuration:

```powershell
npm run lint
```

Run type checking when applicable:

```powershell
npm run typecheck
```

Check the repository state:

```powershell
git status
git diff --check
```

For Android changes, also synchronize Capacitor:

```powershell
npx cap sync android
```

When native behavior changes, build and test the Android application on a real device.

---

## Production Deployment

Cloudflare Pages automatically deploys changes pushed to the `main` branch.

The production application is available at:

```text
https://v.renbrant.com
```

Every production build generates:

```text
/version.json
```

The endpoint reports:

- Application version
- Short Git commit
- Full Git commit
- Deployment branch
- Build timestamp

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

Verify production after deployment:

```powershell
curl.exe -s https://v.renbrant.com/version.json
```

The reported commit must match the intended commit from `main`.

---

## Versioning

Voxyl follows Semantic Versioning:

```text
MAJOR.MINOR.PATCH
```

Examples:

```text
3.0.0
3.1.0
3.1.1
```

### MAJOR

Use for incompatible or major architectural changes.

Examples:

- Authentication platform migration
- Database migration
- Backend architecture replacement
- Breaking API changes

### MINOR

Use for backward-compatible features.

Examples:

- New player functionality
- New playlist options
- New discovery capabilities

### PATCH

Use for backward-compatible fixes.

Examples:

- Android session fixes
- UI corrections
- Cache fixes
- Deployment corrections

---

## Database Changes

Cloudflare D1 schema changes must be added as numbered migration files.

Use the next sequential migration number:

```text
workers/api/migrations/0003_description.sql
workers/api/migrations/0004_description.sql
```

Database migrations should:

- Be deterministic
- Avoid destructive operations unless explicitly required
- Preserve existing production data
- Include rollback considerations in the Pull Request
- Be tested locally before remote execution

Never modify an already-applied production migration to change its historical meaning. Add a new migration instead.

---

## Environment Variables and Secrets

Public frontend variables may use the `VITE_` prefix.

Never commit:

- Clerk secret keys
- API tokens
- Private keys
- Database credentials
- Cloudflare API tokens
- Production secrets

Before committing environment files, inspect the staged content:

```powershell
git diff --cached -- .env.production
git diff --cached -- .env.production.example
```

Secrets must be configured through the appropriate Cloudflare or local environment configuration.

---

## Generated and Local Files

Do not commit generated or machine-specific content unless the project explicitly requires it.

Examples that normally remain untracked:

```text
dist/
node_modules/
.wrangler/
migration-output/
```

Do not use `git add .` without reviewing `git status` first.

Prefer adding specific files:

```powershell
git add package.json scripts/generate-version.mjs
```

---

## Documentation

Update documentation when a change affects:

- Application behavior
- Authentication
- Deployment
- Infrastructure
- API endpoints
- Database schema
- Android setup
- Environment variables
- Migration procedures

Significant releases must be documented in `CHANGELOG.md`.

---

## Project Principles

Voxyl prioritizes:

- Reliability over shortcuts
- Maintainability over cleverness
- Clear architecture over hidden coupling
- Mobile performance
- Secure authentication
- Controlled production migrations
- Independence from proprietary application platforms
- Observable and reproducible deployments

Every contribution should move the project toward these goals.
