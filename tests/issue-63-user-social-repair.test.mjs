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
  MEDIA_PUBLIC_BASE_URL: 'https://voxyl-media.renbrant.com/',
};

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createJwt({ sub = 'clerk-current', email = 'current@example.com', name = 'Current User' } = {}) {
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

function request(path, { method = 'GET', payload, token, rawBody, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (!requestHeaders['content-type'] && rawBody === undefined) requestHeaders['content-type'] = 'application/json';
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  const init = { method, headers: requestHeaders };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = rawBody ?? JSON.stringify(payload ?? {});
  }
  return new Request(`https://api.voxyl.test${path}`, init);
}

async function body(response) {
  return response.json();
}

function user(overrides) {
  return {
    id: 'current-user',
    clerk_user_id: null,
    legacy_base44_user_id: null,
    email: null,
    name: null,
    username: null,
    role: 'user',
    profile_picture: null,
    profile_hidden: 0,
    imported_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function createIssue63Db() {
  const state = {
    users: [
      user({ id: 'current-user', clerk_user_id: 'clerk-current', legacy_base44_user_id: 'legacy-current', name: 'Current User', username: 'current' }),
      user({ id: 'target-user', clerk_user_id: 'clerk-target', legacy_base44_user_id: 'legacy-target', name: 'Target User', username: 'target', profile_picture: 'https://media.renbrant.com/profiles/target/avatar.jpg' }),
      user({ id: 'other-user', clerk_user_id: 'clerk-other', legacy_base44_user_id: 'legacy-other', name: 'Other User', username: 'other' }),
      user({ id: 'hidden-user', clerk_user_id: 'clerk-hidden', legacy_base44_user_id: 'legacy-hidden', name: 'Hidden User', username: 'hidden', profile_hidden: 1 }),
    ],
    follows: [
      {
        id: 'accepted-follow',
        legacy_base44_follow_id: null,
        follower_id: 'current-user',
        follower_clerk_user_id: 'clerk-current',
        follower_legacy_base44_user_id: 'legacy-current',
        following_id: 'target-user',
        following_clerk_user_id: 'clerk-target',
        following_legacy_base44_user_id: 'legacy-target',
        status: 'accepted',
        created_at: '2026-07-10T00:00:00.000Z',
        updated_at: '2026-07-10T00:00:00.000Z',
        follower_email: 'current@example.com',
        follower_name: 'Old Current',
        follower_username: 'old_current',
        following_email: 'target@example.com',
        base44_created_date: null,
        base44_updated_date: null,
      },
      {
        id: 'pending-follow',
        legacy_base44_follow_id: null,
        follower_id: 'other-user',
        follower_clerk_user_id: 'clerk-other',
        follower_legacy_base44_user_id: 'legacy-other',
        following_id: 'current-user',
        following_clerk_user_id: 'clerk-current',
        following_legacy_base44_user_id: 'legacy-current',
        status: 'pending',
        created_at: '2026-07-11T00:00:00.000Z',
        updated_at: '2026-07-11T00:00:00.000Z',
        follower_email: 'other@example.com',
        follower_name: 'Old Other',
        follower_username: 'old_other',
        following_email: 'current@example.com',
        base44_created_date: null,
        base44_updated_date: null,
      },
    ],
    blocks: [],
    insertedSql: [],
    puts: [],
  };

  function byAnyUserId(value) {
    return state.users.find((row) => row.id === value || row.clerk_user_id === value || row.legacy_base44_user_id === value) || null;
  }

  function enrichedFollow(row) {
    const follower = byAnyUserId(row.follower_id);
    const following = byAnyUserId(row.following_id);
    return {
      ...row,
      follower_name: follower?.name || row.follower_name,
      follower_username: follower?.username || row.follower_username,
      follower_profile_picture: follower?.profile_picture || null,
      following_name: following?.name || null,
      following_username: following?.username || null,
      following_profile_picture: following?.profile_picture || null,
    };
  }

  function filterFollows(sql, params) {
    return state.follows
      .filter((row) => {
        let index = 0;
        if (/f\.id = \?/s.test(sql)) {
          if (row.id !== params[index]) return false;
          index += 1;
        }
        if (/f\.follower_id = \?/s.test(sql)) {
          if (row.follower_id !== params[index]) return false;
          index += 1;
        }
        if (/f\.following_id = \?/s.test(sql)) {
          if (row.following_id !== params[index]) return false;
          index += 1;
        }
        if (/f\.status = \?/s.test(sql)) {
          if (row.status !== params[index]) return false;
        }
        return true;
      })
      .map(enrichedFollow);
  }

  return {
    state,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              if (/FROM users\s+WHERE clerk_user_id = \?/s.test(sql)) return state.users.find((row) => row.clerk_user_id === params[0]) || null;
              if (/FROM users\s+WHERE id = \?\s+LIMIT 1/s.test(sql)) return state.users.find((row) => row.id === params[0]) || null;
              if (/FROM users\s+WHERE id = \?\s+OR clerk_user_id = \?\s+OR legacy_base44_user_id = \?/s.test(sql)) return byAnyUserId(params[0]);
              if (/FROM follows f/s.test(sql)) return filterFollows(sql, params)[0] || null;
              if (/FROM blocks b/s.test(sql)) return null;
              throw new Error(`Unhandled first SQL: ${sql}`);
            },
            async all() {
              if (/FROM users\s+WHERE lower\(TRIM\(email\)\) = lower\(TRIM\(\?\)\)/s.test(sql)) {
                return { results: state.users.filter((row) => row.email?.toLowerCase() === String(params[0]).toLowerCase()) };
              }
              if (/FROM follows f/s.test(sql)) return { results: filterFollows(sql, params).slice(0, params.at(-1)) };
              if (/FROM users/s.test(sql) && /LOWER\(username\) LIKE/s.test(sql)) {
                const [query, exact] = params;
                return {
                  results: state.users
                    .filter((row) => row.username?.toLowerCase().startsWith(String(query).toLowerCase()))
                    .filter((row) => !row.profile_hidden || row.username.toLowerCase() === String(exact).toLowerCase())
                    .map((row) => ({ id: row.id, username: row.username, profile_hidden: row.profile_hidden, profile_picture: row.profile_picture })),
                };
              }
              throw new Error(`Unhandled all SQL: ${sql}`);
            },
            async run() {
              if (/UPDATE users\s+SET clerk_user_id = \?/s.test(sql)) return { meta: { changes: 1 } };
              if (/INSERT INTO follows/s.test(sql)) {
                state.insertedSql.push(sql);
                const [id, follower_id, follower_clerk_user_id, follower_legacy_base44_user_id, follower_email, follower_name, follower_username, following_id, following_clerk_user_id, following_legacy_base44_user_id, following_email] = params;
                state.follows.push({
                  id,
                  legacy_base44_follow_id: null,
                  follower_id,
                  follower_clerk_user_id,
                  follower_legacy_base44_user_id,
                  following_id,
                  following_clerk_user_id,
                  following_legacy_base44_user_id,
                  status: 'pending',
                  created_at: '2026-07-12T00:00:00.000Z',
                  updated_at: '2026-07-12T00:00:00.000Z',
                  follower_email,
                  follower_name,
                  follower_username,
                  following_email,
                  base44_created_date: null,
                  base44_updated_date: null,
                });
                return { meta: { changes: 1 } };
              }
              if (/UPDATE follows\s+SET status = \?/s.test(sql)) {
                const row = state.follows.find((follow) => follow.id === params[1]);
                if (row) {
                  row.status = params[0];
                  row.updated_at = '2026-07-13T00:00:00.000Z';
                }
                return { meta: { changes: row ? 1 : 0 } };
              }
              if (/DELETE FROM follows\s+WHERE id = \?/s.test(sql)) {
                const before = state.follows.length;
                state.follows = state.follows.filter((row) => row.id !== params[0]);
                return { meta: { changes: before - state.follows.length } };
              }
              if (/DELETE FROM follows\s+WHERE follower_id = \?/s.test(sql)) {
                const before = state.follows.length;
                state.follows = state.follows.filter((row) => !(row.follower_id === params[0] && row.following_id === params[1]));
                return { meta: { changes: before - state.follows.length } };
              }
              if (/INSERT INTO users|UPDATE users|UPDATE playlists|UPDATE playlist_likes|UPDATE podcast_likes|UPDATE episode_progress|UPDATE podcast_plays|UPDATE follows|UPDATE blocks|UPDATE reports|UPDATE referrals/s.test(sql)) return { meta: { changes: 0 } };
              throw new Error(`Unhandled run SQL: ${sql}`);
            },
          };
        },
      };
    },
  };
}

