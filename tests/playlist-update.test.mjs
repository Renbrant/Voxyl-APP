import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { afterEach, describe, it, mock } from 'node:test';
import worker from '../workers/api/src/index.ts';

const issuer = 'https://clerk.voxyl.test';
const baseEnv = {
  CLERK_AUTHORIZED_PARTIES: 'https://v.renbrant.com,http://localhost:5173',
  CLERK_ISSUER: issuer,
  CLERK_SECRET_KEY: 'sk_test_unused',
  CLERK_JWT_KEY: 'invalid-test-key-to-force-pinned-jwks-fallback',
};

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createJwt({ sub = 'clerk-owner', email = 'owner@example.com', name = 'Owner User' } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `kid-${crypto.randomUUID()}`;
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuer,
    sub,
    sid: 'session-1',
    email,
    name,
    azp: 'https://v.renbrant.com',
    iat: now - 10,
    nbf: now - 10,
    exp: now + 3600,
  };
  const signedData = `${base64urlJson(header)}.${base64urlJson(claims)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signedData), privateKey).toString('base64url');
  const jwk = publicKey.export({ format: 'jwk' });

  return {
    token: `${signedData}.${signature}`,
    jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' },
  };
}

function installJwksMock(jwk) {
  mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(String(url), `${issuer}/.well-known/jwks.json`);
    return Response.json({ keys: [jwk] });
  });
}

function request(path, { payload = {}, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;

  return new Request(`https://api.voxyl.test${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload),
  });
}

async function body(response) {
  return response.json();
}

function user(overrides = {}) {
  return {
    id: overrides.id || 'owner-user',
    clerk_user_id: overrides.clerk_user_id || 'clerk-owner',
    legacy_base44_user_id: overrides.legacy_base44_user_id ?? null,
    email: overrides.email || 'owner@example.com',
    name: overrides.name || 'Owner User',
    username: overrides.username || 'owner',
    role: 'user',
    profile_picture: null,
    profile_hidden: 0,
    imported_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
  };
}

function playlist(overrides = {}) {
  return {
    id: overrides.id || 'playlist-1',
    legacy_base44_playlist_id: null,
    creator_id: overrides.creator_id || 'owner-user',
    creator_clerk_user_id: overrides.creator_clerk_user_id || 'clerk-owner',
    creator_legacy_base44_user_id: overrides.creator_legacy_base44_user_id ?? null,
    title: overrides.title || 'Original',
    description: overrides.description ?? 'Before',
    cover_image: overrides.cover_image ?? null,
    visibility: overrides.visibility || 'public',
    rss_feeds: overrides.rss_feeds ?? JSON.stringify([{ url: 'https://old.example.com/feed.xml', title: 'Old' }]),
    max_duration: overrides.max_duration ?? 30,
    time_filter_hours: overrides.time_filter_hours ?? 24,
    episodes_sort_order: overrides.episodes_sort_order || 'newest_first',
    likes_count: 0,
    plays_count: 0,
    creator_username: 'owner',
    creator_picture: null,
    creator_hidden: 0,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
  };
}

