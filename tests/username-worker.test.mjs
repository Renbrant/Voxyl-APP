import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import worker from '../workers/api/src/index.ts';
import { voxylApi } from '../src/api/voxylApiClient.js';
import { getUsernameErrorKey, getUsernameValidationKey, normalizeUsername } from '../src/lib/username.js';

// These tests run the Worker against a real SQLite database built from the
// repository migrations, so the username SQL (case-insensitive unique index,
// guarded claim, creator_username sync) is exercised exactly as written.

const issuer = 'https://clerk.voxyl.test';
const migrationsDir = path.resolve('workers/api/migrations');
const baseEnv = {
  CLERK_AUTHORIZED_PARTIES: 'https://v.renbrant.com,http://localhost:5173',
  CLERK_ISSUER: issuer,
  CLERK_SECRET_KEY: 'sk_test_unused',
  CLERK_JWT_KEY: '',
};

function migrationFiles() {
  return fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
}

function applyMigrations(db, files) {
  for (const file of files) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
}

function createSqliteD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  applyMigrations(db, migrationFiles());
  const clean = (params) => params.map((value) => (value === undefined ? null : value));

  return {
    raw: db,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            sql,
            params,
            async first() {
              return db.prepare(sql).get(...clean(params)) ?? null;
            },
            async all() {
              return { results: db.prepare(sql).all(...clean(params)) };
            },
            async run() {
              const result = db.prepare(sql).run(...clean(params));
              return { meta: { changes: Number(result.changes) } };
            },
          };
        },
      };
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createJwt({ sub, email, name }) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `kid-${crypto.randomUUID()}`;
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuer,
    sub,
    sid: `session-${sub}`,
    email,
    name,
    azp: 'https://v.renbrant.com',
    iat: now - 10,
    nbf: now - 10,
    exp: now + 3600,
  };
  const signedData = `${base64urlJson(header)}.${base64urlJson(claims)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signedData), privateKey).toString('base64url');

  return {
    token: `${signedData}.${signature}`,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' },
  };
}

const people = {
  owner: { id: 'user-owner', clerk: 'clerk-owner', email: 'owner@example.com', name: 'Owner', username: null },
  holder: { id: 'user-holder', clerk: 'clerk-holder', email: 'holder@example.com', name: 'Holder', username: 'taken_name' },
  rival: { id: 'user-rival', clerk: 'clerk-rival', email: 'rival@example.com', name: 'Rival', username: null },
};

let db;
let env;
let tokens;

function seed() {
  const insertUser = db.raw.prepare(
    'INSERT INTO users (id, clerk_user_id, email, name, username, role) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const person of Object.values(people)) {
    insertUser.run(person.id, person.clerk, person.email, person.name, person.username, 'user');
  }
  // Username claims are gated on the current Terms of Use; these tests cover the
  // username rules themselves, so every seeded account has accepted the terms.
  db.raw.prepare('UPDATE users SET terms_accepted_version = ?').run('2026-11-14');
  const insertPlaylist = db.raw.prepare(
    `INSERT INTO playlists (id, creator_id, creator_clerk_user_id, creator_username, title, visibility)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insertPlaylist.run('playlist-owned', people.owner.id, people.owner.clerk, null, 'Owned mix', 'public');
  insertPlaylist.run('playlist-other', people.holder.id, people.holder.clerk, 'taken_name', 'Other mix', 'public');
}

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
  seed();
});

afterEach(() => {
  mock.restoreAll();
  db.raw.close();
});

function patchMe(payload, as) {
  const headers = { 'content-type': 'application/json' };
  if (as) headers.authorization = `Bearer ${tokens[as]}`;
  return worker.fetch(
    new Request('https://api.voxyl.test/api/me', { method: 'PATCH', headers, body: JSON.stringify(payload) }),
    env,
  );
}

const usernameOf = (id) => db.raw.prepare('SELECT username FROM users WHERE id = ?').get(id).username;
const creatorUsernameOf = (id) => db.raw.prepare('SELECT creator_username FROM playlists WHERE id = ?').get(id).creator_username;

