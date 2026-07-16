import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { beforeEach, describe, it, mock } from 'node:test';
import worker from '../workers/api/src/index.ts';
import {
  activateProgressCacheScope,
  buildProgressCacheKey,
  getActiveProgressScope,
  getCachedProgress,
  getAllFinishedFromCache,
  getProgressPlaybackTransition,
  getProgressScopeDecision,
  loadProgressFromDB,
  mergeProgressRecords,
  resetProgressRuntimeState,
  saveProgressToDB,
  setCachedProgress,
  TTL_MS,
} from '../src/lib/episodeProgressCache.js';

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
  return { token: `${signedData}.${signature}`, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
}

function installJwksMock(jwk) {
  mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(String(url), `${issuer}/.well-known/jwks.json`);
    return Response.json({ keys: [jwk] });
  });
}

function request(path, { method = 'GET', payload, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') init.body = JSON.stringify(payload ?? {});
  return new Request(`https://api.voxyl.test${path}`, init);
}

async function json(response) {
  return response.json();
}

function createEpisodeProgressDb() {
  const freshTimestamp = freshIso();
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
        id: 'legacy-user',
        clerk_user_id: 'clerk-legacy',
        legacy_base44_user_id: 'legacy-real',
        email: 'legacy@example.com',
        name: 'Legacy User',
        username: 'legacy',
        role: 'user',
        profile_picture: null,
        profile_hidden: 0,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'empty-legacy-user',
        clerk_user_id: 'clerk-empty',
        legacy_base44_user_id: '   ',
        email: 'empty@example.com',
        name: 'Empty Legacy',
        username: 'empty',
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
    rows: [
      progressRow({ id: 'real-progress', user_id: 'd1-real-user', clerk_user_id: 'clerk-user-1', audio_url: 'https://cdn.example.com/one.mp3?sig=1', position_seconds: 42, finished: 0, last_played_at: freshTimestamp }),
      progressRow({ id: 'other-progress', user_id: 'other-user', clerk_user_id: 'clerk-other', audio_url: 'https://cdn.example.com/other.mp3', position_seconds: 9, finished: 1, last_played_at: freshTimestamp }),
      progressRow({ id: 'empty-legacy-row', user_id: 'import-empty', legacy_base44_user_id: '', audio_url: 'https://cdn.example.com/empty.mp3', position_seconds: 77, finished: 0, last_played_at: freshTimestamp }),
      progressRow({ id: 'legacy-row', user_id: 'import-legacy', legacy_base44_user_id: 'legacy-real', audio_url: 'https://cdn.example.com/legacy.mp3', position_seconds: 11, finished: 1, last_played_at: freshTimestamp }),
      progressRow({ id: 'completed-only', user_id: 'd1-real-user', clerk_user_id: 'clerk-user-1', audio_url: 'https://cdn.example.com/completed.mp3', position_seconds: 100, finished: 0, completed: 1, last_played_at: freshTimestamp }),
    ],
    calls: [],
    insertRaceRow: null,
    changeOwnerBeforeEpisodeUpdateId: null,
  };

  function publicRow(row) {
    return {
      id: row.id,
      feed_url: row.feed_url ?? null,
      podcast_title: row.podcast_title ?? null,
      episode_title: row.episode_title ?? null,
      audio_url: row.audio_url,
      position_seconds: row.position_seconds ?? 0,
      duration_seconds: row.duration_seconds ?? 0,
      completed: row.completed ?? 0,
      finished: row.finished ?? 0,
      last_played_at: row.last_played_at ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      base44_created_date: row.base44_created_date ?? null,
      base44_updated_date: row.base44_updated_date ?? null,
    };
  }

  function matchesIdentity(row, params, hasLegacy) {
    const [userId, clerkUserId] = params;
    const legacyUserId = hasLegacy ? params[2] : undefined;
    return row.user_id === userId ||
      row.clerk_user_id === clerkUserId ||
      (hasLegacy && legacyUserId && row.legacy_base44_user_id === legacyUserId);
  }

  function identityCount(sql) {
    return /legacy_base44_user_id = \?/s.test(sql) ? 3 : 2;
  }

  function timestampMs(value) {
    const parsed = Date.parse(String(value || '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function shouldApplyIncoming(row, values) {
    return timestampMs(values.last_played_at) >= timestampMs(row.last_played_at);
  }

  function mutateRow(row, values, { playbackOnlyIfCurrent = false } = {}) {
    const applyPlayback = !playbackOnlyIfCurrent || shouldApplyIncoming(row, values);
    row.user_id = values.user_id;
    row.clerk_user_id = values.clerk_user_id;
    row.legacy_base44_user_id = values.legacy_base44_user_id;
    if (values.audio_url !== undefined) row.audio_url = values.audio_url;
    if (applyPlayback) {
      row.feed_url = values.feed_url ?? row.feed_url ?? null;
      row.podcast_title = values.podcast_title ?? row.podcast_title ?? null;
      row.episode_title = values.episode_title ?? row.episode_title ?? null;
      row.position_seconds = values.position_seconds ?? row.position_seconds ?? 0;
      row.duration_seconds = values.duration_seconds ?? row.duration_seconds ?? 0;
      row.finished = values.finished;
      row.completed = values.completed;
      row.last_played_at = values.last_played_at ?? row.last_played_at ?? freshIso();
    }
    row.updated_at = '2026-07-16T00:00:00.000Z';
  }

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
              if (/SELECT id(?:,\s+last_played_at)?\s+FROM episode_progress/s.test(sql)) {
                const audioCount = (sql.match(/audio_url IN \(([^)]*)\)/)?.[1].match(/\?/g) || []).length;
                const audioUrls = params.slice(0, audioCount);
                const idParams = params.slice(audioCount);
                const hasLegacy = identityCount(sql) === 3;
                return state.rows.find((row) => audioUrls.includes(row.audio_url) && matchesIdentity(row, idParams, hasLegacy)) || null;
              }
              if (/FROM episode_progress\s+WHERE id = \?/s.test(sql)) {
                const hasLegacy = identityCount(sql) === 3;
                const row = state.rows.find((item) => item.id === params[0] && matchesIdentity(item, params.slice(1), hasLegacy));
                return row ? publicRow(row) : null;
              }
              if (/FROM episode_progress\s+WHERE user_id = \?/s.test(sql)) {
                const userId = params[0];
                const preferred = params.at(-1);
                const audioUrls = params.slice(1, -1);
                const rows = state.rows.filter((row) => row.user_id === userId && audioUrls.includes(row.audio_url));
                rows.sort((left, right) => (left.audio_url === preferred ? -1 : right.audio_url === preferred ? 1 : 0));
                return rows[0] ? publicRow(rows[0]) : null;
              }
              throw new Error(`Unhandled first SQL: ${sql}`);
            },
            async all() {
              state.calls.push({ kind: 'all', sql, params });
              if (/FROM episode_progress/s.test(sql)) {
                const idCount = identityCount(sql);
                const limit = params.at(-1);
                const audioCount = (sql.match(/audio_url IN \(([^)]*)\)/)?.[1].match(/\?/g) || []).length;
                const audioUrls = audioCount ? params.slice(idCount, idCount + audioCount) : [];
                const hasFinishedFilter = /COALESCE\(CAST\(finished AS INTEGER\), 0\)/s.test(sql);
                const wantsFinished = hasFinishedFilter && /COALESCE\(CAST\(completed AS INTEGER\), 0\) = 1/s.test(sql);
                const results = state.rows
                  .filter((row) => matchesIdentity(row, params.slice(0, idCount), idCount === 3))
                  .filter((row) => audioUrls.length === 0 || audioUrls.includes(row.audio_url))
                  .filter((row) => !hasFinishedFilter || (isFinishedRow(row) === wantsFinished))
                  .slice(0, limit)
                  .map(publicRow);
                return { results };
              }
              throw new Error(`Unhandled all SQL: ${sql}`);
            },
            async run() {
              state.calls.push({ kind: 'run', sql, params });
              if (/INSERT INTO users/s.test(sql)) return { meta: { changes: 0 } };
              if (/UPDATE users|UPDATE playlists|UPDATE playlist_likes|UPDATE podcast_likes|UPDATE podcast_plays/s.test(sql)) return { meta: { changes: 0 } };
              if (/UPDATE episode_progress\s+SET clerk_user_id/s.test(sql)) return { meta: { changes: 0 } };
              if (/UPDATE episode_progress\s+SET user_id = \?/s.test(sql)) {
                const updateHasPlayback = /position_seconds = \?/s.test(sql);
                const isPatchUpdate = /position_seconds = COALESCE/s.test(sql);
                const id = params[updateHasPlayback || isPatchUpdate ? 12 : 4];
                if (state.changeOwnerBeforeEpisodeUpdateId === id) {
                  const changing = state.rows.find((item) => item.id === id);
                  if (changing) {
                    changing.user_id = 'other-user';
                    changing.clerk_user_id = 'clerk-other';
                    changing.legacy_base44_user_id = null;
                  }
                  state.changeOwnerBeforeEpisodeUpdateId = null;
                }
                const identityStart = updateHasPlayback || isPatchUpdate ? 13 : 5;
                const hasLegacy = identityCount(sql) === 3;
                const row = state.rows.find((item) => item.id === id && matchesIdentity(item, params.slice(identityStart), hasLegacy));
                if (!row) return { meta: { changes: 0 } };
                if (updateHasPlayback) {
                  mutateRow(row, {
                    user_id: params[0],
                    clerk_user_id: params[1],
                    legacy_base44_user_id: params[2],
                    audio_url: params[3] ?? undefined,
                    feed_url: params[4],
                    podcast_title: params[5],
                    episode_title: params[6],
                    position_seconds: params[7],
                    duration_seconds: params[8],
                    finished: params[9],
                    completed: params[10],
                    last_played_at: params[11],
                  });
                } else if (isPatchUpdate) {
                  mutateRow(row, {
                    user_id: params[0],
                    clerk_user_id: params[1],
                    legacy_base44_user_id: params[2],
                    audio_url: params[3] ?? row.audio_url,
                    feed_url: params[4] ?? row.feed_url,
                    podcast_title: params[5] ?? row.podcast_title,
                    episode_title: params[6] ?? row.episode_title,
                    position_seconds: params[7] ?? row.position_seconds,
                    duration_seconds: params[8] ?? row.duration_seconds,
                    finished: params[9],
                    completed: params[10],
                    last_played_at: params[11] ?? row.last_played_at,
                  });
                } else {
                  mutateRow(row, {
                    user_id: params[0],
                    clerk_user_id: params[1],
                    legacy_base44_user_id: params[2],
                    audio_url: params[3] ?? undefined,
                  }, { playbackOnlyIfCurrent: true });
                }
                return { meta: { changes: 1 } };
              }
              if (/UPDATE episode_progress\s+       SET user_id = \?/s.test(sql)) {
                const id = params.at(-1);
                const row = state.rows.find((item) => item.id === id);
                if (!row) return { meta: { changes: 0 } };
                mutateRow(row, {
                  user_id: params[0],
                  clerk_user_id: params[1],
                  legacy_base44_user_id: params[2],
                  audio_url: params[3],
                  feed_url: params[4],
                  podcast_title: params[5],
                  episode_title: params[6],
                  position_seconds: params[7],
                  duration_seconds: params[8],
                  finished: params[9],
                  completed: params[10],
                  last_played_at: params[11],
                });
                return { meta: { changes: 1 } };
              }
              if (/INSERT INTO episode_progress/s.test(sql)) {
                if (state.insertRaceRow) {
                  state.rows.push(state.insertRaceRow);
                  state.insertRaceRow = null;
                }
                const [id, user_id, clerk_user_id, legacy_base44_user_id, audio_url, feed_url, podcast_title, episode_title, position_seconds, duration_seconds, finished, completed, last_played_at] = params;
                let row = state.rows.find((item) => item.user_id === user_id && item.audio_url === audio_url);
                const rowAlreadyExisted = Boolean(row);
                if (!row) {
                  row = progressRow({ id, user_id, audio_url, created_at: '2026-07-16T00:00:00.000Z' });
                  state.rows.push(row);
                }
                mutateRow(row, { user_id, clerk_user_id, legacy_base44_user_id, audio_url, feed_url, podcast_title, episode_title, position_seconds, duration_seconds, finished, completed, last_played_at }, { playbackOnlyIfCurrent: rowAlreadyExisted });
                return { meta: { changes: 1 } };
              }
              if (/DELETE FROM episode_progress/s.test(sql)) {
                const hasLegacy = identityCount(sql) === 3;
                const before = state.rows.length;
                state.rows = state.rows.filter((row) => !(row.id === params[0] && matchesIdentity(row, params.slice(1), hasLegacy)));
                return { meta: { changes: before - state.rows.length } };
              }
              throw new Error(`Unhandled run SQL: ${sql}`);
            },
          };
        },
      };
    },
  };
}

