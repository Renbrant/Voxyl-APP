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
  getEpisodeResumeState,
  getProgressPlaybackTransition,
  getProgressScopeDecision,
  createProgressRegressionGuard,
  getProgressHydrationLifecycleDecision,
  createProgressHydrationController,
  getProgressHydrationRecoveryDecision,
  isAuthenticatedProgressSaveReady,
  shouldRefreshRequireResumeTransition,
  createWebResumeRequestGate,
  isCurrentWebResumeRequest,
  shouldBlockProgressSaveForGuard,
  loadProgressFromDB,
  mergeProgressRecords,
  resetProgressRuntimeState,
  saveProgressToDB,
  setCachedProgress,
  TTL_MS,
} from '../src/lib/episodeProgressCache.js';
import {
  beginWebEpisodeSourceSwitch,
  confirmWebResumeSeek,
  createWebPlaybackTransitionCoordinator,
  createWebResumeTransitionProtection,
  establishWebPlaybackTransition,
  getEstablishedWebPlaybackProgress,
  isObsoleteWebPlaybackError,
  requestGuardedWebPlayback,
} from '../src/lib/webPlaybackTransition.js';

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

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createFakeEventTarget(initialState = {}) {
  const listeners = new Map();
  return {
    ...initialState,
    addEventListener(type, listener) {
      const current = listeners.get(type) || new Set();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
    dispatch(type) {
      for (const listener of [...(listeners.get(type) || [])]) {
        listener();
      }
    },
  };
}

function createProgressControllerHarness(scope = 'user-a') {
  const windowTarget = createFakeEventTarget();
  const documentTarget = createFakeEventTarget({ visibilityState: 'visible' });
  const scopeRef = { current: scope };
  const controllerRef = { current: null };
  const hydrationRef = { current: { scope, promise: null, status: 'guest' } };
  const recoveryRef = { current: null };
  const dbUserRef = { current: { id: scope } };
  const loads = [];
  const timers = [];
  let loadCount = 0;
  let settledCount = 0;
  let hydratedCount = 0;
  let refreshedCount = 0;
  let refreshStartedCount = 0;
  let clearCount = 0;
  const setTimeoutFn = (callback, delay) => {
    const timer = { callback, delay, cleared: false };
    timers.push(timer);
    return timer;
  };
  const clearTimeoutFn = (timer) => {
    if (timer) {
      timer.cleared = true;
      clearCount += 1;
    }
  };
  const start = (nextScope = scopeRef.current) => {
    const deferred = createDeferred();
    loads.push(deferred);
    return createProgressHydrationController({
      scopeKey: nextScope,
      progressUser: { id: nextScope },
      controllerRef,
      hydrationRef,
      recoveryRef,
      scopeRef,
      dbUserRef,
      retryDelays: [5],
      loadProgress: () => {
        loadCount += 1;
        if (!loads[loadCount - 1]) {
          loads.push(createDeferred());
        }
        return loads[loadCount - 1].promise;
      },
      setTimeoutFn,
      clearTimeoutFn,
      windowTarget,
      documentTarget,
      onHydrated: () => {
        hydratedCount += 1;
      },
      onBeforeRefresh: () => ({ loadCountBeforeRefresh: loadCount }),
      onRefreshStarted: () => {
        refreshStartedCount += 1;
      },
      onRefreshed: () => {
        refreshedCount += 1;
      },
      onSettled: () => {
        settledCount += 1;
      },
    });
  };

  return {
    windowTarget,
    documentTarget,
    scopeRef,
    controllerRef,
    hydrationRef,
    recoveryRef,
    dbUserRef,
    loads,
    timers,
    start,
    get loadCount() { return loadCount; },
    get settledCount() { return settledCount; },
    get hydratedCount() { return hydratedCount; },
    get refreshedCount() { return refreshedCount; },
    get refreshStartedCount() { return refreshStartedCount; },
    get clearCount() { return clearCount; },
  };
}

async function json(response) {
  return response.json();
}

function createBarrier(count) {
  let waiting = 0;
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  return {
    async wait() {
      waiting += 1;
      if (waiting >= count) release();
      await ready;
    },
    get waiting() {
      return waiting;
    },
  };
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
    rejectUndefinedBinds: false,
    insertRaceRow: null,
    casUpdateBarrier: null,
    acceptedCasUpdates: 0,
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

  function normalizeRevision(value) {
    const parsed = timestampMs(value);
    return parsed ? new Date(parsed).toISOString() : null;
  }

  function nextRevision(row) {
    const previous = timestampMs(row.updated_at);
    const now = timestampMs('2026-07-16T00:00:00.000Z');
    return new Date(Math.max(now, previous + 1)).toISOString();
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
    row.updated_at = nextRevision(row);
  }

  return {
    state,
    prepare(sql) {
      return {
        bind(...params) {
          if (state.rejectUndefinedBinds && params.some((value) => value === undefined)) {
            throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported");
          }
          return {
            async first() {
              state.calls.push({ kind: 'first', sql, params });
              if (/FROM users\s+WHERE clerk_user_id = \?/s.test(sql)) {
                return state.users.find((user) => user.clerk_user_id === params[0]) || null;
              }
              if (/FROM users\s+WHERE lower\((?:TRIM\()?email/s.test(sql)) {
                return state.users.find((user) => user.email?.toLowerCase() === String(params[0]).toLowerCase()) || null;
              }
              if (/SELECT id(?:,\s+last_played_at)?(?:,\s+updated_at)?\s+FROM episode_progress/s.test(sql)) {
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
              if (/FROM users\s+WHERE lower\((?:TRIM\()?email/s.test(sql)) {
                return { results: state.users.filter((user) => user.email?.toLowerCase() === String(params[0]).toLowerCase()) };
              }
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
              if (/UPDATE users\s+SET clerk_user_id/s.test(sql)) return { meta: { changes: 1 } };
              if (/UPDATE users|UPDATE playlists|UPDATE playlist_likes|UPDATE podcast_likes|UPDATE podcast_plays|UPDATE follows|UPDATE blocks|UPDATE reports|UPDATE referrals/s.test(sql)) return { meta: { changes: 0 } };
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
                if (updateHasPlayback && state.casUpdateBarrier) {
                  await state.casUpdateBarrier.wait();
                }
                const row = state.rows.find((item) => item.id === id && matchesIdentity(item, params.slice(identityStart), hasLegacy));
                if (!row) return { meta: { changes: 0 } };
                if (/strftime\('%Y-%m-%dT%H:%M:%fZ',\s*updated_at\) = \?/s.test(sql)) {
                  const expectedRevision = params.at(-1);
                  if (normalizeRevision(row.updated_at) !== normalizeRevision(expectedRevision)) {
                    return { meta: { changes: 0 } };
                  }
                  state.acceptedCasUpdates += 1;
                }
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
                if (params.at(-2) !== null && /strftime\('%Y-%m-%dT%H:%M:%fZ',\s*episode_progress\.updated_at\) = \?/s.test(sql)) {
                  const expectedRevision = params.at(-1);
                  if (rowAlreadyExisted && normalizeRevision(row.updated_at) !== normalizeRevision(expectedRevision)) {
                    return { meta: { changes: 0 } };
                  }
                }
                mutateRow(row, { user_id, clerk_user_id, legacy_base44_user_id, audio_url, feed_url, podcast_title, episode_title, position_seconds, duration_seconds, finished, completed, last_played_at });
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFakeSeekAudio({
  initialTime = 0,
  ignoreSeekBeforeMetadata = true,
  reportAssignedWhileSeeking = false,
  markSeekingOnAssign = false,
  throwOnAssignments = [],
} = {}) {
  const listeners = new Map();
  let current = initialTime;
  let seekableRanges = [];
  let assignmentCount = 0;
  const audio = {
    src: '',
    currentSrc: '',
    readyState: 0,
    duration: Number.NaN,
    networkState: 1,
    seeking: false,
    seekAssignments: [],
    seekable: {
      length: 0,
      start(index) { return seekableRanges[index]?.[0] ?? 0; },
      end(index) { return seekableRanges[index]?.[1] ?? audio.duration; },
    },
    get currentTime() {
      return current;
    },
    set currentTime(value) {
      assignmentCount += 1;
      this.seekAssignments.push(value);
      const errorName = throwOnAssignments[assignmentCount - 1];
      if (errorName) {
        const error = new Error(`${errorName} setting currentTime`);
        error.name = errorName;
        throw error;
      }
      if (markSeekingOnAssign) this.seeking = true;
      if (reportAssignedWhileSeeking || !ignoreSeekBeforeMetadata || this.readyState >= 1) {
        current = value;
      }
    },
    load() {
      this.currentSrc = this.src;
    },
    addEventListener(type, listener) {
      const currentListeners = listeners.get(type) || new Set();
      currentListeners.add(listener);
      listeners.set(type, currentListeners);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
    dispatch(type) {
      for (const listener of [...(listeners.get(type) || [])]) {
        listener();
      }
    },
    setSeekableRanges(ranges, duration = 140) {
      seekableRanges = ranges;
      this.readyState = 1;
      this.duration = duration;
      this.seekable = {
        get length() { return seekableRanges.length; },
        start(index) { return seekableRanges[index][0]; },
        end(index) { return seekableRanges[index][1]; },
      };
    },
    makeSeekable(duration = 140) {
      this.setSeekableRanges([[0, duration]], duration);
    },
    completeSeek(position = current) {
      current = position;
      this.seeking = false;
      this.dispatch('seeked');
    },
    async play() {},
  };
  return audio;
}

const WEB_RESUME_SEEK_EVENTS = [
  'loadedmetadata',
  'durationchange',
  'canplay',
  'canplaythrough',
  'progress',
  'seeked',
  'timeupdate',
];

function countWebResumeSeekListeners(audio) {
  return WEB_RESUME_SEEK_EVENTS.reduce((count, type) => count + audio.listenerCount(type), 0);
}

async function runConfirmedWebPlayback({ coordinator, audio, transition, resumeAt, guardState }) {
  await establishWebPlaybackTransition({
    audio,
    coordinator,
    transition,
    transitionLabel: 'test-play',
    resumeAt,
    retryDelays: [0],
    waitForMediaReady: () => Promise.resolve(),
    logger: { log() {}, warn() {} },
  });
  if (guardState.guard?.transitionGeneration === transition.generation) {
    guardState.guard = null;
  }
  guardState.timersStarted = true;
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

  it('never binds undefined for minimal EpisodeProgress create, update, patch, or CAS writes', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createEpisodeProgressDb();
    db.state.rejectUndefinedBinds = true;
    const audio_url = 'https://traffic.omny.fm/example/audio.mp3?token=abc';

    const created = await worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token,
      payload: {
        audio_url,
        position_seconds: 0,
        duration_seconds: 0,
        finished: false,
        last_played_at: '2026-07-17T17:28:40.964Z',
      },
    }), { ...baseEnv, DB: db });
    const createdBody = await json(created);

    assert.equal(created.status, 200);
    assert.equal(createdBody.data.position_seconds, 0);
    assert.equal(createdBody.data.duration_seconds, 0);
    assert.equal(createdBody.data.finished, false);
    assert.equal(createdBody.data.feed_url, null);
    assert.equal(createdBody.data.podcast_title, null);
    assert.equal(createdBody.data.episode_title, null);

    const row = db.state.rows.find((item) => item.user_id === 'd1-real-user' && item.audio_url === audio_url);
    row.feed_url = 'https://feeds.example.com/show.xml';
    row.podcast_title = 'Existing Show';
    row.episode_title = 'Existing Episode';
    const originalRevision = row.updated_at;

    const updated = await worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token,
      payload: {
        audio_url,
        position_seconds: 29,
        duration_seconds: 309,
        finished: false,
        last_played_at: '2026-07-17T17:29:40.964Z',
        base_server_updated_at: originalRevision,
      },
    }), { ...baseEnv, DB: db });
    const updatedBody = await json(updated);

    assert.equal(updated.status, 200);
    assert.equal(updatedBody.data.position_seconds, 29);
    assert.equal(updatedBody.data.feed_url, 'https://feeds.example.com/show.xml');
    assert.equal(updatedBody.data.podcast_title, 'Existing Show');
    assert.equal(updatedBody.data.episode_title, 'Existing Episode');
    assert.notEqual(updatedBody.data.server_updated_at, originalRevision);

    const patched = await worker.fetch(request(`/api/entities/episode-progress/${row.id}`, {
      method: 'PATCH',
      token,
      payload: {
        position_seconds: 0,
        duration_seconds: 0,
        finished: false,
      },
    }), { ...baseEnv, DB: db });
    const patchedBody = await json(patched);

    assert.equal(patched.status, 200);
    assert.equal(patchedBody.data.position_seconds, 0);
    assert.equal(patchedBody.data.duration_seconds, 0);
    assert.equal(patchedBody.data.finished, false);
    assert.equal(patchedBody.data.feed_url, 'https://feeds.example.com/show.xml');
    assert.equal(patchedBody.data.podcast_title, 'Existing Show');
    assert.equal(patchedBody.data.episode_title, 'Existing Episode');

    const episodeProgressBinds = db.state.calls
      .filter((call) => /episode_progress/s.test(call.sql))
      .flatMap((call) => call.params);
    assert.ok(episodeProgressBinds.length > 0);
    assert.equal(episodeProgressBinds.some((value) => value === undefined), false);
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

  it('rejects stale base revisions even when a delayed device clock is newer', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createEpisodeProgressDb();
    const audio_url = 'https://cdn.example.com/base-revision.mp3';
    const initialTime = freshIso(1000);
    const staleBase = '2026-07-15T00:00:00.000Z';
    const fastClockTime = freshIso(60_000);

    const initial = await worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token,
      payload: { audio_url, position_seconds: 90, duration_seconds: 100, finished: true, last_played_at: initialTime },
    }), { ...baseEnv, DB: db });
    const initialBody = await json(initial);

    const stale = await worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token,
      payload: {
        audio_url,
        position_seconds: 12,
        duration_seconds: 100,
        finished: false,
        last_played_at: fastClockTime,
        base_server_updated_at: staleBase,
      },
    }), { ...baseEnv, DB: db });
    const body = await json(stale);

    assert.equal(body.data.position_seconds, 90);
    assert.equal(body.data.finished, true);
    assert.equal(body.data.last_played_at, initialTime);
    assert.equal(body.data.server_updated_at, initialBody.data.server_updated_at);
  });

  it('uses atomic compare-and-swap for concurrent authenticated revision writes', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createEpisodeProgressDb();
    const audio_url = 'https://cdn.example.com/cas-race.mp3';

    const initial = await worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token,
      payload: {
        audio_url,
        position_seconds: 60,
        duration_seconds: 300,
        finished: false,
        last_played_at: freshIso(1000),
      },
    }), { ...baseEnv, DB: db });
    const initialBody = await json(initial);
    const base = initialBody.data.server_updated_at;
    const barrier = createBarrier(2);
    db.state.casUpdateBarrier = barrier;

    const requestA = worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token,
      payload: {
        audio_url,
        position_seconds: 120,
        duration_seconds: 300,
        finished: false,
        last_played_at: freshIso(2000),
        base_server_updated_at: base,
      },
    }), { ...baseEnv, DB: db });
    const requestB = worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token,
      payload: {
        audio_url,
        position_seconds: 180,
        duration_seconds: 300,
        finished: false,
        last_played_at: freshIso(3000),
        base_server_updated_at: base,
      },
    }), { ...baseEnv, DB: db });

    while (barrier.waiting < 2) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const [responseA, responseB] = await Promise.all([requestA, requestB]);
    const [bodyA, bodyB] = await Promise.all([json(responseA), json(responseB)]);
    const row = db.state.rows.find((item) => item.user_id === 'd1-real-user' && item.audio_url === audio_url);

    assert.equal(db.state.acceptedCasUpdates, 1);
    assert.ok([120, 180].includes(row.position_seconds));
    assert.equal(bodyA.data.position_seconds, row.position_seconds);
    assert.equal(bodyB.data.position_seconds, row.position_seconds);
    assert.equal(bodyA.data.server_updated_at, row.updated_at);
    assert.equal(bodyB.data.server_updated_at, row.updated_at);
    assert.notEqual(row.updated_at, base);
    const winnerRevision = row.updated_at;

    db.state.casUpdateBarrier = null;
    const loserNext = await worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token,
      payload: {
        audio_url,
        position_seconds: 240,
        duration_seconds: 300,
        finished: false,
        last_played_at: freshIso(4000),
        base_server_updated_at: bodyA.data.server_updated_at,
      },
    }), { ...baseEnv, DB: db });
    const loserNextBody = await json(loserNext);

    assert.equal(loserNextBody.data.position_seconds, 240);
    assert.notEqual(loserNextBody.data.server_updated_at, winnerRevision);
  });

  it('rejects forged future base revisions and keeps the canonical row', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createEpisodeProgressDb();
    const audio_url = 'https://cdn.example.com/future-base.mp3';

    const initial = await worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token,
      payload: {
        audio_url,
        position_seconds: 70,
        duration_seconds: 300,
        finished: false,
        last_played_at: freshIso(1000),
      },
    }), { ...baseEnv, DB: db });
    const initialBody = await json(initial);

    const forged = await worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token,
      payload: {
        audio_url,
        position_seconds: 10,
        duration_seconds: 300,
        finished: false,
        last_played_at: freshIso(60_000),
        base_server_updated_at: '2999-01-01T00:00:00.000Z',
      },
    }), { ...baseEnv, DB: db });
    const forgedBody = await json(forged);

    assert.equal(forgedBody.data.position_seconds, 70);
    assert.equal(forgedBody.data.server_updated_at, initialBody.data.server_updated_at);
  });

  it('gives rapid accepted revision writes distinct server revisions', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createEpisodeProgressDb();
    const audio_url = 'https://cdn.example.com/rapid-revisions.mp3';

    const first = await worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token,
      payload: {
        audio_url,
        position_seconds: 20,
        duration_seconds: 300,
        finished: false,
        last_played_at: freshIso(1000),
      },
    }), { ...baseEnv, DB: db });
    const firstBody = await json(first);
    const second = await worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token,
      payload: {
        audio_url,
        position_seconds: 30,
        duration_seconds: 300,
        finished: false,
        last_played_at: freshIso(2000),
        base_server_updated_at: firstBody.data.server_updated_at,
      },
    }), { ...baseEnv, DB: db });
    const secondBody = await json(second);
    const third = await worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token,
      payload: {
        audio_url,
        position_seconds: 40,
        duration_seconds: 300,
        finished: false,
        last_played_at: freshIso(3000),
        base_server_updated_at: secondBody.data.server_updated_at,
      },
    }), { ...baseEnv, DB: db });
    const thirdBody = await json(third);

    assert.notEqual(secondBody.data.server_updated_at, firstBody.data.server_updated_at);
    assert.notEqual(thirdBody.data.server_updated_at, secondBody.data.server_updated_at);
    assert.equal(thirdBody.data.position_seconds, 40);
  });

  it('orders concurrent first saves by server arrival instead of client clock skew', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createEpisodeProgressDb();
    const audio_url = 'https://cdn.example.com/first-save-order.mp3';

    const futureClock = await worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token,
      payload: {
        audio_url,
        position_seconds: 300,
        duration_seconds: 600,
        finished: false,
        last_played_at: '2999-01-01T00:00:00.000Z',
      },
    }), { ...baseEnv, DB: db });
    await json(futureClock);

    const laterServerArrival = await worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token,
      payload: {
        audio_url,
        position_seconds: 30,
        duration_seconds: 600,
        finished: false,
        last_played_at: '2026-07-17T00:00:00.000Z',
      },
    }), { ...baseEnv, DB: {
      ...db,
      prepare(sql) {
        if (/SELECT id, last_played_at, updated_at\s+FROM episode_progress/s.test(sql)) {
          return {
            bind() {
              return {
                async first() {
                  return null;
                },
              };
            },
          };
        }
        return db.prepare(sql);
      },
    } });
    const body = await json(laterServerArrival);

    assert.equal(body.data.position_seconds, 30);
    assert.equal(body.data.last_played_at, '2026-07-17T00:00:00.000Z');
    const row = db.state.rows.find((item) => item.user_id === 'd1-real-user' && item.audio_url === audio_url);
    assert.equal(row.position_seconds, 30);
  });

  it('retains newest progress for concurrent out-of-order saves', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createEpisodeProgressDb();
    const olderTime = freshIso(1000);
    const newerTime = freshIso(3000);
    const audio_url = 'https://cdn.example.com/concurrent.mp3';
    await worker.fetch(request('/api/entities/episode-progress', {
      method: 'POST',
      token,
      payload: { audio_url, position_seconds: 1, duration_seconds: 100, finished: false, last_played_at: freshIso(500) },
    }), { ...baseEnv, DB: db });

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

  function installDeviceStorage(store) {
    globalThis.localStorage = {
      getItem: (key) => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: (key) => { store.delete(key); },
      clear: () => { store.clear(); },
    };
  }

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

  it('restarts same-scope hydration when a cancelled controller left the scope hydrating', () => {
    const scope = 'user-a';
    const userId = 'user-a';
    const hydrating = { scope, promise: Promise.resolve(), status: 'hydrating' };
    const cancelledController = { scope, userId, cancelled: true };

    assert.deepEqual(getProgressHydrationLifecycleDecision({
      currentScope: null,
      nextScope: scope,
      userId,
      hydration: { scope: null, promise: null, status: 'guest' },
      controller: null,
    }), { action: 'start', reason: 'scope-changed' });

    assert.deepEqual(getProgressHydrationLifecycleDecision({
      currentScope: scope,
      nextScope: scope,
      userId,
      hydration: hydrating,
      controller: cancelledController,
    }), { action: 'start', reason: 'same-scope-without-controller' });

    assert.equal(isAuthenticatedProgressSaveReady(userId, hydrating, scope, cancelledController), false);

    const ready = { scope, promise: null, status: 'ready' };
    assert.deepEqual(getProgressHydrationLifecycleDecision({
      currentScope: scope,
      nextScope: scope,
      userId,
      hydration: ready,
      controller: null,
    }), { action: 'start', reason: 'same-scope-without-controller' });
    assert.equal(isAuthenticatedProgressSaveReady(userId, ready, scope, null), false);
    assert.equal(isAuthenticatedProgressSaveReady(userId, ready, scope, { scope, userId, cancelled: false }), true);
  });

  it('preserves one active hydration request across same-scope rerenders and ignores old scopes', () => {
    const activeController = { scope: 'user-a', userId: 'user-a', cancelled: false };
    assert.deepEqual(getProgressHydrationLifecycleDecision({
      currentScope: 'user-a',
      nextScope: 'user-a',
      userId: 'user-a',
      hydration: { scope: 'user-a', promise: Promise.resolve(), status: 'hydrating' },
      controller: activeController,
    }), { action: 'preserve', reason: 'active-controller' });

    assert.deepEqual(getProgressHydrationLifecycleDecision({
      currentScope: 'user-a',
      nextScope: 'user-b',
      userId: 'user-b',
      hydration: { scope: 'user-a', promise: Promise.resolve(), status: 'hydrating' },
      controller: activeController,
    }), { action: 'start', reason: 'scope-changed' });

    assert.equal(isAuthenticatedProgressSaveReady(
      'user-b',
      { scope: 'user-a', promise: null, status: 'ready' },
      'user-b',
      activeController
    ), false);

    assert.deepEqual(getProgressHydrationLifecycleDecision({
      currentScope: 'guest',
      nextScope: 'guest',
      userId: null,
      hydration: { scope: 'guest', promise: null, status: 'guest' },
      controller: null,
    }), { action: 'guest' });
  });

  it('preserves the current controller across same-scope effect rerenders', async () => {
    const harness = createProgressControllerHarness('user-a');
    const controllerA = harness.start();
    await Promise.resolve();

    assert.equal(harness.loadCount, 1);
    assert.equal(harness.windowTarget.listenerCount('online'), 1);
    assert.equal(harness.documentTarget.listenerCount('visibilitychange'), 1);

    const lifecycle = getProgressHydrationLifecycleDecision({
      currentScope: harness.scopeRef.current,
      nextScope: 'user-a',
      userId: 'user-a',
      hydration: harness.hydrationRef.current,
      controller: harness.controllerRef.current,
    });
    assert.deepEqual(lifecycle, { action: 'preserve', reason: 'active-controller' });

    if (lifecycle.action === 'start') harness.start('user-a');
    assert.equal(harness.controllerRef.current, controllerA);
    assert.equal(controllerA.cancelled, false);
    assert.equal(harness.loadCount, 1);
    assert.equal(harness.windowTarget.listenerCount('online'), 1);
    assert.equal(harness.documentTarget.listenerCount('visibilitychange'), 1);

    harness.loads[0].resolve([]);
    await harness.hydrationRef.current.promise;
    assert.equal(harness.hydrationRef.current.status, 'ready');
    assert.equal(isAuthenticatedProgressSaveReady(
      'user-a',
      harness.hydrationRef.current,
      'user-a',
      harness.controllerRef.current
    ), true);
  });

  it('refreshes ready authenticated hydration on window focus', async () => {
    const harness = createProgressControllerHarness('user-a');
    const controller = harness.start();
    await Promise.resolve();
    harness.loads[0].resolve([]);
    await harness.hydrationRef.current.promise;
    assert.equal(harness.hydrationRef.current.status, 'ready');

    harness.windowTarget.dispatch('focus');
    assert.equal(harness.loadCount, 1);
    assert.equal(harness.timers.length, 1);
    harness.timers[0].callback();
    await Promise.resolve();
    assert.equal(harness.loadCount, 2);
    harness.loads[1].resolve([]);
    await controller.refreshPromise;

    assert.equal(harness.refreshStartedCount, 1);
    assert.equal(harness.refreshedCount, 1);
    assert.equal(harness.hydratedCount, 1);
    assert.equal(harness.hydrationRef.current.status, 'ready');
  });

  it('keeps ready refresh callbacks separate from initial hydration callbacks', async () => {
    const harness = createProgressControllerHarness('user-a');
    const controller = harness.start();
    await Promise.resolve();
    harness.loads[0].resolve([]);
    await harness.hydrationRef.current.promise;
    assert.equal(harness.hydratedCount, 1);

    const refresh = controller.requestRefresh('focus', { immediate: true });
    await Promise.resolve();
    harness.loads[1].resolve([]);
    await refresh;

    assert.equal(harness.refreshedCount, 1);
    assert.equal(harness.hydratedCount, 1);
  });

  it('refreshes ready authenticated hydration when visibility becomes visible', async () => {
    const harness = createProgressControllerHarness('user-a');
    const controller = harness.start();
    await Promise.resolve();
    harness.loads[0].resolve([]);
    await harness.hydrationRef.current.promise;

    harness.documentTarget.visibilityState = 'hidden';
    harness.documentTarget.dispatch('visibilitychange');
    assert.equal(harness.loadCount, 1);

    harness.documentTarget.visibilityState = 'visible';
    harness.documentTarget.dispatch('visibilitychange');
    assert.equal(harness.timers.length, 1);
    harness.timers[0].callback();
    await Promise.resolve();
    assert.equal(harness.loadCount, 2);
    harness.loads[1].resolve([]);
    await controller.refreshPromise;

    assert.equal(harness.refreshedCount, 1);
  });

  it('coalesces focus and visible refresh triggers into one request', async () => {
    const harness = createProgressControllerHarness('user-a');
    const controller = harness.start();
    await Promise.resolve();
    harness.loads[0].resolve([]);
    await harness.hydrationRef.current.promise;

    harness.windowTarget.dispatch('focus');
    harness.documentTarget.dispatch('visibilitychange');
    assert.equal(harness.timers.length, 1);
    harness.timers[0].callback();
    await Promise.resolve();
    assert.equal(harness.loadCount, 2);
    harness.loads[1].resolve([]);
    await controller.refreshPromise;

    assert.equal(harness.refreshStartedCount, 1);
    assert.equal(harness.refreshedCount, 1);
  });

  it('keeps failed hydration recovery behavior distinct from ready refresh', async () => {
    const harness = createProgressControllerHarness('user-a');
    const controller = harness.start();
    await Promise.resolve();
    harness.loads[0].reject(new Error('initial outage'));
    await harness.hydrationRef.current.promise;
    assert.equal(harness.hydrationRef.current.status, 'failed');

    controller.requestRefresh('focus', { immediate: true });
    assert.equal(harness.loadCount, 1);

    controller.requestRecovery('progress-save');
    assert.equal(harness.loadCount, 1);
    harness.timers[0].callback();
    await Promise.resolve();
    assert.equal(harness.loadCount, 2);
    harness.loads[1].resolve([]);
    await harness.hydrationRef.current.promise;
    assert.equal(harness.hydrationRef.current.status, 'ready');
  });

  it('ignores refresh results after scope or identity changes and removes listeners on cleanup', async () => {
    const harness = createProgressControllerHarness('user-a');
    const controller = harness.start();
    await Promise.resolve();
    harness.loads[0].resolve([]);
    await harness.hydrationRef.current.promise;

    const refresh = controller.requestRefresh('focus', { immediate: true });
    await Promise.resolve();
    assert.equal(harness.loadCount, 2);
    harness.scopeRef.current = 'user-b';
    harness.dbUserRef.current = { id: 'user-b' };
    harness.loads[1].resolve([]);
    await refresh;

    assert.equal(harness.refreshedCount, 0);
    controller.cleanup();
    assert.equal(harness.windowTarget.listenerCount('online'), 0);
    assert.equal(harness.windowTarget.listenerCount('focus'), 0);
    assert.equal(harness.documentTarget.listenerCount('visibilitychange'), 0);
  });

  it('starts a replacement on the same scope only when the controller is genuinely invalid', async () => {
    const harness = createProgressControllerHarness('user-a');
    const controllerA = harness.start();
    await Promise.resolve();
    const promiseA = harness.hydrationRef.current.promise;

    controllerA.cleanup();
    assert.equal(controllerA.cancelled, true);
    assert.equal(harness.controllerRef.current, null);
    assert.equal(harness.recoveryRef.current, null);

    const lifecycle = getProgressHydrationLifecycleDecision({
      currentScope: harness.scopeRef.current,
      nextScope: 'user-a',
      userId: 'user-a',
      hydration: harness.hydrationRef.current,
      controller: harness.controllerRef.current,
    });
    assert.deepEqual(lifecycle, { action: 'start', reason: 'same-scope-without-controller' });

    const controllerB = harness.start('user-a');
    await Promise.resolve();
    assert.notEqual(controllerB, controllerA);
    assert.equal(harness.controllerRef.current, controllerB);
    assert.equal(harness.recoveryRef.current, controllerB.requestRecovery);
    assert.equal(harness.loadCount, 2);

    controllerA.cleanup();
    assert.equal(harness.controllerRef.current, controllerB);
    assert.equal(harness.recoveryRef.current, controllerB.requestRecovery);
    assert.equal(harness.hydrationRef.current.status, 'hydrating');

    harness.loads[0].resolve([]);
    await promiseA;
    assert.equal(harness.hydrationRef.current.status, 'hydrating');

    harness.loads[1].resolve([]);
    await harness.hydrationRef.current.promise;
    assert.equal(harness.hydrationRef.current.status, 'ready');
    assert.equal(harness.controllerRef.current, controllerB);
  });

  it('cleans the current controller only from the provider unmount cleanup', async () => {
    const harness = createProgressControllerHarness('user-a');
    const controller = harness.start();
    await Promise.resolve();
    const promise = harness.hydrationRef.current.promise;
    controller.retryTimer = { cleared: false };

    const cleanupOnUnmount = () => {
      harness.controllerRef.current?.cleanup?.();
    };
    cleanupOnUnmount();

    assert.equal(controller.cancelled, true);
    assert.equal(controller.retryTimer.cleared, true);
    assert.equal(harness.controllerRef.current, null);
    assert.equal(harness.recoveryRef.current, null);
    assert.equal(harness.windowTarget.listenerCount('online'), 0);
    assert.equal(harness.documentTarget.listenerCount('visibilitychange'), 0);
    assert.equal(harness.clearCount, 1);

    harness.loads[0].resolve([]);
    await promise;
    assert.equal(harness.hydrationRef.current.status, 'failed');
    assert.equal(harness.settledCount, 0);
    assert.equal(harness.hydratedCount, 0);
  });

  it('explicitly cleans scope A and starts scope B once on scope change', async () => {
    const harness = createProgressControllerHarness('user-a');
    const controllerA = harness.start('user-a');
    await Promise.resolve();
    assert.equal(harness.loadCount, 1);

    harness.scopeRef.current = 'user-b';
    harness.dbUserRef.current = { id: 'user-b' };
    controllerA.cleanup();
    harness.hydrationRef.current = { scope: 'user-b', promise: null, status: 'hydrating' };
    const controllerB = harness.start('user-b');
    await Promise.resolve();

    assert.equal(controllerA.cancelled, true);
    assert.notEqual(controllerB, controllerA);
    assert.equal(harness.controllerRef.current, controllerB);
    assert.equal(harness.recoveryRef.current, controllerB.requestRecovery);
    assert.equal(harness.loadCount, 2);
    assert.equal(harness.windowTarget.listenerCount('online'), 1);
    assert.equal(harness.documentTarget.listenerCount('visibilitychange'), 1);
  });

  it('keeps stale hydration controllers from mutating the active controller', async () => {
    const windowTarget = createFakeEventTarget();
    const documentTarget = createFakeEventTarget({ visibilityState: 'visible' });
    const scopeRef = { current: 'user-a' };
    const controllerRef = { current: null };
    const hydrationRef = { current: { scope: 'user-a', promise: null, status: 'guest' } };
    const recoveryRef = { current: null };
    const dbUserRef = { current: { id: 'user-a' } };
    const firstLoad = createDeferred();
    const secondLoad = createDeferred();
    const loads = [firstLoad, secondLoad];
    let loadCount = 0;
    let settledCount = 0;

    const start = () => createProgressHydrationController({
      scopeKey: 'user-a',
      progressUser: { id: 'user-a' },
      controllerRef,
      hydrationRef,
      recoveryRef,
      scopeRef,
      dbUserRef,
      retryDelays: [5],
      loadProgress: () => {
        loadCount += 1;
        return loads.shift().promise;
      },
      windowTarget,
      documentTarget,
      onSettled: () => {
        settledCount += 1;
      },
    });

    const controllerA = start();
    const duplicate = start();
    assert.equal(duplicate, controllerA);
    await Promise.resolve();
    assert.equal(loadCount, 1);
    assert.equal(windowTarget.listenerCount('online'), 1);
    assert.equal(documentTarget.listenerCount('visibilitychange'), 1);

    const promiseA = hydrationRef.current.promise;
    controllerA.cleanup();
    assert.equal(hydrationRef.current.status, 'failed');
    assert.equal(recoveryRef.current, null);
    assert.equal(windowTarget.listenerCount('online'), 0);
    assert.equal(documentTarget.listenerCount('visibilitychange'), 0);

    const controllerB = start();
    await Promise.resolve();
    assert.notEqual(controllerB, controllerA);
    assert.equal(loadCount, 2);
    assert.equal(hydrationRef.current.status, 'hydrating');
    assert.equal(windowTarget.listenerCount('online'), 1);
    assert.equal(documentTarget.listenerCount('visibilitychange'), 1);

    controllerA.cleanup();
    assert.equal(hydrationRef.current.status, 'hydrating');
    assert.equal(windowTarget.listenerCount('online'), 1);
    assert.equal(documentTarget.listenerCount('visibilitychange'), 1);

    firstLoad.resolve([]);
    await promiseA;
    assert.equal(hydrationRef.current.status, 'hydrating');
    assert.equal(settledCount, 0);

    secondLoad.resolve([]);
    await hydrationRef.current.promise;
    assert.equal(hydrationRef.current.status, 'ready');
    assert.equal(settledCount, 1);
    assert.equal(isAuthenticatedProgressSaveReady(
      'user-a',
      hydrationRef.current,
      'user-a',
      controllerB
    ), true);
  });

  it('ignores stale retry and recovery callbacks after identity changes', async () => {
    const windowTarget = createFakeEventTarget();
    const documentTarget = createFakeEventTarget({ visibilityState: 'visible' });
    const timers = [];
    const scopeRef = { current: 'user-a' };
    const controllerRef = { current: null };
    const hydrationRef = { current: { scope: 'user-a', promise: null, status: 'guest' } };
    const recoveryRef = { current: null };
    const dbUserRef = { current: { id: 'user-a' } };
    const firstLoad = createDeferred();
    const secondLoad = createDeferred();
    const loads = [firstLoad, secondLoad];
    let loadCount = 0;
    let clearCount = 0;
    const setTimeoutFn = (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    };
    const clearTimeoutFn = (timer) => {
      if (timer) {
        timer.cleared = true;
        clearCount += 1;
      }
    };

    const controllerA = createProgressHydrationController({
      scopeKey: 'user-a',
      progressUser: { id: 'user-a' },
      controllerRef,
      hydrationRef,
      recoveryRef,
      scopeRef,
      dbUserRef,
      retryDelays: [5],
      loadProgress: () => {
        loadCount += 1;
        return loads.shift().promise;
      },
      setTimeoutFn,
      clearTimeoutFn,
      windowTarget,
      documentTarget,
    });
    await Promise.resolve();
    firstLoad.reject(Object.assign(new Error('network'), { status: 503 }));
    await hydrationRef.current.promise;
    assert.equal(hydrationRef.current.status, 'failed');
    assert.equal(timers.length, 1);

    scopeRef.current = 'user-b';
    dbUserRef.current = { id: 'user-b' };
    controllerA.cleanup();
    assert.equal(clearCount, 1);

    const controllerB = createProgressHydrationController({
      scopeKey: 'user-b',
      progressUser: { id: 'user-b' },
      controllerRef,
      hydrationRef,
      recoveryRef,
      scopeRef,
      dbUserRef,
      retryDelays: [5],
      loadProgress: () => {
        loadCount += 1;
        return loads.shift().promise;
      },
      setTimeoutFn,
      clearTimeoutFn,
      windowTarget,
      documentTarget,
    });
    await Promise.resolve();
    assert.notEqual(controllerB, controllerA);
    assert.equal(loadCount, 2);

    timers[0].callback();
    controllerA.requestRecovery('progress-save');
    windowTarget.dispatch('online');
    documentTarget.dispatch('visibilitychange');
    assert.equal(loadCount, 2);
    assert.equal(hydrationRef.current.scope, 'user-b');
    assert.equal(hydrationRef.current.status, 'hydrating');

    secondLoad.resolve([]);
    await hydrationRef.current.promise;
    assert.equal(hydrationRef.current.status, 'ready');
    assert.equal(isAuthenticatedProgressSaveReady(
      'user-a',
      hydrationRef.current,
      'user-b',
      controllerB
    ), false);
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

  it('requires a refreshed resume transition for paused stale same-episode progress', () => {
    const audioUrl = 'https://cdn.example.com/cross-device.mp3';
    activateProgressCacheScope('user-a');
    mergeProgressRecords([{
      id: 'old',
      audio_url: audioUrl,
      position_seconds: 41,
      duration_seconds: 300,
      finished: false,
      last_played_at: '2026-07-17T12:00:00.000Z',
      server_updated_at: '2026-07-17T12:00:00.000Z',
    }]);
    const before = getCachedProgress(audioUrl);
    mergeProgressRecords([{
      id: 'new',
      audio_url: audioUrl,
      position_seconds: 105,
      duration_seconds: 300,
      finished: false,
      last_played_at: '2026-07-17T12:05:00.000Z',
      server_updated_at: '2026-07-17T12:05:00.000Z',
    }]);
    const after = getCachedProgress(audioUrl);

    assert.equal(shouldRefreshRequireResumeTransition({
      before,
      after,
      currentPosition: 41,
      isPlaying: false,
      isWebPlayback: true,
    }), true);
  });

  it('does not jump active playback and creates web reconciliation state when remote is ahead', () => {
    const before = {
      position_seconds: 41,
      last_played_at: '2026-07-17T12:00:00.000Z',
      server_updated_at: '2026-07-17T12:00:00.000Z',
    };
    const after = {
      position_seconds: 105,
      last_played_at: '2026-07-17T12:05:00.000Z',
      server_updated_at: '2026-07-17T12:05:00.000Z',
    };

    assert.equal(shouldRefreshRequireResumeTransition({
      before,
      after,
      currentPosition: 45,
      isPlaying: true,
      isWebPlayback: true,
    }), true);
    assert.equal(shouldRefreshRequireResumeTransition({
      before,
      after,
      currentPosition: 41,
      isPlaying: false,
      isWebPlayback: false,
    }), false);
  });

  it('uses the furthest valid position instead of server revision alone', () => {
    const newerLowerPosition = {
      position_seconds: 30,
      last_played_at: '2026-07-17T12:05:00.000Z',
      server_updated_at: '2026-07-17T12:05:00.000Z',
    };
    const olderHigherPosition = {
      position_seconds: 200,
      last_played_at: '2026-07-17T12:00:00.000Z',
      server_updated_at: '2026-07-17T12:00:00.000Z',
    };

    assert.equal(shouldRefreshRequireResumeTransition({
      before: olderHigherPosition,
      after: newerLowerPosition,
      currentPosition: 200,
      isPlaying: false,
      isWebPlayback: true,
    }), false);
    assert.equal(shouldRefreshRequireResumeTransition({
      before: newerLowerPosition,
      after: olderHigherPosition,
      currentPosition: 30,
      isPlaying: false,
      isWebPlayback: true,
    }), true);

    const audioUrl = 'https://cdn.example.com/monotonic.mp3';
    activateProgressCacheScope('user-a');
    mergeProgressRecords([{
      audio_url: audioUrl,
      position_seconds: 200,
      duration_seconds: 300,
      finished: false,
      last_played_at: '2026-07-17T12:00:00.000Z',
      server_updated_at: olderHigherPosition.server_updated_at,
    }]);
    mergeProgressRecords([{
      audio_url: audioUrl,
      position_seconds: 30,
      duration_seconds: 300,
      finished: false,
      last_played_at: '2026-07-17T12:05:00.000Z',
      server_updated_at: newerLowerPosition.server_updated_at,
    }]);
    assert.equal(getCachedProgress(audioUrl).position_seconds, 200);
    assert.equal(getCachedProgress(audioUrl).server_updated_at, newerLowerPosition.server_updated_at);
  });

  it('merges furthest position and newest revision metadata independently', () => {
    const audioUrl = 'https://cdn.example.com/revision-merge.mp3';
    const t1 = '2026-07-17T12:00:01.000Z';
    const t2 = '2026-07-17T12:00:02.000Z';

    activateProgressCacheScope('user-a');
    mergeProgressRecords([{
      id: 'row-t2', audio_url: audioUrl, position_seconds: 100, duration_seconds: 300,
      finished: false, last_played_at: t2, server_updated_at: t2,
    }]);
    mergeProgressRecords([{
      id: 'row-t1', audio_url: audioUrl, position_seconds: 120, duration_seconds: 300,
      finished: false, last_played_at: t1, server_updated_at: t1,
    }]);
    assert.equal(getCachedProgress(audioUrl).position_seconds, 120);
    assert.equal(getCachedProgress(audioUrl).server_updated_at, t2);

    const reverseAudioUrl = 'https://cdn.example.com/revision-merge-reverse.mp3';
    mergeProgressRecords([{
      id: 'row-t1', audio_url: reverseAudioUrl, position_seconds: 120, duration_seconds: 300,
      finished: false, last_played_at: t1, server_updated_at: t1,
    }]);
    mergeProgressRecords([{
      id: 'row-t2', audio_url: reverseAudioUrl, position_seconds: 100, duration_seconds: 300,
      finished: false, last_played_at: t2, server_updated_at: t2,
    }]);
    assert.equal(getCachedProgress(reverseAudioUrl).position_seconds, 120);
    assert.equal(getCachedProgress(reverseAudioUrl).server_updated_at, t2);

    mergeProgressRecords([{
      id: 'row-t2-next', audio_url: reverseAudioUrl, position_seconds: 120, duration_seconds: 300,
      finished: true, last_played_at: t2, server_updated_at: t2,
    }]);
    assert.equal(getCachedProgress(reverseAudioUrl).finished, true);
    assert.equal(getCachedProgress(reverseAudioUrl).server_updated_at, t2);
    mergeProgressRecords([{
      id: 'row-t2-later', audio_url: reverseAudioUrl, position_seconds: 120, duration_seconds: 300,
      finished: false, last_played_at: t2, server_updated_at: t2,
    }]);
    assert.equal(getCachedProgress(reverseAudioUrl).finished, true);
  });

  it('only lets the latest web resume request continue', () => {
    const gate = createWebResumeRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    assert.equal(isCurrentWebResumeRequest({
      gate,
      requestGeneration: first,
      expectedAudioUrl: 'episode-a',
      currentAudioUrl: 'episode-a',
      isPlaying: false,
    }), false);
    assert.equal(isCurrentWebResumeRequest({
      gate,
      requestGeneration: second,
      expectedAudioUrl: 'episode-a',
      currentAudioUrl: 'episode-a',
      isPlaying: false,
    }), true);
    assert.equal(isCurrentWebResumeRequest({
      gate,
      requestGeneration: second,
      expectedAudioUrl: 'episode-a',
      currentAudioUrl: 'episode-b',
      isPlaying: false,
    }), false);
    assert.equal(isCurrentWebResumeRequest({
      gate,
      requestGeneration: second,
      expectedAudioUrl: 'episode-a',
      currentAudioUrl: 'episode-a',
      isPlaying: true,
    }), false);
    gate.invalidate();
    assert.equal(isCurrentWebResumeRequest({
      gate,
      requestGeneration: second,
      expectedAudioUrl: 'episode-a',
      currentAudioUrl: 'episode-a',
      isPlaying: false,
    }), false);
  });

  it('permanently obsoletes a resume after play then pause or cleanup', () => {
    const gate = createWebResumeRequestGate();
    const request = gate.begin();
    const requestIsCurrent = (isPlaying) => isCurrentWebResumeRequest({
      gate,
      requestGeneration: request,
      expectedAudioUrl: 'episode-a',
      currentAudioUrl: 'episode-a',
      isPlaying,
    });

    assert.equal(requestIsCurrent(false), true);
    gate.invalidate(); // shared web audio emitted playing
    assert.equal(requestIsCurrent(true), false);
    assert.equal(requestIsCurrent(false), false); // paused again cannot revive it

    const cleanupRequest = gate.begin();
    gate.invalidate(); // web audio cleanup/unmount
    assert.equal(isCurrentWebResumeRequest({
      gate,
      requestGeneration: cleanupRequest,
      expectedAudioUrl: 'episode-a',
      currentAudioUrl: 'episode-a',
      isPlaying: false,
    }), false);

    const latestRequest = gate.begin();
    assert.equal(isCurrentWebResumeRequest({
      gate,
      requestGeneration: latestRequest,
      expectedAudioUrl: 'episode-a',
      currentAudioUrl: 'episode-a',
      isPlaying: false,
    }), true);
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

  it('allows an authenticated pause save after hydration reaches ready', async () => {
    activateProgressCacheScope('user-a');
    const audioUrl = 'https://cdn.example.com/pause-save.mp3';
    const payloads = [];
    const hydration = { scope: 'user-a', promise: null, status: 'hydrating' };
    const api = {
      entities: {
        EpisodeProgress: {
          async filter() {
            return [];
          },
          async create(payload) {
            payloads.push(payload);
            return {
              id: 'pause-save-row',
              audio_url: payload.audio_url,
              position_seconds: payload.position_seconds,
              duration_seconds: payload.duration_seconds,
              finished: payload.finished,
              last_played_at: payload.last_played_at,
              server_updated_at: '2026-07-17T12:00:00.001Z',
            };
          },
        },
      },
    };

    await loadProgressFromDB(api, 'user-a');
    hydration.status = 'ready';

    setCachedProgress(audioUrl, 12, 300, false);
    assert.equal(isAuthenticatedProgressSaveReady(
      'user-a',
      hydration,
      'user-a',
      { scope: 'user-a', userId: 'user-a', cancelled: false }
    ), true);
    await saveProgressToDB(api, 'user-a', audioUrl, {
      scopeStatus: hydration.status,
      hydrationReady: true,
      audioUrl,
    });

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].audio_url, audioUrl);
    assert.equal(payloads[0].position_seconds, 12);
  });

  it('syncs authenticated progress across independent device caches', async () => {
    const mobileStore = new Map();
    const desktopStore = new Map();
    const serverRows = new Map();
    let serverRevision = 0;
    const api = {
      entities: {
        EpisodeProgress: {
          async filter() {
            return [...serverRows.values()];
          },
          async create(payload) {
            const saved = {
              id: `server-${payload.audio_url}`,
              audio_url: payload.audio_url,
              position_seconds: payload.position_seconds,
              duration_seconds: payload.duration_seconds,
              finished: payload.finished,
              last_played_at: payload.last_played_at,
              server_updated_at: new Date(Date.UTC(2026, 6, 17, 12, 0, serverRevision += 1)).toISOString(),
            };
            serverRows.set(payload.audio_url, saved);
            return saved;
          },
        },
      },
    };
    const episode = { audioUrl: 'https://cdn.example.com/cross-device.mp3' };

    installDeviceStorage(mobileStore);
    resetProgressRuntimeState();
    activateProgressCacheScope('user-a');
    setCachedProgress(episode.audioUrl, 64, 300, false);
    await saveProgressToDB(api, 'user-a', episode.audioUrl);

    installDeviceStorage(desktopStore);
    resetProgressRuntimeState();
    activateProgressCacheScope('user-a');
    await loadProgressFromDB(api, 'user-a');
    assert.equal(getEpisodeResumeState(episode).resumeAt, 64);

    setCachedProgress(episode.audioUrl, 140, 300, false);
    await saveProgressToDB(api, 'user-a', episode.audioUrl);

    installDeviceStorage(mobileStore);
    resetProgressRuntimeState();
    activateProgressCacheScope('user-a');
    await loadProgressFromDB(api, 'user-a');
    assert.equal(getEpisodeResumeState(episode).resumeAt, 140);
  });

  it('adopts canonical stale-save responses and refreshes the next base revision', async () => {
    activateProgressCacheScope('user-a');
    const audioUrl = 'https://cdn.example.com/stale-response.mp3';
    const payloads = [];
    setCachedProgress(audioUrl, 12, 300, false);
    mergeProgressRecords([{
      id: 'server-row',
      audio_url: audioUrl,
      position_seconds: 12,
      duration_seconds: 300,
      finished: 0,
      last_played_at: '2026-07-17T12:00:00.000Z',
      server_updated_at: '2026-07-17T12:00:01.000Z',
    }]);

    const api = {
      entities: {
        EpisodeProgress: {
          async create(payload) {
            payloads.push(payload);
            if (payloads.length === 1) {
              return {
                id: 'server-row',
                audio_url: audioUrl,
                position_seconds: 90,
                duration_seconds: 300,
                finished: false,
                last_played_at: '2026-07-17T12:00:10.000Z',
                server_updated_at: '2026-07-17T12:00:20.000Z',
              };
            }
            return {
              id: 'server-row',
              audio_url: audioUrl,
              position_seconds: payload.position_seconds,
              duration_seconds: payload.duration_seconds,
              finished: payload.finished,
              last_played_at: payload.last_played_at,
              server_updated_at: '2026-07-17T12:00:30.000Z',
            };
          },
        },
      },
    };

    setCachedProgress(audioUrl, 40, 300, false);
    await saveProgressToDB(api, 'user-a', audioUrl);
    assert.equal(payloads[0].base_server_updated_at, '2026-07-17T12:00:01.000Z');
    assert.equal(getCachedProgress(audioUrl).position_seconds, 90);
    assert.equal(getCachedProgress(audioUrl).server_updated_at, '2026-07-17T12:00:20.000Z');

    setCachedProgress(audioUrl, 120, 300, false);
    await saveProgressToDB(api, 'user-a', audioUrl);
    assert.equal(payloads[1].base_server_updated_at, '2026-07-17T12:00:20.000Z');
    assert.equal(getCachedProgress(audioUrl).position_seconds, 120);
    assert.equal(getCachedProgress(audioUrl).server_updated_at, '2026-07-17T12:00:30.000Z');
  });

  it('blocks stale prehydration playback from overwriting canonical retry progress until catch-up', async () => {
    activateProgressCacheScope('user-a');
    const audioUrl = 'https://cdn.example.com/prehydration-stale.mp3';
    const payloads = [];

    setCachedProgress(audioUrl, 100, 300, false);
    let activePosition = getEpisodeResumeState({ audioUrl }).resumeAt;
    assert.equal(activePosition, 100);

    await assert.rejects(
      loadProgressFromDB({
        entities: {
          EpisodeProgress: {
            async filter() {
              throw new Error('initial GET failed');
            },
          },
        },
      }, 'user-a'),
      /initial GET failed/
    );

    mergeProgressRecords([{
      id: 'server-row',
      audio_url: audioUrl,
      position_seconds: 200,
      duration_seconds: 300,
      finished: 0,
      last_played_at: '2026-07-17T12:00:00.000Z',
      server_updated_at: '2026-07-17T12:00:02.000Z',
    }]);

    activePosition = 105;
    const guard = createProgressRegressionGuard(audioUrl, activePosition, getCachedProgress(audioUrl));

    assert.equal(activePosition, 105);
    assert.equal(getCachedProgress(audioUrl).position_seconds, 200);
    assert.equal(shouldBlockProgressSaveForGuard(guard, audioUrl, 105), true);
    assert.equal(payloads.length, 0);

    if (!shouldBlockProgressSaveForGuard(guard, audioUrl, 105)) {
      setCachedProgress(audioUrl, 105, 300, false);
    }

    assert.equal(getCachedProgress(audioUrl).position_seconds, 200);
    assert.equal(getCachedProgress(audioUrl).server_updated_at, '2026-07-17T12:00:02.000Z');

    activePosition = 205;
    assert.equal(shouldBlockProgressSaveForGuard(guard, audioUrl, activePosition), false);

    const api = {
      entities: {
        EpisodeProgress: {
          async create(payload) {
            payloads.push(payload);
            return {
              id: 'server-row',
              audio_url: audioUrl,
              position_seconds: payload.position_seconds,
              duration_seconds: payload.duration_seconds,
              finished: payload.finished,
              last_played_at: payload.last_played_at,
              server_updated_at: '2026-07-17T12:00:03.000Z',
            };
          },
        },
      },
    };

    setCachedProgress(audioUrl, activePosition, 300, false);
    await saveProgressToDB(api, 'user-a', audioUrl);

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].position_seconds, 205);
    assert.equal(payloads[0].base_server_updated_at, '2026-07-17T12:00:02.000Z');
    assert.equal(getCachedProgress(audioUrl).position_seconds, 205);
    assert.equal(getCachedProgress(audioUrl).server_updated_at, '2026-07-17T12:00:03.000Z');
  });

  it('does not retain stale playback protection across episodes, users, or guest playback', () => {
    const episodeA = 'https://cdn.example.com/protected-a.mp3';
    const episodeB = 'https://cdn.example.com/protected-b.mp3';
    const guard = createProgressRegressionGuard(episodeA, 100, {
      position_seconds: 200,
      server_updated_at: '2026-07-17T12:00:02.000Z',
    });

    assert.equal(shouldBlockProgressSaveForGuard(guard, episodeA, 120), true);
    assert.equal(shouldBlockProgressSaveForGuard(guard, episodeB, 120), false);

    const clearedForUserSwitch = null;
    assert.equal(shouldBlockProgressSaveForGuard(clearedForUserSwitch, episodeA, 120), false);
    assert.equal(shouldBlockProgressSaveForGuard(null, episodeA, 120), false);
  });

  it('allows active playback already ahead of canonical retry progress to save with the reconciled revision', async () => {
    activateProgressCacheScope('user-a');
    const audioUrl = 'https://cdn.example.com/prehydration-ahead.mp3';
    const payloads = [];

    setCachedProgress(audioUrl, 250, 300, false);
    mergeProgressRecords([{
      id: 'server-row',
      audio_url: audioUrl,
      position_seconds: 200,
      duration_seconds: 300,
      finished: 0,
      last_played_at: '2026-07-17T12:00:00.000Z',
      server_updated_at: '2026-07-17T12:00:02.000Z',
    }]);

    const guard = createProgressRegressionGuard(audioUrl, 250, getCachedProgress(audioUrl));
    assert.equal(guard, null);

    const api = {
      entities: {
        EpisodeProgress: {
          async create(payload) {
            payloads.push(payload);
            return {
              id: 'server-row',
              audio_url: audioUrl,
              position_seconds: payload.position_seconds,
              duration_seconds: payload.duration_seconds,
              finished: payload.finished,
              last_played_at: payload.last_played_at,
              server_updated_at: '2026-07-17T12:00:03.000Z',
            };
          },
        },
      },
    };

    setCachedProgress(audioUrl, 255, 300, false);
    await saveProgressToDB(api, 'user-a', audioUrl);

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].position_seconds, 255);
    assert.equal(payloads[0].base_server_updated_at, '2026-07-17T12:00:02.000Z');
    assert.equal(getCachedProgress(audioUrl).position_seconds, 255);
  });

  it('restarts exhausted hydration recovery and protects stale active playback behind the canonical floor', async () => {
    const { scope } = activateProgressCacheScope('user-a');
    const audioUrl = 'https://cdn.example.com/recovery-stale.mp3';
    const payloads = [];
    let filterCalls = 0;
    let activePosition = 100;
    let hydration = { scope, promise: null, status: 'hydrating' };

    setCachedProgress(audioUrl, activePosition, 300, false);

    const api = {
      entities: {
        EpisodeProgress: {
          async filter() {
            filterCalls += 1;
            if (filterCalls <= 4) {
              throw new Error(`hydration outage ${filterCalls}`);
            }
            return [{
              id: 'server-row',
              audio_url: audioUrl,
              position_seconds: 200,
              duration_seconds: 300,
              finished: 0,
              last_played_at: '2026-07-17T12:00:00.000Z',
              server_updated_at: '2026-07-17T12:00:02.000Z',
            }];
          },
          async create(payload) {
            payloads.push(payload);
            return payload;
          },
        },
      },
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await assert.rejects(loadProgressFromDB(api, 'user-a'), /hydration outage/);
      hydration = { scope, promise: null, status: 'failed' };
    }

    activePosition = 150;
    setCachedProgress(audioUrl, activePosition, 300, false);
    assert.equal(getCachedProgress(audioUrl).position_seconds, 150);

    assert.deepEqual(
      getProgressHydrationRecoveryDecision({
        hydration,
        scope,
        userId: 'user-a',
        hasScheduledRetry: false,
      }),
      { shouldStart: true, reason: 'failed' }
    );
    assert.deepEqual(
      getProgressHydrationRecoveryDecision({
        hydration: { scope, promise: Promise.resolve(), status: 'hydrating' },
        scope,
        userId: 'user-a',
      }),
      { shouldStart: false, reason: 'active-request' }
    );
    assert.deepEqual(
      getProgressHydrationRecoveryDecision({
        hydration,
        scope,
        userId: 'user-a',
        hasScheduledRetry: true,
      }),
      { shouldStart: false, reason: 'scheduled-retry' }
    );

    const recovery = loadProgressFromDB(api, 'user-a');
    hydration = { scope, promise: recovery, status: 'hydrating' };
    assert.equal(
      getProgressHydrationRecoveryDecision({ hydration, scope, userId: 'user-a' }).shouldStart,
      false
    );
    await recovery;
    hydration = { scope, promise: null, status: 'ready' };

    const guard = createProgressRegressionGuard(audioUrl, activePosition, getCachedProgress(audioUrl));
    assert.equal(filterCalls, 5);
    assert.equal(getCachedProgress(audioUrl).position_seconds, 200);
    assert.equal(getCachedProgress(audioUrl).server_updated_at, '2026-07-17T12:00:02.000Z');
    assert.equal(shouldBlockProgressSaveForGuard(guard, audioUrl, 155), true);

    if (!shouldBlockProgressSaveForGuard(guard, audioUrl, 155)) {
      setCachedProgress(audioUrl, 155, 300, false);
      await saveProgressToDB(api, 'user-a', audioUrl);
    }

    assert.equal(payloads.length, 0);
    assert.equal(getCachedProgress(audioUrl).position_seconds, 200);

    const oldScope = scope;
    const { scope: newScope } = activateProgressCacheScope('user-b');
    assert.deepEqual(
      getProgressHydrationRecoveryDecision({
        hydration: { scope: oldScope, promise: null, status: 'failed' },
        scope: newScope,
        userId: 'user-a',
      }),
      { shouldStart: false, reason: 'scope-mismatch' }
    );
    assert.deepEqual(
      getProgressHydrationRecoveryDecision({
        hydration: { scope: newScope, promise: null, status: 'failed' },
        scope: newScope,
        userId: null,
      }),
      { shouldStart: false, reason: 'guest' }
    );
  });

  it('recovers hydration after retry exhaustion without regressing farther active playback', async () => {
    const { scope } = activateProgressCacheScope('user-a');
    const audioUrl = 'https://cdn.example.com/recovery-ahead.mp3';
    const payloads = [];
    let filterCalls = 0;
    let activePosition = 240;

    setCachedProgress(audioUrl, 100, 300, false);

    const api = {
      entities: {
        EpisodeProgress: {
          async filter() {
            filterCalls += 1;
            if (filterCalls <= 4) {
              throw new Error(`hydration outage ${filterCalls}`);
            }
            return [{
              id: 'server-row',
              audio_url: audioUrl,
              position_seconds: 200,
              duration_seconds: 300,
              finished: 0,
              last_played_at: '2026-07-17T12:00:00.000Z',
              server_updated_at: '2026-07-17T12:00:02.000Z',
            }];
          },
          async create(payload) {
            payloads.push(payload);
            return {
              id: 'server-row',
              audio_url: audioUrl,
              position_seconds: payload.position_seconds,
              duration_seconds: payload.duration_seconds,
              finished: payload.finished,
              last_played_at: payload.last_played_at,
              server_updated_at: '2026-07-17T12:00:03.000Z',
            };
          },
        },
      },
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await assert.rejects(loadProgressFromDB(api, 'user-a'), /hydration outage/);
    }

    setCachedProgress(audioUrl, activePosition, 300, false);
    assert.equal(getCachedProgress(audioUrl).position_seconds, 240);
    assert.equal(
      getProgressHydrationRecoveryDecision({
        hydration: { scope, promise: null, status: 'failed' },
        scope,
        userId: 'user-a',
      }).shouldStart,
      true
    );

    await loadProgressFromDB(api, 'user-a');
    const guard = createProgressRegressionGuard(audioUrl, activePosition, getCachedProgress(audioUrl));
    assert.equal(guard, null);
    assert.equal(getCachedProgress(audioUrl).position_seconds, 240);

    activePosition = 245;
    setCachedProgress(audioUrl, activePosition, 300, false);
    await saveProgressToDB(api, 'user-a', audioUrl);

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].position_seconds, 245);
    assert.equal(payloads[0].base_server_updated_at, '2026-07-17T12:00:02.000Z');
    assert.equal(getCachedProgress(audioUrl).position_seconds, 245);
    assert.equal(getCachedProgress(audioUrl).server_updated_at, '2026-07-17T12:00:03.000Z');
  });

  it('lets authenticated server progress beat a future-dated local cache after hydration', () => {
    activateProgressCacheScope('user-a');
    localStorage.setItem(buildProgressCacheKey('user-a'), JSON.stringify({
      'https://cdn.example.com/skew.mp3': progressEntry({
        position_seconds: 12,
        last_played_at: freshIso(60_000),
      }),
    }));
    resetProgressRuntimeState();
    activateProgressCacheScope('user-a');

    mergeProgressRecords([{
      id: 'remote-skew',
      audio_url: 'https://cdn.example.com/skew.mp3',
      position_seconds: 88,
      duration_seconds: 300,
      finished: 0,
      last_played_at: freshIso(1000),
      server_updated_at: freshIso(2000),
    }]);

    assert.equal(getCachedProgress('https://cdn.example.com/skew.mp3').position_seconds, 88);
  });

  it('shows selected episode progress immediately through the web transition coordinator', () => {
    activateProgressCacheScope('user-a');
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = { src: '', currentSrc: '', load() { this.currentSrc = this.src; } };
    const episodeA = { title: 'Episode A', audioUrl: 'https://cdn.example.com/a.mp3' };
    const episodeB = { title: 'Episode B', audioUrl: 'https://cdn.example.com/b.mp3' };
    setCachedProgress(episodeA.audioUrl, 110, 300, false);
    setCachedProgress(episodeB.audioUrl, 50, 180, false);

    let visibleCurrentTime = getEpisodeResumeState(episodeA).resumeAt;
    let visibleDuration = getEpisodeResumeState(episodeA).durationSeconds;
    assert.equal(visibleCurrentTime, 110);
    assert.equal(visibleDuration, 300);

    const selectedB = getEpisodeResumeState(episodeB);
    beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: episodeB.audioUrl,
      resumeAt: selectedB.resumeAt,
      durationSeconds: selectedB.durationSeconds,
    });
    visibleCurrentTime = selectedB.resumeAt;
    visibleDuration = selectedB.durationSeconds;
    assert.equal(visibleCurrentTime, 50);
    assert.equal(visibleDuration, 180);

    const selectedA = getEpisodeResumeState(episodeA);
    beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: episodeA.audioUrl,
      resumeAt: selectedA.resumeAt,
      durationSeconds: selectedA.durationSeconds,
    });
    visibleCurrentTime = selectedA.resumeAt;
    visibleDuration = selectedA.durationSeconds;
    assert.equal(visibleCurrentTime, 110);
    assert.equal(visibleDuration, 300);
  });

  it('uses zero visible duration when the selected episode has no valid cached duration', () => {
    activateProgressCacheScope('user-a');
    const episode = { title: 'No duration', audioUrl: 'https://cdn.example.com/no-duration.mp3' };
    setCachedProgress(episode.audioUrl, 50, 0, false);

    const selected = getEpisodeResumeState(episode);

    assert.equal(selected.resumeAt, 50);
    assert.equal(selected.durationSeconds, 0);
  });

  it('confirms a delayed web resume seek before establishing playback or saving progress', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audioUrl = 'https://cdn.example.com/resume.mp3';
    const audio = createFakeSeekAudio();
    const transition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl,
      resumeAt: 65,
      durationSeconds: 140,
    });
    const guardState = {
      guard: { audioUrl, position_seconds: 65, transitionGeneration: transition.generation },
      timersStarted: false,
    };
    let saved = null;

    const playback = runConfirmedWebPlayback({
      coordinator,
      audio,
      transition,
      resumeAt: 65,
      guardState,
    });

    await Promise.resolve();
    assert.equal(audio.currentTime, 0);
    assert.deepEqual(audio.seekAssignments, [65]);
    assert.equal(coordinator.getPhase(transition), 'switching');
    assert.equal(guardState.timersStarted, false);

    audio.currentTime = 1;
    if (!coordinator.shouldIgnoreEvent('timeupdate', audio) &&
        !shouldBlockProgressSaveForGuard(guardState.guard, audioUrl, audio.currentTime)) {
      saved = audio.currentTime;
    }
    assert.equal(saved, null);

    audio.makeSeekable(140);
    audio.dispatch('loadedmetadata');
    assert.equal(guardState.timersStarted, false);
    audio.completeSeek(65);
    await playback;

    assert.equal(Math.abs(audio.currentTime - 65) <= 0.75, true);
    assert.equal(coordinator.getPhase(transition), 'established');
    assert.equal(guardState.timersStarted, true);
    assert.equal(guardState.guard, null);

    audio.currentTime = 105;
    if (!coordinator.shouldIgnoreEvent('pause', audio) &&
        !shouldBlockProgressSaveForGuard(guardState.guard, audioUrl, audio.currentTime)) {
      saved = audio.currentTime;
    }
    assert.equal(saved, 105);
  });

  it('keeps lower progress blocked when a web resume seek never succeeds', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audioUrl = 'https://cdn.example.com/seek-timeout.mp3';
    const audio = createFakeSeekAudio();
    const timers = [];
    const transition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl,
      resumeAt: 65,
      durationSeconds: 140,
    });
    const guard = { audioUrl, position_seconds: 65, transitionGeneration: transition.generation };
    const seek = confirmWebResumeSeek({
      audio,
      resumeAt: 65,
      isCurrent: () => coordinator.isCurrent(transition),
      timeoutMs: 1000,
      setTimeoutFn(callback, delay) {
        const timer = { callback, delay };
        timers.push(timer);
        return timer;
      },
      clearTimeoutFn() {},
    }).catch((error) => error);

    await Promise.resolve();
    audio.currentTime = 41;
    assert.equal(shouldBlockProgressSaveForGuard(guard, audioUrl, audio.currentTime), true);
    timers[0].callback();
    const error = await seek;

    assert.equal(error instanceof Error, true);
    assert.equal(coordinator.getPhase(transition), 'switching');
    assert.equal(shouldBlockProgressSaveForGuard(guard, audioUrl, 41), true);
    assert.equal(countWebResumeSeekListeners(audio), 0);
  });

  it('treats a replaced transition timeout as obsolete without affecting the current transition', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = createFakeSeekAudio();
    const timers = [];
    const transitionA = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/a-timeout.mp3',
      resumeAt: 65,
      durationSeconds: 140,
    });
    const seekA = confirmWebResumeSeek({
      audio,
      resumeAt: 65,
      isCurrent: () => coordinator.isCurrent(transitionA),
      timeoutMs: 1000,
      setTimeoutFn(callback, delay) {
        const timer = { callback, delay };
        timers.push(timer);
        return timer;
      },
      clearTimeoutFn() {},
    }).catch((error) => error);

    const transitionB = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/b-current.mp3',
      resumeAt: 0,
      durationSeconds: 0,
    });

    timers[0].callback();
    const error = await seekA;

    assert.equal(isObsoleteWebPlaybackError(error), true);
    assert.equal(coordinator.isCurrent(transitionB), true);
    assert.equal(coordinator.getPhase(transitionB), 'switching');
    assert.equal(countWebResumeSeekListeners(audio), 0);
  });

  it('cancels an older web resume seek when a newer transition starts', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = createFakeSeekAudio();
    const transitionA = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/a.mp3',
      resumeAt: 65,
      durationSeconds: 140,
    });
    const seekA = confirmWebResumeSeek({
      audio,
      resumeAt: 65,
      isCurrent: () => coordinator.isCurrent(transitionA),
      timeoutMs: 1000,
    }).catch((error) => error);

    beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/b.mp3',
      resumeAt: 0,
      durationSeconds: 0,
    });
    audio.makeSeekable(140);
    audio.dispatch('loadedmetadata');
    audio.completeSeek(65);
    const error = await seekA;

    assert.equal(isObsoleteWebPlaybackError(error), true);
    assert.equal(coordinator.isCurrent(transitionA), false);
    assert.equal(countWebResumeSeekListeners(audio), 0);
  });

  it('lets resumeAt zero establish immediately without a seek wait', async () => {
    const audio = createFakeSeekAudio();
    const position = await confirmWebResumeSeek({
      audio,
      resumeAt: 0,
      isCurrent: () => true,
      timeoutMs: 1000,
    });

    assert.equal(position, 0);
    assert.deepEqual(audio.seekAssignments, []);
  });

  it('still applies skip-start web seeks before playback establishment', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = createFakeSeekAudio();
    const transition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/skip-start.mp3',
      resumeAt: 15,
      durationSeconds: 0,
    });
    const seek = confirmWebResumeSeek({
      audio,
      resumeAt: 15,
      isCurrent: () => coordinator.isCurrent(transition),
      timeoutMs: 1000,
    });

    await Promise.resolve();
    assert.equal(audio.currentTime, 0);
    audio.makeSeekable(200);
    audio.dispatch('loadedmetadata');
    audio.completeSeek(15);
    await seek;

    assert.equal(audio.currentTime, 15);
  });

  it('does not confirm a synchronous currentTime readback while seeking is still pending', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = createFakeSeekAudio({
      ignoreSeekBeforeMetadata: false,
      markSeekingOnAssign: true,
      reportAssignedWhileSeeking: true,
    });
    audio.makeSeekable(140);
    const transition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/pending-seek.mp3',
      resumeAt: 65,
      durationSeconds: 140,
    });
    let resolved = false;
    const seek = confirmWebResumeSeek({
      audio,
      resumeAt: 65,
      isCurrent: () => coordinator.isCurrent(transition),
      timeoutMs: 1000,
    }).then(() => {
      resolved = true;
    });

    await Promise.resolve();
    assert.equal(audio.currentTime, 65);
    assert.equal(audio.seeking, true);
    assert.equal(resolved, false);

    audio.dispatch('timeupdate');
    await Promise.resolve();
    assert.equal(resolved, false);

    audio.completeSeek(65);
    await seek;
    assert.equal(resolved, true);
    assert.equal(audio.listenerCount('seeked'), 0);
  });

  it('does not treat readiness events as web resume seek confirmation', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = createFakeSeekAudio({
      ignoreSeekBeforeMetadata: false,
      reportAssignedWhileSeeking: true,
    });
    audio.makeSeekable(140);
    const transition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/readiness-only.mp3',
      resumeAt: 65,
      durationSeconds: 140,
    });
    let resolved = false;
    const seek = confirmWebResumeSeek({
      audio,
      resumeAt: 65,
      isCurrent: () => coordinator.isCurrent(transition),
      timeoutMs: 1000,
    }).then(() => {
      resolved = true;
    });

    await Promise.resolve();
    assert.equal(audio.currentTime, 65);
    assert.equal(audio.seeking, false);

    for (const type of ['loadedmetadata', 'progress', 'canplay']) {
      audio.dispatch(type);
      await Promise.resolve();
      assert.equal(resolved, false);
    }

    audio.completeSeek(65);
    await seek;
    assert.equal(resolved, true);
    assert.equal(countWebResumeSeekListeners(audio), 0);
  });

  it('does not create web pending-seek protection for native playback decisions', () => {
    const protection = createWebResumeTransitionProtection({
      isWebPlayback: false,
      shouldProtectCanonicalResume: true,
      audioUrl: 'https://cdn.example.com/native.mp3',
      resumeAt: 65,
      transitionGeneration: 12,
    });

    assert.equal(protection.progressRegressionGuard, null);
    assert.equal(protection.pendingWebSeek, null);
  });

  it('does not repeat currentTime assignments on readiness events while a seek is pending', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = createFakeSeekAudio({
      ignoreSeekBeforeMetadata: false,
      reportAssignedWhileSeeking: true,
      markSeekingOnAssign: true,
    });
    audio.makeSeekable(140);
    const transition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/no-repeat-readiness.mp3',
      resumeAt: 65,
      durationSeconds: 140,
    });
    const seek = confirmWebResumeSeek({
      audio,
      resumeAt: 65,
      isCurrent: () => coordinator.isCurrent(transition),
      timeoutMs: 1000,
    });

    await Promise.resolve();
    assert.deepEqual(audio.seekAssignments, [65]);

    for (const type of ['loadedmetadata', 'durationchange', 'progress', 'canplay', 'canplaythrough']) {
      audio.dispatch(type);
      await Promise.resolve();
      assert.deepEqual(audio.seekAssignments, [65]);
    }

    audio.completeSeek(65);
    await seek;
  });

  it('allows timeupdate to confirm only after this helper assigns the latest seek', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = createFakeSeekAudio({ initialTime: 65, ignoreSeekBeforeMetadata: false });
    audio.makeSeekable(140);
    const transition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/timeupdate-confirm.mp3',
      resumeAt: 65,
      durationSeconds: 140,
    });
    let resolved = false;

    audio.dispatch('timeupdate');
    const seek = confirmWebResumeSeek({
      audio,
      resumeAt: 65,
      isCurrent: () => coordinator.isCurrent(transition),
      timeoutMs: 1000,
    }).then(() => {
      resolved = true;
    });

    await Promise.resolve();
    assert.equal(resolved, false);
    assert.deepEqual(audio.seekAssignments, [65]);

    audio.dispatch('timeupdate');
    await seek;
    assert.equal(resolved, true);
  });

  it('retries a transient currentTime setter error after metadata becomes usable', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = createFakeSeekAudio({
      throwOnAssignments: ['InvalidStateError'],
      ignoreSeekBeforeMetadata: false,
    });
    const transition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/transient-setter.mp3',
      resumeAt: 65,
      durationSeconds: 140,
    });
    let resolved = false;
    const playback = runConfirmedWebPlayback({
      coordinator,
      audio,
      transition,
      resumeAt: 65,
      guardState: { guard: null, timersStarted: false },
    }).then(() => {
      resolved = true;
    });

    await Promise.resolve();
    assert.equal(resolved, false);
    assert.deepEqual(audio.seekAssignments, [65]);

    audio.makeSeekable(140);
    audio.dispatch('loadedmetadata');
    await Promise.resolve();
    assert.deepEqual(audio.seekAssignments, [65, 65]);
    assert.equal(resolved, false);

    audio.completeSeek(65);
    await playback;
    assert.equal(resolved, true);
    assert.equal(coordinator.getPhase(transition), 'established');
    assert.equal(countWebResumeSeekListeners(audio), 0);
  });

  it('waits for seekable ranges to include the resume position before confirming', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = createFakeSeekAudio();
    const transition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/range-growth.mp3',
      resumeAt: 65,
      durationSeconds: 140,
    });
    let resolved = false;
    const seek = confirmWebResumeSeek({
      audio,
      resumeAt: 65,
      isCurrent: () => coordinator.isCurrent(transition),
      timeoutMs: 1000,
    }).then(() => {
      resolved = true;
    });

    await Promise.resolve();
    audio.setSeekableRanges([[0, 30]], 140);
    audio.dispatch('progress');
    await Promise.resolve();
    assert.equal(resolved, false);
    assert.deepEqual(audio.seekAssignments, [65]);

    audio.setSeekableRanges([[0, 80]], 140);
    audio.dispatch('progress');
    await Promise.resolve();
    assert.equal(resolved, false);
    audio.completeSeek(65);
    await seek;

    assert.equal(resolved, true);
    assert.equal(audio.currentTime, 65);
  });

  it('keeps the guard when currentTime resets before seek confirmation', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audioUrl = 'https://cdn.example.com/reset-before-seeked.mp3';
    const audio = createFakeSeekAudio({
      ignoreSeekBeforeMetadata: false,
      markSeekingOnAssign: true,
      reportAssignedWhileSeeking: true,
    });
    audio.makeSeekable(140);
    const transition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl,
      resumeAt: 65,
      durationSeconds: 140,
    });
    const guardState = {
      guard: { audioUrl, position_seconds: 65, transitionGeneration: transition.generation },
      timersStarted: false,
    };
    const playback = runConfirmedWebPlayback({
      coordinator,
      audio,
      transition,
      resumeAt: 65,
      guardState,
    });

    await Promise.resolve();
    audio.seeking = true;
    audio.currentTime = 0;
    audio.dispatch('timeupdate');
    await Promise.resolve();

    assert.equal(guardState.timersStarted, false);
    assert.equal(shouldBlockProgressSaveForGuard(guardState.guard, audioUrl, 0), true);

    audio.completeSeek(65);
    await playback;
    assert.equal(guardState.guard, null);
    assert.equal(guardState.timersStarted, true);
  });

  it('keeps failed same-episode resume guarded until a retry confirms the seek', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audioUrl = 'https://cdn.example.com/retry-same-episode.mp3';
    const audio = createFakeSeekAudio();
    const timers = [];
    const transitionA = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl,
      resumeAt: 65,
      durationSeconds: 140,
    });
    let guard = { audioUrl, position_seconds: 65, pendingSeek: true, transitionGeneration: transitionA.generation };
    const failedSeek = confirmWebResumeSeek({
      audio,
      resumeAt: 65,
      isCurrent: () => coordinator.isCurrent(transitionA),
      timeoutMs: 1000,
      setTimeoutFn(callback, delay) {
        const timer = { callback, delay };
        timers.push(timer);
        return timer;
      },
      clearTimeoutFn() {},
    }).catch((error) => error);

    timers[0].callback();
    await failedSeek;
    coordinator.cancel(transitionA);

    audio.currentTime = 0;
    assert.equal(shouldBlockProgressSaveForGuard(guard, audioUrl, audio.currentTime), true);

    const transitionB = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl,
      resumeAt: 65,
      durationSeconds: 140,
    });
    guard = { ...guard, transitionGeneration: transitionB.generation };
    const guardState = { guard, timersStarted: false };
    const retry = runConfirmedWebPlayback({
      coordinator,
      audio,
      transition: transitionB,
      resumeAt: 65,
      guardState,
    });

    await Promise.resolve();
    assert.equal(guardState.timersStarted, false);
    audio.makeSeekable(140);
    audio.dispatch('loadedmetadata');
    audio.completeSeek(65);
    await retry;

    assert.equal(guardState.guard, null);
    assert.equal(guardState.timersStarted, true);
    audio.currentTime = 20;
    assert.equal(shouldBlockProgressSaveForGuard(guardState.guard, audioUrl, audio.currentTime), false);
  });

  it('reruns a failed same-episode skip-start seek instead of using direct audio.play', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audioUrl = 'https://cdn.example.com/skip-start-retry.mp3';
    let directPlayCalls = 0;
    const audio = createFakeSeekAudio();
    audio.play = async () => {
      directPlayCalls += 1;
    };
    const timers = [];
    let pendingWebSeek = null;
    let transitionRuns = 0;

    const startTransition = ({ shouldTimeout = false } = {}) => {
      transitionRuns += 1;
      const transition = beginWebEpisodeSourceSwitch({
        coordinator,
        audio,
        audioUrl,
        resumeAt: 15,
        durationSeconds: 0,
      });
      pendingWebSeek = { audioUrl, position_seconds: 15, transitionGeneration: transition.generation };
      const seek = (shouldTimeout ? confirmWebResumeSeek({
        audio,
        resumeAt: 15,
        isCurrent: () => coordinator.isCurrent(transition),
        timeoutMs: 1000,
        setTimeoutFn(callback, delay) {
          const timer = { callback, delay };
          timers.push(timer);
          return timer;
        },
        clearTimeoutFn() {},
      }) : establishWebPlaybackTransition({
        audio,
        coordinator,
        transition,
        transitionLabel: 'skip-start-retry',
        resumeAt: 15,
        retryDelays: [0],
        waitForMediaReady: () => Promise.resolve(),
        logger: { log() {}, warn() {} },
      })).then(async () => {
        if (shouldTimeout) {
          await requestGuardedWebPlayback({
            audio,
            transitionLabel: 'skip-start-retry',
            retryDelays: [0],
            waitForMediaReady: () => Promise.resolve(),
            isCurrent: () => coordinator.isCurrent(transition),
            logger: { log() {}, warn() {} },
          });
          coordinator.markEstablished(transition);
        }
        if (pendingWebSeek?.transitionGeneration === transition.generation) {
          pendingWebSeek = null;
        }
      }).catch((error) => error);
      if (shouldTimeout) timers.at(-1).callback();
      return seek;
    };

    const failedSeek = startTransition({ shouldTimeout: true });
    await failedSeek;
    audio.currentTime = 0;
    assert.equal(pendingWebSeek?.audioUrl, audioUrl);

    const sameEpisodePlay = () => {
      if (pendingWebSeek?.audioUrl === audioUrl) {
        return startTransition();
      }
      return audio.play();
    };

    const retry = sameEpisodePlay();
    await Promise.resolve();
    assert.equal(transitionRuns, 2);
    assert.equal(directPlayCalls, 0);

    audio.makeSeekable(120);
    audio.dispatch('loadedmetadata');
    audio.completeSeek(15);
    await retry;

    assert.equal(pendingWebSeek, null);
    assert.equal(directPlayCalls, 1);
    assert.equal(coordinator.getPhase(coordinator.getCurrent()), 'established');
  });

  it('allows a manual rewind after a web resume transition is established', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audioUrl = 'https://cdn.example.com/manual-rewind.mp3';
    const audio = createFakeSeekAudio({ ignoreSeekBeforeMetadata: false });
    audio.makeSeekable(140);
    const transition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl,
      resumeAt: 65,
      durationSeconds: 140,
    });
    let guard = { audioUrl, position_seconds: 65, transitionGeneration: transition.generation };

    const seek = confirmWebResumeSeek({
      audio,
      resumeAt: 65,
      isCurrent: () => coordinator.isCurrent(transition),
      timeoutMs: 1000,
    });
    audio.completeSeek(65);
    await seek;
    coordinator.markEstablished(transition);
    guard = null;

    audio.currentTime = 20;
    assert.equal(coordinator.shouldIgnoreEvent('pause', audio), false);
    assert.equal(shouldBlockProgressSaveForGuard(guard, audioUrl, audio.currentTime), false);
  });

  it('prevents stale readiness from seeking, clearing loading, or changing the active episode state', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const episodeA = { audioUrl: 'https://cdn.example.com/a.mp3' };
    const episodeB = { audioUrl: 'https://cdn.example.com/b.mp3' };
    const readiness = deferred();
    const audio = {
      src: episodeB.audioUrl,
      currentSrc: episodeB.audioUrl,
      currentTime: 0,
      load() { this.currentSrc = this.src; },
    };
    let visibleCurrentTime = 50;
    let isPlaying = false;
    let loading = true;
    const transitionB = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: episodeB.audioUrl,
      resumeAt: 50,
      durationSeconds: 180,
    });
    const staleOperation = (async () => {
      await readiness.promise;
      coordinator.assertCurrent(transitionB);
      audio.currentTime = transitionB.resumeAt;
      visibleCurrentTime = transitionB.resumeAt;
      isPlaying = true;
      loading = false;
    })().catch((error) => {
      if (!isObsoleteWebPlaybackError(error)) throw error;
    });

    visibleCurrentTime = 110;
    beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: episodeA.audioUrl,
      resumeAt: 110,
      durationSeconds: 300,
    });
    readiness.resolve();
    await staleOperation;

    assert.equal(audio.currentTime, 0);
    assert.equal(visibleCurrentTime, 110);
    assert.equal(isPlaying, false);
    assert.equal(loading, true);
  });

  it('prevents stale requestWebPlayback retries from playing the new source', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const retryGate = deferred();
    const audio = {
      src: 'https://cdn.example.com/b.mp3',
      currentSrc: 'https://cdn.example.com/b.mp3',
      networkState: 2,
      playCalls: [],
      async play() {
        this.playCalls.push(this.src);
        if (this.playCalls.length === 1) {
          throw Object.assign(new Error('interrupted'), { name: 'AbortError' });
        }
      },
    };
    const transitionB = coordinator.begin({ audioUrl: audio.src, resumeAt: 50, durationSeconds: 180 });
    const playback = requestGuardedWebPlayback({
      audio,
      transitionLabel: 'manual-play',
      retryDelays: [0, 25],
      waitForMediaReady: () => retryGate.promise,
      isCurrent: () => coordinator.isCurrent(transitionB),
      logger: { log() {}, error() {} },
    }).catch((error) => {
      assert.equal(isObsoleteWebPlaybackError(error), true);
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/a.mp3',
      resumeAt: 110,
      durationSeconds: 300,
    });
    retryGate.resolve();
    await playback;

    assert.deepEqual(audio.playCalls, ['https://cdn.example.com/b.mp3']);
  });

  it('ignores source-switch reset events while preserving the selected episode UI state', () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = {
      src: 'https://cdn.example.com/a.mp3',
      currentSrc: 'https://cdn.example.com/a.mp3',
      currentTime: 0,
      duration: 0,
      load() {},
    };
    let visibleCurrentTime = 110;
    let visibleDuration = 300;
    let savedAudioUrl = null;
    const transitionA = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: audio.src,
      resumeAt: 110,
      durationSeconds: 300,
    });

    if (!coordinator.shouldIgnoreEvent('pause', audio)) savedAudioUrl = audio.src;
    if (!coordinator.shouldIgnoreEvent('timeupdate', audio)) visibleCurrentTime = audio.currentTime;
    if (!coordinator.shouldIgnoreEvent('durationchange', audio)) visibleDuration = audio.duration;

    assert.equal(savedAudioUrl, null);
    assert.equal(visibleCurrentTime, 110);
    assert.equal(visibleDuration, 300);
    assert.equal(coordinator.isCurrent(transitionA), true);
  });

  it('uses the shared web transition path for auto-next without saving A progress under B', () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = {
      src: 'https://cdn.example.com/a.mp3',
      currentSrc: 'https://cdn.example.com/a.mp3',
      currentTime: 110,
      duration: 300,
      load() { this.currentSrc = this.src; },
      pauseEvents: 0,
      pause() { this.pauseEvents += 1; },
    };
    const saved = [];
    let currentEpisode = { audioUrl: 'https://cdn.example.com/a.mp3' };
    let timersStarted = false;
    let podcastStarted = false;

    saved.push({ audioUrl: currentEpisode.audioUrl, position: audio.currentTime, duration: audio.duration });
    const transitionB = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/b.mp3',
      resumeAt: 0,
      durationSeconds: 0,
      onBeforeSource: () => {
        audio.pause();
        currentEpisode = { audioUrl: 'https://cdn.example.com/b.mp3' };
      },
    });

    assert.deepEqual(saved, [{ audioUrl: 'https://cdn.example.com/a.mp3', position: 110, duration: 300 }]);
    assert.equal(audio.pauseEvents, 1);
    assert.equal(coordinator.isCurrent(transitionB), true);
    assert.equal(coordinator.shouldIgnoreEvent('pause', audio), true);

    coordinator.markEstablished(transitionB);
    audio.currentTime = 8;
    audio.duration = 180;
    if (!coordinator.shouldIgnoreEvent('timeupdate', audio)) currentEpisode.currentTime = audio.currentTime;
    if (!coordinator.shouldIgnoreEvent('durationchange', audio)) currentEpisode.duration = audio.duration;
    if (!coordinator.shouldIgnoreEvent('playing', audio)) {
      timersStarted = true;
      podcastStarted = true;
    }
    if (!coordinator.shouldIgnoreEvent('ended', audio)) currentEpisode.ended = true;

    assert.equal(currentEpisode.audioUrl, 'https://cdn.example.com/b.mp3');
    assert.equal(currentEpisode.currentTime, 8);
    assert.equal(currentEpisode.duration, 180);
    assert.equal(timersStarted, true);
    assert.equal(podcastStarted, true);
    assert.equal(currentEpisode.ended, true);
  });

  it('does not leave a manual A transition active after auto-next switches to B', () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = { src: '', currentSrc: '', duration: 0, load() { this.currentSrc = this.src; } };
    const transitionA = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/a.mp3',
      resumeAt: 110,
      durationSeconds: 300,
    });
    coordinator.markEstablished(transitionA);

    const transitionB = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/b.mp3',
      resumeAt: 0,
      durationSeconds: 0,
    });
    coordinator.markEstablished(transitionB);

    assert.equal(coordinator.isCurrent(transitionA), false);
    assert.equal(coordinator.isCurrent(transitionB), true);
    assert.equal(coordinator.shouldIgnoreEvent('timeupdate', audio), false);
    assert.equal(coordinator.shouldIgnoreEvent('durationchange', audio), false);
    assert.equal(coordinator.shouldIgnoreEvent('playing', audio), false);
  });

  it('protects resumeAt zero from delayed reset events and does not save A under B', () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = {
      src: 'https://cdn.example.com/a.mp3',
      currentSrc: 'https://cdn.example.com/a.mp3',
      currentTime: 75,
      duration: 240,
      load() { this.currentSrc = this.src; },
    };
    let visibleCurrentTime = 0;
    let visibleDuration = 180;
    let savedAudioUrl = null;
    const transitionB = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/b.mp3',
      resumeAt: 0,
      durationSeconds: 180,
    });

    audio.currentTime = 75;
    audio.duration = 0;
    if (!coordinator.shouldIgnoreEvent('pause', audio)) savedAudioUrl = 'https://cdn.example.com/b.mp3';
    if (!coordinator.shouldIgnoreEvent('timeupdate', audio)) visibleCurrentTime = audio.currentTime;
    if (!coordinator.shouldIgnoreEvent('durationchange', audio)) visibleDuration = audio.duration;

    assert.equal(coordinator.isCurrent(transitionB), true);
    assert.equal(savedAudioUrl, null);
    assert.equal(visibleCurrentTime, 0);
    assert.equal(visibleDuration, 180);
  });

  it('ignores stale playing events until the current resource is established', () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = { src: '', currentSrc: '', load() { this.currentSrc = this.src; } };
    let loading = true;
    let timersStarted = false;
    let podcastStarted = false;
    const gate = createWebResumeRequestGate();
    const request = gate.begin();
    const transitionB = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/b.mp3',
      resumeAt: 0,
      durationSeconds: 0,
    });

    if (!coordinator.shouldIgnoreEvent('playing', audio)) {
      gate.invalidate();
      loading = false;
      timersStarted = true;
      podcastStarted = true;
    }
    assert.equal(loading, true);
    assert.equal(timersStarted, false);
    assert.equal(podcastStarted, false);
    assert.equal(gate.isCurrent(request), true);

    coordinator.markEstablished(transitionB);
    if (!coordinator.shouldIgnoreEvent('playing', audio)) {
      gate.invalidate();
      loading = false;
      timersStarted = true;
      podcastStarted = true;
    }
    assert.equal(loading, false);
    assert.equal(timersStarted, true);
    assert.equal(podcastStarted, true);
    assert.equal(gate.isCurrent(request), false);
  });

  it('allows current established events to update playback state and save progress', () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = {
      src: 'https://cdn.example.com/a.mp3',
      currentSrc: 'https://cdn.example.com/a.mp3',
      currentTime: 112,
      duration: 300,
    };
    const transitionA = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: audio.src,
      resumeAt: 110,
      durationSeconds: 300,
    });
    coordinator.markEstablished(transitionA);
    let isPlaying = false;
    let loading = true;
    let timersStarted = false;
    let podcastMarkedPlaying = false;
    let savedAudioUrl = null;

    if (!coordinator.shouldIgnoreEvent('playing', audio)) {
      loading = false;
      isPlaying = true;
      timersStarted = true;
      podcastMarkedPlaying = true;
    }
    if (!coordinator.shouldIgnoreEvent('pause', audio)) {
      savedAudioUrl = audio.src;
    }

    assert.equal(isPlaying, true);
    assert.equal(loading, false);
    assert.equal(timersStarted, true);
    assert.equal(podcastMarkedPlaying, true);
    assert.equal(savedAudioUrl, audio.src);
  });

  it('shows zero for missing cached duration and later accepts valid current durationchange', () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = {
      src: 'https://cdn.example.com/no-duration.mp3',
      currentSrc: 'https://cdn.example.com/no-duration.mp3',
      duration: 0,
    };
    const transition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: audio.src,
      resumeAt: 50,
      durationSeconds: 0,
    });
    let visibleDuration = 0;

    if (!coordinator.shouldIgnoreEvent('durationchange', audio)) visibleDuration = audio.duration;
    assert.equal(visibleDuration, 0);

    audio.duration = 240;
    coordinator.markEstablished(transition);
    if (!coordinator.shouldIgnoreEvent('durationchange', audio)) visibleDuration = audio.duration;
    assert.equal(visibleDuration, 240);
  });

  it('reconciles progress from the audio element after ignored switch-time events', () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = {
      src: '',
      currentSrc: '',
      currentTime: 75,
      duration: 240,
      load() { this.currentSrc = this.src; },
    };
    let visibleCurrentTime = 0;
    let visibleDuration = 180;
    const transition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/b.mp3',
      resumeAt: 0,
      durationSeconds: visibleDuration,
    });

    audio.currentTime = 2;
    audio.duration = 210;
    if (!coordinator.shouldIgnoreEvent('timeupdate', audio)) visibleCurrentTime = audio.currentTime;
    if (!coordinator.shouldIgnoreEvent('durationchange', audio)) visibleDuration = audio.duration;
    assert.equal(visibleCurrentTime, 0);
    assert.equal(visibleDuration, 180);

    coordinator.markEstablished(transition);
    const progress = getEstablishedWebPlaybackProgress({
      audio,
      fallbackPosition: transition.resumeAt,
      fallbackDuration: transition.durationSeconds,
    });
    visibleCurrentTime = progress.currentTime;
    visibleDuration = progress.duration;

    assert.equal(visibleCurrentTime, 2);
    assert.equal(visibleDuration, 210);
  });

  it('keeps cached duration visible when established playback has no duration yet', () => {
    const audio = {
      currentTime: 50,
      duration: Number.NaN,
    };

    assert.deepEqual(getEstablishedWebPlaybackProgress({
      audio,
      fallbackPosition: 50,
      fallbackDuration: 180,
    }), {
      currentTime: 50,
      duration: 180,
    });
  });

  it('cancels the current web transition on cleanup and starts later playback fresh', () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = { src: '', currentSrc: '', load() { this.currentSrc = this.src; } };
    const transitionA = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/a.mp3',
      resumeAt: 110,
      durationSeconds: 300,
    });
    assert.equal(coordinator.isCurrent(transitionA), true);

    coordinator.cancel();
    assert.equal(coordinator.getCurrent(), null);
    const transitionGuest = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/guest.mp3',
      resumeAt: 0,
      durationSeconds: 0,
    });

    assert.equal(coordinator.isCurrent(transitionA), false);
    assert.equal(coordinator.isCurrent(transitionGuest), true);
    assert.equal(transitionGuest.generation > transitionA.generation, true);
  });

  it('cancels and cleans up only the current manual web transition after a non-obsolete failure', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const cleanup = { timersStopped: 0, sessionPaused: 0, retryCleared: 0, loadingCleared: 0, wakeReleased: 0 };
    let isPlaying = true;
    const audio = {
      src: '',
      currentSrc: '',
      networkState: 1,
      playCalls: 0,
      load() { this.currentSrc = this.src; },
      async play() {
        this.playCalls += 1;
        throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
      },
    };
    const cleanupFailedTransition = (transition) => {
      if (!coordinator.isCurrent(transition)) return false;
      coordinator.cancel(transition);
      cleanup.timersStopped += 1;
      cleanup.sessionPaused += 1;
      cleanup.retryCleared += 1;
      cleanup.loadingCleared += 1;
      cleanup.wakeReleased += 1;
      isPlaying = false;
      return true;
    };

    const failedTransition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/b.mp3',
      resumeAt: 50,
      durationSeconds: 180,
    });
    await requestGuardedWebPlayback({
      audio,
      transitionLabel: 'manual-play',
      retryDelays: [0, 5],
      waitForMediaReady: () => Promise.resolve(),
      isCurrent: () => coordinator.isCurrent(failedTransition),
      logger: { log() {}, error() {} },
    }).catch((error) => {
      assert.equal(error.name, 'NotSupportedError');
      assert.equal(cleanupFailedTransition(failedTransition), true);
    });

    assert.equal(coordinator.getCurrent(), null);
    assert.equal(isPlaying, false);
    assert.deepEqual(cleanup, {
      timersStopped: 1,
      sessionPaused: 1,
      retryCleared: 1,
      loadingCleared: 1,
      wakeReleased: 1,
    });

    audio.play = async function playAgain() {
      this.playCalls += 1;
    };
    const retryTransition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/b.mp3',
      resumeAt: 50,
      durationSeconds: 180,
    });
    await requestGuardedWebPlayback({
      audio,
      transitionLabel: 'manual-retry',
      retryDelays: [0],
      waitForMediaReady: () => Promise.resolve(),
      isCurrent: () => coordinator.isCurrent(retryTransition),
      logger: { log() {}, error() {} },
    });
    coordinator.markEstablished(retryTransition);

    assert.equal(coordinator.getPhase(retryTransition), 'established');
    assert.equal(audio.playCalls, 2);
  });

  it('cancels a current auto-next failure without affecting newer transitions', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = {
      src: '',
      currentSrc: '',
      networkState: 1,
      load() { this.currentSrc = this.src; },
      async play() {
        throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
      },
    };
    let cleanupCount = 0;
    const cleanupFailedTransition = (transition) => {
      if (!coordinator.isCurrent(transition)) return false;
      cleanupCount += 1;
      coordinator.cancel(transition);
      return true;
    };

    const transitionB = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/b.mp3',
      resumeAt: 0,
      durationSeconds: 0,
    });
    await requestGuardedWebPlayback({
      audio,
      transitionLabel: 'advance:ended',
      retryDelays: [0],
      waitForMediaReady: () => Promise.resolve(),
      isCurrent: () => coordinator.isCurrent(transitionB),
      logger: { log() {}, error() {} },
    }).catch((error) => {
      assert.equal(error.name, 'NotSupportedError');
      assert.equal(cleanupFailedTransition(transitionB), true);
    });

    assert.equal(coordinator.getCurrent(), null);
    assert.equal(cleanupCount, 1);

    audio.play = async () => {};
    const retryB = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/b.mp3',
      resumeAt: 0,
      durationSeconds: 0,
    });
    await requestGuardedWebPlayback({
      audio,
      transitionLabel: 'advance:retry',
      retryDelays: [0],
      waitForMediaReady: () => Promise.resolve(),
      isCurrent: () => coordinator.isCurrent(retryB),
      logger: { log() {}, error() {} },
    });
    coordinator.markEstablished(retryB);

    assert.equal(coordinator.getPhase(retryB), 'established');
  });

  it('keeps a newer transition intact when an obsolete failure resolves later', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const firstPlay = deferred();
    const audio = {
      src: '',
      currentSrc: '',
      networkState: 1,
      load() { this.currentSrc = this.src; },
      play: () => firstPlay.promise,
    };
    let cleanupCount = 0;
    const transitionB = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/b.mp3',
      resumeAt: 50,
      durationSeconds: 180,
    });
    const staleAttempt = requestGuardedWebPlayback({
      audio,
      transitionLabel: 'manual-play',
      retryDelays: [0],
      waitForMediaReady: () => Promise.resolve(),
      isCurrent: () => coordinator.isCurrent(transitionB),
      logger: { log() {}, error() {} },
    }).catch((error) => {
      assert.equal(isObsoleteWebPlaybackError(error), true);
      if (coordinator.isCurrent(transitionB)) {
        cleanupCount += 1;
        coordinator.cancel(transitionB);
      }
    });

    const transitionA = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/a.mp3',
      resumeAt: 110,
      durationSeconds: 300,
    });
    firstPlay.reject(Object.assign(new Error('unsupported'), { name: 'NotSupportedError' }));
    await staleAttempt;

    assert.equal(cleanupCount, 0);
    assert.equal(coordinator.isCurrent(transitionA), true);
    assert.equal(coordinator.getPhase(transitionA), 'switching');
  });

  it('replaces a switching same-episode retry instead of calling direct play on the old generation', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const originalPlay = deferred();
    const audio = {
      src: '',
      currentSrc: '',
      playCalls: [],
      load() { this.currentSrc = this.src; },
      play() {
        this.playCalls.push({ generation: coordinator.getCurrent()?.generation, src: this.src });
        if (this.playCalls.length === 1) return originalPlay.promise;
        return Promise.resolve();
      },
    };
    const originalTransition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/b.mp3',
      resumeAt: 50,
      durationSeconds: 180,
    });
    const originalAttempt = requestGuardedWebPlayback({
      audio,
      transitionLabel: 'manual-play',
      retryDelays: [0],
      waitForMediaReady: () => Promise.resolve(),
      isCurrent: () => coordinator.isCurrent(originalTransition),
      logger: { log() {}, error() {} },
    }).catch((error) => {
      assert.equal(isObsoleteWebPlaybackError(error), true);
    });

    assert.equal(coordinator.getPhase(originalTransition), 'switching');
    const retryTransition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/b.mp3',
      resumeAt: 50,
      durationSeconds: 180,
    });
    await requestGuardedWebPlayback({
      audio,
      transitionLabel: 'manual-retry',
      retryDelays: [0],
      waitForMediaReady: () => Promise.resolve(),
      isCurrent: () => coordinator.isCurrent(retryTransition),
      logger: { log() {}, error() {} },
    });
    coordinator.markEstablished(retryTransition);
    originalPlay.resolve();
    await originalAttempt;

    assert.equal(coordinator.isCurrent(originalTransition), false);
    assert.equal(coordinator.getPhase(retryTransition), 'established');
    assert.deepEqual(audio.playCalls.map(call => call.generation), [
      originalTransition.generation,
      retryTransition.generation,
    ]);
  });

  it('allows direct same-episode resume after the web transition is established', async () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = {
      src: '',
      currentSrc: '',
      directPlayCalls: 0,
      load() { this.currentSrc = this.src; },
      async play() {
        this.directPlayCalls += 1;
      },
    };
    const transitionB = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/b.mp3',
      resumeAt: 50,
      durationSeconds: 180,
    });
    coordinator.markEstablished(transitionB);

    if (coordinator.getPhase(transitionB) === 'established') {
      await audio.play();
    }

    assert.equal(audio.directPlayCalls, 1);
    assert.equal(coordinator.isCurrent(transitionB), true);
    assert.equal(coordinator.getPhase(transitionB), 'established');
  });

  it('keeps native same-episode resume and toggle outside the web coordinator', () => {
    const coordinator = createWebPlaybackTransitionCoordinator();
    const audio = { src: '', currentSrc: '', load() { this.currentSrc = this.src; } };
    const nativePlayer = {
      resumeCalls: 0,
      pauseCalls: 0,
      resume() { this.resumeCalls += 1; },
      pause() { this.pauseCalls += 1; },
    };
    const transition = beginWebEpisodeSourceSwitch({
      coordinator,
      audio,
      audioUrl: 'https://cdn.example.com/web.mp3',
      resumeAt: 0,
      durationSeconds: 0,
    });

    nativePlayer.resume();
    nativePlayer.pause();

    assert.equal(nativePlayer.resumeCalls, 1);
    assert.equal(nativePlayer.pauseCalls, 1);
    assert.equal(coordinator.isCurrent(transition), true);
    assert.equal(coordinator.getPhase(transition), 'switching');
  });
});
