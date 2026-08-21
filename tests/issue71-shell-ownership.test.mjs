import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('Issue #71 keeps child pages from owning primary navigation', () => {
  const layoutSource = fs.readFileSync(
    new URL('../src/components/Layout.jsx', import.meta.url),
    'utf8',
  );

  const playlistDetailSource = fs.readFileSync(
    new URL('../src/pages/PlaylistDetail.jsx', import.meta.url),
    'utf8',
  );

  assert.match(
    layoutSource,
    /ACTIVE_PRIMARY_NAVIGATION/,
    'Layout must consume the shared primary-navigation contract',
  );

  assert.match(
    layoutSource,
    /md:hidden/,
    'Layout must own the mobile primary-navigation renderer',
  );

  assert.doesNotMatch(
    playlistDetailSource,
    /BottomNav/,
    'PlaylistDetail must not render or import its own primary navigation',
  );
});