function createR2(state) {
  return {
    async put(key, value, options) {
      state.puts.push({ key, value, options });
    },
  };
}

afterEach(() => {
  mock.restoreAll();
});

describe('Issue #63 user social Worker repairs', () => {
  it('returns enriched follow fields from users without selecting nonexistent columns', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createIssue63Db();

    const response = await worker.fetch(request('/api/entities/follow?follower_id=legacy-current&status=accepted', { token }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.items[0].following_username, 'target');
    assert.equal(data.items[0].following_name, 'Target User');
    assert.equal(data.items[0].following_profile_picture, 'https://voxyl-media.renbrant.com/profiles/target/avatar.jpg');
    assert.equal(data.items[0].follower_username, 'current');
    assert.doesNotMatch(db.state.insertedSql.join('\n'), /following_name|following_username/);
  });

  it('rejects unauthorized pending follow queries', async () => {
    const { token, jwk } = createJwt({ sub: 'clerk-target', email: 'target@example.com', name: 'Target User' });
    installJwksMock(jwk);
    const db = createIssue63Db();

    const response = await worker.fetch(request('/api/entities/follow?following_id=current-user&status=pending', { token }), { ...baseEnv, DB: db });

    assert.equal(response.status, 403);
  });

  it('accepts pending follows only by the recipient', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createIssue63Db();

    const response = await worker.fetch(request('/api/entities/follow/pending-follow', { method: 'PATCH', token, payload: { status: 'accepted' } }), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.item.status, 'accepted');
    assert.equal(data.item.follower_username, 'other');
    assert.equal(data.item.following_username, 'current');
  });

  it('prevents unrelated users from accepting pending follows', async () => {
    const { token, jwk } = createJwt({ sub: 'clerk-target', email: 'target@example.com', name: 'Target User' });
    installJwksMock(jwk);
    const db = createIssue63Db();

    const response = await worker.fetch(request('/api/entities/follow/pending-follow', { method: 'PATCH', token, payload: { status: 'accepted' } }), { ...baseEnv, DB: db });

    assert.equal(response.status, 403);
  });

  it('allows participants to delete follows and rejects unrelated users', async () => {
    const db = createIssue63Db();
    const current = createJwt();
    installJwksMock(current.jwk);

    const deleted = await worker.fetch(request('/api/entities/follow/accepted-follow', { method: 'DELETE', token: current.token }), { ...baseEnv, DB: db });
    assert.equal(deleted.status, 200);
    assert.equal(db.state.follows.some((row) => row.id === 'accepted-follow'), false);

    mock.restoreAll();
    const target = createJwt({ sub: 'clerk-target', email: 'target@example.com', name: 'Target User' });
    installJwksMock(target.jwk);
    const rejected = await worker.fetch(request('/api/entities/follow/pending-follow', { method: 'DELETE', token: target.token }), { ...baseEnv, DB: db });
    assert.equal(rejected.status, 403);
  });

  it('makes requestFollow idempotent and never inserts nonexistent following display columns', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createIssue63Db();

    const existing = await worker.fetch(request('/api/functions/requestFollow', { method: 'POST', token, payload: { targetUserId: 'legacy-target' } }), { ...baseEnv, DB: db });
    const existingData = await body(existing);
    assert.equal(existing.status, 200);
    assert.equal(existingData.item.id, 'accepted-follow');

    const created = await worker.fetch(request('/api/functions/requestFollow', { method: 'POST', token, payload: { targetUserId: 'legacy-other' } }), { ...baseEnv, DB: db });
    const createdData = await body(created);
    assert.equal(created.status, 201);
    assert.equal(createdData.item.following_username, 'other');
    assert.equal(db.state.insertedSql.some((sql) => /following_name|following_username/.test(sql)), false);
  });

  it('prevents self-follow after canonical ID normalization', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createIssue63Db();

    const response = await worker.fetch(request('/api/functions/requestFollow', { method: 'POST', token, payload: { targetUserId: 'legacy-current' } }), { ...baseEnv, DB: db });

    assert.equal(response.status, 400);
  });

  it('normalizes broken profile URLs in user search and profile responses', async () => {
    const db = createIssue63Db();

    const search = await worker.fetch(request('/api/functions/searchUsers', { method: 'POST', payload: { query: 'tar' } }), { ...baseEnv, DB: db });
    const searchData = await body(search);
    assert.equal(searchData.data.users[0].profile_picture, 'https://voxyl-media.renbrant.com/profiles/target/avatar.jpg');

    const profile = await worker.fetch(request('/api/functions/getPublicUserProfile', { method: 'POST', payload: { userId: 'legacy-target' } }), { ...baseEnv, DB: db });
    const profileData = await body(profile);
    assert.equal(profileData.data.profile_picture, 'https://voxyl-media.renbrant.com/profiles/target/avatar.jpg');
  });

  it('returns the configured public R2 hostname for uploads', async () => {
    const { token, jwk } = createJwt();
    installJwksMock(jwk);
    const db = createIssue63Db();
    const formData = new FormData();
    formData.append('file', new File(['image'], 'avatar.jpg', { type: 'image/jpeg' }));

    const response = await worker.fetch(new Request('https://api.voxyl.test/api/files/upload', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: formData,
    }), { ...baseEnv, DB: db, VOXYL_MEDIA: createR2(db.state) });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.match(data.file_url, /^https:\/\/voxyl-media\.renbrant\.com\/profiles\/clerk-current\//);
    assert.equal(db.state.puts.length, 1);
  });
});

