import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import { sortPlaylistEpisodes } from '../src/lib/playlistEpisodeSorting.js';

function createLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function episode(title, feedUrl, pubDate = '2026-07-14T12:00:00.000Z') {
  return {
    title,
    audioUrl: `https://audio.example.com/${title}.mp3`,
    feedUrl,
    feedTitle: feedUrl,
    pubDate,
  };
}

async function loadPlaylistCacheManager({ invoke, cloudRecords = [] } = {}) {
  globalThis.__voxylApi = {
    entities: {
      PlaylistEpisodesCache: {
        filter: async () => cloudRecords,
        create: async () => ({}),
        update: async () => ({}),
      },
    },
    functions: {
      invoke: invoke || (async () => ({ data: { items: [] } })),
    },
  };
  globalThis.__feedCacheStore = new Map();
  globalThis.__feedCache = {
    getFeedFromCache: (url) => globalThis.__feedCacheStore.get(url) || null,
    saveFeedToCache: (url, data) => {
      globalThis.__feedCacheStore.set(url, data);
      return Promise.resolve();
    },
  };
  globalThis.__parseDurationToSeconds = () => 0;
  globalThis.__sortPlaylistEpisodes = sortPlaylistEpisodes;
  globalThis.localStorage = createLocalStorage();

  const source = fs.readFileSync(new URL('../src/lib/playlistCacheManager.js', import.meta.url), 'utf8')
    .replace("import { voxylApi } from '@/api/voxylApiClient';", 'const voxylApi = globalThis.__voxylApi;')
    .replace("import { getFeedFromCache, saveFeedToCache } from '@/lib/feedCache';", 'const { getFeedFromCache, saveFeedToCache } = globalThis.__feedCache;')
    .replace("import { sortPlaylistEpisodes } from './playlistEpisodeSorting';", 'const sortPlaylistEpisodes = globalThis.__sortPlaylistEpisodes;')
    .replace("import { parseDurationToSeconds } from '@/lib/rssUtils';", 'const parseDurationToSeconds = globalThis.__parseDurationToSeconds;');

  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Date.now()}-${Math.random()}`);
}

async function loadPlaylistGuards() {
  const source = fs.readFileSync(new URL('../src/lib/playlistEpisodeLoadGuards.js', import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Date.now()}-${Math.random()}`);
}

afterEach(() => {
  delete globalThis.__voxylApi;
  delete globalThis.__feedCache;
  delete globalThis.__feedCacheStore;
  delete globalThis.__parseDurationToSeconds;
  delete globalThis.__sortPlaylistEpisodes;
  delete globalThis.localStorage;
});

describe('playlist episode route isolation', () => {
  it('clears playlist-owned state immediately when entering another playlist', async () => {
    const { getPlaylistRouteResetState } = await loadPlaylistGuards();

    assert.deepEqual(getPlaylistRouteResetState(), {
      episodes: [],
      backgroundSyncSource: 'none',
      selectedEpisode: null,
      cacheLookupStatus: 'loading',
      syncState: {
        status: 'idle',
        source: 'none',
        completedFeeds: 0,
        failedFeeds: 0,
        totalFeeds: 0,
      },
    });
  });

  it('ignores a delayed result from an old playlist after navigation', async () => {
    const { createPlaylistRequestGuard } = await loadPlaylistGuards();
    let currentPlaylistId = 'playlist-a';
    const guard = createPlaylistRequestGuard(() => currentPlaylistId);
    const oldToken = guard.start('playlist-a');

    currentPlaylistId = 'playlist-b';
    guard.reset('playlist-b');

    assert.equal(guard.isCurrent(oldToken), false);
    assert.equal(guard.isCurrent(guard.start('playlist-b')), true);
  });

  it('ignores an older background sync when a newer playlist request starts', async () => {
    const { createPlaylistRequestGuard } = await loadPlaylistGuards();
    let currentPlaylistId = 'playlist-a';
    const guard = createPlaylistRequestGuard(() => currentPlaylistId);
    const oldSync = guard.start('playlist-a');

    currentPlaylistId = 'playlist-b';
    const currentSync = guard.start('playlist-b');

    assert.equal(guard.isCurrent(oldSync), false);
    assert.equal(guard.isCurrent(currentSync), true);
  });
});

describe('playlist episode progressive synchronization', () => {
  it('emits fast feed episodes while another feed is still pending', async () => {
    const fastFeed = deferred();
    const slowFeed = deferred();
    const calls = [];
    const manager = await loadPlaylistCacheManager({
      invoke: async (_name, payload) => {
        calls.push(payload.url);
        return payload.url === 'fast' ? fastFeed.promise : slowFeed.promise;
      },
    });
    const playlist = { rss_feeds: [{ url: 'fast' }, { url: 'slow' }] };
    const progress = [];

    const refresh = manager.refreshAndSyncPlaylistEpisodes('playlist-a', playlist, {
      onProgress: (update) => progress.push(update),
    });
    await flushMicrotasks();
    assert.deepEqual(calls, ['fast', 'slow']);

    fastFeed.resolve({ data: { items: [episode('fast-episode', 'fast')] } });
    await flushMicrotasks();

    assert.equal(progress.length, 1);
    assert.equal(progress[0].completedFeeds, 1);
    assert.equal(progress[0].totalFeeds, 2);
    assert.deepEqual(progress[0].episodes.map(ep => ep.title), ['fast-episode']);

    slowFeed.resolve({ data: { items: [episode('slow-episode', 'slow')] } });
    const result = await refresh;
    assert.deepEqual(result.episodes.map(ep => ep.title), ['fast-episode', 'slow-episode']);
  });

  it('keeps successful feed episodes when another feed fails', async () => {
    const manager = await loadPlaylistCacheManager({
      invoke: async (_name, payload) => {
        if (payload.url === 'failed') throw new Error('feed failed');
        return { data: { items: [episode('healthy-episode', payload.url)] } };
      },
    });

    const result = await manager.refreshAndSyncPlaylistEpisodes('playlist-a', {
      rss_feeds: [{ url: 'healthy' }, { url: 'failed' }],
    });

    assert.equal(result.failedFeeds, 1);
    assert.deepEqual(result.episodes.map(ep => ep.title), ['healthy-episode']);
  });

  it('keeps cached episodes visible while fresh feed episodes arrive', async () => {
    const manager = await loadPlaylistCacheManager();
    const playlist = { rss_feeds: [{ url: 'fresh' }, { url: 'cached' }] };
    const fresh = episode('fresh-episode', 'fresh', '2026-07-14T12:00:00.000Z');
    const cached = episode('cached-episode', 'cached', '2026-07-13T12:00:00.000Z');

    const merged = manager.mergePlaylistEpisodeLists([[fresh], [cached]], playlist);

    assert.deepEqual(merged.map(ep => ep.title), ['fresh-episode', 'cached-episode']);
  });

  it('does not show the empty state while RSS synchronization is active', async () => {
    const { getPlaylistEpisodeDisplayState } = await loadPlaylistGuards();

    assert.deepEqual(getPlaylistEpisodeDisplayState({
      episodeCount: 0,
      cacheLookupStatus: 'done',
      syncStatus: 'syncing',
      hasPlaylist: true,
    }), {
      isSyncing: true,
      shouldShowEpisodeLoading: true,
      shouldShowEmptyState: false,
    });
  });
});