function progressRow(overrides) {
  return {
    id: overrides.id,
    user_id: overrides.user_id,
    clerk_user_id: overrides.clerk_user_id ?? null,
    legacy_base44_user_id: overrides.legacy_base44_user_id ?? null,
    feed_url: overrides.feed_url ?? null,
    podcast_title: overrides.podcast_title ?? null,
    episode_title: overrides.episode_title ?? null,
    audio_url: overrides.audio_url,
    position_seconds: overrides.position_seconds ?? 0,
    duration_seconds: overrides.duration_seconds ?? 0,
    completed: Object.hasOwn(overrides, 'completed') ? overrides.completed : overrides.finished ?? 0,
    finished: Object.hasOwn(overrides, 'finished') ? overrides.finished : overrides.completed ?? 0,
    last_played_at: overrides.last_played_at ?? freshIso(),
    created_at: overrides.created_at ?? freshIso(),
    updated_at: overrides.updated_at ?? freshIso(),
    base44_created_date: overrides.base44_created_date ?? null,
    base44_updated_date: overrides.base44_updated_date ?? null,
  };
}

function freshIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function expiredIso() {
  return freshIso(-(TTL_MS + 1000));
}

function progressEntry(overrides = {}) {
  return {
    position_seconds: overrides.position_seconds ?? 20,
    duration_seconds: overrides.duration_seconds ?? 100,
    finished: overrides.finished ?? false,
    completed: overrides.completed ?? 0,
    last_played_at: overrides.last_played_at ?? freshIso(),
  };
}