describe('Issue #63 user social frontend repairs', () => {
  it('renders searched users independently from relationship typed lists', () => {
    const source = fs.readFileSync(new URL('../src/pages/Explore.jsx', import.meta.url), 'utf8');
    const usersRender = source.slice(source.indexOf('{/* Users tab */}'), source.indexOf('{/* Podcasts tab */}'));

    assert.match(source, /const isUserSearching = userSearchQuery\.length > 0/);
    assert.match(usersRender, /isUserSearching \?/);
    assert.match(usersRender, /visibleSearchedUsers\.map/);
    assert.doesNotMatch(source, /username\.toLowerCase\(\) === q/);
  });

  it('maps follower and following display fields from enriched Follow responses', () => {
    const source = fs.readFileSync(new URL('../src/pages/Explore.jsx', import.meta.url), 'utf8');

    assert.match(source, /username: f\.follower_username/);
    assert.match(source, /profile_picture: f\.follower_profile_picture/);
    assert.match(source, /username: f\.following_username/);
    assert.match(source, /profile_picture: f\.following_profile_picture/);
    assert.doesNotMatch(source, /searchUsers', \{ query: '' \}/);
  });

  it('shows a visible follow failure toast and removes temporary follow debug logs', () => {
    const source = fs.readFileSync(new URL('../src/components/profile/FollowButton.jsx', import.meta.url), 'utf8');

    assert.match(source, /import \{ toast \} from '@\/components\/ui\/use-toast'/);
    assert.match(source, /onStatusChange\?\.\(previousStatus\)/);
    assert.match(source, /variant: 'destructive'/);
    assert.doesNotMatch(source, /console\.log\('\[FollowButton\]/);
  });
});
