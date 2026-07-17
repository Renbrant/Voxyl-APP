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

function request(path, { method = 'GET', payload, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(payload ?? {});
  }
  return new Request(`https://api.voxyl.test${path}`, init);
}

async function body(response) {
  return response.json();
}

function publicBlockRow(state, row) {
  const user = state.users.find((item) => item.id === row.blocked_id);
  return {
    id: row.id,
    blocked_id: row.blocked_id,
    created_at: row.created_at,
    base44_created_date: row.base44_created_date ?? null,
    imported_blocked_name: row.blocked_name ?? null,
    blocked_name: user?.name ?? null,
    blocked_username: user?.username ?? null,
    blocked_profile_picture: user?.profile_picture ?? null,
  };
}

function createBlockDb() {
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
        profile_picture: 'https://images.example.com/real.png',
        profile_hidden: 0,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'other-user',
        clerk_user_id: 'clerk-other',
        legacy_base44_user_id: 'legacy-other',
        email: 'other@example.com',
        name: 'Other User',
        username: 'other',
        role: 'user',
        profile_picture: 'https://images.example.com/other.png',
        profile_hidden: 0,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'third-user',
        clerk_user_id: 'clerk-third',
        legacy_base44_user_id: null,
        email: 'third@example.com',
        name: 'Third User',
        username: 'third',
        role: 'user',
        profile_picture: null,
        profile_hidden: 0,
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
      },
    ],
    blocks: [],
    follows: [],
    calls: [],
    failNextBlockInsert: false,
  };

  function currentUser() {
    return state.users.find((user) => user.clerk_user_id === 'clerk-user-1');
  }

  function matches(row, prefix, user = currentUser()) {
    return row[`${prefix}_id`] === user.id ||
      row[`${prefix}_clerk_user_id`] === user.clerk_user_id ||
      (user.legacy_base44_user_id && row[`${prefix}_legacy_base44_user_id`] === user.legacy_base44_user_id);
  }

  function identityValues(user) {
    return [user.id, user.clerk_user_id, user.legacy_base44_user_id].filter(Boolean);
  }

  function rowMatchesUser(row, prefix, user) {
    return identityValues(user).some((value) => [
      row[`${prefix}_id`],
      row[`${prefix}_clerk_user_id`],
      row[`${prefix}_legacy_base44_user_id`],
    ].includes(value));
  }

  function targetUserFromParams(params) {
    return state.users.find((user) => user.id !== currentUser().id && params.includes(user.id)) || null;
  }

  return {
    state,
    async batch(statements) {
      state.calls.push({ kind: 'batch', statements: statements.map((statement) => ({ sql: statement.sql, params: statement.params })) });
      const snapshot = {
        blocks: state.blocks.map((row) => ({ ...row })),
        follows: state.follows.map((row) => ({ ...row })),
        failNextBlockInsert: state.failNextBlockInsert,
      };
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        return results;
      } catch (error) {
        state.blocks = snapshot.blocks;
        state.follows = snapshot.follows;
        state.failNextBlockInsert = snapshot.failNextBlockInsert;
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
              if (/FROM users\s+WHERE lower\(email\)/s.test(sql)) {
                return state.users.find((user) => user.email?.toLowerCase() === String(params[0]).toLowerCase()) || null;
              }
              if (/FROM users\s+WHERE id = \?/s.test(sql)) {
                return state.users.find((user) => user.id === params[0]) || null;
              }
              if (/SELECT id FROM blocks/s.test(sql)) {
                if (/AND blocked_id = \?\s+LIMIT/s.test(sql)) {
                  const blockedId = params.at(-1);
                  return state.blocks.find((row) => matches(row, 'blocker') && row.blocked_id === blockedId) || null;
                }
                const target = targetUserFromParams(params);
                return target ? state.blocks.find((row) => rowMatchesUser(row, 'blocker', currentUser()) && rowMatchesUser(row, 'blocked', target)) || null : null;
              }
              if (/SELECT 1 AS found FROM blocks/s.test(sql)) {
                const target = targetUserFromParams(params);
                return target && state.blocks.some((row) => rowMatchesUser(row, 'blocker', target) && rowMatchesUser(row, 'blocked', currentUser()))
                  ? { found: 1 }
                  : null;
              }
              if (/FROM blocks b\s+LEFT JOIN users/s.test(sql)) {
                const blockedId = params.at(-1);
                const row = state.blocks.find((block) => matches(block, 'blocker') && block.blocked_id === blockedId);
                return row ? publicBlockRow(state, row) : null;
              }
              throw new Error(`Unhandled first SQL: ${sql}`);
            },
            async all() {
              state.calls.push({ kind: 'all', sql, params });
              if (/CASE\s+WHEN/s.test(sql)) {
                const results = [];
                for (const row of state.blocks) {
                  if (matches(row, 'blocker')) results.push({ user_id: row.blocked_id });
                  else if (matches(row, 'blocked')) results.push({ user_id: row.blocker_id });
                }
                return { results: [...new Map(results.map((row) => [row.user_id, row])).values()] };
              }
              if (/FROM blocks b\s+LEFT JOIN users/s.test(sql)) {
                const limit = params.at(-1);
                const results = state.blocks
                  .filter((row) => matches(row, 'blocker'))
                  .slice(0, limit)
                  .map((row) => publicBlockRow(state, row));
                return { results };
              }
              throw new Error(`Unhandled all SQL: ${sql}`);
            },
            async run() {
              state.calls.push({ kind: 'run', sql, params });
              if (/INSERT INTO users/s.test(sql)) return { meta: { changes: 0 } };
              if (/UPDATE users|UPDATE playlist_likes|UPDATE podcast_likes|UPDATE episode_progress|UPDATE podcast_plays|UPDATE playlists/s.test(sql)) {
                return { meta: { changes: 0 } };
              }
              if (/INSERT INTO blocks/s.test(sql)) {
                if (state.failNextBlockInsert) {
                  state.failNextBlockInsert = false;
                  throw new Error('simulated block insert failure');
                }
                const [id, blocker_id, blocker_clerk_user_id, blocker_legacy_base44_user_id, blocked_id, blocked_clerk_user_id, blocked_legacy_base44_user_id] = params;
                if (!state.blocks.some((row) => row.blocker_id === blocker_id && row.blocked_id === blocked_id)) {
                  state.blocks.push({
                    id,
                    blocker_id,
                    blocker_clerk_user_id,
                    blocker_legacy_base44_user_id,
                    blocked_id,
                    blocked_clerk_user_id,
                    blocked_legacy_base44_user_id,
                    created_at: '2026-07-16T00:00:00.000Z',
                    base44_created_date: null,
                  });
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (/DELETE FROM follows/s.test(sql)) {
                const before = state.follows.length;
                state.follows = state.follows.filter((follow) => {
                  const currentToTarget = rowMatchesUser(follow, 'follower', currentUser()) && rowMatchesUser(follow, 'following', state.users.find((user) => user.id === 'other-user'));
                  const targetToCurrent = rowMatchesUser(follow, 'follower', state.users.find((user) => user.id === 'other-user')) && rowMatchesUser(follow, 'following', currentUser());
                  return !(currentToTarget || targetToCurrent);
                });
                return { meta: { changes: before - state.follows.length } };
              }
              if (/DELETE FROM blocks/s.test(sql)) {
                const before = state.blocks.length;
                state.blocks = state.blocks.filter((row) => !(row.id === params[0] && matches(row, 'blocker')));
                return { meta: { changes: before - state.blocks.length } };
              }
              throw new Error(`Unhandled run SQL: ${sql}`);
            },
          };
          return bound;
        },
      };
    },
  };
}

