import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { afterEach, describe, it, mock } from 'node:test';
import worker from '../workers/api/src/index.ts';
import { getRecentlyPlayedPlaylists } from '../src/lib/personalFeedMatching.js';

const issuer = 'https://clerk.voxyl.test';
const baseEnv = {
  CLERK_AUTHORIZED_PARTIES: 'https://v.renbrant.com,http://localhost:5173',
  CLERK_ISSUER: issuer,
  CLERK_SECRET_KEY: 'sk_test_unused',
  CLERK_JWT_KEY: 'invalid-test-key-to-force-pinned-jwks-fallback',
};

const validPayload = {
  event_id: '11111111-1111-4111-8111-111111111111',
  playlist_id: 'public-playlist',
  feed_url: 'https://feeds.example.com/show.xml',
  podcast_title: 'Example Show',
  podcast_image: 'https://img.example.com/show.jpg',
  audio_url: 'https://audio.example.com/episode.mp3',
  episode_title: 'Episode 1',
};

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createJwt({ sub = 'clerk-user-1', email = 'real@example.com', name = 'Real User' } = {}) {
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

function request(path, { method = 'POST', payload = validPayload, token, authHeader, rawBody } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (authHeader !== undefined) headers.authorization = authHeader;
  const init = {
    method,
    headers,
  };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = rawBody ?? JSON.stringify(payload);
  }
  return new Request(`https://api.voxyl.test${path}`, init);
}

async function body(response) {
  return response.json();
}

function playlist(overrides) {
  return {
    id: overrides.id,
    creator_id: overrides.creator_id || 'owner-user',
    creator_clerk_user_id: overrides.creator_clerk_user_id || null,
    visibility: overrides.visibility || 'public',
    rss_feeds: overrides.rss_feeds ?? JSON.stringify([{ url: 'https://feeds.example.com/show.xml' }]),
    plays_count: overrides.plays_count ?? 0,
  };
}

