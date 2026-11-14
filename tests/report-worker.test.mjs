import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import worker from '../workers/api/src/index.ts';
import { voxylApi } from '../src/api/voxylApiClient.js';

// These tests run the Worker against a real SQLite database built from the
// repository migrations, so the report SQL (partial unique index, atomic
// counter, ON CONFLICT handling) is exercised exactly as written.

const issuer = 'https://clerk.voxyl.test';
const migrationsDir = path.resolve('workers/api/migrations');
const baseEnv = {
  CLERK_AUTHORIZED_PARTIES: 'https://v.renbrant.com,http://localhost:5173',
  CLERK_ISSUER: issuer,
  CLERK_SECRET_KEY: 'sk_test_unused',
  CLERK_JWT_KEY: '',
};

function createSqliteD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
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
  reporter: { id: 'user-reporter', clerk: 'clerk-reporter', email: 'reporter@example.com', name: 'Reporter', role: 'user' },
  owner: { id: 'user-owner', clerk: 'clerk-owner', email: 'owner@example.com', name: 'Owner', role: 'user' },
  admin: { id: 'user-admin', clerk: 'clerk-admin', email: 'moderator@example.com', name: 'Moderator', role: 'admin' },
};

let db;
let env;
let tokens;

function seed() {
  for (const [key, person] of Object.entries(people)) {
    db.raw.prepare(
      'INSERT INTO users (id, clerk_user_id, email, name, username, role) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(person.id, person.clerk, person.email, person.name, key, person.role);
  }
  const insertPlaylist = db.raw.prepare(
    `INSERT INTO playlists (id, creator_id, creator_clerk_user_id, title, visibility)
     VALUES (?, ?, ?, ?, ?)`,
  );
  insertPlaylist.run('playlist-public', people.owner.id, people.owner.clerk, 'Public mix', 'public');
  insertPlaylist.run('playlist-private', people.owner.id, people.owner.clerk, 'Secret mix', 'private');
  insertPlaylist.run('playlist-reporter', people.reporter.id, people.reporter.clerk, 'My mix', 'public');
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

function call(pathname, { method = 'GET', payload, as } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (as) headers.authorization = `Bearer ${tokens[as]}`;
  const init = { method, headers };
  if (payload !== undefined) init.body = JSON.stringify(payload);
  return worker.fetch(new Request(`https://api.voxyl.test${pathname}`, init), env);
}

const reports = () => db.raw.prepare('SELECT * FROM reports ORDER BY created_at, id').all();
const reportsCount = (playlistId) => db.raw.prepare('SELECT reports_count FROM playlists WHERE id = ?').get(playlistId).reports_count;

describe('POST /api/reports', () => {
  it('requires authentication', async () => {
    const response = await call('/api/reports', {
      method: 'POST',
      payload: { content_type: 'playlist', content_id: 'playlist-public', reason: 'spam' },
    });

    assert.equal(response.status, 401);
    assert.equal(reports().length, 0);
  });

  it('rejects invalid payloads', async () => {
    const cases = [
      { content_type: 'comment', content_id: 'playlist-public', reason: 'spam' },
      { content_type: 'playlist', content_id: 'playlist-public', reason: 'because' },
      { content_type: 'playlist', reason: 'spam' },
      { content_type: 'playlist', content_id: 'playlist-public', reason: 'spam', details: 'x'.repeat(1001) },
    ];

    for (const payload of cases) {
      const response = await call('/api/reports', { method: 'POST', payload, as: 'reporter' });
      assert.equal(response.status, 400, JSON.stringify(payload).slice(0, 80));
    }

    assert.equal(reports().length, 0);
  });

  it('records a playlist report with server-derived identity and increments the counter', async () => {
    const response = await call('/api/reports', {
      method: 'POST',
      as: 'reporter',
      payload: {
        content_type: 'playlist',
        content_id: 'playlist-public',
        reason: 'hate_speech',
        details: '  offensive description  ',
        // Forged fields must be ignored.
        reporter_id: people.owner.id,
        reported_user_id: people.admin.id,
        reporter_email: 'forged@example.com',
        content_title: 'Forged title',
        status: 'resolved',
      },
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.duplicate, false);
    assert.doesNotMatch(JSON.stringify(body), /@|clerk|legacy/i);

    const [row] = reports();
    assert.equal(reports().length, 1);
    assert.equal(row.reporter_id, people.reporter.id);
    assert.equal(row.reporter_clerk_user_id, people.reporter.clerk);
    assert.equal(row.reported_user_id, people.owner.id);
    assert.equal(row.reported_playlist_id, 'playlist-public');
    assert.equal(row.content_title, 'Public mix');
    assert.equal(row.reason, 'hate_speech');
    assert.equal(row.details, 'offensive description');
    assert.equal(row.status, 'open');
    assert.equal(row.reporter_email, null);
    assert.equal(reportsCount('playlist-public'), 1);
  });

  it('treats a repeated report as idempotent', async () => {
    const payload = { content_type: 'playlist', content_id: 'playlist-public', reason: 'spam' };

    assert.equal((await call('/api/reports', { method: 'POST', as: 'reporter', payload })).status, 201);
    const second = await call('/api/reports', { method: 'POST', as: 'reporter', payload: { ...payload, reason: 'other' } });

    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { ok: true, duplicate: true });
    assert.equal(reports().length, 1);
    assert.equal(reportsCount('playlist-public'), 1);
  });

  it('creates exactly one report for concurrent submissions', async () => {
    const payload = { content_type: 'playlist', content_id: 'playlist-public', reason: 'spam' };
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => call('/api/reports', { method: 'POST', as: 'reporter', payload })),
    );

    assert.equal(responses.filter((response) => response.status === 201).length, 1);
    assert.equal(reports().length, 1);
    assert.equal(reportsCount('playlist-public'), 1);
  });

  it('rejects reporting your own playlist or yourself', async () => {
    const own = await call('/api/reports', {
      method: 'POST', as: 'reporter',
      payload: { content_type: 'playlist', content_id: 'playlist-reporter', reason: 'spam' },
    });
    const self = await call('/api/reports', {
      method: 'POST', as: 'reporter',
      payload: { content_type: 'user', content_id: people.reporter.id, reason: 'spam' },
    });

    assert.equal(own.status, 400);
    assert.equal((await own.json()).code, 'own-content');
    assert.equal(self.status, 400);
    assert.equal(reports().length, 0);
  });

  it('hides playlists the reporter cannot access and unknown content', async () => {
    const privatePlaylist = await call('/api/reports', {
      method: 'POST', as: 'reporter',
      payload: { content_type: 'playlist', content_id: 'playlist-private', reason: 'spam' },
    });
    const missingPlaylist = await call('/api/reports', {
      method: 'POST', as: 'reporter',
      payload: { content_type: 'playlist', content_id: 'does-not-exist', reason: 'spam' },
    });
    const missingUser = await call('/api/reports', {
      method: 'POST', as: 'reporter',
      payload: { content_type: 'user', content_id: 'does-not-exist', reason: 'spam' },
    });

    assert.equal(privatePlaylist.status, 404);
    assert.equal(missingPlaylist.status, 404);
    assert.equal(missingUser.status, 404);
    assert.equal(reports().length, 0);
    assert.equal(reportsCount('playlist-private'), 0);
  });

  it('records a user report without touching playlist counters', async () => {
    const response = await call('/api/reports', {
      method: 'POST', as: 'reporter',
      payload: { content_type: 'user', content_id: people.owner.id, reason: 'inappropriate' },
    });

    assert.equal(response.status, 201);
    const [row] = reports();
    assert.equal(row.reported_user_id, people.owner.id);
    assert.equal(row.reported_playlist_id, null);
    assert.equal(row.content_type, 'user');
    assert.equal(reportsCount('playlist-public'), 0);
  });

  it('limits how many reports one account can send per day', async () => {
    const insert = db.raw.prepare(
      `INSERT INTO reports (id, reporter_id, reported_user_id, reason, status, content_type, content_id)
       VALUES (?, ?, ?, 'spam', 'open', 'user', ?)`,
    );
    for (let index = 0; index < 20; index += 1) {
      insert.run(`old-${index}`, people.reporter.id, people.owner.id, `target-${index}`);
    }

    const response = await call('/api/reports', {
      method: 'POST', as: 'reporter',
      payload: { content_type: 'playlist', content_id: 'playlist-public', reason: 'spam' },
    });

    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, 'rate-limited');
    assert.equal(reports().length, 20);
    assert.equal(reportsCount('playlist-public'), 0);
  });
});

