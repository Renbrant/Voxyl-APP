import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterEach, describe, it, mock } from 'node:test';
import worker from '../workers/api/src/index.ts';

const issuer = 'https://clerk.voxyl.test';

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createJwt({
  sub = 'clerk-user-1',
  email = 'real@example.com',
  name = 'Real User',
} = {}) {
  const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKey = keyPair.privateKey;
  const publicKey = keyPair.publicKey;
  const kid = 'kid-' + crypto.randomUUID();
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

  const signedData =
    base64urlJson(header) +
    '.' +
    base64urlJson(claims);

  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(signedData), privateKey)
    .toString('base64url');

  const jwk = publicKey.export({ format: 'jwk' });

  return {
    token: signedData + '.' + signature,
    jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' },
  };
}

function request(path, {
  token,
  method = 'DELETE',
  payload,
} = {}) {
  const headers = {
    'content-type': 'application/json',
  };

  if (token) {
    headers.authorization = 'Bearer ' + token;
  }

  const options = {
    method,
    headers,
  };

  if (payload !== undefined) {
    options.body = JSON.stringify(payload);
  }

  return new Request(
    'https://api.voxyl.test' + path,
    options,
  );
}

async function body(response) {
  return response.json();
}

function createDb({
  user = {
    id: 'd1-real-user',
    clerk_user_id: 'clerk-user-1',
    legacy_base44_user_id: 'legacy-real-user',
    email: 'real@example.com',
    name: 'Real User',
    username: 'real',
    role: 'user',
    profile_picture: null,
    clerk_profile_picture: null,
    profile_hidden: 0,
    imported_at: '2026-07-01T00:00:00.000Z',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
  },
  failBatch = false,
  events = [],
} = {}) {
  const state = {
    user,
    failBatch,
    batchStatements: [],
    events,
  };

  return {
    state,

    prepare(sql) {
      return {
        bind(...params) {
          return {
            sql,
            params,

            async first() {
              if (/FROM users\s+WHERE clerk_user_id = \?/s.test(sql)) {
                return state.user;
              }

              throw new Error('Unhandled first SQL: ' + sql);
            },
          };
        },
      };
    },

    async batch(statements) {
      state.events.push('db:batch');

      state.batchStatements = statements.map((statement) => ({
        sql: statement.sql,
        params: statement.params,
      }));

      if (state.failBatch) {
        throw new Error('Synthetic D1 batch failure');
      }

      return statements.map(() => ({
        success: true,
        meta: { changes: 1 },
      }));
    },
  };
}

function createR2({
  pages,
  failList = false,
  failDelete = false,
  events = [],
} = {}) {
  const configuredPages = pages || [
    {
      objects: [],
      truncated: false,
    },
  ];

  const state = {
    listCalls: [],
    deleteCalls: [],
    pageIndex: 0,
    events,
  };

  return {
    state,

    async list(options) {
      state.events.push('r2:list');
      state.listCalls.push({ ...options });

      if (failList) {
        throw new Error('Synthetic R2 list failure');
      }

      const page =
        configuredPages[
          Math.min(state.pageIndex, configuredPages.length - 1)
        ];

      state.pageIndex += 1;

      return page;
    },

    async delete(keys) {
      state.events.push('r2:delete');

      if (failDelete) {
        throw new Error('Synthetic R2 delete failure');
      }

      state.deleteCalls.push(
        Array.isArray(keys) ? [...keys] : [keys],
      );
    },
  };
}

function installFetchMock(
  jwk,
  {
    clerkDeleteStatus = 200,
    events = [],
  } = {},
) {
  const state = {
    clerkDeleteCalls: [],
    events,
  };

  mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const requestedUrl = String(url);

    if (requestedUrl === issuer + '/.well-known/jwks.json') {
      return Response.json({ keys: [jwk] });
    }

    if (
      requestedUrl ===
        'https://api.clerk.com/v1/users/clerk-user-1' &&
      String(options.method || 'GET').toUpperCase() === 'DELETE'
    ) {
      state.events.push('clerk:delete');
      state.clerkDeleteCalls.push({
        url: requestedUrl,
        method: options.method,
        authorization:
          new Headers(options.headers).get('authorization'),
      });

      return new Response(
        clerkDeleteStatus === 200 ? '{}' : null,
        {
          status: clerkDeleteStatus,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    }

    throw new Error('Unexpected fetch URL: ' + requestedUrl);
  });

  return state;
}

