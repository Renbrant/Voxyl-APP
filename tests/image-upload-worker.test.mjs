import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import worker from '../workers/api/src/index.ts';
import { dimensionsAllowed, inspectImage } from '../workers/api/src/imageInspection.ts';
import { baseEnv, createJwt, createSqliteD1, issuer } from './helpers/worker-harness.mjs';

// Issue #116: uploads are judged by their bytes, never by the declared MIME type or name.

function png(width, height) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(bytes.buffer).setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function jpeg(width, height, { withExifFirst = true } = {}) {
  const parts = [0xff, 0xd8];
  if (withExifFirst) parts.push(0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00);
  parts.push(0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  parts.push(0xff, 0xd9);
  return Uint8Array.from(parts);
}

function webpLossless(width, height) {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 5, 0, 0, 0], 0);
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  bytes[20] = 0x2f;
  new DataView(bytes.buffer).setUint32(21, bits >>> 0, true);
  return bytes;
}

function webpExtended(width, height) {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0], 0);
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  return bytes;
}

describe('inspectImage', () => {
  it('reads format and size from PNG, JPEG and WebP headers', () => {
    assert.deepEqual(inspectImage(png(640, 480)), { mime: 'image/png', extension: 'png', width: 640, height: 480 });
    assert.deepEqual(inspectImage(jpeg(1024, 768)), { mime: 'image/jpeg', extension: 'jpg', width: 1024, height: 768 });
    assert.deepEqual(inspectImage(jpeg(30, 20, { withExifFirst: false })), { mime: 'image/jpeg', extension: 'jpg', width: 30, height: 20 });
    assert.deepEqual(inspectImage(webpLossless(300, 200)), { mime: 'image/webp', extension: 'webp', width: 300, height: 200 });
    assert.deepEqual(inspectImage(webpExtended(4000, 3000)), { mime: 'image/webp', extension: 'webp', width: 4000, height: 3000 });
  });

  it('rejects active, unsupported and malformed content', () => {
    const encode = (text) => new TextEncoder().encode(text);
    assert.equal(inspectImage(encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
    assert.equal(inspectImage(encode('<html><script>alert(1)</script></html>')), null);
    assert.equal(inspectImage(encode('GIF89a\u0001\u0000\u0001\u0000')), null);
    assert.equal(inspectImage(new Uint8Array(0)), null);
    assert.equal(inspectImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
    assert.equal(inspectImage(png(0, 10)), null);
    assert.equal(inspectImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])), null);
  });

  it('flags oversized dimensions without decoding pixels', () => {
    assert.equal(dimensionsAllowed({ width: 4000, height: 3000 }), true);
    assert.equal(dimensionsAllowed({ width: 8193, height: 100 }), false);
    assert.equal(dimensionsAllowed({ width: 8000, height: 8000 }), false);
  });
});