function createPlaylistUpdateDb({ users = [user()], playlists = [playlist()], failUpdates = false } = {}) {
  const state = {
    users: users.map((row) => ({ ...row })),
    playlists: playlists.map((row) => ({ ...row })),
    calls: [],
  };

  return {
    state,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              state.calls.push({ kind: 'first', sql, params });

              if (/FROM users\s+WHERE clerk_user_id = \?/s.test(sql)) {
                return state.users.find((row) => row.clerk_user_id === params[0]) || null;
              }

              if (/FROM playlists\s+WHERE id = \?/s.test(sql)) {
                return state.playlists.find((row) => row.id === params[0]) || null;
              }

              return null;
            },
            async all() {
              state.calls.push({ kind: 'all', sql, params });

              if (/FROM users\s+WHERE lower\(TRIM\(email\)\)/s.test(sql)) {
                const email = String(params[0]).trim().toLowerCase();
                return { results: state.users.filter((row) => row.email?.trim().toLowerCase() === email) };
              }

              return { results: [] };
            },
            async run() {
              state.calls.push({ kind: 'run', sql, params });

              if (/UPDATE users/s.test(sql)) {
                return { meta: { changes: 1 } };
              }

              if (/UPDATE playlists/s.test(sql)) {
                if (failUpdates) {
                  throw new Error('database unavailable');
                }

                const playlistId = params.at(-3);
                const ownerId = params.at(-2);
                const ownerClerkId = params.at(-1);
                const row = state.playlists.find((item) => item.id === playlistId);

                if (!row || (row.creator_id !== ownerId && row.creator_clerk_user_id !== ownerClerkId)) {
                  return { meta: { changes: 0 } };
                }

                const setClause = sql.match(/SET\s+([\s\S]+?)\s+WHERE id = \?/)[1];
                const columns = setClause
                  .split(',')
                  .map((part) => part.trim())
                  .filter((part) => !part.startsWith('updated_at'))
                  .map((part) => part.split('=')[0].trim());

                columns.forEach((column, index) => {
                  row[column] = params[index];
                });
                row.updated_at = '2026-07-20T12:00:00.000Z';

                return { meta: { changes: 1 } };
              }

              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
}

afterEach(() => {
  mock.restoreAll();
});

describe('playlist update Worker route', () => {
  it('saves playlist edits and returns the updated playlist', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createPlaylistUpdateDb();
    const response = await worker.fetch(request('/api/entities/playlist/playlist-1', {
      token,
      payload: {
        name: 'Updated',
        description: 'After',
        max_duration: 45,
        time_filter_hours: 168,
        episodes_sort_order: 'oldest_first',
        visibility: 'private',
        cover_image: 'https://cdn.example.com/cover.jpg',
        rss_feeds: [{ url: 'https://new.example.com/feed.xml', title: 'New', skip_start_seconds: 12, skip_end_seconds: 3 }],
      },
    }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.playlist.name, 'Updated');
    assert.equal(data.playlist.description, 'After');
    assert.equal(data.playlist.max_duration, 45);
    assert.equal(data.playlist.time_filter_hours, 168);
    assert.equal(data.playlist.episodes_sort_order, 'oldest_first');
    assert.equal(data.playlist.visibility, 'private');
    assert.deepEqual(data.playlist.rss_feeds.map((feed) => feed.url), ['https://new.example.com/feed.xml']);
  });

  it('requires authentication before saving a playlist', async () => {
    const db = createPlaylistUpdateDb();
    const response = await worker.fetch(request('/api/playlists/playlist-1', {
      payload: { name: 'Nope' },
    }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 401);
    assert.equal(data.ok, false);
    assert.equal(db.state.playlists[0].title, 'Original');
  });

  it('rejects edits from a non-owner', async () => {
    const { token, jwk } = createJwt({ sub: 'clerk-other', email: 'other@example.com', name: 'Other User' });
    installJwksMock(jwk);
    const db = createPlaylistUpdateDb({
      users: [user({ id: 'other-user', clerk_user_id: 'clerk-other', email: 'other@example.com', name: 'Other User' })],
    });
    const response = await worker.fetch(request('/api/playlists/playlist-1', {
      token,
      payload: { name: 'Stolen' },
    }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 403);
    assert.equal(data.ok, false);
    assert.equal(db.state.playlists[0].title, 'Original');
  });

  it('rejects invalid playlist input', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createPlaylistUpdateDb();
    const response = await worker.fetch(request('/api/playlists/playlist-1', {
      token,
      payload: { max_duration: -1 },
    }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 400);
    assert.equal(data.code, 'invalid-request');
    assert.equal(db.state.playlists[0].max_duration, 30);
  });

  it('persists zero-valued numeric filters', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createPlaylistUpdateDb();
    const response = await worker.fetch(request('/api/playlists/playlist-1', {
      token,
      payload: { max_duration: 0, time_filter_hours: 0 },
    }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.playlist.max_duration, 0);
    assert.equal(data.playlist.time_filter_hours, 0);
    assert.equal(db.state.playlists[0].max_duration, 0);
    assert.equal(db.state.playlists[0].time_filter_hours, 0);
  });

  it('preserves RSS feeds when rss_feeds is omitted', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createPlaylistUpdateDb();
    const response = await worker.fetch(request('/api/playlists/playlist-1', {
      token,
      payload: { name: 'Name Only' },
    }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.deepEqual(data.playlist.rss_feeds.map((feed) => feed.url), ['https://old.example.com/feed.xml']);
  });

  it('returns a 500 response when the playlist update fails unexpectedly', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createPlaylistUpdateDb({ failUpdates: true });
    const response = await worker.fetch(request('/api/playlists/playlist-1', {
      token,
      payload: { name: 'Updated' },
    }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 500);
    assert.equal(data.ok, false);
    assert.equal(db.state.playlists[0].title, 'Original');
  });
});

describe('playlist edit modal save failure handling', () => {
  it('keeps save failures retryable and always clears the saving state', () => {
    const source = fs.readFileSync(new URL('../src/components/playlist/EditPlaylistModal.jsx', import.meta.url), 'utf8');
    const handleSaveBlock = source.slice(source.indexOf('const handleSave = async () => {'), source.indexOf('return ('));

    assert.match(handleSaveBlock, /try\s*\{/);
    assert.match(handleSaveBlock, /catch \(error\)\s*\{/);
    assert.match(handleSaveBlock, /finally\s*\{/);
    assert.match(handleSaveBlock, /setSaveError\(''\)/);
    assert.match(handleSaveBlock, /setSaveError\(error\?\.message \|\| 'Não foi possível salvar a playlist\. Tente novamente\.'\)/);
    assert.match(handleSaveBlock, /setSaving\(false\)/);
    assert.equal(/catch \(error\)[\s\S]*onClose\(\)/.test(handleSaveBlock), false);
    assert.match(source, /role="alert"/);
  });
});
