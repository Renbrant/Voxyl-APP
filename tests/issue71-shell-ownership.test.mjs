import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('Issue #71 keeps primary navigation available on standalone playlist detail', () => {
  const appSource = fs.readFileSync(
    new URL('../src/App.jsx', import.meta.url),
    'utf8',
  );

  const playlistDetailSource = fs.readFileSync(
    new URL('../src/pages/PlaylistDetail.jsx', import.meta.url),
    'utf8',
  );

  const playlistRoute =
    '<Route path="/playlist/:id" element={<PlaylistDetail />} />';

  assert.match(
    appSource,
    /<Route element={<Layout \/>}>/,
    'Primary landing routes must use the shared Layout shell',
  );

  assert.ok(
    appSource.includes(playlistRoute),
    'Playlist detail must remain an explicit standalone route',
  );

  assert.match(
    playlistDetailSource,
    /import BottomNav from '@\/components\/common\/BottomNav';/,
    'Standalone playlist detail must import the canonical mobile navigation',
  );

  const bottomNavRenderCount =
    playlistDetailSource.split('<BottomNav />').length - 1;

  assert.equal(
    bottomNavRenderCount,
    1,
    'Standalone playlist detail must render exactly one primary bottom navigation',
  );
});