describe('POST /api/files/upload', () => {
  let db;
  let stored;
  let existing;
  let jwks;

  function bucket() {
    return {
      async put(key, body, options) {
        stored.push({ key, size: body.byteLength, options });
      },
      async list({ prefix, limit }) {
        const objects = existing.filter((object) => object.key.startsWith(prefix));
        return { objects: objects.slice(0, limit), truncated: objects.length > limit };
      },
    };
  }

  async function upload(bytes, { name = 'photo.png', type = 'image/png', headers = {} } = {}) {
    const form = new FormData();
    form.append('file', new File([bytes], name, { type }));
    const response = await worker.fetch(
      new Request('https://api.voxyl.test/api/files/upload', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, ...headers },
        body: form,
      }),
      { ...baseEnv, DB: db, VOXYL_MEDIA: bucket() },
    );
    return { status: response.status, body: await response.json() };
  }

  let token;

  beforeEach(() => {
    db = createSqliteD1();
    stored = [];
    existing = [];
    db.raw.prepare(
      `INSERT INTO users (id, clerk_user_id, email, name, username, role, terms_accepted_version)
       VALUES ('u1', 'clerk-u1', 'u1@example.com', 'User One', 'userone', 'user', '2026-11-14')`,
    ).run();
    const session = createJwt({ sub: 'clerk-u1', email: 'u1@example.com', name: 'User One' });
    token = session.token;
    jwks = session.jwk;
    mock.method(globalThis, 'fetch', async (url) => {
      assert.equal(String(url), `${issuer}/.well-known/jwks.json`);
      return Response.json({ keys: [jwks] });
    });
  });

  afterEach(() => mock.restoreAll());

  it('stores a valid image with the detected type and an extension from the bytes', async () => {
    const result = await upload(png(800, 600), { name: '../../evil name.html', type: 'text/html' });
    assert.equal(result.status, 200);
    assert.equal(stored.length, 1);
    assert.match(stored[0].key, /^profiles\/clerk-u1\/\d+-[0-9a-f-]{36}\.png$/);
    assert.equal(stored[0].options.httpMetadata.contentType, 'image/png');
    assert.match(stored[0].options.httpMetadata.cacheControl, /immutable/);
    assert.ok(result.body.file_url.endsWith(stored[0].key));
    assert.equal(stored[0].key.includes('evil'), false);
  });

  it('ignores a spoofed MIME type when the bytes are a real image', async () => {
    const result = await upload(jpeg(500, 500), { name: 'a.txt', type: 'application/octet-stream' });
    assert.equal(result.status, 200);
    assert.equal(stored[0].options.httpMetadata.contentType, 'image/jpeg');
    assert.ok(stored[0].key.endsWith('.jpg'));
  });

  it('rejects active or spoofed content even when it claims to be an image', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    for (const [bytes, type, name] of [
      [svg, 'image/svg+xml', 'a.svg'],
      [svg, 'image/png', 'a.png'],
      [new TextEncoder().encode('<script>alert(1)</script>'), 'image/jpeg', 'a.jpg'],
      [new TextEncoder().encode('GIF89a'), 'image/gif', 'a.gif'],
    ]) {
      const result = await upload(bytes, { name, type });
      assert.equal(result.status, 415, name);
      assert.equal(result.body.code, 'unsupported-image');
    }
    assert.equal(stored.length, 0);
  });

  it('rejects excessive dimensions', async () => {
    const result = await upload(png(20000, 20000));
    assert.equal(result.status, 413);
    assert.equal(result.body.code, 'image-dimensions');
    assert.equal(stored.length, 0);
  });

  it('rejects an oversized file before storing it', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(png(10, 10));
    const result = await upload(big);
    assert.equal(result.status, 413);
    assert.equal(result.body.code, 'file-too-large');
    assert.equal(stored.length, 0);
  });

  it('rejects an oversized declared body before parsing the multipart data', async () => {
    const result = await upload(png(10, 10), { headers: { 'content-length': String(50 * 1024 * 1024) } });
    assert.equal(result.status, 413);
    assert.equal(result.body.code, 'file-too-large');
    assert.equal(stored.length, 0);
  });

  it('rejects an empty or missing file', async () => {
    const result = await upload(new Uint8Array(0));
    assert.equal(result.status, 400);
    assert.equal(stored.length, 0);
  });

  it('enforces the per-account object count quota and keeps old objects', async () => {
    existing = Array.from({ length: 40 }, (_, index) => ({ key: `profiles/clerk-u1/old-${index}.png`, size: 1000 }));
    const result = await upload(png(100, 100));
    assert.equal(result.status, 413);
    assert.equal(result.body.code, 'storage-quota-exceeded');
    assert.equal(stored.length, 0);
    assert.equal(existing.length, 40);
  });

  it('enforces the per-account byte quota', async () => {
    existing = [{ key: 'profiles/clerk-u1/big.png', size: 99 * 1024 * 1024 + 900 * 1024 }];
    const result = await upload(png(100, 100).slice(0, 33));
    assert.equal(result.status, 200);
    existing = [{ key: 'profiles/clerk-u1/big.png', size: 100 * 1024 * 1024 }];
    const second = await upload(png(100, 100));
    assert.equal(second.status, 413);
    assert.equal(second.body.code, 'storage-quota-exceeded');
  });

  it('does not count another account\'s objects toward the quota', async () => {
    existing = Array.from({ length: 40 }, (_, index) => ({ key: `profiles/clerk-other/old-${index}.png`, size: 1000 }));
    assert.equal((await upload(png(100, 100))).status, 200);
  });

  it('still requires a session', async () => {
    const form = new FormData();
    form.append('file', new File([png(10, 10)], 'a.png', { type: 'image/png' }));
    const response = await worker.fetch(
      new Request('https://api.voxyl.test/api/files/upload', { method: 'POST', body: form }),
      { ...baseEnv, DB: db, VOXYL_MEDIA: bucket() },
    );
    assert.equal(response.status, 401);
  });
});
