import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

const appSource = fs.readFileSync(
  new URL('../src/App.jsx', import.meta.url),
  'utf8',
);
const librarySource = fs.readFileSync(
  new URL('../src/pages/Library.jsx', import.meta.url),
  'utf8',
);
const collectionsSource = fs.readFileSync(
  new URL('../src/pages/Playlists.jsx', import.meta.url),
  'utf8',
);
const downloadsSource = fs.readFileSync(
  new URL('../src/lib/downloads.js', import.meta.url),
  'utf8',
);
const savedContentSource = fs.readFileSync(
  new URL('../src/lib/savedContentQueries.js', import.meta.url),
  'utf8',
);

describe('Issue #76 Library dashboard and collection ownership', () => {
  it('makes /library a dashboard and keeps each supported collection on a focused child route', () => {
    assert.match(appSource, /import Library from '@\/pages\/Library';/);
    assert.match(appSource, /path="\/library" element=\{<Library \/>\}/);
    assert.match(appSource, /path="\/library\/my-playlists" element=\{<Playlists view="mine" \/>\}/);
    assert.match(appSource, /path="\/library\/followed-playlists" element=\{<Playlists view="followed" \/>\}/);
    assert.match(appSource, /path="\/library\/liked-podcasts" element=\{<Playlists view="podcasts" \/>\}/);
    assert.match(appSource, /path="\/library\/downloads" element=\{<Playlists view="downloads" \/>\}/);
    assert.match(appSource, /LegacyRouteRedirect to="\/library"/);
  });

  it('defines exactly four dashboard cards and does not add an Overview tab', () => {
    const start = librarySource.indexOf('const LIBRARY_CARDS');
    const end = librarySource.indexOf('function LibraryCard', start);
    assert.ok(start >= 0 && end > start);

    const cards = librarySource.slice(start, end);
    const keys = [...cards.matchAll(/key: '(mine|followed|podcasts|downloads)'/g)]
      .map((match) => match[1]);

    assert.deepEqual(keys, ['mine', 'followed', 'podcasts', 'downloads']);
    assert.doesNotMatch(cards, /overview/i);
  });

  it('derives dashboard counts from the same persisted product models used by the existing collections', () => {
    assert.match(librarySource, /entities\.Playlist\.filter\(\{ creator_id: user\.id \}/);
    assert.match(librarySource, /loadPlaylistLikeRecords\(user\.id\)/);
    assert.match(librarySource, /loadLikedPlaylistsForRecords/);
    assert.match(librarySource, /loadPodcastLikeRecords\(user\.id\)/);
    assert.match(librarySource, /getDownloads\(\)\.length/);
    assert.match(savedContentSource, /entities\.PlaylistLike\.filter/);
    assert.match(savedContentSource, /entities\.PodcastLike\.filter/);
    assert.match(downloadsSource, /voxyl_downloads/);
  });

  it('keeps owned playlists separate from liked/followed playlists', () => {
    assert.match(savedContentSource, /const ownedIds = new Set/);
    assert.match(savedContentSource, /idsToLoad = likedIds\.filter\(\(id\) => !ownedIds\.has\(id\)\)/);
    assert.match(collectionsSource, /view === 'mine'/);
    assert.match(collectionsSource, /view === 'followed'/);
  });

  it('keeps playlist creation and editing inside My Playlists rather than on the dashboard', () => {
    assert.doesNotMatch(librarySource, /CreatePlaylistModal/);
    assert.match(collectionsSource, /view === 'mine' \? \(/);
    assert.match(collectionsSource, /<CreatePlaylistModal/);
    assert.match(collectionsSource, /onEdited=\{refetchMine\}/);
  });

  it('uses downloaded episodes as the supported episode collection instead of inventing a SavedEpisode backend', () => {
    assert.match(librarySource, /path: '\/library\/downloads'/);
    assert.match(collectionsSource, /<DownloadedEpisodeCard/);
    assert.match(collectionsSource, /getDownloads\(\)/);
    assert.doesNotMatch(librarySource, /SavedEpisode/);
    assert.doesNotMatch(collectionsSource, /entities\.SavedEpisode/);
  });

  it('provides explicit loading/error handling for remote dashboard collections', () => {
    assert.match(librarySource, /myPlaylistsQuery\.isLoading/);
    assert.match(librarySource, /playlistLikesQuery\.isError/);
    assert.match(librarySource, /followedPlaylistsQuery\.isError/);
    assert.match(librarySource, /likedPodcastsQuery\.isError/);
    assert.match(librarySource, /handleRetry/);
  });
});