describe('PATCH /api/me username', () => {
  it('requires authentication', async () => {
    const response = await patchMe({ username: 'newname' });

    assert.equal(response.status, 401);
    assert.equal(usernameOf(people.owner.id), null);
  });

  it('persists the username, which the old handler ignored entirely', async () => {
    const response = await patchMe({ username: 'renato' }, 'owner');

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.user.username, 'renato');
    assert.equal(usernameOf(people.owner.id), 'renato');
  });

  it('normalizes padding, a leading @ and uppercase on the server', async () => {
    const response = await patchMe({ username: '  @Renato_01  ' }, 'owner');

    assert.equal(response.status, 200);
    assert.equal(usernameOf(people.owner.id), 'renato_01');
  });

  it('rejects usernames that are too short', async () => {
    const response = await patchMe({ username: 'ab' }, 'owner');

    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'invalid-username');
    assert.equal(usernameOf(people.owner.id), null);
  });

  it('rejects usernames that are too long', async () => {
    const response = await patchMe({ username: 'a'.repeat(31) }, 'owner');

    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'invalid-username');
  });

  it('rejects unsupported characters', async () => {
    for (const candidate of ['bad name', 'bad-name', 'bad.name', 'bad/name', 'nome_ação']) {
      const response = await patchMe({ username: candidate }, 'owner');

      assert.equal(response.status, 400, `expected ${candidate} to be rejected`);
      assert.equal((await response.json()).code, 'invalid-username');
    }

    assert.equal(usernameOf(people.owner.id), null);
  });

  it('rejects non-string usernames', async () => {
    const response = await patchMe({ username: 42 }, 'owner');

    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'invalid-username');
  });

  it('refuses reserved handles that would impersonate the product', async () => {
    const response = await patchMe({ username: 'Admin' }, 'owner');

    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'username-taken');
    assert.equal(usernameOf(people.owner.id), null);
  });

  it('returns a conflict when another user already holds the handle', async () => {
    const response = await patchMe({ username: 'taken_name' }, 'owner');

    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, 'username-taken');
    assert.equal(usernameOf(people.owner.id), null);
  });

  it('treats the conflict as case-insensitive', async () => {
    const response = await patchMe({ username: 'TAKEN_NAME' }, 'owner');

    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'username-taken');
  });

  it('does not leak the other account when rejecting a claim', async () => {
    const response = await patchMe({ username: 'taken_name' }, 'owner');
    const body = await response.json();

    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes(people.holder.email), false);
    assert.equal(serialized.includes(people.holder.id), false);
    assert.equal(serialized.includes(people.holder.name), false);
  });

  it('lets the holder re-submit their own handle', async () => {
    const response = await patchMe({ username: 'Taken_Name' }, 'holder');

    assert.equal(response.status, 200);
    assert.equal(usernameOf(people.holder.id), 'taken_name');
  });

  it('keeps only one winner when two accounts claim the same handle at once', async () => {
    const [first, second] = await Promise.all([
      patchMe({ username: 'shared' }, 'owner'),
      patchMe({ username: 'shared' }, 'rival'),
    ]);

    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 409]);

    const holders = db.raw
      .prepare("SELECT id FROM users WHERE LOWER(username) = 'shared'")
      .all();
    assert.equal(holders.length, 1);
  });

  it('syncs the creator handle on owned playlists', async () => {
    await patchMe({ username: 'renato' }, 'owner');

    assert.equal(creatorUsernameOf('playlist-owned'), 'renato');
    assert.equal(creatorUsernameOf('playlist-other'), 'taken_name');
  });

  it('leaves other playlists untouched when the claim is refused', async () => {
    await patchMe({ username: 'taken_name' }, 'owner');

    assert.equal(creatorUsernameOf('playlist-owned'), null);
    assert.equal(creatorUsernameOf('playlist-other'), 'taken_name');
  });

  it('still updates other profile fields alongside the username', async () => {
    const response = await patchMe({ username: 'renato', profile_hidden: true }, 'owner');

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.user.username, 'renato');
    assert.equal(db.raw.prepare('SELECT profile_hidden FROM users WHERE id = ?').get(people.owner.id).profile_hidden, 1);
  });
});