describe('admin report moderation', () => {
  async function submit() {
    const response = await call('/api/reports', {
      method: 'POST', as: 'reporter',
      payload: { content_type: 'playlist', content_id: 'playlist-public', reason: 'spam', details: 'looks automated' },
    });
    assert.equal(response.status, 201);
    return (await response.json()).report.id;
  }

  it('only lets administrators list and update reports', async () => {
    const id = await submit();

    assert.equal((await call('/api/admin/reports')).status, 401);
    assert.equal((await call('/api/admin/reports', { as: 'reporter' })).status, 403);
    assert.equal((await call(`/api/admin/reports/${id}`, { method: 'PATCH', as: 'reporter', payload: { status: 'resolved' } })).status, 403);
    assert.equal(reports()[0].status, 'open');
  });

  it('lists open reports with usernames but without emails', async () => {
    const id = await submit();
    const response = await call('/api/admin/reports', { as: 'admin' });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.reports.length, 1);
    assert.equal(body.reports[0].id, id);
    assert.equal(body.reports[0].reported_username, 'owner');
    assert.equal(body.reports[0].reporter_username, 'reporter');
    assert.equal(body.reports[0].details, 'looks automated');
    assert.doesNotMatch(JSON.stringify(body), /@example\.com/);
    assert.equal((await call('/api/admin/reports?status=bogus', { as: 'admin' })).status, 400);
  });

  it('resolves a report, moves it out of the open queue and allows a fresh report', async () => {
    const id = await submit();
    const update = await call(`/api/admin/reports/${id}`, { method: 'PATCH', as: 'admin', payload: { status: 'resolved' } });

    assert.equal(update.status, 200);
    assert.equal((await (await call('/api/admin/reports', { as: 'admin' })).json()).reports.length, 0);
    assert.equal((await (await call('/api/admin/reports?status=resolved', { as: 'admin' })).json()).reports.length, 1);

    await submit();
    assert.equal(reports().length, 2);
    assert.equal(reportsCount('playlist-public'), 2);
  });

  it('rejects invalid transitions and unknown reports', async () => {
    const id = await submit();

    assert.equal((await call(`/api/admin/reports/${id}`, { method: 'PATCH', as: 'admin', payload: { status: 'open' } })).status, 400);
    assert.equal((await call('/api/admin/reports/missing', { method: 'PATCH', as: 'admin', payload: { status: 'dismissed' } })).status, 404);
  });
});

describe('report client', () => {
  it('sends only the content reference and reason, never identity fields', async () => {
    mock.restoreAll();
    let captured;
    mock.method(globalThis, 'fetch', async (url, init) => {
      captured = { url: String(url), init };
      return Response.json({ ok: true, duplicate: false }, { headers: { 'content-type': 'application/json' } });
    });

    await voxylApi.reports.create({ contentType: 'playlist', contentId: 'abc', reason: 'spam', details: '' });

    assert.match(captured.url, /\/reports$/);
    assert.equal(captured.init.method, 'POST');
    assert.deepEqual(JSON.parse(captured.init.body), { content_type: 'playlist', content_id: 'abc', reason: 'spam' });
  });

  it('no longer exposes the generic Report entity', () => {
    assert.equal(voxylApi.entities.Report, undefined);
  });

  it('has no source file that writes reports through the generic entity client', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(jsx?|ts)$/.test(entry.name) && /entities\.Report\b/.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
      }
    };
    walk(path.resolve('src'));

    assert.deepEqual(offenders, []);
  });
});
