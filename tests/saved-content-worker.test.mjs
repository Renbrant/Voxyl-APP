import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { afterEach, describe, it, mock } from 'node:test';
import worker from '../workers/api/src/index.ts';
import { voxylApi } from '../src/api/voxylApiClient.js';
import {
  applyPlaylistLikeOptimistic,
  normalizePodcastFeedUrl,
  podcastFeedUrlSet,
  reconcilePlaylistLikeRecords,
  updatePlaylistLikesCountInValue,
} from '../src/lib/savedContentState.js';
import {
  loadLikedPlaylistsForRecords,
  refreshPlaylistLikeQuery,
  savedContentQueryKeys,
  togglePlaylistLikeOptimistically,
} from '../src/lib/savedContentQueries.js';

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

function request(path, { method = 'GET', payload, token, authHeader, rawBody } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (authHeader !== undefined) headers.authorization = authHeader;
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = rawBody ?? JSON.stringify(payload ?? {});
  }
  return new Request(`https://api.voxyl.test${path}`, init);
}

async function body(response) {
  return response.json();
}

function createSavedContentDb() {
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
      {
        id: 'other-user',
        clerk_user_id: 'clerk-other',
        legacy_base44_user_id: null,
        email: 'other@example.com',
        name: 'Other User',
        username: 'other',
        role: 'user',
        profile_picture: null,
        profile_hidden: 0,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
      },
    ],
    playlists: [
      { id: 'public-playlist', creator_id: 'other-user', creator_clerk_user_id: 'clerk-other', creator_legacy_base44_user_id: null, visibility: 'public', rss_feeds: null, likes_count: 99 },
      { id: 'private-other', creator_id: 'other-user', creator_clerk_user_id: 'clerk-other', creator_legacy_base44_user_id: null, visibility: 'private', rss_feeds: null, likes_count: 0 },
      { id: 'friends-playlist', creator_id: 'other-user', creator_clerk_user_id: 'clerk-other', creator_legacy_base44_user_id: null, visibility: 'friends_only', rss_feeds: null, likes_count: 0 },
      { id: 'legacy-owned-private', creator_id: 'legacy-row-user', creator_clerk_user_id: null, creator_legacy_base44_user_id: 'legacy-real-user', visibility: 'private', rss_feeds: null, likes_count: 7 },
      { id: 'liked-one', creator_id: 'other-user', creator_clerk_user_id: 'clerk-other', creator_legacy_base44_user_id: null, visibility: 'public', rss_feeds: '[]', likes_count: 1, title: 'Liked One', description: null, cover_image: null, plays_count: 0, creator_username: 'other', creator_picture: null, creator_hidden: 0, created_at: '2026-07-10T00:00:00.000Z', updated_at: '2026-07-10T00:00:00.000Z' },
      { id: 'liked-two', creator_id: 'other-user', creator_clerk_user_id: 'clerk-other', creator_legacy_base44_user_id: null, visibility: 'public', rss_feeds: '[]', likes_count: 1, title: 'Liked Two', description: null, cover_image: null, plays_count: 0, creator_username: 'other', creator_picture: null, creator_hidden: 0, created_at: '2026-07-11T00:00:00.000Z', updated_at: '2026-07-11T00:00:00.000Z' },
    ],
    follows: [],
    playlistLikes: [],
    podcastLikes: [],
    calls: [],
    failNextBatchUpdate: false,
    insertCompetingPodcastBeforeInsert: null,
  };

  function matchesIdentity(row, params, hasLegacy) {
    const [userId, clerkUserId] = params;
    const legacyUserId = hasLegacy ? params[2] : undefined;
    return row.user_id === userId ||
      row.clerk_user_id === clerkUserId ||
      (hasLegacy && row.legacy_base44_user_id === legacyUserId);
  }

  function publicPodcastRow(row) {
    return {
      id: row.id,
      feed_url: row.feed_url,
      podcast_title: row.podcast_title ?? null,
      podcast_author: row.podcast_author ?? null,
      podcast_image: row.podcast_image ?? null,
      podcast_description: row.podcast_description ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      base44_created_date: row.base44_created_date ?? null,
      base44_updated_date: row.base44_updated_date ?? null,
    };
  }

  return {
    state,
    async batch(statements) {
      state.calls.push({ kind: 'batch', statements: statements.map((statement) => statement.__bound || statement) });
      const snapshot = {
        playlistLikes: state.playlistLikes.map((row) => ({ ...row })),
        playlists: state.playlists.map((row) => ({ ...row })),
        podcastLikes: state.podcastLikes.map((row) => ({ ...row })),
      };
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        return results;
      } catch (error) {
        state.playlistLikes = snapshot.playlistLikes;
        state.playlists = snapshot.playlists;
        state.podcastLikes = snapshot.podcastLikes;
        throw error;
      }
    },
    prepare(sql) {
      return {
        bind(...params) {
          const bound = {
            sql,
            params,
          };
          return {
            __bound: bound,
            async first() {
              state.calls.push({ kind: 'first', sql, params });
              if (/FROM users\s+WHERE clerk_user_id = \?/s.test(sql)) {
                return state.users.find((user) => user.clerk_user_id === params[0]) || null;
              }
              if (/FROM users\s+WHERE lower\(email\)/s.test(sql)) {
                return state.users.find((user) => user.email?.toLowerCase() === String(params[0]).toLowerCase()) || null;
              }
              if (/FROM playlists\s+WHERE id = \?/s.test(sql)) {
                const playlist = state.playlists.find((row) => row.id === params[0]);
                return playlist ? {
                  legacy_base44_playlist_id: null,
                  title: playlist.title || playlist.id,
                  description: playlist.description ?? null,
                  cover_image: playlist.cover_image ?? null,
                  plays_count: playlist.plays_count ?? 0,
                  creator_username: playlist.creator_username ?? null,
                  creator_picture: playlist.creator_picture ?? null,
                  creator_hidden: playlist.creator_hidden ?? 0,
                  created_at: playlist.created_at || '2026-07-01T00:00:00.000Z',
                  updated_at: playlist.updated_at || '2026-07-01T00:00:00.000Z',
                  ...playlist,
                } : null;
              }
              if (/FROM follows/s.test(sql)) {
                return state.follows.find((follow) =>
                  follow.status === 'accepted' &&
                  [follow.follower_id, follow.follower_clerk_user_id, follow.follower_legacy_base44_user_id].includes(params[0]) &&
                  [follow.following_id, follow.following_clerk_user_id, follow.following_legacy_base44_user_id].some((value) => params.includes(value))
                ) || null;
              }
              if (/SELECT id\s+FROM playlist_likes/s.test(sql)) {
                const playlistId = params[0];
                const hasLegacy = /legacy_base44_user_id = \?/s.test(sql);
                return state.playlistLikes.find((row) => row.playlist_id === playlistId && matchesIdentity(row, params.slice(1), hasLegacy)) || null;
              }
              if (/SELECT COUNT\(\*\) AS count\s+FROM playlist_likes/s.test(sql)) {
                return { count: state.playlistLikes.filter((row) => row.playlist_id === params[0]).length };
              }
              if (/SELECT id\s+FROM podcast_likes/s.test(sql)) {
                const feedCandidateCount = (sql.match(/feed_url IN \(([^)]*)\)/)?.[1].match(/\?/g) || []).length || 1;
                const feedUrls = params.slice(0, feedCandidateCount);
                const hasLegacy = /legacy_base44_user_id = \?/s.test(sql);
                return state.podcastLikes.find((row) => feedUrls.includes(row.feed_url) && matchesIdentity(row, params.slice(feedCandidateCount), hasLegacy)) || null;
              }
              if (/FROM podcast_likes\s+WHERE id = \?/s.test(sql)) {
                const row = state.podcastLikes.find((like) => like.id === params[0]);
                return row ? publicPodcastRow(row) : null;
              }
              if (/FROM podcast_likes\s+WHERE user_id = \?/s.test(sql)) {
                const userId = params[0];
                const feedUrls = params.slice(1, -1);
                const preferred = params.at(-1);
                const rows = state.podcastLikes
                  .filter((row) => row.user_id === userId && feedUrls.includes(row.feed_url))
                  .sort((left, right) => (left.feed_url === preferred ? -1 : right.feed_url === preferred ? 1 : 0));
                return rows[0] ? publicPodcastRow(rows[0]) : null;
              }
              if (/SELECT likes_count\s+FROM playlists/s.test(sql)) {
                const playlist = state.playlists.find((row) => row.id === params[0]);
                return playlist ? { likes_count: playlist.likes_count } : null;
              }
              throw new Error(`Unhandled first SQL: ${sql}`);
            },
            async all() {
              state.calls.push({ kind: 'all', sql, params });
              if (/FROM users\s+WHERE lower\(email\)/s.test(sql)) {
                return { results: state.users.filter((user) => user.email?.toLowerCase() === String(params[0]).toLowerCase()) };
              }
              if (/FROM playlist_likes/s.test(sql)) {
                const hasLegacy = /legacy_base44_user_id = \?/s.test(sql);
                const limit = params.at(-1);
                const playlistFilterIndex = hasLegacy ? 3 : 2;
                const playlistId = /playlist_id = \?/s.test(sql) ? params[playlistFilterIndex] : null;
                const identityParams = params.slice(0, hasLegacy ? 3 : 2);
                const results = state.playlistLikes
                  .filter((row) => matchesIdentity(row, identityParams, hasLegacy))
                  .filter((row) => !playlistId || row.playlist_id === playlistId)
                  .slice(0, limit)
                  .map((row) => ({
                    id: row.id,
                    playlist_id: row.playlist_id,
                    created_at: row.created_at,
                    base44_created_date: row.base44_created_date ?? null,
                  }));
                return { results };
              }
              if (/FROM podcast_likes/s.test(sql)) {
                const hasLegacy = /legacy_base44_user_id = \?/s.test(sql);
                const limit = params.at(-1);
                const feedCandidateCount = (sql.match(/feed_url IN \(([^)]*)\)/)?.[1].match(/\?/g) || []).length;
                const feedUrls = feedCandidateCount
                  ? params.slice(hasLegacy ? 3 : 2, (hasLegacy ? 3 : 2) + feedCandidateCount)
                  : [];
                const identityParams = params.slice(0, hasLegacy ? 3 : 2);
                const results = state.podcastLikes
                  .filter((row) => matchesIdentity(row, identityParams, hasLegacy))
                  .filter((row) => feedUrls.length === 0 || feedUrls.includes(row.feed_url))
                  .slice(0, limit)
                  .map(publicPodcastRow);
                return { results };
              }
              throw new Error(`Unhandled all SQL: ${sql}`);
            },
            async run() {
              state.calls.push({ kind: 'run', sql, params });
              if (/INSERT INTO users/s.test(sql)) return { meta: { changes: 0 } };
              if (/UPDATE users|UPDATE playlist_likes|UPDATE episode_progress|UPDATE podcast_plays|UPDATE follows|UPDATE blocks|UPDATE reports|UPDATE referrals/s.test(sql)) return { meta: { changes: 0 } };
              if (/UPDATE playlists\s+SET creator_clerk_user_id/s.test(sql)) return { meta: { changes: 0 } };
              if (/UPDATE playlists\s+SET likes_count/s.test(sql)) {
                if (state.failNextBatchUpdate) {
                  state.failNextBatchUpdate = false;
                  throw new Error('simulated count update failure');
                }
                const playlist = state.playlists.find((row) => row.id === params[1]);
                if (playlist) playlist.likes_count = state.playlistLikes.filter((row) => row.playlist_id === params[0]).length;
                return { meta: { changes: playlist ? 1 : 0 } };
              }
              if (/DELETE FROM playlist_likes/s.test(sql)) {
                const before = state.playlistLikes.length;
                state.playlistLikes = state.playlistLikes.filter((row) => row.id !== params[0]);
                return { meta: { changes: before - state.playlistLikes.length } };
              }
              if (/INSERT OR IGNORE INTO playlist_likes/s.test(sql)) {
                const [id, playlist_id, user_id, clerk_user_id, legacy_base44_user_id] = params;
                if (!state.playlistLikes.some((row) => row.playlist_id === playlist_id && row.user_id === user_id)) {
                  state.playlistLikes.push({ id, playlist_id, user_id, clerk_user_id, legacy_base44_user_id, created_at: '2026-07-16T00:00:00.000Z' });
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (/UPDATE podcast_likes/s.test(sql)) {
                const id = params.at(-1);
                const row = state.podcastLikes.find((like) => like.id === id);
                if (!row) return { meta: { changes: 0 } };
                row.user_id = params[0];
                row.clerk_user_id = params[1];
                row.legacy_base44_user_id = params[2];
                row.feed_url = params[3];
                row.podcast_title = params[4] ?? row.podcast_title ?? null;
                row.podcast_author = params[5] ?? row.podcast_author ?? null;
                row.podcast_image = params[6] ?? row.podcast_image ?? null;
                row.podcast_description = params[7] ?? row.podcast_description ?? null;
                row.updated_at = '2026-07-16T00:00:00.000Z';
                return { meta: { changes: 1 } };
              }
              if (/INSERT INTO podcast_likes/s.test(sql)) {
                const [id, user_id, clerk_user_id, legacy_base44_user_id, feed_url, podcast_title, podcast_author, podcast_image, podcast_description] = params;
                if (state.insertCompetingPodcastBeforeInsert) {
                  state.podcastLikes.push(state.insertCompetingPodcastBeforeInsert);
                  state.insertCompetingPodcastBeforeInsert = null;
                }
                const existing = state.podcastLikes.find((row) => row.user_id === user_id && row.feed_url === feed_url);
                const row = existing || { id, user_id, feed_url, created_at: '2026-07-16T00:00:00.000Z' };
                Object.assign(row, {
                  clerk_user_id,
                  legacy_base44_user_id,
                  podcast_title: podcast_title ?? row.podcast_title ?? null,
                  podcast_author: podcast_author ?? row.podcast_author ?? null,
                  podcast_image: podcast_image ?? row.podcast_image ?? null,
                  podcast_description: podcast_description ?? row.podcast_description ?? null,
                  updated_at: '2026-07-16T00:00:00.000Z',
                });
                if (!existing) state.podcastLikes.push(row);
                return { meta: { changes: 1 } };
              }
              if (/DELETE FROM podcast_likes/s.test(sql)) {
                const id = params[0];
                const hasLegacy = /legacy_base44_user_id = \?/s.test(sql);
                const identityParams = params.slice(1);
                const before = state.podcastLikes.length;
                state.podcastLikes = state.podcastLikes.filter((row) => !(row.id === id && matchesIdentity(row, identityParams, hasLegacy)));
                return { meta: { changes: before - state.podcastLikes.length } };
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

describe('saved-content Worker routes', () => {
  it('requires authentication on saved-content read and write routes', async () => {
    for (const [path, method, payload] of [
      ['/api/entities/playlist-like', 'GET'],
      ['/entities/playlist-like', 'GET'],
      ['/api/functions/togglePlaylistLike', 'POST', { playlist_id: 'public-playlist' }],
      ['/functions/togglePlaylistLike', 'POST', { playlist_id: 'public-playlist' }],
      ['/api/entities/podcast-like', 'GET'],
      ['/entities/podcast-like', 'GET'],
      ['/api/entities/podcast-like', 'POST', { feed_url: 'https://feeds.example.com/show.xml' }],
      ['/entities/podcast-like', 'POST', { feed_url: 'https://feeds.example.com/show.xml' }],
      ['/api/entities/podcast-like/like-1', 'DELETE'],
      ['/entities/podcast-like/like-1', 'DELETE'],
    ]) {
      const response = await worker.fetch(request(path, { method, payload }), { ...baseEnv, DB: createSavedContentDb() });
      assert.equal(response.status, 401, `${method} ${path}`);
    }
  });

  it('returns 401 for invalid bearer tokens', async () => {
    const response = await worker.fetch(request('/api/entities/playlist-like', { token: 'invalid.token.value' }), { ...baseEnv, DB: createSavedContentDb() });
    assert.equal(response.status, 401);
  });

  it('reads only the authenticated user playlist likes and ignores spoofed identity filters', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();
    db.state.playlistLikes.push(
      { id: 'own-like', playlist_id: 'public-playlist', user_id: 'd1-real-user', clerk_user_id: 'clerk-user-1', created_at: '2026-07-15T00:00:00.000Z' },
      { id: 'other-like', playlist_id: 'public-playlist', user_id: 'other-user', clerk_user_id: 'clerk-other', created_at: '2026-07-16T00:00:00.000Z' },
    );

    const response = await worker.fetch(request('/api/entities/playlist-like?user_id=other-user&limit=500', { token }), { ...baseEnv, DB: db });
    const data = await body(response);
    const call = db.state.calls.find((entry) => entry.kind === 'all' && /FROM playlist_likes/s.test(entry.sql));

    assert.equal(response.status, 200);
    assert.deepEqual(data.items.map((row) => row.id), ['own-like']);
    assert.deepEqual(data.data, data.items);
    assert.equal('user_id' in data.items[0], false);
    assert.deepEqual(call.params, ['d1-real-user', 'clerk-user-1', 100]);
  });

  it('supports playlist_id filtering without trusting client identity filters', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();
    db.state.playlistLikes.push(
      { id: 'wanted', playlist_id: 'public-playlist', user_id: 'd1-real-user', clerk_user_id: 'clerk-user-1', created_at: '2026-07-15T00:00:00.000Z' },
      { id: 'other-playlist', playlist_id: 'another-playlist', user_id: 'd1-real-user', clerk_user_id: 'clerk-user-1', created_at: '2026-07-16T00:00:00.000Z' },
    );

    const response = await worker.fetch(request('/entities/playlist-like?playlist_id=public-playlist&user_id=other-user', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.deepEqual(data.items.map((row) => row.id), ['wanted']);
  });

  it('does not match empty legacy playlist rows when the authenticated user has no legacy id', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();
    db.state.playlistLikes.push(
      { id: 'own-like', playlist_id: 'public-playlist', user_id: 'd1-real-user', clerk_user_id: 'clerk-user-1', legacy_base44_user_id: null, created_at: '2026-07-15T00:00:00.000Z' },
      { id: 'empty-legacy', playlist_id: 'public-playlist', user_id: 'other-user', clerk_user_id: 'clerk-other', legacy_base44_user_id: '', created_at: '2026-07-16T00:00:00.000Z' },
    );

    const response = await worker.fetch(request('/api/entities/playlist-like', { token }), { ...baseEnv, DB: db });
    const data = await body(response);
    const call = db.state.calls.find((entry) => entry.kind === 'all' && /FROM playlist_likes/s.test(entry.sql));

    assert.deepEqual(data.items.map((row) => row.id), ['own-like']);
    assert.doesNotMatch(call.sql, /legacy_base44_user_id = \?/);
  });

  it('loads legitimate non-empty legacy playlist likes', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();
    db.state.users[0].legacy_base44_user_id = 'legacy-real-user';
    db.state.playlistLikes.push({ id: 'legacy-like', playlist_id: 'public-playlist', user_id: 'legacy-row-user', clerk_user_id: null, legacy_base44_user_id: 'legacy-real-user', created_at: '2026-07-15T00:00:00.000Z' });

    const response = await worker.fetch(request('/api/entities/playlist-like', { token }), { ...baseEnv, DB: db });
    const data = await body(response);
    const call = db.state.calls.find((entry) => entry.kind === 'all' && /FROM playlist_likes/s.test(entry.sql));

    assert.deepEqual(data.items.map((row) => row.id), ['legacy-like']);
    assert.match(call.sql, /legacy_base44_user_id = \?/);
    assert.deepEqual(call.params, ['d1-real-user', 'clerk-user-1', 'legacy-real-user', 100]);
  });

  it('toggles playlist likes, prevents duplicates, and recounts likes from rows', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();
    const first = await worker.fetch(request('/api/functions/togglePlaylistLike', { method: 'POST', token, payload: { playlist_id: 'public-playlist', user_id: 'other-user', likes_count: 1000 } }), { ...baseEnv, DB: db });
    const firstData = await body(first);
    const second = await worker.fetch(request('/functions/togglePlaylistLike', { method: 'POST', token, payload: { playlist_id: 'public-playlist' } }), { ...baseEnv, DB: db });
    const secondData = await body(second);

    assert.equal(first.status, 200);
    assert.equal(firstData.liked, true);
    assert.equal(firstData.likes_count, 1);
    assert.equal(db.state.playlistLikes.length, 0);
    assert.equal(secondData.liked, false);
    assert.equal(secondData.likes_count, 0);
    assert.equal(db.state.playlists.find((row) => row.id === 'public-playlist').likes_count, 0);
  });

  it('updates playlist like mutation and count in one transactional batch with a subquery count update', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();
    db.state.playlists.find((row) => row.id === 'public-playlist').likes_count = 50;

    const response = await worker.fetch(request('/api/functions/togglePlaylistLike', {
      method: 'POST',
      token,
      payload: { playlist_id: 'public-playlist' },
    }), { ...baseEnv, DB: db });
    const data = await body(response);
    const batchCall = db.state.calls.find((entry) => entry.kind === 'batch');
    const countUpdate = batchCall.statements.find((statement) => /UPDATE playlists\s+SET likes_count = \(/s.test(statement.sql));

    assert.equal(response.status, 200);
    assert.equal(data.likes_count, 1);
    assert.equal(db.state.playlists.find((row) => row.id === 'public-playlist').likes_count, 1);
    assert.ok(batchCall);
    assert.match(countUpdate.sql, /SELECT COUNT\(\*\)\s+FROM playlist_likes/s);
    assert.deepEqual(countUpdate.params, ['public-playlist', 'public-playlist']);
  });

  it('rolls back playlist like mutation when the batched count update fails', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();
    db.state.failNextBatchUpdate = true;

    const response = await worker.fetch(request('/api/functions/togglePlaylistLike', {
      method: 'POST',
      token,
      payload: { playlist_id: 'public-playlist' },
    }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 500);
    assert.equal(data.error, 'Internal server error');
    assert.equal(db.state.playlistLikes.length, 0);
    assert.equal(db.state.playlists.find((row) => row.id === 'public-playlist').likes_count, 99);
  });

  it('corrects stale playlist counts after interleaved existing rows', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();
    db.state.playlists.find((row) => row.id === 'public-playlist').likes_count = 500;
    db.state.playlistLikes.push({ id: 'other-like', playlist_id: 'public-playlist', user_id: 'other-user', clerk_user_id: 'clerk-other', created_at: '2026-07-15T00:00:00.000Z' });

    const response = await worker.fetch(request('/api/functions/togglePlaylistLike', {
      method: 'POST',
      token,
      payload: { playlist_id: 'public-playlist' },
    }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.likes_count, 2);
    assert.equal(db.state.playlists.find((row) => row.id === 'public-playlist').likes_count, 2);
  });

  it('returns 400 for invalid playlist toggle input and 404 for missing or inaccessible playlists', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    for (const [payload, expected] of [
      [{ playlist_id: '' }, 400],
      [{ playlist_id: 'missing-playlist' }, 404],
      [{ playlist_id: 'private-other' }, 404],
    ]) {
      const response = await worker.fetch(request('/api/functions/togglePlaylistLike', { method: 'POST', token, payload }), { ...baseEnv, DB: createSavedContentDb() });
      assert.equal(response.status, expected);
    }
  });

  it('allows friends-only playlist likes when accepted follow data grants access', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();
    db.state.follows.push({ id: 'follow-1', follower_id: 'd1-real-user', follower_clerk_user_id: 'clerk-user-1', following_id: 'other-user', following_clerk_user_id: 'clerk-other', status: 'accepted' });

    const response = await worker.fetch(request('/api/functions/togglePlaylistLike', { method: 'POST', token, payload: { playlist_id: 'friends-playlist' } }), { ...baseEnv, DB: db });

    assert.equal(response.status, 200);
    assert.equal(db.state.playlistLikes.length, 1);
  });

  it('allows imported private playlist owners through server-resolved non-empty legacy ids', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();
    db.state.users[0].legacy_base44_user_id = 'legacy-real-user';

    const response = await worker.fetch(request('/api/functions/togglePlaylistLike', {
      method: 'POST',
      token,
      payload: { playlist_id: 'legacy-owned-private', legacy_base44_user_id: 'spoofed' },
    }), { ...baseEnv, DB: db });

    assert.equal(response.status, 200);
    assert.equal(db.state.playlistLikes.length, 1);
  });

  it('loads liked playlist metadata by exact id instead of repeating the public collection head', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();

    const first = await worker.fetch(request('/api/playlists/liked-one', { token }), { ...baseEnv, DB: db });
    const second = await worker.fetch(request('/api/playlists/liked-two', { token }), { ...baseEnv, DB: db });
    const firstData = await body(first);
    const secondData = await body(second);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(firstData.playlist.id, 'liked-one');
    assert.equal(firstData.playlist.name, 'Liked One');
    assert.equal(secondData.playlist.id, 'liked-two');
    assert.equal(secondData.playlist.name, 'Liked Two');
  });

  it('reads only the authenticated user podcast likes and supports exact feed filters', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();
    db.state.podcastLikes.push(
      { id: 'own-podcast', user_id: 'd1-real-user', clerk_user_id: 'clerk-user-1', feed_url: 'https://feeds.example.com/show.xml', podcast_title: 'Own', created_at: '2026-07-15T00:00:00.000Z', updated_at: '2026-07-15T00:00:00.000Z' },
      { id: 'other-podcast', user_id: 'other-user', clerk_user_id: 'clerk-other', feed_url: 'https://feeds.example.com/show.xml', podcast_title: 'Other', created_at: '2026-07-16T00:00:00.000Z', updated_at: '2026-07-16T00:00:00.000Z' },
      { id: 'own-other-feed', user_id: 'd1-real-user', clerk_user_id: 'clerk-user-1', feed_url: 'https://feeds.example.com/other.xml', podcast_title: 'Other Feed', created_at: '2026-07-16T00:00:00.000Z', updated_at: '2026-07-16T00:00:00.000Z' },
    );

    const response = await worker.fetch(request('/entities/podcast-like?user_id=other-user&feed_url=https://feeds.example.com/show.xml', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.deepEqual(data.items.map((row) => row.id), ['own-podcast']);
    assert.equal('user_id' in data.items[0], false);
    assert.equal('user_email' in data.items[0], false);
  });

  it('creates, upserts, and refreshes podcast like metadata without exposing identity fields', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();
    const payload = {
      feed_url: 'https://feeds.example.com/show.xml',
      podcast_title: 'Original',
      podcast_author: 'Author',
      podcast_image: 'https://img.example.com/show.jpg',
      podcast_description: 'Description',
      user_id: 'other-user',
    };
    const first = await worker.fetch(request('/api/entities/podcast-like', { method: 'POST', token, payload }), { ...baseEnv, DB: db });
    const second = await worker.fetch(request('/entities/podcast-like', { method: 'POST', token, payload: { ...payload, podcast_title: 'Updated' } }), { ...baseEnv, DB: db });
    const secondData = await body(second);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(db.state.podcastLikes.length, 1);
    assert.equal(secondData.item.podcast_title, 'Updated');
    assert.equal('user_id' in secondData.item, false);
  });

  it('returns the existing podcast row when another insert wins the upsert race', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();
    db.state.insertCompetingPodcastBeforeInsert = {
      id: 'winner-row',
      user_id: 'd1-real-user',
      clerk_user_id: 'clerk-user-1',
      feed_url: 'https://feeds.example.com/race.xml',
      podcast_title: 'Old',
      created_at: '2026-07-15T00:00:00.000Z',
      updated_at: '2026-07-15T00:00:00.000Z',
    };

    const response = await worker.fetch(request('/api/entities/podcast-like', {
      method: 'POST',
      token,
      payload: {
        feed_url: 'https://feeds.example.com/race.xml',
        podcast_title: 'New',
      },
    }), { ...baseEnv, DB: db });
    const data = await body(response);
    const firstExistingLookup = db.state.calls.find((entry) => entry.kind === 'first' && /SELECT id\s+FROM podcast_likes/s.test(entry.sql));

    assert.equal(response.status, 200);
    assert.equal(db.state.podcastLikes.length, 1);
    assert.ok(firstExistingLookup);
    assert.equal(data.item.id, 'winner-row');
    assert.equal(data.item.podcast_title, 'New');
  });

  it('preserves existing podcast metadata when optional fields are omitted on upsert', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();
    db.state.podcastLikes.push({
      id: 'existing-metadata',
      user_id: 'd1-real-user',
      clerk_user_id: 'clerk-user-1',
      feed_url: 'https://feeds.example.com/metadata.xml',
      podcast_title: 'Keep Title',
      podcast_author: 'Keep Author',
      podcast_image: 'https://img.example.com/keep.jpg',
      podcast_description: 'Keep Description',
      created_at: '2026-07-15T00:00:00.000Z',
      updated_at: '2026-07-15T00:00:00.000Z',
    });

    const response = await worker.fetch(request('/api/entities/podcast-like', {
      method: 'POST',
      token,
      payload: { feed_url: 'https://feeds.example.com/metadata.xml' },
    }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.item.podcast_title, 'Keep Title');
    assert.equal(data.item.podcast_author, 'Keep Author');
    assert.equal(data.item.podcast_image, 'https://img.example.com/keep.jpg');
    assert.equal(data.item.podcast_description, 'Keep Description');
  });

  it('normalizes podcast feed_url consistently while still matching legacy stored forms', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();

    const created = await worker.fetch(request('/api/entities/podcast-like', {
      method: 'POST',
      token,
      payload: { feed_url: 'https://example.com#frag', podcast_title: 'Canonical' },
    }), { ...baseEnv, DB: db });
    const createdData = await body(created);
    const canonicalGet = await worker.fetch(request('/api/entities/podcast-like?feed_url=https://example.com', { token }), { ...baseEnv, DB: db });
    const canonicalData = await body(canonicalGet);

    db.state.podcastLikes.push({
      id: 'legacy-url',
      user_id: 'd1-real-user',
      clerk_user_id: 'clerk-user-1',
      feed_url: 'https://legacy.example.com',
      podcast_title: 'Legacy URL',
      created_at: '2026-07-15T00:00:00.000Z',
      updated_at: '2026-07-15T00:00:00.000Z',
    });
    const legacyGet = await worker.fetch(request('/api/entities/podcast-like?feed_url=https://legacy.example.com/', { token }), { ...baseEnv, DB: db });
    const legacyData = await body(legacyGet);

    assert.equal(created.status, 200);
    assert.equal(createdData.item.feed_url, 'https://example.com/');
    assert.deepEqual(canonicalData.items.map((row) => row.id), [createdData.item.id]);
    assert.deepEqual(legacyData.items.map((row) => row.id), ['legacy-url']);
  });

  it('returns 400 for malformed or non-http podcast feed URLs', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    for (const feed_url of ['not-a-url', 'ftp://feeds.example.com/show.xml']) {
      const response = await worker.fetch(request('/api/entities/podcast-like', { method: 'POST', token, payload: { feed_url } }), { ...baseEnv, DB: createSavedContentDb() });
      assert.equal(response.status, 400);
    }
  });

  it('deletes only owned podcast likes and hides ownership of other users rows', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createSavedContentDb();
    db.state.podcastLikes.push(
      { id: 'own-podcast', user_id: 'd1-real-user', clerk_user_id: 'clerk-user-1', feed_url: 'https://feeds.example.com/show.xml', created_at: '2026-07-15T00:00:00.000Z', updated_at: '2026-07-15T00:00:00.000Z' },
      { id: 'other-podcast', user_id: 'other-user', clerk_user_id: 'clerk-other', feed_url: 'https://feeds.example.com/other.xml', created_at: '2026-07-16T00:00:00.000Z', updated_at: '2026-07-16T00:00:00.000Z' },
    );

    const forbidden = await worker.fetch(request('/api/entities/podcast-like/other-podcast', { method: 'DELETE', token }), { ...baseEnv, DB: db });
    const deleted = await worker.fetch(request('/entities/podcast-like/own-podcast', { method: 'DELETE', token }), { ...baseEnv, DB: db });
    const deletedData = await body(deleted);

    assert.equal(forbidden.status, 404);
    assert.equal(deleted.status, 200);
    assert.deepEqual(deletedData, { ok: true, deleted: true });
    assert.deepEqual(db.state.podcastLikes.map((row) => row.id), ['other-podcast']);
  });
});

