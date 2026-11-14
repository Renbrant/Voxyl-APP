import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import worker from '../workers/api/src/index.ts';

// These tests exercise the rate limit layer with fake limiter bindings, so they
// check which requests are limited, with which key, and what the client receives.

const issuer = 'https://clerk.voxyl.test';
const origin = 'https://v.renbrant.com';
const baseEnv = {
  CLERK_AUTHORIZED_PARTIES: origin,
  CLERK_ISSUER: issuer,
  CLERK_SECRET_KEY: 'sk_test_unused',
  CLERK_JWT_KEY: '',
};

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createJwt(sub) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `kid-${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuer,
    sub,
    sid: `session-${sub}`,
    email: `${sub}@example.com`,
    name: sub,
    azp: origin,
    iat: now - 10,
    nbf: now - 10,
    exp: now + 3600,
  };
  const signedData = `${base64urlJson({ alg: 'RS256', typ: 'JWT', kid })}.${base64urlJson(claims)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signedData), privateKey).toString('base64url');
  return {
    token: `${signedData}.${signature}`,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' },
  };
}

// A limiter that records every key it sees and answers with a fixed decision.
function fakeLimiter(success) {
  const keys = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      return { success };
    },
  };
}

let issued;
let env;

beforeEach(() => {
  issued = createJwt('user-limited');
  env = { ...baseEnv };
  mock.method(globalThis, 'fetch', async (url) => {
    if (String(url) === `${issuer}/.well-known/jwks.json`) {
      return Response.json({ keys: [issued.jwk] });
    }
    throw new Error(`unexpected outbound fetch in rate limit test: ${url}`);
  });
});

afterEach(() => {
  mock.restoreAll();
});

function call(pathname, { method = 'POST', ip = '203.0.113.7', token, payload, headers = {} } = {}) {
  const requestHeaders = { 'content-type': 'application/json', 'cf-connecting-ip': ip, origin, ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  const init = { method, headers: requestHeaders };
  if (payload !== undefined) init.body = JSON.stringify(payload);
  return worker.fetch(new Request(`https://api.voxyl.test${pathname}`, init), env);
}

describe('expensive anonymous routes (RL_EXPENSIVE, keyed by IP)', () => {
  it('returns 429 with Retry-After and a stable error code when the limit is exceeded', async () => {
    env.RL_EXPENSIVE = fakeLimiter(false);

    const response = await call('/api/functions/searchPodcasts', { payload: { query: 'news' } });

    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '60');
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, 'rate-limited');
  });

  it('keys anonymous callers by client IP and by route', async () => {
    const limiter = fakeLimiter(false);
    env.RL_EXPENSIVE = limiter;

    await call('/api/rss/fetch', { ip: '198.51.100.9', payload: { url: 'https://example.com/feed.xml' } });

    assert.deepEqual(limiter.keys, ['POST /api/rss/fetch:ip:198.51.100.9']);
  });

  it('keys an authenticated caller by user id instead of IP', async () => {
    const limiter = fakeLimiter(false);
    env.RL_EXPENSIVE = limiter;

    await call('/api/functions/searchPodcasts', { token: issued.token, payload: { query: 'news' } });

    assert.deepEqual(limiter.keys, ['POST /api/functions/searchPodcasts:user:user-limited']);
  });

  it('lets the request through when the limiter allows it', async () => {
    const limiter = fakeLimiter(true);
    env.RL_EXPENSIVE = limiter;

    const response = await call('/api/functions/searchPodcasts', { payload: { query: 'news' } });

    assert.notEqual(response.status, 429);
    assert.equal(limiter.keys.length, 1);
  });
});

describe('public discovery routes (RL_PUBLIC, keyed by IP)', () => {
  it('limits user search by IP', async () => {
    env.RL_PUBLIC = fakeLimiter(false);

    const response = await call('/api/functions/searchUsers', { payload: { query: 'ana' } });

    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, 'rate-limited');
  });

  it('limits public profile lookups by IP', async () => {
    const limiter = fakeLimiter(false);
    env.RL_PUBLIC = limiter;

    await call('/api/functions/getPublicUserProfile', { ip: '192.0.2.44', payload: { user_id: 'x' } });

    assert.deepEqual(limiter.keys, ['POST /api/functions/getPublicUserProfile:ip:192.0.2.44']);
  });
});

describe('authenticated writes (RL_WRITE, keyed by user)', () => {
  it('returns 429 for a write that exceeds the per-user limit', async () => {
    env.RL_WRITE = fakeLimiter(false);

    const response = await call('/api/playlists', { token: issued.token, payload: { title: 'Mix' } });

    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, 'rate-limited');
  });

  it('keys writes by user across routes, so ids in the path do not reset the budget', async () => {
    const limiter = fakeLimiter(false);
    env.RL_WRITE = limiter;

    await call('/api/playlists', { token: issued.token, payload: {} });
    await call('/api/me', { method: 'PATCH', token: issued.token, payload: {} });

    assert.deepEqual(limiter.keys, ['write:user:user-limited', 'write:user:user-limited']);
  });

  it('does not consult the write limiter for unauthenticated writes', async () => {
    const limiter = fakeLimiter(false);
    env.RL_WRITE = limiter;

    const response = await call('/api/playlists', { payload: { title: 'Mix' } });

    assert.equal(response.status, 401);
    assert.equal(limiter.keys.length, 0);
  });

  it('treats an unverifiable token as anonymous instead of failing with 500', async () => {
    const limiter = fakeLimiter(false);
    env.RL_WRITE = limiter;

    const response = await call('/api/playlists', { token: 'not-a-jwt', payload: {} });

    assert.notEqual(response.status, 500);
    assert.notEqual(response.status, 429);
    assert.equal(limiter.keys.length, 0);
  });
});

describe('unlimited requests', () => {
  it('never consults limiters for reads', async () => {
    const limiter = fakeLimiter(false);
    env.RL_PUBLIC = limiter;
    env.RL_EXPENSIVE = limiter;
    env.RL_WRITE = limiter;

    const response = await call('/api/me', { method: 'GET', token: issued.token });

    assert.notEqual(response.status, 429);
    assert.equal(limiter.keys.length, 0);
  });

  it('does not enforce limits when no binding is configured (local development)', async () => {
    const response = await call('/api/functions/searchPodcasts', { payload: { query: 'news' } });

    assert.notEqual(response.status, 429);
  });
});

describe('client-facing behaviour', () => {
  it('keeps CORS headers on the 429 so the browser can read the error', async () => {
    env.RL_EXPENSIVE = fakeLimiter(false);

    const response = await call('/api/rss/fetch', { payload: { url: 'https://example.com/feed.xml' } });

    assert.equal(response.status, 429);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
  });
});
