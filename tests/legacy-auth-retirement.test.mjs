import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearLegacyAuthCredentials,
  stripLegacyAuthUrl,
} from '../src/lib/legacyAuthCleanup.js';

function storage(entries) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    values,
  };
}

test('retired native callback credentials are removed from query and fragment without exposing them', () => {
  const incoming = 'https://v.renbrant.com/auth/callback?ref=friend&access_token=private-value&native_auth_callback=1#access_tc=other-private-value&tab=info';
  const history = { state: { navigation: 2 }, replaceState(state, unused, path) { this.result = { state, path }; } };

  assert.equal(stripLegacyAuthUrl({ href: incoming }, history), true);
  assert.deepEqual(history.result, {
    state: { navigation: 2 },
    path: '/auth/callback?ref=friend#tab=info',
  });
  assert.equal(JSON.stringify(history.result).includes('private-value'), false);
});

test('normal paths and anchor fragments remain unchanged', () => {
  const history = { state: null, replaceState(state, unused, path) { this.path = path; } };
  assert.equal(stripLegacyAuthUrl({ href: 'https://v.renbrant.com/playlist/42#episodes' }, history), false);
  assert.equal(history.path, undefined);

  assert.equal(stripLegacyAuthUrl({ href: 'https://v.renbrant.com/?token=old#episodes' }, history), true);
  assert.equal(history.path, '/#episodes');
});

test('obsolete browser and native token stores are cleaned without touching the active Clerk session', async () => {
  const local = storage({ voxyl_access_token: 'old', token: 'old', voxyl_post_auth_path: '/profile', theme: 'dark' });
  const session = storage({ voxyl_last_auth_callback: 'old-url', voxyl_authed: 'true' });
  const preferences = { removed: [], async remove({ key }) { this.removed.push(key); } };

  await clearLegacyAuthCredentials({ local, session, native: true, preferences });

  assert.deepEqual([...local.values], [['theme', 'dark']]);
  assert.deepEqual([...session.values], [['voxyl_authed', 'true']]);
  assert.deepEqual(preferences.removed, ['voxyl_access_token']);
});

test('legacy cleanup remains safe when storage is unavailable', async () => {
  const inaccessible = { removeItem() { throw new Error('storage unavailable'); } };
  const preferences = { async remove() { throw new Error('native storage unavailable'); } };

  await assert.doesNotReject(clearLegacyAuthCredentials({
    local: inaccessible,
    session: inaccessible,
    native: true,
    preferences,
  }));
});