function assertNoPrivateIdentityFields(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /email/i);
  assert.doesNotMatch(serialized, /clerk/i);
  assert.doesNotMatch(serialized, /legacy/i);
  assert.doesNotMatch(serialized, /blocker/i);
}

function followRow(id, followerId, followingId) {
  const follower = {
    'd1-real-user': ['clerk-user-1', null],
    'other-user': ['clerk-other', 'legacy-other'],
    'third-user': ['clerk-third', null],
  }[followerId];
  const following = {
    'd1-real-user': ['clerk-user-1', null],
    'other-user': ['clerk-other', 'legacy-other'],
    'third-user': ['clerk-third', null],
  }[followingId];
  return {
    id,
    follower_id: followerId,
    follower_clerk_user_id: follower[0],
    follower_legacy_base44_user_id: follower[1],
    following_id: followingId,
    following_clerk_user_id: following[0],
    following_legacy_base44_user_id: following[1],
    status: 'pending',
  };
}

afterEach(() => {
  mock.restoreAll();
});

describe('Block Worker routes', () => {
  it('returns 401 for unauthenticated block operations', async () => {
    for (const [path, method, payload] of [
      ['/api/blocks', 'GET'],
      ['/api/blocks', 'POST', { blocked_id: 'other-user' }],
      ['/api/blocks/block-1', 'DELETE'],
      ['/api/blocks/hidden-users', 'GET'],
      ['/api/blocks/status/other-user', 'GET'],
    ]) {
      const response = await worker.fetch(request(path, { method, payload }), { ...baseEnv, DB: createBlockDb() });
      assert.equal(response.status, 401, `${method} ${path}`);
    }
  });

  it('creates and lists only the authenticated user outbound blocks without private identity fields', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createBlockDb();
    db.state.blocks.push({
      id: 'someone-elses-block',
      blocker_id: 'other-user',
      blocker_clerk_user_id: 'clerk-other',
      blocker_legacy_base44_user_id: null,
      blocked_id: 'third-user',
      blocked_clerk_user_id: 'clerk-third',
      blocked_legacy_base44_user_id: null,
      created_at: '2026-07-10T00:00:00.000Z',
    });

    const createResponse = await worker.fetch(request('/api/blocks', { method: 'POST', token, payload: { blocked_id: 'other-user', blocker_id: 'third-user', blocker_email: 'fake@example.com' } }), { ...baseEnv, DB: db });
    const listResponse = await worker.fetch(request('/api/blocks', { token }), { ...baseEnv, DB: db });
    const createData = await body(createResponse);
    const listData = await body(listResponse);

    assert.equal(createResponse.status, 200);
    assert.equal(listResponse.status, 200);
    assert.equal(db.state.blocks.filter((row) => row.blocker_id === 'd1-real-user').length, 1);
    assert.deepEqual(listData.items.map((row) => row.blocked_user.id), ['other-user']);
    assert.equal(createData.block.blocked_user.username, 'other');
    assert.equal('blocked_id' in createData.block, false);
    assertNoPrivateIdentityFields(createData);
    assertNoPrivateIdentityFields(listData);
  });

  it('makes duplicate and concurrent block requests idempotent', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createBlockDb();

    await worker.fetch(request('/api/blocks', { method: 'POST', token, payload: { blocked_id: 'other-user' } }), { ...baseEnv, DB: db });
    const [second, third] = await Promise.all([
      worker.fetch(request('/api/blocks', { method: 'POST', token, payload: { blocked_id: 'other-user' } }), { ...baseEnv, DB: db }),
      worker.fetch(request('/api/blocks', { method: 'POST', token, payload: { blocked_id: 'other-user' } }), { ...baseEnv, DB: db }),
    ]);

    assert.equal(second.status, 200);
    assert.equal(third.status, 200);
    assert.equal(db.state.blocks.length, 1);
  });

  it('creates a block and deletes follows in both directions in one batch', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createBlockDb();
    db.state.follows.push(
      followRow('me-to-other', 'd1-real-user', 'other-user'),
      followRow('other-to-me', 'other-user', 'd1-real-user'),
      followRow('unrelated', 'third-user', 'other-user'),
    );

    const response = await worker.fetch(request('/api/blocks', { method: 'POST', token, payload: { blocked_id: 'other-user' } }), { ...baseEnv, DB: db });

    assert.equal(response.status, 200);
    assert.equal(db.state.blocks.length, 1);
    assert.deepEqual(db.state.follows.map((row) => row.id), ['unrelated']);
    assert.equal(db.state.calls.some((entry) => entry.kind === 'batch' && entry.statements.some((statement) => /INSERT INTO blocks/s.test(statement.sql)) && entry.statements.some((statement) => /DELETE FROM follows/s.test(statement.sql))), true);
  });

  it('does not delete follows when block creation fails inside the batch', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createBlockDb();
    db.state.failNextBlockInsert = true;
    db.state.follows.push(
      followRow('me-to-other', 'd1-real-user', 'other-user'),
      followRow('other-to-me', 'other-user', 'd1-real-user'),
    );

    const response = await worker.fetch(request('/api/blocks', { method: 'POST', token, payload: { blocked_id: 'other-user' } }), { ...baseEnv, DB: db });

    assert.equal(response.status, 500);
    assert.equal(db.state.blocks.length, 0);
    assert.deepEqual(db.state.follows.map((row) => row.id).sort(), ['me-to-other', 'other-to-me']);
  });

  it('rejects self-blocking', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const response = await worker.fetch(request('/api/blocks', { method: 'POST', token, payload: { blocked_id: 'd1-real-user' } }), { ...baseEnv, DB: createBlockDb() });

    assert.equal(response.status, 400);
  });

  it('does not list or delete another user block', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createBlockDb();
    db.state.blocks.push({
      id: 'other-block',
      blocker_id: 'other-user',
      blocker_clerk_user_id: 'clerk-other',
      blocker_legacy_base44_user_id: null,
      blocked_id: 'third-user',
      blocked_clerk_user_id: 'clerk-third',
      blocked_legacy_base44_user_id: null,
      created_at: '2026-07-10T00:00:00.000Z',
    });

    const listResponse = await worker.fetch(request('/api/blocks', { token }), { ...baseEnv, DB: db });
    const deleteResponse = await worker.fetch(request('/api/blocks/other-block', { method: 'DELETE', token }), { ...baseEnv, DB: db });
    const listData = await body(listResponse);

    assert.deepEqual(listData.items, []);
    assert.equal(deleteResponse.status, 404);
    assert.equal(db.state.blocks.length, 1);
  });

  it('returns hidden user ids for both block directions without exposing relationship details', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createBlockDb();
    db.state.blocks.push(
      {
        id: 'outbound',
        blocker_id: 'd1-real-user',
        blocker_clerk_user_id: 'clerk-user-1',
        blocker_legacy_base44_user_id: null,
        blocked_id: 'other-user',
        blocked_clerk_user_id: 'clerk-other',
        blocked_legacy_base44_user_id: null,
        created_at: '2026-07-10T00:00:00.000Z',
      },
      {
        id: 'inbound',
        blocker_id: 'third-user',
        blocker_clerk_user_id: 'clerk-third',
        blocker_legacy_base44_user_id: null,
        blocked_id: 'd1-real-user',
        blocked_clerk_user_id: 'clerk-user-1',
        blocked_legacy_base44_user_id: null,
        created_at: '2026-07-11T00:00:00.000Z',
      },
    );

    const response = await worker.fetch(request('/api/blocks/hidden-users', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.deepEqual(data.user_ids.sort(), ['other-user', 'third-user']);
    assert.deepEqual(Object.keys(data).sort(), ['ok', 'user_ids']);
  });

  it('returns status for outbound, inbound, and no-block states without inbound details', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createBlockDb();
    db.state.blocks.push(
      {
        id: 'outbound',
        blocker_id: 'd1-real-user',
        blocker_clerk_user_id: 'clerk-user-1',
        blocker_legacy_base44_user_id: null,
        blocked_id: 'other-user',
        blocked_clerk_user_id: 'clerk-other',
        blocked_legacy_base44_user_id: 'legacy-other',
        created_at: '2026-07-10T00:00:00.000Z',
      },
      {
        id: 'inbound',
        blocker_id: 'third-user',
        blocker_clerk_user_id: 'clerk-third',
        blocker_legacy_base44_user_id: null,
        blocked_id: 'd1-real-user',
        blocked_clerk_user_id: 'clerk-user-1',
        blocked_legacy_base44_user_id: null,
        created_at: '2026-07-11T00:00:00.000Z',
      },
    );

    const outbound = await body(await worker.fetch(request('/api/blocks/status/other-user', { token }), { ...baseEnv, DB: db }));
    const inbound = await body(await worker.fetch(request('/api/blocks/status/third-user', { token }), { ...baseEnv, DB: db }));
    const none = await body(await worker.fetch(request('/api/blocks/status/d1-real-user', { token }), { ...baseEnv, DB: db }));

    assert.deepEqual(outbound, { ok: true, hidden: true, can_unblock: true, outbound_block_id: 'outbound' });
    assert.deepEqual(inbound, { ok: true, hidden: true, can_unblock: false, outbound_block_id: null });
    assert.deepEqual(none, { ok: true, hidden: false, can_unblock: false, outbound_block_id: null });
    assert.equal(JSON.stringify(inbound).includes('inbound'), false);
    assertNoPrivateIdentityFields(inbound);
  });

  it('does not treat hidden-users or status routes as dynamic block ids', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createBlockDb();
    db.state.blocks.push({
      id: 'hidden-users',
      blocker_id: 'd1-real-user',
      blocker_clerk_user_id: 'clerk-user-1',
      blocker_legacy_base44_user_id: null,
      blocked_id: 'other-user',
      blocked_clerk_user_id: 'clerk-other',
      blocked_legacy_base44_user_id: null,
      created_at: '2026-07-10T00:00:00.000Z',
    });
    db.state.blocks.push({
      id: 'status',
      blocker_id: 'd1-real-user',
      blocker_clerk_user_id: 'clerk-user-1',
      blocker_legacy_base44_user_id: null,
      blocked_id: 'third-user',
      blocked_clerk_user_id: 'clerk-third',
      blocked_legacy_base44_user_id: null,
      created_at: '2026-07-10T00:00:00.000Z',
    });

    const hiddenDelete = await worker.fetch(request('/api/blocks/hidden-users', { method: 'DELETE', token }), { ...baseEnv, DB: db });
    const statusDelete = await worker.fetch(request('/api/blocks/status', { method: 'DELETE', token }), { ...baseEnv, DB: db });
    const nestedStatusDelete = await worker.fetch(request('/api/blocks/status/other-user', { method: 'DELETE', token }), { ...baseEnv, DB: db });

    assert.equal(hiddenDelete.status, 404);
    assert.equal(statusDelete.status, 404);
    assert.equal(nestedStatusDelete.status, 404);
    assert.deepEqual(db.state.blocks.map((row) => row.id).sort(), ['hidden-users', 'status']);
  });

  it('restores visibility after unblocking', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createBlockDb();
    db.state.blocks.push({
      id: 'own-block',
      blocker_id: 'd1-real-user',
      blocker_clerk_user_id: 'clerk-user-1',
      blocker_legacy_base44_user_id: null,
      blocked_id: 'other-user',
      blocked_clerk_user_id: 'clerk-other',
      blocked_legacy_base44_user_id: null,
      created_at: '2026-07-10T00:00:00.000Z',
    });

    const before = await body(await worker.fetch(request('/api/blocks/hidden-users', { token }), { ...baseEnv, DB: db }));
    const deleted = await worker.fetch(request('/api/blocks/own-block', { method: 'DELETE', token }), { ...baseEnv, DB: db });
    const after = await body(await worker.fetch(request('/api/blocks/hidden-users', { token }), { ...baseEnv, DB: db }));

    assert.deepEqual(before.user_ids, ['other-user']);
    assert.equal(deleted.status, 200);
    assert.deepEqual(after.user_ids, []);
  });

  it('keeps valid imported Base44 block rows usable through legacy identity columns', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createBlockDb();
    db.state.users[0].legacy_base44_user_id = 'legacy-real-user';
    db.state.blocks.push({
      id: 'legacy-block',
      blocker_id: 'legacy-row-user',
      blocker_clerk_user_id: null,
      blocker_legacy_base44_user_id: 'legacy-real-user',
      blocked_id: 'other-user',
      blocked_clerk_user_id: null,
      blocked_legacy_base44_user_id: 'legacy-other',
      blocked_name: 'Imported Other',
      created_at: '2026-07-10T00:00:00.000Z',
      base44_created_date: '2025-01-01T00:00:00.000Z',
    });

    const listed = await body(await worker.fetch(request('/api/blocks', { token }), { ...baseEnv, DB: db }));
    const repeated = await worker.fetch(request('/api/blocks', { method: 'POST', token, payload: { blocked_id: 'other-user' } }), { ...baseEnv, DB: db });
    const hidden = await body(await worker.fetch(request('/api/blocks/hidden-users', { token }), { ...baseEnv, DB: db }));

    assert.deepEqual(listed.items.map((row) => row.id), ['legacy-block']);
    assert.equal(listed.items[0].created_at, '2025-01-01T00:00:00.000Z');
    assert.equal(listed.items[0].blocked_user.id, 'other-user');
    assert.equal(repeated.status, 200);
    assert.equal(db.state.blocks.length, 1);
    assert.deepEqual(hidden.user_ids, ['other-user']);
    const deleted = await worker.fetch(request('/api/blocks/legacy-block', { method: 'DELETE', token }), { ...baseEnv, DB: db });
    assert.equal(deleted.status, 200);
    assert.equal(db.state.blocks.length, 0);
  });

  it('keeps Feed and Explore fail-closed when hidden-user loading is unresolved', () => {
    const feedSource = fs.readFileSync(new URL('../src/pages/Feed.jsx', import.meta.url), 'utf8');
    const exploreSource = fs.readFileSync(new URL('../src/pages/Explore.jsx', import.meta.url), 'utf8');

    assert.match(feedSource, /canRenderSocialContent = !user \|\| hiddenUsersReady/);
    assert.match(feedSource, /tab !== 'my-playlists' && canRenderSocialContent/);
    assert.match(exploreSource, /showHiddenUsersGate/);
    assert.match(exploreSource, /tab === 'playlists' && !showHiddenUsersGate/);
    assert.match(exploreSource, /tab === 'users' && !showHiddenUsersGate/);
  });
});
