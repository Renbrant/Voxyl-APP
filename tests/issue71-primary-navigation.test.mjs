import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  LEGACY_PRIMARY_NAVIGATION,
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

  await t.test('derives the pre-migration runtime navigation from the canonical contract', () => {
    assert.deepEqual(
      LEGACY_PRIMARY_NAVIGATION.map(item => item.id),
      [
        'home',
        'discover',
        'library',
        'profile',
      ],
    );

    assert.deepEqual(
      LEGACY_PRIMARY_NAVIGATION.map(item => item.path),
      [
        '/',
        '/explore',
        '/playlists',
        '/profile',
      ],
    );

    assert.deepEqual(
      LEGACY_PRIMARY_NAVIGATION.map(item => item.labelKey),
      [
        'navFeed',
        'navExplore',
        'navPlaylists',
        'navProfile',
      ],
    );
  });

  await t.test('removes duplicated navigation arrays from every UI renderer', () => {
    const files = [
      '../src/components/Layout.jsx',
      '../src/components/common/Sidebar.jsx',
      '../src/components/common/BottomNav.jsx',
    ];

    for (const relativePath of files) {
      const source = fs.readFileSync(
        new URL(relativePath, import.meta.url),
        'utf8',
      );

      assert.match(
        source,
        /LEGACY_PRIMARY_NAVIGATION/,
        `${relativePath} must consume the shared navigation source`,
      );

      assert.doesNotMatch(
        source,
        /const getNavItems = \(\) => \[/,
        `${relativePath} must not define its own navigation array`,
      );
    }
  });
});