function isFinishedRow(row) {
  return row.finished === true || row.finished === 1 || row.finished === '1' ||
    row.completed === true || row.completed === 1 || row.completed === '1';
}

describe('EpisodeProgress Worker routes', () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  it('requires authentication on GET, POST, PATCH, and DELETE aliases', async () => {
    const db = createEpisodeProgressDb();
    for (const [path, method] of [
      ['/api/entities/episode-progress', 'GET'],
      ['/entities/episode-progress', 'POST'],
      ['/api/entities/episode-progress/real-progress', 'PATCH'],
      ['/entities/episode-progress/real-progress', 'DELETE'],
    ]) {
      const response = await worker.fetch(request(path, { method, payload: { audio_url: 'https://cdn.example.com/new.mp3', position_seconds: 1 } }), { ...baseEnv, DB: db });
      assert.equal(response.status, 401);
    }
  });

  it('reads only authenticated rows, ignores client user_id, supports aliases, and omits identity', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createEpisodeProgressDb();
    const response = await worker.fetch(request('/api/entities/episode-progress?user_id=other-user&limit=50', { token }), { ...baseEnv, DB: db });
    assert.equal(response.status, 200);
    const data = await json(response);
    assert.deepEqual(data.items.map((item) => item.id), ['real-progress', 'completed-only']);
    assert.equal(data.data[0].audio_url, 'https://cdn.example.com/one.mp3?sig=1');
    assert.equal(data.data[0].finished, false);
    assert.equal(data.data[1].finished, true);
    assert.equal('user_id' in data.data[0], false);

    const alias = await worker.fetch(request('/entities/episode-progress?audio_url=https%3A%2F%2Fcdn.example.com%2Fone.mp3%3Fsig%3D1', { token }), { ...baseEnv, DB: db });
    assert.equal(alias.status, 200);
    assert.equal((await json(alias)).items.length, 1);

    const finished = await worker.fetch(request('/api/entities/episode-progress?finished=true', { token }), { ...baseEnv, DB: db });
    assert.deepEqual((await json(finished)).items.map((item) => item.id), ['completed-only']);
  });

  it('matches non-empty legacy rows and never broadens access for empty legacy identities', async () => {
    const legacy = createJwt({ sub: 'clerk-legacy', email: 'legacy@example.com' });
    installJwksMock(legacy.jwk);
    const db = createEpisodeProgressDb();
    const legacyResponse = await worker.fetch(request('/api/entities/episode-progress', { token: legacy.token }), { ...baseEnv, DB: db });
    assert.deepEqual((await json(legacyResponse)).items.map((item) => item.id), ['legacy-row']);

    mock.restoreAll();
    const empty = createJwt({ sub: 'clerk-empty', email: 'empty@example.com' });
    installJwksMock(empty.jwk);
    const emptyResponse = await worker.fetch(request('/api/entities/episode-progress', { token: empty.token }), { ...baseEnv, DB: db });
    assert.deepEqual((await json(emptyResponse)).items, []);
  });

  it('creates, repeated-upserts, preserves signed URLs, and returns the persisted id after an upsert race', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createEpisodeProgressDb();
    const payload = {
      user_id: 'other-user',
      clerk_user_id: 'clerk-other',
      audio_url: ' https://cdn.example.com/new.mp3?sig=abc#frag ',
      position_seconds: 12.9,
      duration_seconds: 100,
      finished: 0,
      last_played_at: freshIso(),
      episode_title: 'New Episode',
    };
    const created = await worker.fetch(request('/api/entities/episode-progress', { method: 'POST', token, payload }), { ...baseEnv, DB: db });
    assert.equal(created.status, 200);
    const createdBody = await json(created);
    assert.equal(createdBody.data.audio_url, 'https://cdn.example.com/new.mp3?sig=abc');
    assert.equal(createdBody.data.position_seconds, 12);

    const updated = await worker.fetch(request('/entities/episode-progress', { method: 'POST', token, payload: { ...payload, position_seconds: 55, finished: true } }), { ...baseEnv, DB: db });
    const updatedBody = await json(updated);
    assert.equal(updatedBody.data.id, createdBody.data.id);
    assert.equal(updatedBody.data.finished, true);
    assert.equal(db.state.rows.filter((row) => row.user_id === 'd1-real-user' && row.audio_url === 'https://cdn.example.com/new.mp3?sig=abc').length, 1);

    db.state.insertRaceRow = progressRow({ id: 'race-winner', user_id: 'd1-real-user', clerk_user_id: 'clerk-user-1', audio_url: 'https://cdn.example.com/race.mp3' });
    const raced = await worker.fetch(request('/api/entities/episode-progress', { method: 'POST', token, payload: { audio_url: 'https://cdn.example.com/race.mp3', position_seconds: 1 } }), { ...baseEnv, DB: db });
    assert.equal((await json(raced)).data.id, 'race-winner');
  });

  it('validates URL, number, boolean, timestamp, and patch audio movement rules', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createEpisodeProgressDb();
    for (const payload of [
      { audio_url: 'ftp://cdn.example.com/a.mp3', position_seconds: 1 },
      { audio_url: 'https://cdn.example.com/a.mp3', position_seconds: -1 },
      { audio_url: 'https://cdn.example.com/a.mp3', position_seconds: 1, finished: 'yes' },
      { audio_url: 'https://cdn.example.com/a.mp3', position_seconds: 1, last_played_at: 'not-a-date' },
    ]) {
      const response = await worker.fetch(request('/api/entities/episode-progress', { method: 'POST', token, payload }), { ...baseEnv, DB: db });
      assert.equal(response.status, 400);
    }

    const moved = await worker.fetch(request('/api/entities/episode-progress/real-progress', { method: 'PATCH', token, payload: { audio_url: 'https://cdn.example.com/different.mp3' } }), { ...baseEnv, DB: db });
    assert.equal(moved.status, 400);
  });

  it('patches and deletes only owned rows, and keeps finished/completed synchronized', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createEpisodeProgressDb();
    const patched = await worker.fetch(request('/api/entities/episode-progress/real-progress', { method: 'PATCH', token, payload: { position_seconds: 88, finished: true, user_id: 'other-user' } }), { ...baseEnv, DB: db });
    assert.equal(patched.status, 200);
    assert.equal((await json(patched)).data.position_seconds, 88);
    const row = db.state.rows.find((item) => item.id === 'real-progress');
    assert.equal(row.user_id, 'd1-real-user');
    assert.equal(row.finished, 1);
    assert.equal(row.completed, 1);

    const otherPatch = await worker.fetch(request('/api/entities/episode-progress/other-progress', { method: 'PATCH', token, payload: { position_seconds: 99 } }), { ...baseEnv, DB: db });
    assert.equal(otherPatch.status, 404);
    const otherDelete = await worker.fetch(request('/entities/episode-progress/other-progress', { method: 'DELETE', token }), { ...baseEnv, DB: db });
    assert.equal(otherDelete.status, 404);
    const deleted = await worker.fetch(request('/entities/episode-progress/real-progress', { method: 'DELETE', token }), { ...baseEnv, DB: db });
    assert.equal(deleted.status, 200);
    assert.equal(db.state.rows.some((item) => item.id === 'real-progress'), false);
  });

  it('filters unfinished progress when finished and completed are zero or null', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createEpisodeProgressDb();
    db.state.rows.push(
      progressRow({ id: 'finished-zero-completed-null', user_id: 'd1-real-user', clerk_user_id: 'clerk-user-1', audio_url: 'https://cdn.example.com/f0-cn.mp3', finished: 0, completed: null }),
      progressRow({ id: 'finished-null-completed-zero', user_id: 'd1-real-user', clerk_user_id: 'clerk-user-1', audio_url: 'https://cdn.example.com/fn-c0.mp3', finished: null, completed: 0 }),
      progressRow({ id: 'finished-null-completed-null', user_id: 'd1-real-user', clerk_user_id: 'clerk-user-1', audio_url: 'https://cdn.example.com/fn-cn.mp3', finished: null, completed: null }),
    );

    const unfinished = await worker.fetch(request('/api/entities/episode-progress?finished=false&limit=50', { token }), { ...baseEnv, DB: db });
    assert.equal(unfinished.status, 200);
    const ids = (await json(unfinished)).items.map((item) => item.id);
    assert.ok(ids.includes('finished-zero-completed-null'));
    assert.ok(ids.includes('finished-null-completed-zero'));
    assert.ok(ids.includes('finished-null-completed-null'));
    assert.ok(!ids.includes('completed-only'));

    const finished = await worker.fetch(request('/api/entities/episode-progress?finished=true&limit=50', { token }), { ...baseEnv, DB: db });
    assert.deepEqual((await json(finished)).items.map((item) => item.id), ['completed-only']);
  });

  it('retains newer persisted progress when an older POST arrives later', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createEpisodeProgressDb();
    const newerTime = freshIso(2000);
    const olderTime = freshIso(1000);
    const audio_url = 'https://cdn.example.com/newest-wins.mp3';

    await worker.fetch(request('/api/entities/episode-progress', { method: 'POST', token, payload: { audio_url, position_seconds: 90, duration_seconds: 100, finished: true, last_played_at: newerTime } }), { ...baseEnv, DB: db });
    const older = await worker.fetch(request('/api/entities/episode-progress', { method: 'POST', token, payload: { audio_url, position_seconds: 12, duration_seconds: 100, finished: false, last_played_at: olderTime } }), { ...baseEnv, DB: db });
    const body = await json(older);

    assert.equal(body.data.position_seconds, 90);
    assert.equal(body.data.finished, true);
    assert.equal(body.data.last_played_at, newerTime);
  });

  it('retains newest progress for concurrent out-of-order saves', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createEpisodeProgressDb();
    const olderTime = freshIso(1000);
    const newerTime = freshIso(3000);
    const audio_url = 'https://cdn.example.com/concurrent.mp3';

    await Promise.all([
      worker.fetch(request('/api/entities/episode-progress', { method: 'POST', token, payload: { audio_url, position_seconds: 10, duration_seconds: 100, finished: false, last_played_at: olderTime } }), { ...baseEnv, DB: db }),
      worker.fetch(request('/api/entities/episode-progress', { method: 'POST', token, payload: { audio_url, position_seconds: 80, duration_seconds: 100, finished: true, last_played_at: newerTime } }), { ...baseEnv, DB: db }),
    ]);

    const row = db.state.rows.find((item) => item.user_id === 'd1-real-user' && item.audio_url === audio_url);
    assert.equal(row.position_seconds, 80);
    assert.equal(row.finished, 1);
    assert.equal(row.last_played_at, newerTime);
  });

  it('keeps legacy-row update owner-scoped at mutation time', async () => {
    const legacy = createJwt({ sub: 'clerk-legacy', email: 'legacy@example.com' });
    installJwksMock(legacy.jwk);
    const db = createEpisodeProgressDb();
    db.state.changeOwnerBeforeEpisodeUpdateId = 'legacy-row';

    const response = await worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token: legacy.token,
      payload: {
        audio_url: 'https://cdn.example.com/legacy.mp3',
        position_seconds: 99,
        duration_seconds: 100,
        finished: true,
        last_played_at: freshIso(5000),
      },
    }), { ...baseEnv, DB: db });
    const row = db.state.rows.find((item) => item.id === 'legacy-row');

    assert.equal(response.status, 404);
    assert.equal(row.user_id, 'other-user');
    assert.equal(row.position_seconds, 11);
  });
});

