import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

function createJwt({ sub = 'clerk-prod-user', email = 'real@example.com', name = 'Real User' } = {}) {
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

function request(path, { token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`https://api.voxyl.test${path}`, { headers });
}

async function body(response) {
  return response.json();
}

function identityStateSnapshot(state) {
  return JSON.stringify({
    users: state.users,
    playlists: state.playlists,
    playlistLikes: state.playlistLikes,
    podcastLikes: state.podcastLikes,
    podcastPlays: state.podcastPlays,
    episodeProgress: state.episodeProgress,
    follows: state.follows,
    blocks: state.blocks,
    reports: state.reports,
    referrals: state.referrals,
  });
}

function normalizeTestEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function normalizeTestName(name) {
  return String(name ?? '').trim().toLowerCase();
}

function baseUser(overrides) {
  return {
    id: 'd1-real-user',
    clerk_user_id: 'clerk-dev-user',
    legacy_base44_user_id: 'legacy-real-user',
    email: 'real@example.com',
    name: 'Real User',
    username: 'real',
    role: 'user',
    profile_picture: null,
    profile_hidden: 0,
    imported_at: '2026-07-01T00:00:00.000Z',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

const productionCanonicalUserId = '69e2ae13aa773b21002b1fe5';
const productionDevClerkUserId = 'user_3GEQX0wuk6BL8CBIeiU222Dfcj2';
const productionEmail = 'renatobrant@gmail.com';

function productionCanonicalUser(overrides = {}) {
  return baseUser({
    id: productionCanonicalUserId,
    clerk_user_id: productionDevClerkUserId,
    legacy_base44_user_id: productionCanonicalUserId,
    email: productionEmail,
    name: 'Renato Brant',
    username: 'renatobrant',
    imported_at: '2026-07-08T22:14:25.690Z',
    created_at: '2026-07-08 22:34:08',
    ...overrides,
  });
}

function productionOrphanUser(overrides = {}) {
  return baseUser({
    id: productionDevClerkUserId,
    clerk_user_id: null,
    legacy_base44_user_id: null,
    email: productionEmail,
    name: 'Renato Brant',
    username: null,
    role: 'user',
    profile_picture: null,
    profile_hidden: 0,
    imported_at: null,
    created_at: '2026-07-08 19:16:52',
    updated_at: '2026-07-09 03:34:38',
    ...overrides,
  });
}

function createAuthMigrationDb({ users, beforeBatch } = {}) {
  const state = {
    users: users || [
      baseUser(),
      baseUser({
        id: 'other-user',
        clerk_user_id: 'clerk-other',
        legacy_base44_user_id: null,
        email: 'other@example.com',
        username: 'other',
        imported_at: null,
      }),
    ],
    playlists: [
      { id: 'playlist-1', creator_id: 'd1-real-user', creator_clerk_user_id: 'clerk-dev-user', creator_legacy_base44_user_id: 'legacy-real-user' },
    ],
    playlistLikes: [
      { id: 'playlist-like-1', playlist_id: 'playlist-1', user_id: 'd1-real-user', clerk_user_id: 'clerk-dev-user', legacy_base44_user_id: 'legacy-real-user' },
    ],
    podcastLikes: [
      { id: 'podcast-like-1', user_id: 'd1-real-user', clerk_user_id: 'clerk-dev-user', legacy_base44_user_id: 'legacy-real-user' },
    ],
    podcastPlays: [
      { id: 'podcast-play-1', user_id: 'd1-real-user', clerk_user_id: 'clerk-dev-user', legacy_base44_user_id: 'legacy-real-user' },
    ],
    episodeProgress: [
      { id: 'progress-1', user_id: 'd1-real-user', clerk_user_id: 'clerk-dev-user', legacy_base44_user_id: 'legacy-real-user', audio_url: 'https://cdn.example.com/one.mp3' },
    ],
    follows: [
      { id: 'follow-out', follower_id: 'd1-real-user', follower_clerk_user_id: 'clerk-dev-user', follower_legacy_base44_user_id: 'legacy-real-user', following_id: 'other-user', following_clerk_user_id: 'clerk-other', following_legacy_base44_user_id: null },
      { id: 'follow-in', follower_id: 'other-user', follower_clerk_user_id: 'clerk-other', follower_legacy_base44_user_id: null, following_id: 'd1-real-user', following_clerk_user_id: 'clerk-dev-user', following_legacy_base44_user_id: 'legacy-real-user' },
    ],
    blocks: [
      { id: 'block-out', blocker_id: 'd1-real-user', blocker_clerk_user_id: 'clerk-dev-user', blocker_legacy_base44_user_id: 'legacy-real-user', blocked_id: 'other-user', blocked_clerk_user_id: 'clerk-other', blocked_legacy_base44_user_id: null },
      { id: 'block-in', blocker_id: 'other-user', blocker_clerk_user_id: 'clerk-other', blocker_legacy_base44_user_id: null, blocked_id: 'd1-real-user', blocked_clerk_user_id: 'clerk-dev-user', blocked_legacy_base44_user_id: 'legacy-real-user' },
    ],
    reports: [
      { id: 'report-1', reporter_id: 'd1-real-user', reporter_clerk_user_id: 'clerk-dev-user', reporter_legacy_base44_user_id: 'legacy-real-user' },
    ],
    referrals: [
      { id: 'referral-out', inviter_id: 'd1-real-user', inviter_clerk_user_id: 'clerk-dev-user', inviter_legacy_base44_user_id: 'legacy-real-user', invitee_user_id: 'other-user', invitee_clerk_user_id: 'clerk-other', invitee_legacy_base44_user_id: null },
      { id: 'referral-in', inviter_id: 'other-user', inviter_clerk_user_id: 'clerk-other', inviter_legacy_base44_user_id: null, invitee_user_id: 'd1-real-user', invitee_clerk_user_id: 'clerk-dev-user', invitee_legacy_base44_user_id: 'legacy-real-user' },
    ],
    calls: [],
    beforeBatch,
  };

  function emailUser(email, legacyOnly) {
    const rows = state.users
      .filter((user) => normalizeTestEmail(user.email) === normalizeTestEmail(email))
      .filter((user) => !legacyOnly || user.legacy_base44_user_id)
      .sort((left, right) => {
        const legacyOrder = Number(!left.legacy_base44_user_id) - Number(!right.legacy_base44_user_id);
        if (legacyOrder !== 0) return legacyOrder;
        const importedOrder = Number(!left.imported_at) - Number(!right.imported_at);
        if (importedOrder !== 0) return importedOrder;
        return String(left.created_at).localeCompare(String(right.created_at));
      });
    return rows[0] || null;
  }

  function emailUsers(email) {
    return state.users
      .filter((user) => normalizeTestEmail(user.email) === normalizeTestEmail(email))
      .sort((left, right) => {
        const importedOrder = Number(!left.imported_at) - Number(!right.imported_at);
        if (importedOrder !== 0) return importedOrder;
        return String(left.created_at).localeCompare(String(right.created_at));
      });
  }

  function referenceCount(userId, clerkUserId = null) {
    return [
      state.playlists.filter((row) => row.creator_id === userId || row.creator_clerk_user_id === clerkUserId).length,
      state.playlistLikes.filter((row) => row.user_id === userId || row.clerk_user_id === clerkUserId).length,
      state.podcastLikes.filter((row) => row.user_id === userId || row.clerk_user_id === clerkUserId).length,
      state.podcastPlays.filter((row) => row.user_id === userId || row.clerk_user_id === clerkUserId).length,
      state.episodeProgress.filter((row) => row.user_id === userId || row.clerk_user_id === clerkUserId).length,
      state.follows.filter((row) => row.follower_id === userId || row.follower_clerk_user_id === clerkUserId || row.following_id === userId || row.following_clerk_user_id === clerkUserId).length,
      state.blocks.filter((row) => row.blocker_id === userId || row.blocker_clerk_user_id === clerkUserId || row.blocked_id === userId || row.blocked_clerk_user_id === clerkUserId).length,
      state.reports.filter((row) => row.reporter_id === userId || row.reporter_clerk_user_id === clerkUserId || row.reported_user_id === userId).length,
      state.referrals.filter((row) => row.inviter_id === userId || row.inviter_clerk_user_id === clerkUserId || row.invitee_user_id === userId || row.invitee_clerk_user_id === clerkUserId).length,
    ].reduce((sum, count) => sum + count, 0);
  }

  function stableReferenceCount(userId) {
    return [
      state.playlists.filter((row) => row.creator_id === userId).length,
      state.playlistLikes.filter((row) => row.user_id === userId).length,
      state.podcastLikes.filter((row) => row.user_id === userId).length,
      state.podcastPlays.filter((row) => row.user_id === userId).length,
      state.episodeProgress.filter((row) => row.user_id === userId).length,
      state.follows.filter((row) => row.follower_id === userId || row.following_id === userId).length,
      state.blocks.filter((row) => row.blocker_id === userId || row.blocked_id === userId).length,
      state.reports.filter((row) => row.reporter_id === userId || row.reported_user_id === userId).length,
      state.referrals.filter((row) => row.inviter_id === userId || row.invitee_user_id === userId).length,
    ].reduce((sum, count) => sum + count, 0);
  }

  function updateRows(rows, params, column, idColumn, legacyColumn, clerkColumn) {
    const [newClerkUserId, userId, legacyBase44UserId, oldClerkUserId] = params;
    if (!state.users.some((user) => user.id === params.at(-2) && user.clerk_user_id === params.at(-1))) {
      return 0;
    }
    let changes = 0;
    for (const row of rows) {
      if (
        row[idColumn] === userId ||
        (legacyBase44UserId && row[legacyColumn] === legacyBase44UserId) ||
        (oldClerkUserId && row[clerkColumn] === oldClerkUserId)
      ) {
        row[column] = newClerkUserId;
        changes += 1;
      }
    }
    return changes;
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(state));
  }

  function restore(previous) {
    for (const [key, value] of Object.entries(previous)) {
      state[key] = value;
    }
  }

  return {
    state,
    async batch(statements) {
      state.calls.push({ kind: 'batch', statements: statements.map((statement) => ({ sql: statement.sql, params: statement.params })) });
      if (state.beforeBatch) {
        state.beforeBatch(state);
        state.beforeBatch = null;
      }
      const previous = snapshot();
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        return results;
      } catch (error) {
        restore(previous);
        throw error;
      }
    },
    prepare(sql) {
      return {
        bind(...params) {
          const bound = {
            sql,
            params,
            async first() {
              state.calls.push({ kind: 'first', sql, params });
              if (/FROM users\s+WHERE clerk_user_id = \?/s.test(sql)) {
                return state.users.find((user) => user.clerk_user_id === params[0]) || null;
              }
              if (/FROM users\s+WHERE lower\((?:TRIM\()?email/s.test(sql)) {
                return emailUser(params[0], /legacy_base44_user_id IS NOT NULL/s.test(sql));
              }
              if (/SELECT \(/s.test(sql) && /AS count/s.test(sql)) {
                return { count: /creator_clerk_user_id/s.test(sql) ? referenceCount(params[0], params[1]) : stableReferenceCount(params[0]) };
              }
              throw new Error(`Unhandled first SQL: ${sql}`);
            },
            async all() {
              state.calls.push({ kind: 'all', sql, params });
              if (/FROM users\s+WHERE lower\((?:TRIM\()?email/s.test(sql)) {
                return { results: emailUsers(params[0]) };
              }
              throw new Error(`Unhandled all SQL: ${sql}`);
            },
            async run() {
              state.calls.push({ kind: 'run', sql, params });
              if (/INSERT INTO users/s.test(sql)) {
                const [id, clerk_user_id, email, name] = params;
                if (!state.users.some((user) => user.clerk_user_id === clerk_user_id)) {
                  state.users.push(baseUser({ id, clerk_user_id, email, name, legacy_base44_user_id: null, username: null, imported_at: null }));
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (/DELETE FROM users/s.test(sql)) {
                if (/AND clerk_user_id IS NULL/s.test(sql)) {
                  const [
                    orphanId,
                    email,
                    canonicalPrecondition,
                    expectedOrphanId,
                    canonicalId,
                    canonicalClerkPrecondition,
                  ] = params;
                  const orphan = state.users.find((user) => user.id === orphanId);
                  const canonical = state.users.find((user) => user.id === canonicalId);
                  const before = state.users.length;
                  if (
                    orphan &&
                    canonical &&
                    orphan.id === expectedOrphanId &&
                    orphan.id === canonicalPrecondition &&
                    orphan.clerk_user_id === null &&
                    !orphan.legacy_base44_user_id &&
                    normalizeTestEmail(orphan.email) === normalizeTestEmail(email) &&
                    (!normalizeTestName(orphan.name) || normalizeTestName(orphan.name) === normalizeTestName(canonical.name)) &&
                    orphan.username === null &&
                    orphan.profile_picture === null &&
                    (orphan.role || 'user') === 'user' &&
                    Number(orphan.profile_hidden || 0) === 0 &&
                    orphan.imported_at === null &&
                    canonical.clerk_user_id === canonicalClerkPrecondition &&
                    stableReferenceCount(orphanId) === 0
                  ) {
                    state.users = state.users.filter((user) => user.id !== orphanId);
                  }
                  return { meta: { changes: before - state.users.length } };
                }
                const [
                  placeholderId,
                  clerkUserId,
                  email,
                  canonicalId,
                  canonicalPrecondition,
                ] = params;
                const canonical = state.users.find((user) => user.id === canonicalId);
                const canonicalMatches = canonical && (
                  (canonicalPrecondition === null && canonical.clerk_user_id === null) ||
                  canonical.clerk_user_id === canonicalPrecondition
                );
                const before = state.users.length;
                if (canonicalMatches && referenceCount(placeholderId, clerkUserId) === 0) {
                  state.users = state.users.filter((user) => !(user.id === placeholderId && user.clerk_user_id === clerkUserId && !user.legacy_base44_user_id && normalizeTestEmail(user.email) === normalizeTestEmail(email)));
                }
                return { meta: { changes: before - state.users.length } };
              }
              if (/UPDATE users\s+       SET clerk_user_id/s.test(sql)) {
                const [clerkUserId, email, name, id, oldClerkUserId] = params;
                const orphanGuardId = params[6];
                if (orphanGuardId && state.users.some((item) => item.id === orphanGuardId)) return { meta: { changes: 0 } };
                const user = state.users.find((item) => item.id === id && ((oldClerkUserId === null && item.clerk_user_id === null) || item.clerk_user_id === oldClerkUserId));
                if (!user) return { meta: { changes: 0 } };
                const conflict = state.users.find((item) => item.id !== id && item.clerk_user_id === clerkUserId);
                if (conflict) throw new Error('UNIQUE constraint failed: users.clerk_user_id');
                user.clerk_user_id = clerkUserId;
                user.email ||= email;
                user.name ||= name;
                return { meta: { changes: 1 } };
              }
              if (/UPDATE playlists/s.test(sql)) return { meta: { changes: updateRows(state.playlists, params, 'creator_clerk_user_id', 'creator_id', 'creator_legacy_base44_user_id', 'creator_clerk_user_id') } };
              if (/UPDATE playlist_likes/s.test(sql)) return { meta: { changes: updateRows(state.playlistLikes, params, 'clerk_user_id', 'user_id', 'legacy_base44_user_id', 'clerk_user_id') } };
              if (/UPDATE podcast_likes/s.test(sql)) return { meta: { changes: updateRows(state.podcastLikes, params, 'clerk_user_id', 'user_id', 'legacy_base44_user_id', 'clerk_user_id') } };
              if (/UPDATE podcast_plays/s.test(sql)) return { meta: { changes: updateRows(state.podcastPlays, params, 'clerk_user_id', 'user_id', 'legacy_base44_user_id', 'clerk_user_id') } };
              if (/UPDATE episode_progress/s.test(sql)) return { meta: { changes: updateRows(state.episodeProgress, params, 'clerk_user_id', 'user_id', 'legacy_base44_user_id', 'clerk_user_id') } };
              if (/UPDATE follows\s+       SET follower_clerk_user_id/s.test(sql)) return { meta: { changes: updateRows(state.follows, params, 'follower_clerk_user_id', 'follower_id', 'follower_legacy_base44_user_id', 'follower_clerk_user_id') } };
              if (/UPDATE follows\s+       SET following_clerk_user_id/s.test(sql)) return { meta: { changes: updateRows(state.follows, params, 'following_clerk_user_id', 'following_id', 'following_legacy_base44_user_id', 'following_clerk_user_id') } };
              if (/UPDATE blocks\s+       SET blocker_clerk_user_id/s.test(sql)) return { meta: { changes: updateRows(state.blocks, params, 'blocker_clerk_user_id', 'blocker_id', 'blocker_legacy_base44_user_id', 'blocker_clerk_user_id') } };
              if (/UPDATE blocks\s+       SET blocked_clerk_user_id/s.test(sql)) return { meta: { changes: updateRows(state.blocks, params, 'blocked_clerk_user_id', 'blocked_id', 'blocked_legacy_base44_user_id', 'blocked_clerk_user_id') } };
              if (/UPDATE reports/s.test(sql)) return { meta: { changes: updateRows(state.reports, params, 'reporter_clerk_user_id', 'reporter_id', 'reporter_legacy_base44_user_id', 'reporter_clerk_user_id') } };
              if (/UPDATE referrals\s+       SET inviter_clerk_user_id/s.test(sql)) return { meta: { changes: updateRows(state.referrals, params, 'inviter_clerk_user_id', 'inviter_id', 'inviter_legacy_base44_user_id', 'inviter_clerk_user_id') } };
              if (/UPDATE referrals\s+       SET invitee_clerk_user_id/s.test(sql)) return { meta: { changes: updateRows(state.referrals, params, 'invitee_clerk_user_id', 'invitee_user_id', 'invitee_legacy_base44_user_id', 'invitee_clerk_user_id') } };
              throw new Error(`Unhandled run SQL: ${sql}`);
            },
          };
          return bound;
        },
      };
    },
  };
}

function createProductionOrphanDb(options = {}) {
  const db = createAuthMigrationDb({
    users: [
      productionCanonicalUser(options.canonicalOverrides),
      productionOrphanUser(options.orphanOverrides),
      baseUser({
        id: 'production-other-user',
        clerk_user_id: 'user_other',
        legacy_base44_user_id: null,
        email: 'other-production@example.com',
        username: 'other-production',
        imported_at: null,
      }),
    ],
    beforeBatch: options.beforeBatch,
  });

  db.state.playlists = [
    { id: 'prod-playlist-1', creator_id: productionCanonicalUserId, creator_clerk_user_id: productionDevClerkUserId, creator_legacy_base44_user_id: productionCanonicalUserId },
  ];
  db.state.playlistLikes = [
    { id: 'prod-playlist-like-1', playlist_id: 'prod-playlist-1', user_id: productionCanonicalUserId, clerk_user_id: productionDevClerkUserId, legacy_base44_user_id: productionCanonicalUserId },
  ];
  db.state.podcastLikes = [
    { id: 'prod-podcast-like-1', user_id: productionCanonicalUserId, clerk_user_id: productionDevClerkUserId, legacy_base44_user_id: productionCanonicalUserId },
  ];
  db.state.podcastPlays = [
    { id: 'prod-podcast-play-1', user_id: productionCanonicalUserId, clerk_user_id: productionDevClerkUserId, legacy_base44_user_id: productionCanonicalUserId },
  ];
  db.state.episodeProgress = [
    { id: 'prod-progress-1', user_id: productionCanonicalUserId, clerk_user_id: productionDevClerkUserId, legacy_base44_user_id: productionCanonicalUserId, audio_url: 'https://cdn.example.com/prod.mp3' },
  ];
  db.state.follows = [
    { id: 'prod-follow-out', follower_id: productionCanonicalUserId, follower_clerk_user_id: productionDevClerkUserId, follower_legacy_base44_user_id: productionCanonicalUserId, following_id: 'production-other-user', following_clerk_user_id: 'user_other', following_legacy_base44_user_id: null },
    { id: 'prod-follow-in', follower_id: 'production-other-user', follower_clerk_user_id: 'user_other', follower_legacy_base44_user_id: null, following_id: productionCanonicalUserId, following_clerk_user_id: productionDevClerkUserId, following_legacy_base44_user_id: productionCanonicalUserId },
  ];
  db.state.blocks = [
    { id: 'prod-block-out', blocker_id: productionCanonicalUserId, blocker_clerk_user_id: productionDevClerkUserId, blocker_legacy_base44_user_id: productionCanonicalUserId, blocked_id: 'production-other-user', blocked_clerk_user_id: 'user_other', blocked_legacy_base44_user_id: null },
    { id: 'prod-block-in', blocker_id: 'production-other-user', blocker_clerk_user_id: 'user_other', blocker_legacy_base44_user_id: null, blocked_id: productionCanonicalUserId, blocked_clerk_user_id: productionDevClerkUserId, blocked_legacy_base44_user_id: productionCanonicalUserId },
  ];
  db.state.reports = [
    { id: 'prod-report-1', reporter_id: productionCanonicalUserId, reporter_clerk_user_id: productionDevClerkUserId, reporter_legacy_base44_user_id: productionCanonicalUserId, reported_user_id: 'production-other-user' },
  ];
  db.state.referrals = [
    { id: 'prod-referral-out', inviter_id: productionCanonicalUserId, inviter_clerk_user_id: productionDevClerkUserId, inviter_legacy_base44_user_id: productionCanonicalUserId, invitee_user_id: 'production-other-user', invitee_clerk_user_id: 'user_other', invitee_legacy_base44_user_id: null },
    { id: 'prod-referral-in', inviter_id: 'production-other-user', inviter_clerk_user_id: 'user_other', inviter_legacy_base44_user_id: null, invitee_user_id: productionCanonicalUserId, invitee_clerk_user_id: productionDevClerkUserId, invitee_legacy_base44_user_id: productionCanonicalUserId },
  ];

  return db;
}

afterEach(() => {
  mock.restoreAll();
});

describe('Clerk production identity migration', () => {
  it('resolves the exact production canonical user during current Development authentication and removes the orphan', async () => {
    const { token, jwk } = createJwt({ sub: productionDevClerkUserId, email: productionEmail, name: 'Renato Brant' });
    installJwksMock(jwk);
    const db = createProductionOrphanDb();

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.user.id, productionCanonicalUserId);
    assert.equal(data.user.clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.users.some((user) => user.id === productionDevClerkUserId), false);
    assert.equal(db.state.users.filter((user) => user.email === productionEmail).length, 1);
    assert.equal(db.state.playlists[0].creator_id, productionCanonicalUserId);
    assert.equal(db.state.playlists[0].creator_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.podcastPlays[0].user_id, productionCanonicalUserId);
    assert.equal(db.state.podcastPlays[0].clerk_user_id, productionDevClerkUserId);
  });

  it('relinks the exact production canonical user for future Production authentication without inheriting orphan Clerk counts', async () => {
    const productionClerkUserId = 'user_production_new';
    const { token, jwk } = createJwt({ sub: productionClerkUserId, email: productionEmail, name: 'Renato Brant' });
    installJwksMock(jwk);
    const db = createProductionOrphanDb();

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.user.id, productionCanonicalUserId);
    assert.equal(data.user.clerk_user_id, productionClerkUserId);
    assert.equal(db.state.users.some((user) => user.id === productionDevClerkUserId), false);
    assert.equal(db.state.users.find((user) => user.id === productionCanonicalUserId).clerk_user_id, productionClerkUserId);
    assert.equal(db.state.users.filter((user) => user.email === productionEmail).length, 1);
    assert.equal(db.state.playlists[0].creator_id, productionCanonicalUserId);
    assert.equal(db.state.playlists[0].creator_clerk_user_id, productionClerkUserId);
    assert.equal(db.state.playlistLikes[0].user_id, productionCanonicalUserId);
    assert.equal(db.state.playlistLikes[0].clerk_user_id, productionClerkUserId);
    assert.equal(db.state.podcastLikes[0].user_id, productionCanonicalUserId);
    assert.equal(db.state.podcastLikes[0].clerk_user_id, productionClerkUserId);
    assert.equal(db.state.podcastPlays[0].user_id, productionCanonicalUserId);
    assert.equal(db.state.podcastPlays[0].clerk_user_id, productionClerkUserId);
    assert.equal(db.state.episodeProgress[0].user_id, productionCanonicalUserId);
    assert.equal(db.state.episodeProgress[0].clerk_user_id, productionClerkUserId);
    assert.equal(db.state.follows[0].follower_clerk_user_id, productionClerkUserId);
    assert.equal(db.state.follows[1].following_clerk_user_id, productionClerkUserId);
    assert.equal(db.state.blocks[0].blocker_clerk_user_id, productionClerkUserId);
    assert.equal(db.state.blocks[1].blocked_clerk_user_id, productionClerkUserId);
    assert.equal(db.state.reports[0].reporter_clerk_user_id, productionClerkUserId);
    assert.equal(db.state.referrals[0].inviter_clerk_user_id, productionClerkUserId);
    assert.equal(db.state.referrals[1].invitee_clerk_user_id, productionClerkUserId);
  });

  it('keeps the exact production orphan unchanged when it has a stable reference', async () => {
    const productionClerkUserId = 'user_production_new';
    const { token, jwk } = createJwt({ sub: productionClerkUserId, email: productionEmail, name: 'Renato Brant' });
    installJwksMock(jwk);
    const db = createProductionOrphanDb();
    db.state.podcastPlays.push({ id: 'orphan-stable-play', user_id: productionDevClerkUserId, clerk_user_id: null, legacy_base44_user_id: null });
    const before = identityStateSnapshot(db.state);

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 409);
    assert.equal(data.code, 'identity-conflict');
    assert.equal(identityStateSnapshot(db.state), before);
  });

  it('keeps the exact production orphan unchanged when it has customized profile state', async () => {
    const productionClerkUserId = 'user_production_new';
    const { token, jwk } = createJwt({ sub: productionClerkUserId, email: productionEmail, name: 'Renato Brant' });
    installJwksMock(jwk);
    const db = createProductionOrphanDb({ orphanOverrides: { username: 'unexpected-orphan' } });
    const before = identityStateSnapshot(db.state);

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 409);
    assert.equal(data.code, 'identity-conflict');
    assert.equal(identityStateSnapshot(db.state), before);
  });

  it('keeps the exact production orphan unchanged when it has an unrelated name', async () => {
    const productionClerkUserId = 'user_production_new';
    const { token, jwk } = createJwt({ sub: productionClerkUserId, email: productionEmail, name: 'Renato Brant' });
    installJwksMock(jwk);
    const db = createProductionOrphanDb({ orphanOverrides: { name: 'Different Person' } });
    const before = identityStateSnapshot(db.state);

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 409);
    assert.equal(data.code, 'identity-conflict');
    assert.equal(identityStateSnapshot(db.state), before);
  });

  it('does not partially migrate when the production orphan gains a stable relationship before the batch', async () => {
    const productionClerkUserId = 'user_production_new';
    const { token, jwk } = createJwt({ sub: productionClerkUserId, email: productionEmail, name: 'Renato Brant' });
    installJwksMock(jwk);
    const db = createProductionOrphanDb({
      beforeBatch(state) {
        state.podcastPlays.push({ id: 'orphan-race-play', user_id: productionDevClerkUserId, clerk_user_id: null, legacy_base44_user_id: null });
      },
    });

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 409);
    assert.equal(data.code, 'identity-conflict');
    assert.equal(db.state.users.find((user) => user.id === productionCanonicalUserId).clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.users.some((user) => user.id === productionDevClerkUserId), true);
    assert.equal(db.state.podcastPlays.some((row) => row.id === 'orphan-race-play'), true);
    assert.equal(db.state.playlists[0].creator_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.playlistLikes[0].clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.podcastLikes[0].clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.podcastPlays[0].clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.episodeProgress[0].clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.follows[0].follower_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.follows[1].following_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.blocks[0].blocker_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.blocks[1].blocked_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.reports[0].reporter_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.referrals[0].inviter_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.referrals[1].invitee_clerk_user_id, productionDevClerkUserId);
  });

  it('does not partially migrate when the production orphan name changes before the batch', async () => {
    const productionClerkUserId = 'user_production_new';
    const { token, jwk } = createJwt({ sub: productionClerkUserId, email: productionEmail, name: 'Renato Brant' });
    installJwksMock(jwk);
    const db = createProductionOrphanDb({
      beforeBatch(state) {
        state.users.find((user) => user.id === productionDevClerkUserId).name = 'Different Person';
      },
    });

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 409);
    assert.equal(data.code, 'identity-conflict');
    assert.equal(db.state.users.find((user) => user.id === productionCanonicalUserId).clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.users.find((user) => user.id === productionDevClerkUserId).name, 'Different Person');
    assert.equal(db.state.playlists[0].creator_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.playlistLikes[0].clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.podcastLikes[0].clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.podcastPlays[0].clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.episodeProgress[0].clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.follows[0].follower_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.follows[1].following_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.blocks[0].blocker_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.blocks[1].blocked_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.reports[0].reporter_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.referrals[0].inviter_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.referrals[1].invitee_clerk_user_id, productionDevClerkUserId);
  });

  it('accepts exact production orphans with null or blank names', async () => {
    for (const orphanName of [null, '   ']) {
      const productionClerkUserId = `user_production_${orphanName === null ? 'null' : 'blank'}`;
      const { token, jwk } = createJwt({ sub: productionClerkUserId, email: productionEmail, name: 'Renato Brant' });
      installJwksMock(jwk);
      const db = createProductionOrphanDb({ orphanOverrides: { name: orphanName } });

      const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
      const data = await body(response);

      assert.equal(response.status, 200);
      assert.equal(data.user.id, productionCanonicalUserId);
      assert.equal(db.state.users.some((user) => user.id === productionDevClerkUserId), false);
      assert.equal(db.state.users.find((user) => user.id === productionCanonicalUserId).clerk_user_id, productionClerkUserId);
    }
  });

  it('does not partially migrate when the production canonical old Clerk ID changes before the batch', async () => {
    const productionClerkUserId = 'user_production_new';
    const { token, jwk } = createJwt({ sub: productionClerkUserId, email: productionEmail, name: 'Renato Brant' });
    installJwksMock(jwk);
    const db = createProductionOrphanDb({
      beforeBatch(state) {
        state.users.find((user) => user.id === productionCanonicalUserId).clerk_user_id = 'user_raced';
      },
    });

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 409);
    assert.equal(data.code, 'identity-conflict');
    assert.equal(db.state.users.find((user) => user.id === productionCanonicalUserId).clerk_user_id, 'user_raced');
    assert.equal(db.state.users.some((user) => user.id === productionDevClerkUserId), true);
    assert.equal(db.state.playlists[0].creator_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.playlistLikes[0].clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.podcastLikes[0].clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.podcastPlays[0].clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.episodeProgress[0].clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.follows[0].follower_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.follows[1].following_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.blocks[0].blocker_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.blocks[1].blocked_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.reports[0].reporter_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.referrals[0].inviter_clerk_user_id, productionDevClerkUserId);
    assert.equal(db.state.referrals[1].invitee_clerk_user_id, productionDevClerkUserId);
  });

  it('replaces a development Clerk ID with the production Clerk ID without changing the D1 user', async () => {
    const { token, jwk } = createJwt({ sub: 'clerk-prod-user', email: 'REAL@example.com' });
    installJwksMock(jwk);
    const db = createAuthMigrationDb();

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.user.id, 'd1-real-user');
    assert.equal(data.user.clerk_user_id, 'clerk-prod-user');
    assert.equal(data.user.legacy_base44_user_id, 'legacy-real-user');
    assert.equal(db.state.users.filter((user) => user.email === 'real@example.com').length, 1);
    assert.equal(db.state.users.find((user) => user.id === 'd1-real-user').clerk_user_id, 'clerk-prod-user');
    assert.equal(db.state.playlistLikes[0].user_id, 'd1-real-user');
    assert.equal(db.state.playlistLikes[0].clerk_user_id, 'clerk-prod-user');
    assert.equal(db.state.episodeProgress[0].user_id, 'd1-real-user');
    assert.equal(db.state.episodeProgress[0].clerk_user_id, 'clerk-prod-user');
    assert.equal(db.state.playlists[0].creator_clerk_user_id, 'clerk-prod-user');
    assert.equal(db.state.follows[0].follower_clerk_user_id, 'clerk-prod-user');
    assert.equal(db.state.follows[1].following_clerk_user_id, 'clerk-prod-user');
    assert.equal(db.state.blocks[0].blocker_clerk_user_id, 'clerk-prod-user');
    assert.equal(db.state.blocks[1].blocked_clerk_user_id, 'clerk-prod-user');
    assert.equal(db.state.reports[0].reporter_clerk_user_id, 'clerk-prod-user');
    assert.equal(db.state.referrals[0].inviter_clerk_user_id, 'clerk-prod-user');
    assert.equal(db.state.referrals[1].invitee_clerk_user_id, 'clerk-prod-user');
    assert.equal(db.state.calls.some((call) => call.kind === 'batch'), true);
  });

  it('removes a harmless same-email production placeholder before relinking the canonical user', async () => {
    const { token, jwk } = createJwt({ sub: 'clerk-prod-user', email: 'real@example.com' });
    installJwksMock(jwk);
    const db = createAuthMigrationDb({
      users: [
        baseUser(),
        baseUser({ id: 'clerk-prod-user', clerk_user_id: 'clerk-prod-user', legacy_base44_user_id: null, email: 'real@example.com', username: null, imported_at: null, created_at: '2026-07-18T00:00:00.000Z' }),
      ],
    });

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.user.id, 'd1-real-user');
    assert.equal(db.state.users.length, 1);
    assert.equal(db.state.users[0].id, 'd1-real-user');
    assert.equal(db.state.users[0].clerk_user_id, 'clerk-prod-user');
  });

  it('does not treat a placeholder with Clerk-only podcast plays as harmless', async () => {
    const { token, jwk } = createJwt({ sub: 'clerk-prod-user', email: 'real@example.com' });
    installJwksMock(jwk);
    const db = createAuthMigrationDb({
      users: [
        baseUser(),
        baseUser({ id: 'clerk-prod-user', clerk_user_id: 'clerk-prod-user', legacy_base44_user_id: null, email: 'real@example.com', username: null, imported_at: null }),
      ],
    });
    db.state.podcastPlays.push({ id: 'placeholder-play', user_id: null, clerk_user_id: 'clerk-prod-user', legacy_base44_user_id: null });
    const before = identityStateSnapshot(db.state);

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 409);
    assert.equal(data.code, 'identity-conflict');
    assert.equal(identityStateSnapshot(db.state), before);
  });

  it('does not delete a placeholder referenced only by report or referral Clerk IDs', async () => {
    const { token, jwk } = createJwt({ sub: 'clerk-prod-user', email: 'real@example.com' });
    installJwksMock(jwk);
    const db = createAuthMigrationDb({
      users: [
        baseUser(),
        baseUser({ id: 'clerk-prod-user', clerk_user_id: 'clerk-prod-user', legacy_base44_user_id: null, email: 'real@example.com', username: null, imported_at: null }),
      ],
    });
    db.state.reports.push({ id: 'placeholder-report', reporter_id: null, reporter_clerk_user_id: 'clerk-prod-user', reporter_legacy_base44_user_id: null, reported_user_id: null });
    db.state.referrals.push({ id: 'placeholder-referral', inviter_id: null, inviter_clerk_user_id: 'clerk-prod-user', inviter_legacy_base44_user_id: null, invitee_user_id: null, invitee_clerk_user_id: 'clerk-prod-user', invitee_legacy_base44_user_id: null });
    const before = identityStateSnapshot(db.state);

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 409);
    assert.equal(data.code, 'identity-conflict');
    assert.equal(identityStateSnapshot(db.state), before);
  });

  it('rolls back when a placeholder gains Clerk-only related data before the batch executes', async () => {
    const { token, jwk } = createJwt({ sub: 'clerk-prod-user', email: 'real@example.com' });
    installJwksMock(jwk);
    const db = createAuthMigrationDb({
      users: [
        baseUser(),
        baseUser({ id: 'clerk-prod-user', clerk_user_id: 'clerk-prod-user', legacy_base44_user_id: null, email: 'real@example.com', username: null, imported_at: null }),
      ],
      beforeBatch(state) {
        state.podcastPlays.push({ id: 'concurrent-placeholder-play', user_id: null, clerk_user_id: 'clerk-prod-user', legacy_base44_user_id: null });
      },
    });

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 409);
    assert.equal(data.code, 'identity-conflict');
    assert.equal(db.state.users.find((user) => user.id === 'd1-real-user').clerk_user_id, 'clerk-dev-user');
    assert.equal(db.state.users.find((user) => user.id === 'clerk-prod-user').clerk_user_id, 'clerk-prod-user');
    assert.equal(db.state.podcastPlays.some((row) => row.id === 'concurrent-placeholder-play'), true);
    assert.equal(db.state.playlistLikes[0].clerk_user_id, 'clerk-dev-user');
    assert.equal(db.state.episodeProgress[0].clerk_user_id, 'clerk-dev-user');
  });

  it('does not partially migrate when the canonical old Clerk ID changes before the batch executes', async () => {
    const { token, jwk } = createJwt({ sub: 'clerk-prod-user', email: 'real@example.com' });
    installJwksMock(jwk);
    const db = createAuthMigrationDb({
      beforeBatch(state) {
        state.users.find((user) => user.id === 'd1-real-user').clerk_user_id = 'clerk-raced-user';
      },
    });

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 409);
    assert.equal(data.code, 'identity-conflict');
    assert.equal(db.state.users.find((user) => user.id === 'd1-real-user').clerk_user_id, 'clerk-raced-user');
    assert.equal(db.state.playlists[0].creator_clerk_user_id, 'clerk-dev-user');
    assert.equal(db.state.playlistLikes[0].clerk_user_id, 'clerk-dev-user');
    assert.equal(db.state.podcastLikes[0].clerk_user_id, 'clerk-dev-user');
    assert.equal(db.state.podcastPlays[0].clerk_user_id, 'clerk-dev-user');
    assert.equal(db.state.episodeProgress[0].clerk_user_id, 'clerk-dev-user');
    assert.equal(db.state.follows[0].follower_clerk_user_id, 'clerk-dev-user');
    assert.equal(db.state.follows[1].following_clerk_user_id, 'clerk-dev-user');
    assert.equal(db.state.blocks[0].blocker_clerk_user_id, 'clerk-dev-user');
    assert.equal(db.state.blocks[1].blocked_clerk_user_id, 'clerk-dev-user');
    assert.equal(db.state.reports[0].reporter_clerk_user_id, 'clerk-dev-user');
    assert.equal(db.state.referrals[0].inviter_clerk_user_id, 'clerk-dev-user');
    assert.equal(db.state.referrals[1].invitee_clerk_user_id, 'clerk-dev-user');
  });

  it('fails safely when the new Clerk ID belongs to an unrelated D1 user', async () => {
    const { token, jwk } = createJwt({ sub: 'clerk-prod-user', email: 'real@example.com' });
    installJwksMock(jwk);
    const db = createAuthMigrationDb({
      users: [
        baseUser(),
        baseUser({ id: 'clerk-prod-user', clerk_user_id: 'clerk-prod-user', legacy_base44_user_id: null, email: 'other@example.com', username: 'prod', imported_at: null }),
      ],
    });

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 409);
    assert.equal(data.code, 'identity-conflict');
    assert.equal(db.state.users.find((user) => user.id === 'd1-real-user').clerk_user_id, 'clerk-dev-user');
    assert.equal(db.state.users.find((user) => user.id === 'clerk-prod-user').clerk_user_id, 'clerk-prod-user');
    assert.equal(db.state.playlistLikes[0].clerk_user_id, 'clerk-dev-user');
  });

  it('returns 409 when two unrelated meaningful users share the normalized email', async () => {
    const { token, jwk } = createJwt({ sub: 'clerk-prod-user', email: 'REAL@example.com' });
    installJwksMock(jwk);
    const db = createAuthMigrationDb({
      users: [
        baseUser({ legacy_base44_user_id: null }),
        baseUser({ id: 'same-email-user', clerk_user_id: 'clerk-same-email', legacy_base44_user_id: null, email: 'real@example.com', username: 'same-email', imported_at: null }),
      ],
    });
    const before = JSON.stringify({
      users: db.state.users,
      playlistLikes: db.state.playlistLikes,
      episodeProgress: db.state.episodeProgress,
    });

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 409);
    assert.equal(data.code, 'identity-conflict');
    assert.equal(JSON.stringify({
      users: db.state.users,
      playlistLikes: db.state.playlistLikes,
      episodeProgress: db.state.episodeProgress,
    }), before);
    assert.equal(db.state.calls.some((call) => call.kind === 'batch'), false);
  });

  it('returns 409 when two legacy users share the normalized email', async () => {
    const { token, jwk } = createJwt({ sub: 'clerk-prod-user', email: 'real@example.com' });
    installJwksMock(jwk);
    const db = createAuthMigrationDb({
      users: [
        baseUser(),
        baseUser({ id: 'second-legacy-user', clerk_user_id: 'clerk-second-legacy', legacy_base44_user_id: 'legacy-second-user', email: 'REAL@example.com', username: 'second-legacy' }),
      ],
    });
    const before = JSON.stringify({
      users: db.state.users,
      playlistLikes: db.state.playlistLikes,
      episodeProgress: db.state.episodeProgress,
    });

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 409);
    assert.equal(data.code, 'identity-conflict');
    assert.equal(JSON.stringify({
      users: db.state.users,
      playlistLikes: db.state.playlistLikes,
      episodeProgress: db.state.episodeProgress,
    }), before);
    assert.equal(db.state.calls.some((call) => call.kind === 'batch'), false);
  });

  it('does not displace a meaningful user that already owns the authenticated Clerk ID', async () => {
    const { token, jwk } = createJwt({ sub: 'clerk-prod-user', email: 'real@example.com' });
    installJwksMock(jwk);
    const db = createAuthMigrationDb({
      users: [
        baseUser(),
        baseUser({ id: 'prod-owner', clerk_user_id: 'clerk-prod-user', legacy_base44_user_id: null, email: 'real@example.com', username: 'prod-owner', imported_at: null }),
      ],
    });
    const before = JSON.stringify({
      users: db.state.users,
      playlistLikes: db.state.playlistLikes,
      episodeProgress: db.state.episodeProgress,
    });

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 409);
    assert.equal(data.code, 'identity-conflict');
    assert.equal(JSON.stringify({
      users: db.state.users,
      playlistLikes: db.state.playlistLikes,
      episodeProgress: db.state.episodeProgress,
    }), before);
    assert.equal(db.state.users.find((user) => user.id === 'prod-owner').clerk_user_id, 'clerk-prod-user');
  });

  it('keeps the existing-ID bootstrap path working', async () => {
    const { token, jwk } = createJwt({ sub: 'clerk-dev-user', email: 'real@example.com' });
    installJwksMock(jwk);
    const db = createAuthMigrationDb();

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.user.id, 'd1-real-user');
    assert.equal(data.user.clerk_user_id, 'clerk-dev-user');
    assert.equal(db.state.users.length, 2);
  });

  it('keeps the brand-new user bootstrap path working', async () => {
    const { token, jwk } = createJwt({ sub: 'clerk-new-user', email: 'new@example.com', name: 'New User' });
    installJwksMock(jwk);
    const db = createAuthMigrationDb({ users: [] });

    const response = await worker.fetch(request('/me', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.user.id, 'clerk-new-user');
    assert.equal(data.user.clerk_user_id, 'clerk-new-user');
    assert.equal(db.state.users.length, 1);
  });
});
