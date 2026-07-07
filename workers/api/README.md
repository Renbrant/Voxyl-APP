# Voxyl Cloudflare Worker API

This is the future Cloudflare Worker API shell for Voxyl. It is intended to replace the current Base44 functions over the course of the migration.

For now, it only exposes health checks:

- `GET /health`
- `GET /api/health`

Base44 must not be removed yet.
