import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { afterEach, describe, it, mock } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import worker from '../workers/api/src/index.ts';

const issuer = 'https://clerk.voxyl.test';
const baseEnv = {
  CLERK_AUTHORIZED_PARTIES: 'https://v.renbrant.com,http://localhost:5173',
  CLERK_ISSUER: issuer,
  CLERK_SECRET_KEY: 'sk_test_unused',
  CLERK_JWT_KEY: '',
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


function database({ bootstrap = false, role = 'user' } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  const directory = new URL('../workers/api/migrations/', import.meta.url);
  for (const name of fs.readdirSync(directory).filter(n => n.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(new URL(name, directory), 'utf8'));
  }
  if (!bootstrap) sqlite.prepare(`INSERT INTO users (id, clerk_user_id, email, name, username, role, clerk_profile_picture)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('owner-user', 'clerk-owner', 'owner@example.com', 'Owner User', 'owner', role, 'https://images.example.com/avatar.jpg');
  const db = {
    sqlite,
    prepare(sql) {
      return { bind(...params) {
        return {
          async first() { return sqlite.prepare(sql).get(...params) || null; },
          async all() { return { results: sqlite.prepare(sql).all(...params) }; },
          async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }; },
        };
      } };
    },
  };
  return db;
}

function setup(options = {}) {
  const { token, jwk } = createJwt();
  mock.method(globalThis, 'fetch', async url => {
    if (String(url) === `${issuer}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    assert.equal(String(url), 'https://api.clerk.com/v1/users/clerk-owner');
    return Response.json({ first_name: 'Owner', last_name: 'User', has_image: false,
      email_addresses: [{ id: 'email-1', email_address: 'owner@example.com' }], primary_email_address_id: 'email-1' });
  });
  const db = database(options);
  const env = { ...baseEnv, DB: db };
  const create = (payload, { route = '/api/entities/playlist', authenticated = true, raw } = {}) => worker.fetch(new Request(`https://api.voxyl.test${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://v.renbrant.com',
      ...(authenticated ? { authorization: `Bearer ${token}` } : {}) },
    body: raw === undefined ? JSON.stringify(payload) : raw,
  }), env);
  return { db, create, env };
}

afterEach(() => mock.restoreAll());

describe('playlist creation through the Worker with real SQLite migrations', () => {
  it('creates an empty playlist for a newly bootstrapped account and returns the client DTO', async () => {
    const { db, create } = setup({ bootstrap: true });
    const response = await create({ name: '  Brazuka  ' });
    const { playlist } = await response.json();
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://v.renbrant.com');
    assert.equal(playlist.name, 'Brazuka');
    assert.equal(playlist.title, 'Brazuka');
    assert.equal(playlist.creator_id, 'clerk-owner');
    assert.deepEqual(playlist.rss_feeds, []);
    assert.equal(playlist.max_duration, 0);
    assert.equal(playlist.time_filter_hours, 0);
    assert.equal(playlist.visibility, 'public');
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM playlists').get().n, 1);
    const fetched = await worker.fetch(new Request(`https://api.voxyl.test/api/playlists/${playlist.id}`), { ...baseEnv, DB: db });
    assert.equal(fetched.status, 200);
    assert.equal((await fetched.json()).playlist.name, 'Brazuka');
  });

  it('ignores forged identity, counters and sharing credentials, and saves filters/feeds', async () => {
    const { db, create } = setup();
    const response = await create({ name: 'Podcasts', creator_id: 'victim', creator_clerk_user_id: 'victim',
      creator_email: 'victim@example.com', creator_picture: 'forged', likes_count: 900, plays_count: 800,
      role: 'admin', share_token: 'legacy-retry-key', visibility: 'friends_only',
      max_duration: 45, time_filter_hours: 168, episodes_sort_order: 'oldest_first',
      rss_feeds: [{ url: 'https://example.com/rss', title: 'Show', skip_start_seconds: 12, skip_end_seconds: 3 }] });
    assert.equal(response.status, 201);
    const { playlist } = await response.json();
    assert.equal(playlist.creator_id, 'owner-user');
    assert.equal(playlist.creator_picture, 'https://images.example.com/avatar.jpg');
    assert.equal(playlist.creator_username, 'owner');
    assert.equal(playlist.likes_count, 0);
    assert.equal(playlist.plays_count, 0);
    assert.equal(playlist.visibility, 'friends_only');
    assert.equal(playlist.max_duration, 45);
    assert.equal(playlist.time_filter_hours, 168);
    assert.equal(playlist.episodes_sort_order, 'oldest_first');
    assert.equal(playlist.rss_feeds[0].skip_start_seconds, 12);
    const row = db.sqlite.prepare('SELECT * FROM playlists').get();
    assert.equal(row.creator_email, 'owner@example.com');
    assert.notEqual(row.share_token, 'legacy-retry-key');
  });

  it('supports legacy is_public and both creation route aliases', async () => {
    const { create } = setup();
    for (const route of ['/api/playlists', '/entities/playlist']) {
      const response = await create({ name: route, is_public: false }, { route });
      assert.equal(response.status, 201);
      assert.equal((await response.json()).playlist.visibility, 'private');
    }
  });

  it('rejects anonymous creation without a database write', async () => {
    const { create, db } = setup();
    assert.equal((await create({ name: 'No' }, { authenticated: false })).status, 401);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM playlists').get().n, 0);
  });

  it('rejects malformed, oversized and invalid creation settings', async () => {
    const { create, db } = setup();
    for (const payload of [{}, { name: ' ' }, { name: 'x'.repeat(201) }, { name: 'X', visibility: 'unknown' },
      { name: 'X', max_duration: -1 }, { name: 'X', max_duration: 1.2 }, { name: 'X', max_duration: true },
      { name: 'X', rss_feeds: 'invalid' }, { name: 'X', rss_feeds: [{ url: 'javascript:alert(1)' }] },
      { name: 'X', cover_image: 'javascript:alert(1)' }, { name: 'X', creation_request_id: '' }]) {
      const response = await create(payload);
      assert.equal(response.status, 400, JSON.stringify(payload));
    }
    assert.equal((await create({}, { raw: '{' })).status, 400);
    assert.equal((await create({}, { raw: 'x'.repeat(65537) })).status, 413);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM playlists').get().n, 0);
  });

  it('enforces feed limits and the final playlist slot atomically under concurrent creates', async () => {
    const { create, db } = setup();
    const feedResponse = await create({ name: 'Too many', rss_feeds: Array.from({ length: 6 }, (_, i) => ({ url: `https://example.com/${i}` })) });
    assert.equal((await feedResponse.json()).code, 'feed-limit');
    assert.equal((await create({ name: 'First' })).status, 201);
    const responses = await Promise.all(Array.from({ length: 4 }, (_, i) => create({ name: `Concurrent ${i}` })));
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409, 409, 409]);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM playlists').get().n, 2);
  });

  it('replays concurrent retries, including at quota, and rejects reusing a key for different data', async () => {
    const { create, db } = setup();
    const payload = { name: 'Retry', creation_request_id: 'operation-1' };
    const responses = await Promise.all([create(payload), create(payload)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
    const bodies = await Promise.all(responses.map(r => r.json()));
    assert.equal(bodies[0].playlist.id, bodies[1].playlist.id);
    await create({ name: 'Second' });
    assert.equal((await create(payload)).status, 200);
    const conflict = await create({ ...payload, name: 'Different' });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, 'creation-request-conflict');
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM playlists').get().n, 2);
  });

  it('scopes idempotency to the owner and allows unkeyed legacy rows', () => {
    const db = database();
    db.sqlite.prepare(`INSERT INTO users (id, clerk_user_id) VALUES ('other', 'clerk-other')`).run();
    for (const [id, owner] of [['a', 'owner-user'], ['b', 'other']]) {
      db.sqlite.prepare(`INSERT INTO playlists (id, creator_id, title, creation_request_id) VALUES (?, ?, 'Test', 'same-key')`).run(id, owner);
    }
    assert.throws(() => db.sqlite.prepare(`INSERT INTO playlists (id, creator_id, title, creation_request_id) VALUES ('c', 'other', 'Test', 'same-key')`).run(), /UNIQUE/);
    db.sqlite.prepare(`INSERT INTO playlists (id, creator_id, title) VALUES ('legacy', 'other', 'Legacy')`).run();
    assert.equal(db.sqlite.prepare(`SELECT creation_request_id FROM playlists WHERE id = 'legacy'`).get().creation_request_id, null);
  });

  it('preserves pre-existing playlists when migration 0007 is applied', () => {
    const db = new DatabaseSync(':memory:');
    const directory = new URL('../workers/api/migrations/', import.meta.url);
    for (const name of fs.readdirSync(directory).filter(n => n.endsWith('.sql') && !n.startsWith('0007')).sort()) {
      db.exec(fs.readFileSync(new URL(name, directory), 'utf8'));
    }
    db.exec(`INSERT INTO users (id) VALUES ('legacy-owner');
      INSERT INTO playlists (id, creator_id, title, likes_count, rss_feeds)
      VALUES ('legacy', 'legacy-owner', 'Keep me', 9, '[]');`);
    const before = db.prepare('SELECT * FROM playlists').get();
    db.exec(fs.readFileSync(new URL('0007_playlist_creation_idempotency.sql', directory), 'utf8'));
    const after = db.prepare('SELECT * FROM playlists').get();
    assert.equal(after.creation_request_id, null);
    assert.equal(after.creation_request_hash, null);
    for (const [key, value] of Object.entries(before)) assert.equal(after[key], value);
    db.close();
  });

  it('uses the server role for admin quotas rather than client claims', async () => {
    const { create } = setup({ role: 'admin' });
    for (let i = 0; i < 3; i++) assert.equal((await create({ name: `Admin ${i}` })).status, 201);
  });

  it('returns an explicit failure when D1 cannot persist the playlist', async () => {
    const { create, db } = setup();
    db.sqlite.exec(`CREATE TRIGGER test_failure BEFORE INSERT ON playlists BEGIN SELECT RAISE(ABORT, 'test database failure'); END;`);
    const response = await create({ name: 'Failure' });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).ok, false);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM playlists').get().n, 0);
  });
});
