import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getNativeEntryRedirect } from '../src/lib/entryRouting.js';

test('native startup opens Home rather than the public landing page', () => {
  assert.equal(getNativeEntryRedirect({ pathname: '/' }, true), '/app');
});

test('browser and browser-installed PWA keep the public landing page', () => {
  assert.equal(getNativeEntryRedirect({ pathname: '/' }, false), null);
});

test('native root entry preserves query parameters and fragments', () => {
  assert.equal(
    getNativeEntryRedirect({ pathname: '/', search: '?source=shortcut', hash: '#resume' }, true),
    '/app?source=shortcut#resume',
  );
});

test('native deep links and existing app routes keep their destinations', () => {
  for (const pathname of ['/app', '/playlist/123', '/share/123', '/people', '/privacy']) {
    assert.equal(getNativeEntryRedirect({ pathname, search: '?id=123' }, true), null);
  }
});

test('router replaces native root before landing and authentication-loading branches', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /getNativeEntryRedirect\(location, Capacitor\.isNativePlatform\(\)\)/);
  assert.match(app, /<Navigate to=\{nativeEntryRedirect\} replace \/>/);
  const nativeRedirectIndex = app.indexOf('if (nativeEntryRedirect)');
  assert.ok(nativeRedirectIndex < app.indexOf("if (location.pathname === '/')"));
  assert.ok(nativeRedirectIndex < app.indexOf('if (isLoadingPublicSettings || isLoadingAuth)'));
});