function createEnv({
  db,
  r2,
} = {}) {
  return {
    DB: db,
    VOXYL_MEDIA: r2,
    VOXYL_CACHE: {
      async get() {
        return null;
      },
      async put() {},
      async delete() {},
    },
    DIAGNOSTICS_TOKEN: 'diagnostics-test-token',
    CLERK_AUTHORIZED_PARTIES:
      'https://v.renbrant.com,http://localhost:5173',
    CLERK_ISSUER: issuer,
    CLERK_SECRET_KEY: 'sk_test_account_deletion',
    CLERK_JWT_KEY:
      'invalid-test-key-to-force-pinned-jwks-fallback',
  };
}

function normalizedBatchSql(db) {
  return db.state.batchStatements
    .map((statement) =>
      statement.sql.replace(/\s+/g, ' ').trim(),
    )
    .join('\n');
}

function allBatchParams(db) {
  return db.state.batchStatements.flatMap(
    (statement) => statement.params,
  );
}

afterEach(() => {
  mock.restoreAll();
});

describe('account deletion worker contract', () => {
  it('rejects unauthenticated DELETE /me without mutating data', async () => {
    const events = [];
    const db = createDb({ events });
    const r2 = createR2({ events });
    const env = createEnv({ db, r2 });

    const response = await worker.fetch(
      request('/api/me'),
      env,
    );

    assert.equal(response.status, 401);
    assert.equal(db.state.batchStatements.length, 0);
    assert.equal(r2.state.listCalls.length, 0);
    assert.deepEqual(events, []);
  });

  it('deletes only the authenticated account across R2, D1, and Clerk', async () => {
    const events = [];
    const auth = createJwt();
    const db = createDb({ events });
    const r2 = createR2({
      events,
      pages: [
        {
          objects: [
            { key: 'profiles/clerk-user-1/avatar-a.png' },
            { key: 'profiles/clerk-user-1/avatar-b.png' },
          ],
          truncated: true,
          cursor: 'page-2',
        },
        {
          objects: [
            { key: 'profiles/clerk-user-1/avatar-c.png' },
          ],
          truncated: false,
        },
      ],
    });

    const clerk = installFetchMock(
      auth.jwk,
      { events },
    );

    const env = createEnv({ db, r2 });

    const response = await worker.fetch(
      request('/api/me', {
        token: auth.token,
        payload: {
          userId: 'other-user-target',
          clerkUserId: 'clerk-other-target',
        },
      }),
      env,
    );

    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.deleted, true);

    assert.deepEqual(
      r2.state.listCalls.map((call) => call.prefix),
      [
        'profiles/clerk-user-1/',
        'profiles/clerk-user-1/',
      ],
    );

    assert.deepEqual(
      r2.state.deleteCalls,
      [
        [
          'profiles/clerk-user-1/avatar-a.png',
          'profiles/clerk-user-1/avatar-b.png',
        ],
        [
          'profiles/clerk-user-1/avatar-c.png',
        ],
      ],
    );

    const sql = normalizedBatchSql(db);

    for (const table of [
      'playlist_episodes_cache',
      'playlist_likes',
      'podcast_likes',
      'podcast_plays',
      'episode_progress',
      'follows',
      'blocks',
      'reports',
      'referrals',
      'playlists',
      'users',
    ]) {
      assert.match(
        sql,
        new RegExp('DELETE FROM ' + table),
      );
    }

    for (const identityColumn of [
      'legacy_base44_user_id',
      'creator_email',
      'user_email',
      'follower_email',
      'following_email',
      'blocker_email',
      'blocked_email',
      'reporter_email',
      'reported_user_email',
      'inviter_email',
      'invitee_email',
    ]) {
      assert.match(
        sql,
        new RegExp(identityColumn),
      );
    }

    const params = allBatchParams(db);

    assert.ok(params.includes('d1-real-user'));
    assert.ok(params.includes('clerk-user-1'));
    assert.ok(params.includes('legacy-real-user'));
    assert.ok(params.includes('real@example.com'));

    assert.equal(
      params.includes('other-user-target'),
      false,
    );

    assert.equal(
      params.includes('clerk-other-target'),
      false,
    );

    assert.equal(clerk.clerkDeleteCalls.length, 1);

    assert.equal(
      clerk.clerkDeleteCalls[0].authorization,
      'Bearer sk_test_account_deletion',
    );

    const lastR2Delete =
      events.lastIndexOf('r2:delete');

    const d1Batch =
      events.indexOf('db:batch');

    const clerkDelete =
      events.indexOf('clerk:delete');

    assert.ok(lastR2Delete >= 0);
    assert.ok(d1Batch > lastR2Delete);
    assert.ok(clerkDelete > d1Batch);
  });

  it('fails closed before D1 and Clerk when R2 cleanup fails', async () => {
    const events = [];
    const auth = createJwt();
    const db = createDb({ events });
    const r2 = createR2({
      events,
      failList: true,
    });

    const clerk = installFetchMock(
      auth.jwk,
      { events },
    );

    const env = createEnv({ db, r2 });

    const response = await worker.fetch(
      request('/api/me', {
        token: auth.token,
      }),
      env,
    );

    const data = await body(response);

    assert.equal(response.status, 500);
    assert.equal(data.ok, false);
    assert.equal(data.stage, 'r2');
    assert.equal(db.state.batchStatements.length, 0);
    assert.equal(clerk.clerkDeleteCalls.length, 0);
    assert.equal(events.includes('db:batch'), false);
    assert.equal(events.includes('clerk:delete'), false);
  });

  it('rolls back the deletion flow before Clerk when D1 batch fails', async () => {
    const events = [];
    const auth = createJwt();
    const db = createDb({
      events,
      failBatch: true,
    });

    const r2 = createR2({ events });

    const clerk = installFetchMock(
      auth.jwk,
      { events },
    );

    const env = createEnv({ db, r2 });

    const response = await worker.fetch(
      request('/api/me', {
        token: auth.token,
      }),
      env,
    );

    const data = await body(response);

    assert.equal(response.status, 500);
    assert.equal(data.ok, false);
    assert.equal(data.stage, 'd1');
    assert.ok(db.state.batchStatements.length > 0);
    assert.equal(clerk.clerkDeleteCalls.length, 0);
    assert.equal(events.includes('clerk:delete'), false);
  });

  it('does not report success when Clerk deletion fails', async () => {
    const events = [];
    const auth = createJwt();
    const db = createDb({ events });
    const r2 = createR2({ events });

    const clerk = installFetchMock(
      auth.jwk,
      {
        events,
        clerkDeleteStatus: 500,
      },
    );

    const env = createEnv({ db, r2 });

    const response = await worker.fetch(
      request('/api/me', {
        token: auth.token,
      }),
      env,
    );

    const data = await body(response);

    assert.equal(response.status, 502);
    assert.equal(data.ok, false);
    assert.equal(data.stage, 'clerk');
    assert.ok(db.state.batchStatements.length > 0);
    assert.equal(clerk.clerkDeleteCalls.length, 1);
  });

  it('allows a safe retry after Voxyl data is already gone', async () => {
    const events = [];
    const auth = createJwt();
    const db = createDb({
      events,
      user: null,
    });

    const r2 = createR2({ events });

    const clerk = installFetchMock(
      auth.jwk,
      {
        events,
        clerkDeleteStatus: 404,
      },
    );

    const env = createEnv({ db, r2 });

    const response = await worker.fetch(
      request('/api/me', {
        token: auth.token,
      }),
      env,
    );

    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.deleted, true);
    assert.ok(db.state.batchStatements.length > 0);

    const params = allBatchParams(db);

    assert.ok(params.includes('clerk-user-1'));
    assert.ok(params.includes('real@example.com'));
    assert.equal(clerk.clerkDeleteCalls.length, 1);
  });
});