describe('EpisodeProgress frontend cache helpers', () => {
  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: (key) => { store.delete(key); },
      clear: () => { store.clear(); },
    };
    globalThis.window = { location: { hostname: 'localhost' } };
    resetProgressRuntimeState();
    activateProgressCacheScope(null, { migrateLegacy: false });
  });

  it('keeps unresolved auth provisional and does not consume legacy migration', () => {
    localStorage.setItem('voxyl_ep_progress', JSON.stringify({
      'https://cdn.example.com/legacy.mp3': progressEntry({ position_seconds: 20 }),
    }));
    const decision = getProgressScopeDecision({ apiUser: null, isAuthenticated: false, isLoadingAuth: true, authChecked: false });
    assert.deepEqual(decision, { status: 'loading', userId: null, migrateLegacy: false });
    activateProgressCacheScope(null, { migrateLegacy: false });
    assert.equal(localStorage.getItem('voxyl_ep_progress_legacy_migrated'), null);
    assert.equal(getCachedProgress('https://cdn.example.com/legacy.mp3'), null);
  });

  it('prioritizes unresolved auth over a stale apiUser', () => {
    const decision = getProgressScopeDecision({
      apiUser: { id: 'user-a' },
      isAuthenticated: true,
      isLoadingAuth: true,
      authChecked: true,
    });

    assert.deepEqual(decision, { status: 'loading', userId: null, migrateLegacy: false });
    assert.deepEqual(getProgressPlaybackTransition('user-a', decision), {
      nextScope: 'user-a',
      shouldClearPlayback: true,
      mergeCurrentCache: false,
      dbUserId: null,
    });
  });

  it('clears active playback for user A to user B and user A to logout transitions', () => {
    const toUserB = getProgressPlaybackTransition('user-a', getProgressScopeDecision({
      apiUser: { id: 'user-b' },
      isAuthenticated: true,
      isLoadingAuth: false,
      authChecked: true,
    }));
    assert.deepEqual(toUserB, {
      nextScope: 'user-b',
      shouldClearPlayback: true,
      mergeCurrentCache: false,
      dbUserId: 'user-b',
    });

    const toGuest = getProgressPlaybackTransition('user-a', getProgressScopeDecision({
      apiUser: null,
      isAuthenticated: false,
      isLoadingAuth: false,
      authChecked: true,
    }));
    assert.deepEqual(toGuest, {
      nextScope: 'guest',
      shouldClearPlayback: true,
      mergeCurrentCache: false,
      dbUserId: null,
    });
  });

  it('keeps Clerk provisional progress outside guest and reconciles it when D1 user resolves', () => {
    const provisional = getProgressScopeDecision({
      apiUser: null,
      clerkUser: { id: 'clerk-a' },
      isAuthenticated: true,
      isLoadingAuth: false,
      authChecked: true,
    });
    assert.deepEqual(provisional, { status: 'provisional', userId: 'clerk:clerk-a', migrateLegacy: false });

    activateProgressCacheScope(provisional.userId, { migrateLegacy: provisional.migrateLegacy });
    setCachedProgress('https://cdn.example.com/provisional.mp3', 31, 100, false);
    activateProgressCacheScope(null, { migrateLegacy: false });
    assert.equal(getCachedProgress('https://cdn.example.com/provisional.mp3'), null);

    activateProgressCacheScope(provisional.userId, { migrateLegacy: false });
    const confirmed = getProgressScopeDecision({
      apiUser: { id: 'user-a' },
      clerkUser: { id: 'clerk-a' },
      isAuthenticated: true,
      isLoadingAuth: false,
      authChecked: true,
    });
    const transition = getProgressPlaybackTransition(provisional.userId, confirmed);
    assert.deepEqual(transition, {
      nextScope: 'user-a',
      shouldClearPlayback: false,
      mergeCurrentCache: true,
      dbUserId: 'user-a',
    });

    activateProgressCacheScope(confirmed.userId, {
      migrateLegacy: confirmed.migrateLegacy,
      mergeCurrentCache: transition.mergeCurrentCache,
    });
    assert.equal(getCachedProgress('https://cdn.example.com/provisional.mp3').position_seconds, 31);
  });

  it('migrates legacy cache into confirmed guest only when guest is final', () => {
    localStorage.setItem('voxyl_ep_progress', JSON.stringify({
      'https://cdn.example.com/legacy-guest.mp3': progressEntry({ position_seconds: 21 }),
    }));
    const decision = getProgressScopeDecision({ apiUser: null, isAuthenticated: false, isLoadingAuth: false, authChecked: true });
    assert.deepEqual(decision, { status: 'confirmed', userId: null, migrateLegacy: true });
    activateProgressCacheScope(decision.userId, { migrateLegacy: decision.migrateLegacy });
    assert.equal(getCachedProgress('https://cdn.example.com/legacy-guest.mp3').position_seconds, 21);
    assert.equal(localStorage.getItem('voxyl_ep_progress_legacy_migrated'), 'guest');
  });

  it('migrates legacy cache into the authenticated user and not later accounts', () => {
    localStorage.setItem('voxyl_ep_progress', JSON.stringify({
      'https://cdn.example.com/legacy-user.mp3': progressEntry({ position_seconds: 22 }),
    }));
    assert.equal(buildProgressCacheKey('user-a'), 'voxyl_ep_progress_user-a');
    const decision = getProgressScopeDecision({ apiUser: { id: 'user-a' }, isAuthenticated: true, isLoadingAuth: false, authChecked: true });
    activateProgressCacheScope(decision.userId, { migrateLegacy: decision.migrateLegacy });
    assert.equal(getCachedProgress('https://cdn.example.com/legacy-user.mp3').position_seconds, 22);
    assert.equal(localStorage.getItem('voxyl_ep_progress_legacy_migrated'), 'user-a');
    activateProgressCacheScope('user-b');
    assert.equal(getCachedProgress('https://cdn.example.com/legacy-user.mp3'), null);
  });

  it('isolates user A to guest to user B scope transitions', () => {
    activateProgressCacheScope('user-a');
    setCachedProgress('https://cdn.example.com/a.mp3', 30, 100, false);
    assert.equal(getAllFinishedFromCache().size, 0);
    activateProgressCacheScope(null);
    setCachedProgress('https://cdn.example.com/guest.mp3', 11, 100, false);
    activateProgressCacheScope('user-b');
    assert.equal(getCachedProgress('https://cdn.example.com/a.mp3'), null);
    assert.equal(getCachedProgress('https://cdn.example.com/guest.mp3'), null);
    setCachedProgress('https://cdn.example.com/b.mp3', 12, 100, false);
    activateProgressCacheScope(null);
    assert.equal(getCachedProgress('https://cdn.example.com/guest.mp3').position_seconds, 11);
    assert.equal(getCachedProgress('https://cdn.example.com/b.mp3'), null);
    activateProgressCacheScope('user-a');
    assert.equal(getCachedProgress('https://cdn.example.com/a.mp3').position_seconds, 30);
    assert.equal(getCachedProgress('https://cdn.example.com/guest.mp3'), null);
  });

  it('merges newer local or remote records, ignores old records, and coerces D1 booleans', () => {
    activateProgressCacheScope('user-a');
    setCachedProgress('https://cdn.example.com/local.mp3', 40, 100, false);
    const local = getCachedProgress('https://cdn.example.com/local.mp3');
    mergeProgressRecords([
      { id: 'older', audio_url: 'https://cdn.example.com/local.mp3', position_seconds: 10, duration_seconds: 100, finished: 1, last_played_at: expiredIso() },
      { id: 'remote', audio_url: 'https://cdn.example.com/remote.mp3', position_seconds: 99, duration_seconds: 100, finished: 0, completed: 1, last_played_at: freshIso() },
      { id: 'expired', audio_url: 'https://cdn.example.com/old.mp3', position_seconds: 99, duration_seconds: 100, finished: 1, last_played_at: expiredIso() },
    ]);
    assert.equal(getCachedProgress('https://cdn.example.com/local.mp3').last_played_at, local.last_played_at);
    assert.equal(getCachedProgress('https://cdn.example.com/remote.mp3').finished, true);
    assert.equal(getCachedProgress('https://cdn.example.com/old.mp3'), null);
  });

  it('prevents stale remote responses from overwriting a new user scope', async () => {
    activateProgressCacheScope('user-a');
    const { version } = getActiveProgressScope();
    activateProgressCacheScope('user-b');
    mergeProgressRecords([{ id: 'stale', audio_url: 'https://cdn.example.com/stale.mp3', position_seconds: 1, last_played_at: freshIso() }], version);
    assert.equal(getCachedProgress('https://cdn.example.com/stale.mp3'), null);
  });

  it('omits user identity in save payloads, serializes concurrent saves, rejects mismatched user scope, and preserves local progress on API failure', async () => {
    activateProgressCacheScope('user-a');
    setCachedProgress('https://cdn.example.com/save.mp3', 10, 100, false);
    const payloads = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    const api = {
      entities: {
        EpisodeProgress: {
          async create(payload) {
            payloads.push(payload);
            if (payloads.length === 1) await firstGate;
            return { id: `row-${payloads.length}`, ...payload };
          },
        },
      },
    };
    const first = saveProgressToDB(api, 'user-a', 'https://cdn.example.com/save.mp3');
    setCachedProgress('https://cdn.example.com/save.mp3', 77, 100, false);
    const second = saveProgressToDB(api, 'user-a', 'https://cdn.example.com/save.mp3');
    releaseFirst();
    await Promise.all([first, second]);
    assert.equal(payloads.length, 2);
    assert.equal(payloads[0].user_id, undefined);
    assert.equal(payloads[1].position_seconds, 77);

    await saveProgressToDB(api, 'user-b', 'https://cdn.example.com/save.mp3');
    assert.equal(payloads.length, 2);

    const failingApi = { entities: { EpisodeProgress: { create: async () => { throw Object.assign(new Error('offline'), { status: 503 }); } } } };
    await saveProgressToDB(failingApi, 'user-a', 'https://cdn.example.com/save.mp3');
    assert.equal(getCachedProgress('https://cdn.example.com/save.mp3').position_seconds, 77);
    assert.deepEqual([...getAllFinishedFromCache()], []);
  });

  it('does not POST a queued save after the active user scope changes', async () => {
    activateProgressCacheScope('user-a');
    setCachedProgress('https://cdn.example.com/queued.mp3', 10, 100, false);
    const payloads = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    const api = {
      entities: {
        EpisodeProgress: {
          async create(payload) {
            payloads.push(payload);
            await firstGate;
            return { id: 'saved', ...payload };
          },
        },
      },
    };
    const first = saveProgressToDB(api, 'user-a', 'https://cdn.example.com/queued.mp3');
    const second = saveProgressToDB(api, 'user-a', 'https://cdn.example.com/queued.mp3');
    activateProgressCacheScope('user-b');
    releaseFirst();
    await Promise.all([first, second]);
    assert.equal(payloads.length, 0);
  });

  it('ignores a deferred remote load that resolves after switching users', async () => {
    activateProgressCacheScope('user-a');
    let releaseLoad;
    const deferred = new Promise((resolve) => { releaseLoad = resolve; });
    const api = {
      entities: {
        EpisodeProgress: {
          async filter() {
            await deferred;
            return [{ id: 'remote-a', audio_url: 'https://cdn.example.com/a-remote.mp3', position_seconds: 55, duration_seconds: 100, finished: 0, last_played_at: freshIso() }];
          },
        },
      },
    };
    const load = loadProgressFromDB(api, 'user-a');
    activateProgressCacheScope('user-b');
    releaseLoad();
    await load;
    assert.equal(getCachedProgress('https://cdn.example.com/a-remote.mp3'), null);
  });

  it('loads remote progress through the authenticated route without client user filters', async () => {
    activateProgressCacheScope('user-a');
    const calls = [];
    await loadProgressFromDB({
      entities: {
        EpisodeProgress: {
          filter: async (filters, sort, limit) => {
            calls.push({ filters, sort, limit });
            return [{ id: 'remote', audio_url: 'https://cdn.example.com/load.mp3', position_seconds: 44, duration_seconds: 100, finished: 0, last_played_at: freshIso() }];
          },
        },
      },
    }, 'user-a');
    assert.deepEqual(calls[0], { filters: {}, sort: '-last_played_at', limit: 500 });
    assert.equal(getCachedProgress('https://cdn.example.com/load.mp3').position_seconds, 44);
  });
});
