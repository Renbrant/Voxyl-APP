// TEMPORARY MIGRATION FUNCTION: admin-only Base44 export for phase 1 D1 migration.
// Remove this function immediately after the migration export/import is complete.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 1000;
const ORDER = '-created_date';
const AVAILABLE_ENTITIES = ['User', 'Playlist'];

function json(body, status = 200) {
  return Response.json(body, { status });
}

function exportedAt() {
  return new Date().toISOString();
}

function normalizeLimit(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.floor(value), MAX_LIMIT);
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed' }, 405);
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }

    let body = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if (body.mode === 'manifest') {
      return json({
        ok: true,
        temporary: true,
        sensitive: true,
        phase: 1,
        available_entities: AVAILABLE_ENTITIES,
        defaults: {
          limit: DEFAULT_LIMIT,
          max_limit: MAX_LIMIT,
        },
        exported_at: exportedAt(),
      });
    }

    if (body.mode !== 'entity') {
      return json({ ok: false, error: 'Invalid mode' }, 400);
    }

    if (!AVAILABLE_ENTITIES.includes(body.entity)) {
      return json({ ok: false, error: 'Unsupported entity' }, 400);
    }

    const limit = normalizeLimit(body.limit);
    const entityApi = body.entity === 'User'
      ? base44.asServiceRole.entities.User
      : base44.asServiceRole.entities.Playlist;
    const data = await entityApi.list(ORDER, limit);

    return json({
      ok: true,
      temporary: true,
      sensitive: true,
      phase: 1,
      entity: body.entity,
      order: ORDER,
      limit,
      count: data.length,
      truncated: data.length >= limit,
      exported_at: exportedAt(),
      data,
    });
  } catch {
    return json({ ok: false, error: 'Export failed' }, 500);
  }
});
