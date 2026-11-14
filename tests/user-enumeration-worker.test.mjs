import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import worker from '../workers/api/src/index.ts';
import { baseEnv, createJwt, createSqliteD1, issuer } from './helpers/worker-harness.mjs';

// Issue #144: user search, suggestions and public profiles must not let an anonymous
// caller list accounts, must not leak real names anonymously, and must respect blocks.

const TERMS = '2026-11-14';
let db;
let sessions;

function addUser(id, username, name, { hidden = 0 } = {}) {
  db.raw.prepare(
    `INSERT INTO users (id, clerk_user_id, email, name, username, role, profile_hidden, terms_accepted_version)
     VALUES (?, ?, ?, ?, ?, 'user', ?, ?)`,
  ).run(id, `clerk-${id}`, `${id}@example.com`, name, username, hidden, TERMS);
}

function addBlock(blocker, blocked) {
  db.raw.prepare('INSERT INTO blocks (id, blocker_id, blocked_id) VALUES (?, ?, ?)')
    .run(`block-${blocker}-${blocked}`, blocker, blocked);
}

function addFollow(follower, following) {
  db.raw.prepare("INSERT INTO follows (id, follower_id, following_id, status) VALUES (?, ?, ?, 'accepted')")
    .run(`follow-${follower}-${following}`, follower, following);
}

function sessionFor(id) {
  const { token, jwk } = createJwt({ sub: `clerk-${id}`, email: `${id}@example.com`, name: id });
  sessions.set(jwk.kid, jwk);
  return token;
}

async function call(route, payload, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await worker.fetch(
    new Request(`https://api.voxyl.test/api/functions/${route}`, {
      method: 'POST', headers, body: JSON.stringify(payload),
    }),
    { ...baseEnv, DB: db },
  );
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  db = createSqliteD1();
  sessions = new Map();
  mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(String(url), `${issuer}/.well-known/jwks.json`);
    return Response.json({ keys: [...sessions.values()] });
  });
  addUser('me', 'meuser', 'Me Real');
  addUser('ana', 'ana_silva', 'Ana Silva');
  addUser('anselmo', 'anselmo', 'Anselmo Real');
  addUser('bob', 'bobby', 'Bob Real');
  addUser('ghost', 'ghostly', 'Ghost Real', { hidden: 1 });
});

afterEach(() => mock.restoreAll());

describe('searchUsers', () => {
  it('requires a session', async () => {
    const result = await call('searchUsers', { query: 'an' });
    assert.equal(result.status, 401);
  });

  it('rejects empty and one-character searches instead of listing accounts', async () => {
    const token = sessionFor('me');
    for (const query of ['', ' ', 'a']) {
      const result = await call('searchUsers', { query }, token);
      assert.equal(result.status, 400);
      assert.equal(result.body.code, 'query-too-short');
    }
  });

  it('finds users by handle prefix and never returns the caller', async () => {
    const token = sessionFor('me');
    const result = await call('searchUsers', { query: 'an' }, token);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data.users.map((user) => user.username).sort(), ['ana_silva', 'anselmo']);
    const self = await call('searchUsers', { query: 'me' }, token);
    assert.deepEqual(self.body.data.users, []);
  });

  it('treats LIKE wildcards as plain characters so they cannot enumerate users', async () => {
    const token = sessionFor('me');
    for (const query of ['%%', '__', '%a', '_n']) {
      const result = await call('searchUsers', { query }, token);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.data.users, [], `query ${query} must not match`);
    }
  });

  it('hides users blocked in either direction', async () => {
    addBlock('me', 'ana');
    addBlock('anselmo', 'me');
    const result = await call('searchUsers', { query: 'an' }, sessionFor('me'));
    assert.deepEqual(result.body.data.users, []);
  });

  it('never returns a hidden profile unless the handle is typed exactly', async () => {
    const token = sessionFor('me');
    assert.deepEqual((await call('searchUsers', { query: 'gh' }, token)).body.data.users, []);
    const exact = await call('searchUsers', { query: 'ghostly' }, token);
    assert.equal(exact.body.data.users.length, 1);
  });
});

describe('getUserSuggestions', () => {
  it('requires a session', async () => {
    assert.equal((await call('getUserSuggestions', {})).status, 401);
  });

  it('is capped and excludes the caller, followed, blocked and hidden users', async () => {
    for (let index = 0; index < 15; index += 1) addUser(`extra${index}`, `extra${index}`, `Extra ${index}`);
    addFollow('me', 'bob');
    addBlock('me', 'ana');
    addBlock('anselmo', 'me');
    const result = await call('getUserSuggestions', {}, sessionFor('me'));
    assert.equal(result.status, 200);
    const names = result.body.data.users.map((user) => user.username);
    assert.equal(names.length, 10);
    for (const excluded of ['meuser', 'bobby', 'ana_silva', 'anselmo', 'ghostly']) {
      assert.ok(!names.includes(excluded), `${excluded} must not be suggested`);
    }
  });
});

describe('getPublicUserProfile', () => {
  it('shows the handle and picture but not the real name to anonymous viewers', async () => {
    const result = await call('getPublicUserProfile', { userId: 'ana' });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.username, 'ana_silva');
    assert.equal(result.body.data.full_name, null);
    assert.equal(JSON.stringify(result.body).includes('Ana Silva'), false);
    assert.equal(JSON.stringify(result.body).includes('example.com'), false);
  });

  it('includes the name for a signed-in viewer', async () => {
    const result = await call('getPublicUserProfile', { userId: 'ana' }, sessionFor('me'));
    assert.equal(result.body.data.full_name, 'Ana Silva');
  });

  it('treats an unverifiable token as anonymous instead of failing the shared link', async () => {
    const result = await call('getPublicUserProfile', { userId: 'ana' }, 'not.a.jwt');
    assert.equal(result.status, 200);
    assert.equal(result.body.data.full_name, null);
  });

  it('returns 404 when either side blocked the other', async () => {
    addBlock('me', 'ana');
    addBlock('bob', 'me');
    const token = sessionFor('me');
    assert.equal((await call('getPublicUserProfile', { userId: 'ana' }, token)).status, 404);
    assert.equal((await call('getPublicUserProfile', { userId: 'bob' }, token)).status, 404);
    assert.equal((await call('getPublicUserProfile', { userId: 'anselmo' }, token)).status, 200);
  });

  it('keeps hidden profiles hidden', async () => {
    assert.equal((await call('getPublicUserProfile', { userId: 'ghost' })).status, 404);
  });
});

describe('getUserPlaylists', () => {
  it('returns 404 to a viewer who is blocked in either direction and 200 otherwise', async () => {
    addBlock('ana', 'me');
    const token = sessionFor('me');
    assert.equal((await call('getUserPlaylists', { userId: 'ana' }, token)).status, 404);
    assert.equal((await call('getUserPlaylists', { userId: 'bob' }, token)).status, 200);
    assert.equal((await call('getUserPlaylists', { userId: 'ana' })).status, 200);
  });
});