describe('migration 0009', () => {
  function dbWithoutUsernameMigration() {
    const files = migrationFiles();
    const index = files.indexOf('0009_username_normalization.sql');
    assert.ok(index > 0, 'expected the username migration to exist');
    const raw = new DatabaseSync(':memory:');
    applyMigrations(raw, files.slice(0, index));
    return { raw, remaining: files.slice(index) };
  }

  it('resolves case-insensitive duplicates, keeping the earliest account', () => {
    const { raw, remaining } = dbWithoutUsernameMigration();
    const insert = raw.prepare(
      'INSERT INTO users (id, email, name, username, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insert.run('user-first', 'first@example.com', 'First', 'Renato', '2024-01-01T00:00:00Z');
    insert.run('user-second', 'second@example.com', 'Second', 'renato', '2024-06-01T00:00:00Z');
    insert.run('user-third', 'third@example.com', 'Third', 'RENATO', '2024-09-01T00:00:00Z');

    applyMigrations(raw, remaining);

    const rows = raw.prepare('SELECT id, username FROM users ORDER BY id').all();
    const byId = Object.fromEntries(rows.map((row) => [row.id, row.username]));
    assert.equal(byId['user-first'], 'renato');
    assert.notEqual(byId['user-second'], 'renato');
    assert.notEqual(byId['user-third'], 'renato');
    assert.equal(new Set(rows.map((row) => row.username)).size, 3);
    raw.close();
  });

  it('lowercases, trims and clears blank handles', () => {
    const { raw, remaining } = dbWithoutUsernameMigration();
    const insert = raw.prepare('INSERT INTO users (id, email, name, username) VALUES (?, ?, ?, ?)');
    insert.run('user-mixed', 'mixed@example.com', 'Mixed', '  MiXeD  ');
    insert.run('user-blank', 'blank@example.com', 'Blank', '   ');

    applyMigrations(raw, remaining);

    assert.equal(raw.prepare('SELECT username FROM users WHERE id = ?').get('user-mixed').username, 'mixed');
    assert.equal(raw.prepare('SELECT username FROM users WHERE id = ?').get('user-blank').username, null);
    raw.close();
  });

  it('realigns playlist creator handles after rewriting usernames', () => {
    const { raw, remaining } = dbWithoutUsernameMigration();
    raw.prepare('INSERT INTO users (id, email, name, username) VALUES (?, ?, ?, ?)')
      .run('user-mixed', 'mixed@example.com', 'Mixed', 'MiXeD');
    raw.prepare(
      'INSERT INTO playlists (id, creator_id, creator_username, title, visibility) VALUES (?, ?, ?, ?, ?)',
    ).run('playlist-mixed', 'user-mixed', 'MiXeD', 'Mix', 'public');

    applyMigrations(raw, remaining);

    assert.equal(
      raw.prepare('SELECT creator_username FROM playlists WHERE id = ?').get('playlist-mixed').creator_username,
      'mixed',
    );
    raw.close();
  });

  it('blocks a duplicate handle that differs only by case', () => {
    assert.throws(() => {
      db.raw.prepare('INSERT INTO users (id, email, name, username) VALUES (?, ?, ?, ?)')
        .run('user-dupe', 'dupe@example.com', 'Dupe', 'TAKEN_NAME');
    }, /UNIQUE constraint failed/i);
  });

  it('still allows several accounts without a handle', () => {
    const insert = db.raw.prepare('INSERT INTO users (id, email, name, username) VALUES (?, ?, ?, ?)');
    insert.run('user-null-a', 'a@example.com', 'A', null);
    insert.run('user-null-b', 'b@example.com', 'B', null);

    assert.equal(db.raw.prepare('SELECT COUNT(*) AS count FROM users WHERE username IS NULL').get().count, 4);
  });
});

describe('username client', () => {
  it('no longer exposes a generic User entity client', () => {
    assert.equal(voxylApi.entities.User, undefined);
    assert.ok(voxylApi.entities.Playlist, 'other entity clients are unaffected');
  });

  it('normalizes the same way the Worker does', () => {
    assert.equal(normalizeUsername('  @Renato_01 '), 'renato_01');
    assert.equal(normalizeUsername('@@renato'), 'renato');
    assert.equal(normalizeUsername(null), '');
  });

  it('pre-checks the same rules the Worker enforces', () => {
    assert.equal(getUsernameValidationKey(''), 'usernameRequired');
    assert.equal(getUsernameValidationKey('ab'), 'usernameTooShort');
    assert.equal(getUsernameValidationKey('a'.repeat(31)), 'usernameTooLong');
    assert.equal(getUsernameValidationKey('bad-name'), 'usernameInvalidChars');
    assert.equal(getUsernameValidationKey('good_name1'), '');
  });

  it('maps server responses to message keys', () => {
    assert.equal(getUsernameErrorKey({ status: 409, code: 'username-taken' }), 'usernameTaken');
    assert.equal(getUsernameErrorKey({ status: 400, code: 'invalid-username' }), 'usernameInvalidChars');
    assert.equal(getUsernameErrorKey({ status: 401 }), 'usernameAuthError');
    assert.equal(getUsernameErrorKey({ status: 500 }), 'usernameSaveError');
  });
});
