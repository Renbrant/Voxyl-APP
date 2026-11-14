import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import worker from '../workers/api/src/index.ts';
import { baseEnv, createJwt, createSqliteD1, issuer, origin } from './helpers/worker-harness.mjs';

const CURRENT = '2026-11-14';

const people = {
  pending: { id: 'user-pending', clerk: 'clerk-pending', email: 'pending@example.com', name: 'Pending', accepted: null },
  accepted: { id: 'user-accepted', clerk: 'clerk-accepted', email: 'accepted@example.com', name: 'Accepted', accepted: CURRENT },
};

let db;
let env;
let tokens;

beforeEach(() => {
  db = createSqliteD1();
  env = { ...baseEnv, DB: db };
  const issued = Object.fromEntries(
    Object.entries(people).map(([key, person]) => [key, createJwt({ sub: person.clerk, email: person.email, name: person.name })]),
  );
  tokens = Object.fromEntries(Object.entries(issued).map(([key, value]) => [key, value.token]));
  mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(String(url), `${issuer}/.well-known/jwks.json`);
    return Response.json({ keys: Object.values(issued).map((value) => value.jwk) });
  });

  const insert = db.raw.prepare(
    'INSERT INTO users (id, clerk_user_id, email, name, username, role, terms_accepted_version) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const person of Object.values(people)) {
    insert.run(person.id, person.clerk, person.email, person.name, null, 'user', person.accepted);
  }
});

afterEach(() => {
  mock.restoreAll();
  db.raw.close();
});

function call(pathname, { method = 'POST', as, payload } = {}) {
  const headers = { 'content-type': 'application/json', origin };
  if (as) headers.authorization = `Bearer ${tokens[as]}`;
  const init = { method, headers };
  if (payload !== undefined) init.body = JSON.stringify(payload);
  return worker.fetch(new Request(`https://api.voxyl.test${pathname}`, init), env);
}

const acceptedVersionOf = (id) =>
  db.raw.prepare('SELECT terms_accepted_version AS version FROM users WHERE id = ?').get(id).version;

describe('accepting the Terms of Use', () => {
  it('requires authentication', async () => {
    const response = await call('/api/me/accept-terms', { payload: { version: CURRENT } });

    assert.equal(response.status, 401);
    assert.equal(acceptedVersionOf(people.pending.id), null);
  });

  it('records the current version and timestamp', async () => {
    const response = await call('/api/me/accept-terms', { as: 'pending', payload: { version: CURRENT } });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).terms_accepted_version, CURRENT);
    assert.equal(acceptedVersionOf(people.pending.id), CURRENT);
    const row = db.raw.prepare('SELECT terms_accepted_at AS at FROM users WHERE id = ?').get(people.pending.id);
    assert.ok(row.at, 'acceptance timestamp is stored');
  });

  it('refuses a version the user did not review', async () => {
    const response = await call('/api/me/accept-terms', { as: 'pending', payload: { version: '2025-01-01' } });

    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'terms-version-mismatch');
    assert.equal(acceptedVersionOf(people.pending.id), null);
  });

  it('refuses a request without a version', async () => {
    const response = await call('/api/me/accept-terms', { as: 'pending', payload: {} });

    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'terms-version-mismatch');
  });

  it('is idempotent for an already accepted user', async () => {
    const response = await call('/api/me/accept-terms', { as: 'accepted', payload: { version: CURRENT } });

    assert.equal(response.status, 200);
    assert.equal(acceptedVersionOf(people.accepted.id), CURRENT);
  });
});

describe('gating content creation', () => {
  it('blocks playlist creation until the current terms are accepted', async () => {
    const response = await call('/api/playlists', { as: 'pending', payload: { name: 'Mix' } });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'terms-not-accepted');
    const count = db.raw.prepare("SELECT COUNT(*) AS count FROM playlists WHERE creator_id = ?").get(people.pending.id).count;
    assert.equal(count, 0);
  });

  it('lets an accepted user past the terms gate', async () => {
    const response = await call('/api/playlists', { as: 'accepted', payload: { name: 'Mix' } });

    assert.notEqual(response.status, 403);
  });

  it('blocks file uploads until the current terms are accepted', async () => {
    const response = await call('/api/files/upload', { as: 'pending', payload: {} });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'terms-not-accepted');
  });

  it('blocks claiming a username until the current terms are accepted', async () => {
    const response = await call('/api/me', { method: 'PATCH', as: 'pending', payload: { username: 'fresh_name' } });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'terms-not-accepted');
    assert.equal(db.raw.prepare('SELECT username FROM users WHERE id = ?').get(people.pending.id).username, null);
  });

  it('allows the username claim once accepted', async () => {
    const response = await call('/api/me', { method: 'PATCH', as: 'accepted', payload: { username: 'fresh_name' } });

    assert.equal(response.status, 200);
    assert.equal(db.raw.prepare('SELECT username FROM users WHERE id = ?').get(people.accepted.id).username, 'fresh_name');
  });

  it('does not gate reading the caller profile, so the client can show the acceptance screen', async () => {
    const response = await call('/api/me', { method: 'GET', as: 'pending' });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.user.terms_accepted_version, null);
    assert.equal(body.terms_current_version, CURRENT);
  });

  it('reports the accepted version on the profile after acceptance', async () => {
    const response = await call('/api/me', { method: 'GET', as: 'accepted' });

    const body = await response.json();
    assert.equal(body.user.terms_accepted_version, CURRENT);
  });
});