describe('saved-content frontend regressions', () => {
  function installLocalStorage() {
    const store = new Map();
    const storage = {
      getItem: (key) => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
      clear: () => store.clear(),
      key: (index) => [...store.keys()][index] || null,
      get length() { return store.size; },
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: storage,
      configurable: true,
    });
    return storage;
  }

  it('keeps generic entity route construction for PlaylistLike and PodcastLike', async () => {
    const source = fs.readFileSync(new URL('../src/api/voxylApiClient.js', import.meta.url), 'utf8');
    assert.match(source, /replace\(\/\(\[a-z0-9\]\)\(\[A-Z\]\)\/g, "\$1-\$2"\)\.toLowerCase\(\)/);
    assert.match(source, /"PlaylistLike"/);
    assert.match(source, /"PodcastLike"/);
  });

  it('compares podcast feed URLs by canonical frontend form', () => {
    const records = [{ feed_url: 'https://example.com' }];
    assert.equal(normalizePodcastFeedUrl(' https://example.com#frag '), 'https://example.com/');
    assert.equal(normalizePodcastFeedUrl('ftp://example.com/feed.xml'), 'ftp://example.com/feed.xml');
    assert.equal(podcastFeedUrlSet(records).has(normalizePodcastFeedUrl('https://example.com/')), true);
  });

  it('applies playlist optimistic add, remove, and rollback state transitions', () => {
    const previous = [{ id: 'existing', playlist_id: 'one' }];
    const added = applyPlaylistLikeOptimistic(previous, 'two');
    const removed = applyPlaylistLikeOptimistic(added, 'two');

    assert.deepEqual(added.map((record) => record.playlist_id), ['two', 'one']);
    assert.deepEqual(removed.map((record) => record.playlist_id), ['one']);
    assert.deepEqual(previous.map((record) => record.playlist_id), ['one']);
  });

  it('reconciles optimistic playlist records with Worker liked state', () => {
    const previous = [{ id: 'existing', playlist_id: 'one' }];
    assert.deepEqual(reconcilePlaylistLikeRecords(previous, 'two', true).map((record) => record.playlist_id), ['two', 'one']);
    assert.deepEqual(reconcilePlaylistLikeRecords(previous, 'one', false), []);
  });

  it('loads accessible liked playlists when one saved playlist is now inaccessible', async () => {
    mock.method(voxylApi.entities.Playlist, 'get', async (id) => {
      if (id === 'missing') {
        const error = new Error('missing');
        error.status = 404;
        throw error;
      }
      return { id, name: id };
    });
    mock.method(console, 'warn', () => {});

    const playlists = await loadLikedPlaylistsForRecords([
      { playlist_id: 'valid-one' },
      { playlist_id: 'missing' },
      { playlist_id: 'valid-two' },
    ]);

    assert.deepEqual(playlists.map((playlist) => playlist.id), ['valid-one', 'valid-two']);
    assert.equal(console.warn.mock.calls.length, 1);
    assert.equal(console.warn.mock.calls[0].arguments[1].playlistId, 'missing');
  });

  it('rejects liked playlist metadata loading on non-404 item failures', async () => {
    mock.method(voxylApi.entities.Playlist, 'get', async (id) => {
      if (id === 'server-error') {
        const error = new Error('server error');
        error.status = 500;
        throw error;
      }
      return { id };
    });

    await assert.rejects(
      () => loadLikedPlaylistsForRecords([{ playlist_id: 'valid' }, { playlist_id: 'server-error' }]),
      /server error/,
    );
  });

  it('updates visible playlist like counts in cached arrays and item envelopes', () => {
    const list = updatePlaylistLikesCountInValue([{ id: 'playlist-1', likes_count: 1 }, { id: 'playlist-2', likes_count: 3 }], 'playlist-1', 9);
    const detail = updatePlaylistLikesCountInValue({ playlist: { id: 'playlist-1', likes_count: 1 } }, 'playlist-1', 4);

    assert.equal(list[0].likes_count, 9);
    assert.equal(list[1].likes_count, 3);
    assert.equal(detail.playlist.likes_count, 4);
  });

  it('clears saved-content custom cache before refetching canonical playlist likes', async () => {
    const storage = installLocalStorage();
    storage.setItem('voxyl_cache_liked-playlists-user-1', JSON.stringify({ data: ['stale'], expiresAt: Date.now() + 60_000 }));
    storage.setItem('saved_liked_playlists_user-1', JSON.stringify(['stale']));
    const calls = [];
    const queryClient = {
      refetchQueries(options) {
        calls.push(options);
        return Promise.resolve();
      },
    };

    await refreshPlaylistLikeQuery(queryClient, 'user-1');

    assert.equal(storage.getItem('voxyl_cache_liked-playlists-user-1'), null);
    assert.equal(storage.getItem('saved_liked_playlists_user-1'), null);
    assert.deepEqual(calls, [{ queryKey: savedContentQueryKeys.playlistLikes('user-1'), type: 'active' }]);
  });

  it('rolls back query-backed optimistic playlist toggle failures', async () => {
    const queryKey = savedContentQueryKeys.playlistLikes('user-1');
    const cache = new Map([[JSON.stringify(queryKey), [{ id: 'one', playlist_id: 'one' }]]]);
    const queryClient = {
      getQueryData(key) { return cache.get(JSON.stringify(key)); },
      setQueryData(key, value) { cache.set(JSON.stringify(key), typeof value === 'function' ? value(cache.get(JSON.stringify(key))) : value); },
      invalidateQueries() {},
    };

    await assert.rejects(
      () => togglePlaylistLikeOptimistically({
        queryClient,
        userId: 'user-1',
        playlistId: 'two',
        toggle: async () => { throw new Error('nope'); },
      }),
      /nope/,
    );

    assert.deepEqual(cache.get(JSON.stringify(queryKey)).map((record) => record.playlist_id), ['one']);
  });

  it('coalesces concurrent playlist toggles for the same user and playlist', async () => {
    const queryKey = savedContentQueryKeys.playlistLikes('user-1');
    const cache = new Map([[JSON.stringify(queryKey), []]]);
    const queryClient = {
      getQueryData(key) { return cache.get(JSON.stringify(key)); },
      setQueryData(key, value) { cache.set(JSON.stringify(key), typeof value === 'function' ? value(cache.get(JSON.stringify(key))) : value); },
      invalidateQueries() {},
      setQueriesData() {},
    };
    let toggleCalls = 0;
    let resolveToggle;
    const toggle = () => {
      toggleCalls += 1;
      return new Promise((resolve) => {
        resolveToggle = () => resolve({ data: { liked: true, likes_count: 1 } });
      });
    };

    const first = togglePlaylistLikeOptimistically({ queryClient, userId: 'user-1', playlistId: 'one', toggle });
    const second = togglePlaylistLikeOptimistically({ queryClient, userId: 'user-1', playlistId: 'one', toggle });
    assert.equal(first, second);
    assert.equal(toggleCalls, 1);
    resolveToggle();
    await Promise.all([first, second]);
    assert.equal(toggleCalls, 1);
  });

  it('keeps saved-content failures visible and mutation caches narrow', () => {
    const playlists = fs.readFileSync(new URL('../src/pages/Playlists.jsx', import.meta.url), 'utf8');
    const explore = fs.readFileSync(new URL('../src/pages/Explore.jsx', import.meta.url), 'utf8');
    const feed = fs.readFileSync(new URL('../src/pages/Feed.jsx', import.meta.url), 'utf8');
    const podcastDetail = fs.readFileSync(new URL('../src/pages/PodcastDetail.jsx', import.meta.url), 'utf8');
    const helper = fs.readFileSync(new URL('../src/lib/savedContentQueries.js', import.meta.url), 'utf8');

    assert.match(playlists, /isError: likedPlaylistsError/);
    assert.match(playlists, /isError: likedPodcastsError/);
    assert.match(playlists, /isError: likedPlaylistDataError/);
    assert.match(playlists, /console\.error\('\[Playlists\] Failed to load saved podcasts'/);
    assert.match(explore, /console\.error\('\[Explore\] Failed to load saved playlist likes'/);
    assert.match(feed, /togglePlaylistLikeOptimistically/);
    assert.match(podcastDetail, /normalizePodcastFeedUrl/);
    assert.match(helper, /savedContentQueryKeys\.playlistLikes/);
    assert.match(helper, /savedContentQueryKeys\.podcastLikes/);
    assert.match(helper, /queryClient\.invalidateQueries\(\{ queryKey: savedContentQueryKeys\.podcastLikes\(userId\) \}\)/);
    assert.match(helper, /voxylApi\.entities\.Playlist\.get\(id\)/);
    assert.match(playlists, /likedPlaylistsError &&\s*<div className="text-center py-8/s);
    assert.match(playlists, /myPlaylists\.length > 0/);
    assert.doesNotMatch(playlists, /Playlist\.filter\(\{ id \}/);
    assert.doesNotMatch(explore, /invalidateQueries\(\)/);
  });

  it('keeps pending playlist auto-like on a fresh Worker route read instead of cached like records', () => {
    const source = fs.readFileSync(new URL('../src/pages/PlaylistDetail.jsx', import.meta.url), 'utf8');
    const pendingBlock = source.slice(source.indexOf("if (pending === id)"), source.indexOf('// Auto-follow'));

    assert.match(pendingBlock, /voxylApi\.entities\.PlaylistLike\.filter\(\{ playlist_id: id \}, '-created_date', 1\)/);
    assert.doesNotMatch(pendingBlock, /loadPlaylistLikeRecords/);
  });
}
);