function createPlaybackDb() {
  const state = {
    users: [
      {
        id: 'd1-real-user',
        clerk_user_id: 'clerk-user-1',
        legacy_base44_user_id: null,
        email: 'real@example.com',
        name: 'Real User',
        username: 'real',
        role: 'user',
        profile_picture: null,
        profile_hidden: 0,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
      },
    ],
    playlists: [
      playlist({ id: 'public-playlist', visibility: 'public', plays_count: 4 }),
      playlist({ id: 'private-playlist', visibility: 'private', creator_id: 'd1-real-user', creator_clerk_user_id: 'clerk-user-1' }),
      playlist({ id: 'private-other', visibility: 'private', creator_id: 'other-user', creator_clerk_user_id: 'clerk-other' }),
    ],
    plays: [],
    calls: [],
  };

  const orderPlaysNewestFirst = (plays) => [...plays].sort((left, right) => {
    const leftDate = new Date(left.played_at || left.created_at || 0);
    const rightDate = new Date(right.played_at || right.created_at || 0);
    return rightDate - leftDate || String(right.id).localeCompare(String(left.id));
  });

  return {
    state,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              state.calls.push({ kind: 'first', sql, params });
              if (/FROM users\s+WHERE clerk_user_id = \?/s.test(sql)) {
                return state.users.find((user) => user.clerk_user_id === params[0]) || null;
              }
              if (/FROM users\s+WHERE lower\(email\)/s.test(sql)) {
                return state.users.find((user) => user.email?.toLowerCase() === String(params[0]).toLowerCase()) || null;
              }
              if (/FROM playlists\s+WHERE id = \?/s.test(sql)) {
                return state.playlists.find((row) => row.id === params[0]) || null;
              }
              throw new Error(`Unhandled first SQL: ${sql}`);
            },
            async all() {
              state.calls.push({ kind: 'all', sql, params });
              if (/FROM users\s+WHERE lower\(email\)/s.test(sql)) {
                return { results: state.users.filter((user) => user.email?.toLowerCase() === String(params[0]).toLowerCase()) };
              }
              if (/FROM podcast_plays/s.test(sql)) {
                const hasLegacyPredicate = /legacy_base44_user_id = \?/s.test(sql);
                const [user_id, clerk_user_id] = params;
                const legacy_base44_user_id = hasLegacyPredicate ? params[2] : undefined;
                const limit = params[hasLegacyPredicate ? 3 : 2];
                const results = orderPlaysNewestFirst(state.plays.filter((row) =>
                  row.user_id === user_id ||
                  row.clerk_user_id === clerk_user_id ||
                  (hasLegacyPredicate && row.legacy_base44_user_id === legacy_base44_user_id)
                ))
                  .slice(0, limit)
                  .map(({
                    id,
                    playlist_id,
                    feed_url,
                    podcast_title,
                    podcast_image,
                    audio_url,
                    episode_title,
                    played_at,
                    created_at,
                  }) => ({
                    id,
                    playlist_id,
                    feed_url,
                    podcast_title,
                    podcast_image,
                    audio_url,
                    episode_title,
                    played_at,
                    created_at,
                  }));

                return { results };
              }
              throw new Error(`Unhandled all SQL: ${sql}`);
            },
            async run() {
              state.calls.push({ kind: 'run', sql, params });
              if (/INSERT INTO users/s.test(sql)) {
                if (!state.users.some((user) => user.clerk_user_id === params[1])) {
                  state.users.push({
                    id: params[0],
                    clerk_user_id: params[1],
                    legacy_base44_user_id: null,
                    email: params[2],
                    name: params[3],
                    username: null,
                    role: 'user',
                    profile_picture: null,
                    profile_hidden: 0,
                    created_at: 'now',
                    updated_at: 'now',
                  });
                }
                return { meta: { changes: 1 } };
              }
              if (/UPDATE users\s+SET clerk_user_id/s.test(sql)) {
                return { meta: { changes: 1 } };
              }
              if (/UPDATE users|UPDATE playlists|UPDATE playlist_likes|UPDATE podcast_likes|UPDATE episode_progress|UPDATE follows|UPDATE blocks|UPDATE reports|UPDATE referrals/s.test(sql)) {
                return { meta: { changes: 0 } };
              }
              if (/UPDATE podcast_plays\s+SET clerk_user_id/s.test(sql)) {
                return { meta: { changes: 0 } };
              }
              if (/INSERT OR IGNORE INTO podcast_plays/s.test(sql)) {
                const [
                  id,
                  client_event_id,
                  user_id,
                  clerk_user_id,
                  playlist_id,
                  feed_url,
                  podcast_title,
                  podcast_image,
                  audio_url,
                  episode_title,
                ] = params;
                if (state.plays.some((row) => row.client_event_id === client_event_id)) {
                  return { meta: { changes: 0 } };
                }
                state.plays.push({
                  id,
                  client_event_id,
                  user_id,
                  clerk_user_id,
                  playlist_id,
                  feed_url,
                  podcast_title,
                  podcast_image,
                  audio_url,
                  episode_title,
                  played_at: '2026-07-01T00:00:00.000Z',
                  created_at: '2026-07-01T00:00:00.000Z',
                });
                if (playlist_id) {
                  const matchedPlaylist = state.playlists.find((row) => row.id === playlist_id);
                  if (matchedPlaylist) matchedPlaylist.plays_count += 1;
                }
                return { meta: { changes: 1 } };
              }
              throw new Error(`Unhandled run SQL: ${sql}`);
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

describe('podcast playback recording Worker route', () => {
  it('supports every canonical and compatibility route alias', async () => {
    for (const path of ['/api/plays', '/plays', '/api/functions/recordPodcastPlay', '/functions/recordPodcastPlay']) {
      const db = createPlaybackDb();
      const response = await worker.fetch(request(path), { ...baseEnv, DB: db });
      const data = await body(response);

      assert.equal(response.status, 200, path);
      assert.equal(data.ok, true);
      assert.equal(data.recorded, true);
      assert.equal(data.duplicate, false);
      assert.equal(db.state.plays.length, 1);
    }
  });

  it('keeps unsupported methods on playback aliases as 404s', async () => {
    const db = createPlaybackDb();
    const response = await worker.fetch(request('/api/plays', { method: 'PATCH' }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 404);
    assert.equal(data.ok, false);
    assert.equal(db.state.plays.length, 0);
  });

  it('returns only the authenticated user playback history from GET /api/plays', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createPlaybackDb();
    db.state.plays.push(
      {
        id: 'own-newer',
        user_id: 'd1-real-user',
        clerk_user_id: 'clerk-user-1',
        legacy_base44_user_id: null,
        playlist_id: 'public-playlist',
        feed_url: 'https://feeds.example.com/show.xml',
        podcast_title: 'Example Show',
        podcast_image: 'https://img.example.com/show.jpg',
        audio_url: 'https://audio.example.com/newer.mp3',
        episode_title: 'Newer',
        played_at: '2026-07-12T10:00:00.000Z',
        created_at: '2026-07-12T09:59:00.000Z',
      },
      {
        id: 'other-user',
        user_id: 'other-user',
        clerk_user_id: 'clerk-other',
        legacy_base44_user_id: null,
        playlist_id: 'public-playlist',
        feed_url: 'https://feeds.example.com/other.xml',
        podcast_title: 'Other Show',
        podcast_image: null,
        audio_url: 'https://audio.example.com/other.mp3',
        episode_title: 'Other',
        played_at: '2026-07-13T10:00:00.000Z',
        created_at: '2026-07-13T09:59:00.000Z',
      },
    );

    const response = await worker.fetch(request('/api/plays', { method: 'GET', token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.deepEqual(data.items.map((row) => row.id), ['own-newer']);
    assert.deepEqual(data.data, data.items);
    assert.equal('user_id' in data.items[0], false);
    assert.equal('clerk_user_id' in data.items[0], false);
  });

  it('supports compatibility GET /api/entities/podcast-play', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createPlaybackDb();
    db.state.plays.push({
      id: 'entity-route-play',
      user_id: 'd1-real-user',
      clerk_user_id: 'clerk-user-1',
      legacy_base44_user_id: null,
      playlist_id: 'public-playlist',
      feed_url: 'https://feeds.example.com/show.xml',
      podcast_title: 'Example Show',
      podcast_image: null,
      audio_url: 'https://audio.example.com/entity.mp3',
      episode_title: 'Entity',
      played_at: '2026-07-12T10:00:00.000Z',
      created_at: '2026-07-12T09:59:00.000Z',
    });

    const response = await worker.fetch(request('/api/entities/podcast-play?user_id=other-user', { method: 'GET', token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.deepEqual(data.items.map((row) => row.id), ['entity-route-play']);
  });

  it('returns 401 for missing authentication on playback history', async () => {
    const db = createPlaybackDb();
    const response = await worker.fetch(request('/api/plays', { method: 'GET' }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 401);
    assert.equal(data.ok, false);
    assert.equal(data.authenticated, false);
  });

  it('returns 401 for an invalid playback history bearer token', async () => {
    const db = createPlaybackDb();
    const response = await worker.fetch(request('/api/plays', { method: 'GET', token: 'invalid.token.value' }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 401);
    assert.equal(data.ok, false);
  });

  it('returns an empty array for authenticated users with no playback history', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createPlaybackDb();
    const response = await worker.fetch(request('/api/plays', { method: 'GET', token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.deepEqual(data.items, []);
    assert.deepEqual(data.data, []);
  });

  it('ignores client-supplied user_id filters on playback history', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createPlaybackDb();
    db.state.plays.push(
      {
        id: 'own-play',
        user_id: 'd1-real-user',
        clerk_user_id: 'clerk-user-1',
        legacy_base44_user_id: null,
        playlist_id: 'public-playlist',
        feed_url: 'https://feeds.example.com/show.xml',
        podcast_title: 'Example Show',
        podcast_image: null,
        audio_url: 'https://audio.example.com/own.mp3',
        episode_title: 'Own',
        played_at: '2026-07-12T10:00:00.000Z',
        created_at: '2026-07-12T09:59:00.000Z',
      },
      {
        id: 'requested-other',
        user_id: 'other-user',
        clerk_user_id: 'clerk-other',
        legacy_base44_user_id: null,
        playlist_id: 'public-playlist',
        feed_url: 'https://feeds.example.com/other.xml',
        podcast_title: 'Other',
        podcast_image: null,
        audio_url: 'https://audio.example.com/other.mp3',
        episode_title: 'Other',
        played_at: '2026-07-13T10:00:00.000Z',
        created_at: '2026-07-13T09:59:00.000Z',
      },
    );

    const response = await worker.fetch(request('/api/plays?user_id=other-user', { method: 'GET', token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.deepEqual(data.items.map((row) => row.id), ['own-play']);
  });

  it('does not match empty legacy playback rows for authenticated users without a legacy id', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createPlaybackDb();
    assert.equal(db.state.users[0].legacy_base44_user_id, null);
    db.state.plays.push(
      {
        id: 'own-play',
        user_id: 'd1-real-user',
        clerk_user_id: 'clerk-user-1',
        legacy_base44_user_id: null,
        playlist_id: 'public-playlist',
        feed_url: 'https://feeds.example.com/show.xml',
        podcast_title: 'Example Show',
        podcast_image: null,
        audio_url: 'https://audio.example.com/own.mp3',
        episode_title: 'Own',
        played_at: '2026-07-12T10:00:00.000Z',
        created_at: '2026-07-12T09:59:00.000Z',
      },
      {
        id: 'unrelated-empty-legacy',
        user_id: 'other-user',
        clerk_user_id: 'clerk-other',
        legacy_base44_user_id: '',
        playlist_id: 'public-playlist',
        feed_url: 'https://feeds.example.com/empty-legacy.xml',
        podcast_title: 'Unrelated Empty Legacy',
        podcast_image: null,
        audio_url: 'https://audio.example.com/empty-legacy.mp3',
        episode_title: 'Should Not Leak',
        played_at: '2026-07-13T10:00:00.000Z',
        created_at: '2026-07-13T09:59:00.000Z',
      },
    );

    const response = await worker.fetch(request('/api/plays', { method: 'GET', token }), { ...baseEnv, DB: db });
    const data = await body(response);
    const historyCall = db.state.calls.find((call) => call.kind === 'all' && /FROM podcast_plays/s.test(call.sql));

    assert.equal(response.status, 200);
    assert.deepEqual(data.items.map((row) => row.id), ['own-play']);
    assert.doesNotMatch(historyCall.sql, /legacy_base44_user_id = \?/);
    assert.deepEqual(historyCall.params, ['d1-real-user', 'clerk-user-1', 100]);
  });

  it('returns legitimate legacy playback rows for authenticated users with a matching legacy id', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createPlaybackDb();
    db.state.users[0].legacy_base44_user_id = 'legacy-real-user';
    db.state.plays.push(
      {
        id: 'legacy-play',
        user_id: 'legacy-only-user',
        clerk_user_id: null,
        legacy_base44_user_id: 'legacy-real-user',
        playlist_id: 'public-playlist',
        feed_url: 'https://feeds.example.com/legacy.xml',
        podcast_title: 'Legacy Show',
        podcast_image: null,
        audio_url: 'https://audio.example.com/legacy.mp3',
        episode_title: 'Legacy',
        played_at: '2026-07-12T10:00:00.000Z',
        created_at: '2026-07-12T09:59:00.000Z',
      },
      {
        id: 'other-legacy-play',
        user_id: 'other-user',
        clerk_user_id: null,
        legacy_base44_user_id: 'legacy-other-user',
        playlist_id: 'public-playlist',
        feed_url: 'https://feeds.example.com/other-legacy.xml',
        podcast_title: 'Other Legacy',
        podcast_image: null,
        audio_url: 'https://audio.example.com/other-legacy.mp3',
        episode_title: 'Other Legacy',
        played_at: '2026-07-13T10:00:00.000Z',
        created_at: '2026-07-13T09:59:00.000Z',
      },
    );

    const response = await worker.fetch(request('/api/plays', { method: 'GET', token }), { ...baseEnv, DB: db });
    const data = await body(response);
    const historyCall = db.state.calls.find((call) => call.kind === 'all' && /FROM podcast_plays/s.test(call.sql));

    assert.equal(response.status, 200);
    assert.deepEqual(data.items.map((row) => row.id), ['legacy-play']);
    assert.match(historyCall.sql, /legacy_base44_user_id = \?/);
    assert.deepEqual(historyCall.params, ['d1-real-user', 'clerk-user-1', 'legacy-real-user', 100]);
  });

  it('orders playback history newest first and bounds limit to 100', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createPlaybackDb();
    for (let index = 0; index < 105; index += 1) {
      db.state.plays.push({
        id: `play-${String(index).padStart(3, '0')}`,
        user_id: 'd1-real-user',
        clerk_user_id: 'clerk-user-1',
        legacy_base44_user_id: null,
        playlist_id: 'public-playlist',
        feed_url: `https://feeds.example.com/${index}.xml`,
        podcast_title: `Show ${index}`,
        podcast_image: null,
        audio_url: `https://audio.example.com/${index}.mp3`,
        episode_title: `Episode ${index}`,
        played_at: index === 104 ? null : new Date(Date.UTC(2026, 6, 1 + index, 10)).toISOString(),
        created_at: new Date(Date.UTC(2026, 6, 1 + index, 9)).toISOString(),
      });
    }

    const response = await worker.fetch(request('/api/plays?limit=500', { method: 'GET', token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(data.items.length, 100);
    assert.equal(data.items[0].id, 'play-104');
    assert.equal(data.items[1].id, 'play-103');
    assert.equal(db.state.calls.find((call) => call.kind === 'all' && /FROM podcast_plays/s.test(call.sql)).params.at(-1), 100);
  });

  it('stores valid guest playback with nullable user identity', async () => {
    const db = createPlaybackDb();
    const response = await worker.fetch(request('/api/plays'), { ...baseEnv, DB: db });

    assert.equal(response.status, 200);
    assert.equal(db.state.plays[0].user_id, null);
    assert.equal(db.state.plays[0].clerk_user_id, null);
  });

  it('derives authenticated identity from Clerk and ignores request body user fields', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createPlaybackDb();
    const response = await worker.fetch(request('/api/plays', {
      token,
      payload: {
        ...validPayload,
        user_id: 'spoofed-user',
        clerk_user_id: 'spoofed-clerk',
        legacy_base44_user_id: 'spoofed-legacy',
        played_at: '1999-01-01T00:00:00.000Z',
      },
    }), { ...baseEnv, DB: db });

    assert.equal(response.status, 200);
    assert.equal(db.state.plays[0].user_id, 'd1-real-user');
    assert.equal(db.state.plays[0].clerk_user_id, 'clerk-user-1');
    assert.equal('legacy_base44_user_id' in db.state.plays[0], false);
  });

  it('returns 401 for an invalid bearer token', async () => {
    const db = createPlaybackDb();
    const response = await worker.fetch(request('/api/plays', { token: 'invalid.token.value' }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 401);
    assert.equal(data.ok, false);
    assert.equal(db.state.plays.length, 0);
  });

  it('authenticates before parsing analytics JSON', async () => {
    const invalidAuthDb = createPlaybackDb();
    const invalidAuthResponse = await worker.fetch(
      request('/api/plays', { authHeader: 'Bearer invalid.token.value', rawBody: '{bad json' }),
      { ...baseEnv, DB: invalidAuthDb },
    );
    assert.equal(invalidAuthResponse.status, 401);

    const guestDb = createPlaybackDb();
    const guestResponse = await worker.fetch(
      request('/api/plays', { rawBody: '{bad json' }),
      { ...baseEnv, DB: guestDb },
    );
    assert.equal(guestResponse.status, 400);

    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const authedDb = createPlaybackDb();
    const authedResponse = await worker.fetch(
      request('/api/plays', { token, rawBody: '{bad json' }),
      { ...baseEnv, DB: authedDb },
    );
    assert.equal(authedResponse.status, 400);
  });

  it('rejects malformed JSON and missing required fields', async () => {
    for (const [payload, rawBody] of [
      [validPayload, '{bad json'],
      [{ ...validPayload, event_id: undefined }, undefined],
      [{ ...validPayload, feed_url: undefined }, undefined],
      [{ ...validPayload, audio_url: undefined }, undefined],
    ]) {
      const db = createPlaybackDb();
      const response = await worker.fetch(request('/api/plays', { payload, rawBody }), { ...baseEnv, DB: db });

      assert.equal(response.status, 400);
      assert.equal(db.state.plays.length, 0);
    }
  });

  it('rejects invalid feed and audio URLs', async () => {
    for (const payload of [
      { ...validPayload, event_id: '22222222-2222-4222-8222-222222222222', feed_url: '/relative.xml' },
      { ...validPayload, event_id: '33333333-3333-4333-8333-333333333333', audio_url: 'ftp://audio.example.com/episode.mp3' },
    ]) {
      const db = createPlaybackDb();
      const response = await worker.fetch(request('/api/plays', { payload }), { ...baseEnv, DB: db });

      assert.equal(response.status, 400);
      assert.equal(db.state.plays.length, 0);
    }
  });

  it('rejects unknown playlists and guest playback against non-public playlists', async () => {
    for (const playlist_id of ['missing-playlist', 'private-playlist']) {
      const db = createPlaybackDb();
      const response = await worker.fetch(request('/api/plays', {
        payload: { ...validPayload, event_id: crypto.randomUUID(), playlist_id },
      }), { ...baseEnv, DB: db });

      assert.equal(response.status, 400);
      assert.equal(db.state.plays.length, 0);
    }
  });

  it('accepts only feeds configured on the supplied playlist', async () => {
    const acceptedDb = createPlaybackDb();
    const accepted = await worker.fetch(request('/api/plays', {
      payload: {
        ...validPayload,
        feed_url: 'https://feeds.example.com/show.xml#episode-fragment',
      },
    }), { ...baseEnv, DB: acceptedDb });

    assert.equal(accepted.status, 200);
    assert.equal(acceptedDb.state.plays.length, 1);

    const rejectedDb = createPlaybackDb();
    const rejected = await worker.fetch(request('/api/plays', {
      payload: {
        ...validPayload,
        event_id: crypto.randomUUID(),
        feed_url: 'https://feeds.example.com/unrelated.xml',
      },
    }), { ...baseEnv, DB: rejectedDb });
    const rejectedData = await body(rejected);

    assert.equal(rejected.status, 400);
    assert.deepEqual(rejectedData, { ok: false, code: 'invalid-playlist', error: 'Invalid playlist' });
    assert.equal(rejectedDb.state.plays.length, 0);
  });

  it('allows authenticated owner playback against a non-public playlist', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createPlaybackDb();
    const response = await worker.fetch(request('/api/plays', {
      token,
      payload: { ...validPayload, playlist_id: 'private-playlist' },
    }), { ...baseEnv, DB: db });

    assert.equal(response.status, 200);
    assert.equal(db.state.plays[0].playlist_id, 'private-playlist');
  });

  it('rejects unrelated feeds for authenticated owners with the generic playlist error', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createPlaybackDb();
    const response = await worker.fetch(request('/api/plays', {
      token,
      payload: {
        ...validPayload,
        playlist_id: 'private-playlist',
        feed_url: 'https://feeds.example.com/not-in-private.xml',
      },
    }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 400);
    assert.deepEqual(data, { ok: false, code: 'invalid-playlist', error: 'Invalid playlist' });
    assert.equal(db.state.plays.length, 0);
  });

  it('uses the same generic error shape for unknown, private, and feed-mismatched playlists', async () => {
    const cases = [
      { playlist_id: 'missing-playlist', feed_url: validPayload.feed_url },
      { playlist_id: 'private-other', feed_url: validPayload.feed_url },
      { playlist_id: 'public-playlist', feed_url: 'https://feeds.example.com/other.xml' },
    ];

    for (const payload of cases) {
      const db = createPlaybackDb();
      const response = await worker.fetch(request('/api/plays', {
        payload: {
          ...validPayload,
          ...payload,
          event_id: crypto.randomUUID(),
        },
      }), { ...baseEnv, DB: db });
      const data = await body(response);

      assert.equal(response.status, 400);
      assert.deepEqual(data, { ok: false, code: 'invalid-playlist', error: 'Invalid playlist' });
    }
  });

  it('makes duplicate event_id idempotent and increments playlist count only once', async () => {
    const db = createPlaybackDb();
    const first = await worker.fetch(request('/api/plays'), { ...baseEnv, DB: db });
    const second = await worker.fetch(request('/api/plays'), { ...baseEnv, DB: db });
    const firstData = await body(first);
    const secondData = await body(second);

    assert.equal(firstData.duplicate, false);
    assert.equal(secondData.duplicate, true);
    assert.equal(db.state.plays.length, 1);
    assert.equal(db.state.playlists.find((row) => row.id === 'public-playlist').plays_count, 5);
  });

  it('does not increment playlist counts when playback has no playlist', async () => {
    const db = createPlaybackDb();
    const response = await worker.fetch(request('/api/plays', {
      payload: { ...validPayload, playlist_id: undefined },
    }), { ...baseEnv, DB: db });

    assert.equal(response.status, 200);
    assert.equal(db.state.plays[0].playlist_id, null);
    assert.equal(db.state.playlists.find((row) => row.id === 'public-playlist').plays_count, 4);
  });

  it('keeps analytics responses minimal and private-data free', async () => {
    const db = createPlaybackDb();
    const response = await worker.fetch(request('/api/plays'), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.deepEqual(Object.keys(data).sort(), ['duplicate', 'ok', 'recorded']);
  });
});

describe('podcast playback frontend integration', () => {
  it('matches recent playlists by playlist_id before falling back to feed_url', () => {
    const playlists = [
      {
        id: 'feed-owner',
        rss_feeds: [{ url: 'https://feeds.example.com/shared.xml' }],
      },
      {
        id: 'recorded-playlist',
        rss_feeds: [{ url: 'https://feeds.example.com/shared.xml' }],
      },
      {
        id: 'legacy-feed-match',
        rss_feeds: [{ feed_url: 'https://feeds.example.com/legacy.xml' }],
      },
    ];
    const plays = [
      {
        playlist_id: 'recorded-playlist',
        feed_url: 'https://feeds.example.com/shared.xml',
        played_at: '2026-07-12T10:00:00.000Z',
      },
      {
        playlist_id: null,
        feed_url: 'https://feeds.example.com/legacy.xml',
        played_at: '2026-07-11T10:00:00.000Z',
      },
    ];

    assert.deepEqual(
      getRecentlyPlayedPlaylists(plays, playlists).map((playlist) => playlist.id),
      ['recorded-playlist', 'legacy-feed-match'],
    );
  });

  it('does not fall back to feed_url when a recorded playlist_id is unavailable', () => {
    const playlists = [
      {
        id: 'available-shared-feed',
        rss_feeds: [{ url: 'https://feeds.example.com/shared.xml' }],
      },
    ];
    const plays = [
      {
        playlist_id: 'private-or-missing-playlist',
        feed_url: 'https://feeds.example.com/shared.xml',
        played_at: '2026-07-12T10:00:00.000Z',
      },
    ];

    assert.deepEqual(getRecentlyPlayedPlaylists(plays, playlists), []);
  });

  it('includes playlist source in the analytics payload and no longer increments playlist plays directly', () => {
    const playerSource = fs.readFileSync(new URL('../src/lib/PlayerContext.jsx', import.meta.url), 'utf8');
    const playlistSource = fs.readFileSync(new URL('../src/pages/PlaylistDetail.jsx', import.meta.url), 'utf8');
    const podcastSource = fs.readFileSync(new URL('../src/pages/PodcastDetail.jsx', import.meta.url), 'utf8');
    const downloadSource = fs.readFileSync(new URL('../src/components/downloads/DownloadedEpisodeCard.jsx', import.meta.url), 'utf8');

    assert.match(playerSource, /createPodcastPlaySession\(episode, source\)/);
    assert.match(playerSource, /const nextSource = source \?\? null/);
    assert.match(playlistSource, /play\(ep, episodes, \{ type: 'playlist', id \}\)/);
    assert.match(playlistSource, /play\(nextUnplayed, episodes, \{ type: 'playlist', id \}\)/);
    assert.match(podcastSource, /play\(ep, episodes, \{ type: 'podcast', id: feedUrl \}\)/);
    assert.match(podcastSource, /play\(next, episodes, \{ type: 'podcast', id: feedUrl \}\)/);
    assert.match(downloadSource, /play\(episode, \[episode\], \{ type: 'download', id: null \}\)/);
    assert.equal(playlistSource.includes('incrementPlaylistPlays'), false);
  });

  it('keeps playback analytics fire-and-forget and session-scoped', () => {
    const playerSource = fs.readFileSync(new URL('../src/lib/PlayerContext.jsx', import.meta.url), 'utf8');
    const helperSource = fs.readFileSync(new URL('../src/lib/podcastPlaybackSession.js', import.meta.url), 'utf8');

    assert.match(playerSource, /void podcastPlayRecorderRef\.current\?\.attempt\(expectedEventId\)/);
    assert.match(playerSource, /createPodcastPlayRecorder/);
    assert.match(helperSource, /PODCAST_PLAY_RECORD_AFTER_SECONDS = 10/);
    assert.match(helperSource, /\.catch\(\(error\) =>/);
    assert.match(playerSource, /queryClient\.invalidateQueries\(\{ queryKey: \['user-podcast-plays', u\.id\] \}\)/);
    assert.match(playerSource, /startPodcastPlaySession\(episode\)/);
    assert.match(playerSource, /startPodcastPlaySession\(nextEpisode\)/);
  });
});
