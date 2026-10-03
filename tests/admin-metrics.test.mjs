import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterEach, describe, it, mock } from 'node:test';
import worker from '../workers/api/src/index.ts';

const issuer = 'https://clerk.voxyl.test';
const baseEnv = {
  CLERK_AUTHORIZED_PARTIES: 'https://v.renbrant.com,http://localhost:5173',
  CLERK_ISSUER: issuer,
  CLERK_SECRET_KEY: 'sk_test_admin',
  CLERK_JWT_KEY: '',
};

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createJwt({ sub = 'clerk-admin-user', email = 'admin@example.com', name = 'Admin User' } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `kid-${crypto.randomUUID()}`;
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuer,
    sub,
    sid: 'session-admin',
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
    const requestedUrl = String(url);
    if (requestedUrl === `${issuer}/.well-known/jwks.json`) {
      return Response.json({ keys: [jwk] });
    }
    return new Response(null, { status: 503 });
  });
}

function createMockD1({ users = [], playlists = [], plays = [] } = {}) {
  return {
    prepare(sql) {
      const normalized = sql.trim().replace(/\s+/g, ' ');

      return {
        bind(..._args) {
          return this;
        },
        async first() {
          if (normalized.includes('FROM users WHERE clerk_user_id = ?')) {
            return users[0] || null;
          }
          if (normalized.includes('SELECT COUNT(*) AS count FROM users WHERE datetime(created_at) >= datetime')) {
            return { count: 3 };
          }
          if (normalized.includes('SELECT COUNT(*) AS count FROM users')) {
            return { count: users.length || 10 };
          }
          if (normalized.includes('SELECT COUNT(DISTINCT user_id) AS count FROM episode_progress')) {
            return { count: 5 };
          }
          if (normalized.includes('SELECT COUNT(*) AS count FROM playlists WHERE visibility = \'public\'')) {
            return { count: 8 };
          }
          if (normalized.includes('SELECT COUNT(*) AS count FROM playlists WHERE visibility = \'private\'')) {
            return { count: 2 };
          }
          if (normalized.includes('SELECT COUNT(*) AS count FROM playlists')) {
            return { count: playlists.length || 10 };
          }
          if (normalized.includes('SELECT COUNT(*) AS count FROM playlist_likes')) {
            return { count: 25 };
          }
          if (normalized.includes('SELECT COUNT(*) AS count FROM podcast_likes')) {
            return { count: 40 };
          }
          if (normalized.includes('SELECT COUNT(*) AS count FROM podcast_plays WHERE datetime')) {
            return { count: 15 };
          }
          if (normalized.includes('SELECT COUNT(*) AS count FROM podcast_plays')) {
            return { count: plays.length || 120 };
          }
          return { count: 0 };
        },
        async all() {
          if (normalized.includes('SELECT id, name, username, email, role, profile_picture, created_at FROM users')) {
            return {
              results: users.slice(0, 10).map((u) => ({
                id: u.id,
                name: u.name,
                username: u.username,
                email: u.email,
                role: u.role,
                profile_picture: u.profile_picture || null,
                created_at: u.created_at || '2026-10-01 12:00:00',
              })),
            };
          }
          if (normalized.includes('SELECT id, title, creator_username, visibility, likes_count, plays_count, created_at FROM playlists')) {
            return {
              results: [
                {
                  id: 'pl-1',
                  title: 'Tech Daily',
                  creator_username: 'renatobrant',
                  visibility: 'public',
                  likes_count: 5,
                  plays_count: 30,
                  created_at: '2026-10-02 10:00:00',
                },
              ],
            };
          }
          if (normalized.includes('SELECT date(COALESCE(NULLIF(TRIM(played_at), \'\'), created_at)) AS day, COUNT(*) AS count FROM podcast_plays')) {
            return {
              results: [
                { day: '2026-10-01', count: 12 },
                { day: '2026-10-02', count: 18 },
                { day: '2026-10-03', count: 25 },
              ],
            };
          }
          if (normalized.includes('SELECT date(created_at) AS day, COUNT(*) AS count FROM users')) {
            return {
              results: [
                { day: '2026-10-01', count: 2 },
                { day: '2026-10-02', count: 4 },
                { day: '2026-10-03', count: 3 },
              ],
            };
          }
          return { results: [] };
        },
      };
    },
  };
}

describe('Admin Metrics API Route', () => {
  afterEach(() => {
    mock.reset();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const response = await worker.fetch(
      new Request('https://api.voxyl.renbrant.com/api/admin/metrics'),
      { ...baseEnv, DB: createMockD1() },
    );
    assert.equal(response.status, 401);
  });

  it('rejects non-admin users with 403', async () => {
    const { token, jwk } = createJwt({ sub: 'user-regular', email: 'regular@example.com' });
    installJwksMock(jwk);

    const db = createMockD1({
      users: [
        {
          id: 'u-regular',
          clerk_user_id: 'user-regular',
          email: 'regular@example.com',
          name: 'Regular Listener',
          username: 'regular',
          role: 'user',
        },
      ],
    });

    const response = await worker.fetch(
      new Request('https://api.voxyl.renbrant.com/api/admin/metrics', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { ...baseEnv, DB: db },
    );

    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /administrador/i);
  });

  it('allows access for users with role === admin and returns complete metrics payload', async () => {
    const { token, jwk } = createJwt({ sub: 'user-admin', email: 'admin@example.com' });
    installJwksMock(jwk);

    const db = createMockD1({
      users: [
        {
          id: 'u-admin',
          clerk_user_id: 'user-admin',
          email: 'admin@example.com',
          name: 'Super Admin',
          username: 'superadmin',
          role: 'admin',
        },
      ],
    });

    const response = await worker.fetch(
      new Request('https://api.voxyl.renbrant.com/api/admin/metrics', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { ...baseEnv, DB: db },
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.currentUser.role, 'admin');
    assert.ok(body.stats.users.total >= 0);
    assert.ok(body.stats.playlists.total >= 0);
    assert.ok(body.stats.engagement.totalPlays >= 0);
    assert.ok(Array.isArray(body.stats.recentUsers));
    assert.ok(Array.isArray(body.stats.recentPlaylists));
    assert.ok(Array.isArray(body.stats.charts.dailyPlays));
    assert.equal(body.cloudflare.limits.d1Writes, 100000);
    assert.equal(body.cloudflare.limits.d1Reads, 5000000);
  });

  it('allows access for default admin email renatobrant@gmail.com even if role in DB is user', async () => {
    const { token, jwk } = createJwt({ sub: 'user-renato', email: 'renatobrant@gmail.com' });
    installJwksMock(jwk);

    const db = createMockD1({
      users: [
        {
          id: 'u-renato',
          clerk_user_id: 'user-renato',
          email: 'renatobrant@gmail.com',
          name: 'Renato Brant',
          username: 'renatobrant',
          role: 'user',
        },
      ],
    });

    const response = await worker.fetch(
      new Request('https://api.voxyl.renbrant.com/api/admin/metrics', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { ...baseEnv, DB: db },
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.currentUser.email, 'renatobrant@gmail.com');
  });
});
