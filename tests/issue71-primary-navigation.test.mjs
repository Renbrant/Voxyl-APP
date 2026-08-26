import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  ACTIVE_PRIMARY_NAVIGATION,
  LEGACY_PRIMARY_NAVIGATION,
  LEGACY_PRIMARY_ROUTE_REDIRECTS,
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
        /ACTIVE_PRIMARY_NAVIGATION/,
        `${relativePath} must consume the shared navigation source`,
      );

      assert.doesNotMatch(
        source,
        /const getNavItems = \(\) => \[/,
        `${relativePath} must not define its own navigation array`,
      );
    }
  });

  await t.test('activates all five canonical primary destinations', () => {
    assert.deepEqual(
      ACTIVE_PRIMARY_NAVIGATION.map(item => item.id),
      [
        'home',
        'discover',
        'people',
        'library',
        'profile',
      ],
    );

    assert.deepEqual(
      ACTIVE_PRIMARY_NAVIGATION.map(item => item.path),
      [
        '/',
        '/discover',
        '/people',
        '/library',
        '/profile',
      ],
    );

    assert.deepEqual(
      ACTIVE_PRIMARY_NAVIGATION.map(item => item.labelKey),
      [
        'navHome',
        'navDiscover',
        'navPeople',
        'navLibrary',
        'navProfile',
      ],
    );
  });
  await t.test('preserves legacy primary routes through canonical redirects', () => {
    assert.deepEqual(
      LEGACY_PRIMARY_ROUTE_REDIRECTS,
      {
        '/explore': '/discover',
        '/playlists': '/library',
      },
    );

    const appSource = fs.readFileSync(
      new URL('../src/App.jsx', import.meta.url),
      'utf8',
    );

    assert.match(
      appSource,
      /path="\/discover" element=\{<Explore \/>}/,
    );

    assert.match(
      appSource,
      /path="\/library" element=\{<Playlists \/>}/,
    );

    assert.match(
      appSource,
      /path="\/explore" element=\{<LegacyRouteRedirect to="\/discover" \/>}/,
    );

    assert.match(
      appSource,
      /path="\/playlists" element=\{<LegacyRouteRedirect to="\/library" \/>}/,
    );
  });

  await t.test('keeps canonical navigation paths inside source behavior', () => {
    const exploreSource = fs.readFileSync(
      new URL('../src/pages/Explore.jsx', import.meta.url),
      'utf8',
    );

    const createPlaylistSource = fs.readFileSync(
      new URL('../src/components/playlist/CreatePlaylistModal.jsx', import.meta.url),
      'utf8',
    );

    assert.match(exploreSource, /\/discover/);
    assert.doesNotMatch(
      exploreSource,
      /const newUrl = qs \? `\/explore/,
    );

    assert.match(
      createPlaylistSource,
      /navigate\('\/discover'\)/,
    );
  });

  await t.test('exposes People as a dedicated stable primary root', () => {
    const appSource = fs.readFileSync(
      new URL('../src/App.jsx', import.meta.url),
      'utf8',
    );

    const peopleSource = fs.readFileSync(
      new URL('../src/pages/People.jsx', import.meta.url),
      'utf8',
    );

    assert.match(
      appSource,
      /path="\/people" element=\{<People \/>}/,
    );

    assert.doesNotMatch(
      peopleSource,
      /from '@\/pages\/Explore'/,
    );

    assert.match(
      peopleSource,
      /voxylApi\.people\.summary\(\)/,
    );

    for (const section of ['following', 'followers', 'requests', 'suggestions']) {
      assert.match(
        peopleSource,
        new RegExp(`key: '${section}'`),
      );
    }
  });
});
test('Issue #71 keeps canonical Profile identity while preserving auth gating', () => {
  const rendererPaths = [
    '../src/components/Layout.jsx',
    '../src/components/common/BottomNav.jsx',
    '../src/components/common/Sidebar.jsx',
  ];

  for (const rendererPath of rendererPaths) {
    const source = fs.readFileSync(
      new URL(rendererPath, import.meta.url),
      'utf8',
    );

    assert.match(source, /ACTIVE_PRIMARY_NAVIGATION/);
    assert.match(source, /path === '\/profile'/);
    assert.match(source, /navigateToLogin\(\)/);

    assert.doesNotMatch(source, /const showLogin =/);
    assert.doesNotMatch(source, /const DisplayIcon =/);
    assert.doesNotMatch(source, /const displayLabel =/);
    assert.doesNotMatch(source, /loginWithGoogle/);
    assert.doesNotMatch(source, /<DisplayIcon/);
    assert.doesNotMatch(source, /\{displayLabel\}/);
  }
});
