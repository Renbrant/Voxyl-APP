import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterEach, describe, it, mock } from 'node:test';
import worker from '../workers/api/src/index.ts';

const issuer = 'https://clerk.voxyl-security.test';
const now = () => Math.floor(Date.now() / 1000);
const env = {
  CLERK_ISSUER: issuer,
  CLERK_AUTHORIZED_PARTIES: 'https://v.renbrant.com,https://localhost',
  CLERK_SECRET_KEY: 'sk_test_unused',
  CLERK_JWT_KEY: '',
};
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'security-test-key', use: 'sig', alg: 'RS256' };

function signedToken(overrides = {}, headerOverrides = {}, signer = pair.privateKey) {
  const header = { typ: 'JWT', alg: 'RS256', kid: jwk.kid, ...headerOverrides };
  const claims = {
    iss: issuer,
    sub: 'user_test',
    sid: 'sess_test',
    azp: 'https://v.renbrant.com',
    iat: now() - 15,
    nbf: now() - 15,
    exp: now() + 3600,
    ...overrides,
  };
  const data = [header, claims].map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
  return `${data}.${crypto.sign('RSA-SHA256', Buffer.from(data), signer).toString('base64url')}`;
}

async function status(token, config = env) {
  const request = new Request('https://api.voxyl.test/api/auth/diagnostics', {
    headers: { authorization: `Bearer ${token}` },
  });
  return (await worker.fetch(request, config)).status;
}

function serveJwks(response = Response.json({ keys: [jwk] })) {
  let count = 0;
  mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(String(url), `${issuer}/.well-known/jwks.json`);
    count++;
    return response.clone();
  });
  return () => count;
}

afterEach(() => mock.restoreAll());

describe('Clerk session token contract', () => {
  it('accepts a valid session and a native session without azp', async () => {
    serveJwks();
    assert.equal(await status(signedToken()), 200);
    assert.equal(await status(signedToken({ azp: undefined })), 200);
  });

  it('rejects missing, malformed, expired or future time claims', async () => {
    serveJwks();
    for (const overrides of [
      { exp: undefined }, { exp: 'tomorrow' }, { exp: Infinity }, { exp: now() - 1 },
      { nbf: undefined }, { nbf: 'now' }, { nbf: now() + 3600 },
      { iat: undefined }, { iat: now() + 3600 }, { exp: now() - 1, iat: now() - 2 },
    ]) {
      assert.equal(await status(signedToken(overrides)), 401, JSON.stringify(overrides));
    }
  });

  it('rejects wrong issuer, origin, missing session identity and non-session JWTs', async () => {
    serveJwks();
    for (const overrides of [
      { iss: 'https://attacker.test' }, { azp: 'https://attacker.test' },
      { azp: null }, { sid: undefined }, { sub: undefined },
    ]) {
      assert.equal(await status(signedToken(overrides)), 401, JSON.stringify(overrides));
    }
    assert.equal(await status(signedToken({}, { typ: 'at+jwt' })), 401);
    assert.equal(await status(signedToken({}, { alg: 'HS256' })), 401);
  });

  it('rejects unknown key, altered signature and unavailable JWKS', async () => {
    serveJwks();
    assert.equal(await status(signedToken({}, { kid: 'unknown' })), 401);
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    assert.equal(await status(signedToken({}, {}, other.privateKey)), 401);
    mock.restoreAll();
    serveJwks(new Response(null, { status: 503 }));
    assert.equal(await status(signedToken({}, { kid: 'new-key' })), 401);
  });

  it('never retries a failed SDK verification via JWKS when a local key exists', async () => {
    const fetchCount = serveJwks();
    assert.equal(await status(signedToken({}, { kid: 'invalid-key-test' }), { ...env, CLERK_JWT_KEY: 'invalid-pem' }), 401);
    assert.equal(fetchCount(), 0);
  });

  it('applies the same session contract to SDK-verified tokens', async () => {
    const fetchCount = serveJwks();
    const localEnv = { ...env, CLERK_JWT_KEY: pair.publicKey.export({ format: 'pem', type: 'spki' }) };
    assert.equal(await status(signedToken(), localEnv), 200);
    assert.equal(await status(signedToken({ exp: undefined }), localEnv), 401);
    assert.equal(await status(signedToken({ sid: undefined }), localEnv), 401);
    assert.equal(await status(signedToken({ iss: 'https://wrong.test' }), localEnv), 401);
    assert.equal(fetchCount(), 0);
  });
});
