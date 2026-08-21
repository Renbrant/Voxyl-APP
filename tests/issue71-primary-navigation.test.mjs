import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRIMARY_NAVIGATION,
  PRIMARY_NAVIGATION_IDS,
  PRIMARY_NAVIGATION_PATHS,
} from '../src/lib/primaryNavigation.js';

test('Issue #71 primary navigation architecture', async t => {
  await t.test('defines exactly five primary destinations', () => {
    assert.equal(PRIMARY_NAVIGATION.length, 5);
  });

  await t.test('keeps the approved destination order', () => {
    assert.deepEqual(
      PRIMARY_NAVIGATION_IDS,
      [
        'home',
        'discover',
        'people',
        'library',
        'profile',
      ],
    );
  });

  await t.test('defines the stable root route for every primary destination', () => {
    assert.deepEqual(
      PRIMARY_NAVIGATION_PATHS,
      [
        '/',
        '/discover',
        '/people',
        '/library',
        '/profile',
      ],
    );
  });

  await t.test('keeps every primary id and route unique', () => {
    assert.equal(
      new Set(PRIMARY_NAVIGATION_IDS).size,
      PRIMARY_NAVIGATION.length,
    );

    assert.equal(
      new Set(PRIMARY_NAVIGATION_PATHS).size,
      PRIMARY_NAVIGATION.length,
    );
  });

  await t.test('does not expose legacy primary routes in the new contract', () => {
    assert.equal(PRIMARY_NAVIGATION_PATHS.includes('/explore'), false);
    assert.equal(PRIMARY_NAVIGATION_PATHS.includes('/playlists'), false);
    assert.equal(PRIMARY_NAVIGATION_PATHS.includes('/settings'), false);
  });

  await t.test('defines translation and icon contracts for every destination', () => {
    for (const item of PRIMARY_NAVIGATION) {
      assert.match(item.labelKey, /^nav[A-Z]/);
      assert.equal(typeof item.icon, 'string');
      assert.notEqual(item.icon.trim(), '');
    }
  });

  await t.test('keeps the navigation contract immutable', () => {
    assert.equal(Object.isFrozen(PRIMARY_NAVIGATION), true);

    for (const item of PRIMARY_NAVIGATION) {
      assert.equal(Object.isFrozen(item), true);
    }
  });
});
