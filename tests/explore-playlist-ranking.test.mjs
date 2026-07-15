import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import worker from '../workers/api/src/index.ts';

const baseEnv = {
  CLERK_AUTHORIZED_PARTIES: 'https://v.renbrant.com,http://localhost:5173',
};

const now = Date.now();
const daysAgo = (days) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

function playlist(overrides) {
  return {
    id: overrides.id,
    legacy_base44_playlist_id: null,
    creator_id: `${overrides.id}-creator`,
    creator_clerk_user_id: null,
    creator_legacy_base44_user_id: null,
    title: overrides.title || overrides.id,
    description: null,
    cover_image: null,
    visibility: overrides.visibility || 'public',
    rss_feeds: '[]',
    likes_count: overrides.likes_count ?? 0,
    plays_count: overrides.plays_count ?? 0,
    creator_username: overrides.creator_username || null,
    creator_picture: null,
    creator_hidden: 0,
    created_at: overrides.created_at || daysAgo(30),
    updated_at: overrides.updated_at || daysAgo(1),
    creator_email: 'private@example.com',
  };
}

function play(overrides) {
  return {
    id: overrides.id,
    playlist_id: overrides.playlist_id,
    played_at: overrides.played_at,
    created_at: overrides.created_at || overrides.played_at,
  };
}

function recentPlayCount(plays, playlistId) {
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;

  return plays.filter((row) => {
    if (row.playlist_id !== playlistId) return false;
    const timestamp = row.played_at && row.played_at.trim() ? row.played_at : row.created_at;
    return Date.parse(timestamp) >= cutoff;
  }).length;
}

function createRankingDb({ playlists, plays }) {
  const calls = [];

  return {
    calls,
    prepare(sql) {
      assert.match(sql, /LEFT JOIN podcast_plays pp/);
      assert.match(sql, /ON pp\.playlist_id = p\.id/);
      assert.match(sql, /WHERE p\.visibility = 'public'/);
      calls.push(sql);
      return {
        async all() {
          const results = playlists
            .filter((row) => row.visibility === 'public')
            .map((row) => ({
              ...row,
              recent_plays_count: recentPlayCount(plays, row.id),
            }))
            .sort((left, right) =>
              right.recent_plays_count - left.recent_plays_count ||
              right.plays_count - left.plays_count ||
              right.likes_count - left.likes_count ||
              right.updated_at.localeCompare(left.updated_at) ||
              left.id.localeCompare(right.id),
            )
            .slice(0, 50);

          return { results };
        },
      };
    },
  };
}

function request(path, method = 'GET') {
  return new Request(`https://api.voxyl.test${path}`, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: method === 'POST' ? '{}' : undefined,
  });
}

async function body(response) {
  return response.json();
}

function fixtureDb() {
  return createRankingDb({
    playlists: [
      playlist({
        id: 'alpha',
        title: 'Alpha',
        plays_count: 5,
        likes_count: 1,
        updated_at: '2026-07-10T00:00:00.000Z',
      }),
      playlist({
        id: 'bravo',
        title: 'Bravo',
        plays_count: 100,
        likes_count: 1,
        updated_at: '2026-07-09T00:00:00.000Z',
      }),
      playlist({
        id: 'charlie',
        title: 'Charlie',
        plays_count: 5,
        likes_count: 9,
        updated_at: '2026-07-08T00:00:00.000Z',
      }),
      playlist({
        id: 'delta',
        title: 'Delta',
        plays_count: 5,
        likes_count: 1,
        updated_at: '2026-07-11T00:00:00.000Z',
      }),
      playlist({
        id: 'echo',
        title: 'Echo',
        plays_count: 5,
        likes_count: 1,
        updated_at: '2026-07-11T00:00:00.000Z',
      }),
      playlist({ id: 'private', visibility: 'private', plays_count: 999 }),
      playlist({ id: 'friends', visibility: 'friends_only', plays_count: 999 }),
    ],
    plays: [
      play({ id: 'recent-alpha-1', playlist_id: 'alpha', played_at: daysAgo(1) }),
      play({ id: 'recent-alpha-2', playlist_id: 'alpha', played_at: '', created_at: daysAgo(2) }),
      play({ id: 'old-bravo', playlist_id: 'bravo', played_at: daysAgo(8) }),
      play({ id: 'recent-charlie', playlist_id: 'charlie', played_at: daysAgo(1) }),
      play({ id: 'private-recent', playlist_id: 'private', played_at: daysAgo(1) }),
      play({ id: 'friends-recent', playlist_id: 'friends', played_at: daysAgo(1) }),
    ],
  });
}

describe('Explore playlist discovery ranking Worker route', () => {
  it('supports every top-playlists route alias', async () => {
    for (const [method, path] of [
      ['GET', '/api/discovery/top-playlists'],
      ['GET', '/discovery/top-playlists'],
      ['POST', '/api/functions/getTopPlaylistsByPlayback'],
      ['POST', '/functions/getTopPlaylistsByPlayback'],
    ]) {
      const db = fixtureDb();
      const response = await worker.fetch(request(path, method), { ...baseEnv, DB: db });

      assert.equal(response.status, 200, `${method} ${path}`);
    }
  });

  it('does not route unsupported methods to playlist discovery', async () => {
    for (const [method, path] of [
      ['POST', '/api/discovery/top-playlists'],
      ['POST', '/discovery/top-playlists'],
      ['GET', '/api/functions/getTopPlaylistsByPlayback'],
      ['GET', '/functions/getTopPlaylistsByPlayback'],
    ]) {
      const db = fixtureDb();
      const response = await worker.fetch(request(path, method), { ...baseEnv, DB: db });
      const data = await body(response);

      assert.equal(response.status, 404, `${method} ${path}`);
      assert.equal(data.ok, false);
      assert.equal(db.calls.length, 0);
    }
  });

  it('returns ranked public playlists with compatibility shape and counts', async () => {
    const db = fixtureDb();
    const response = await worker.fetch(request('/api/discovery/top-playlists'), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.deepEqual(data.playlists.map((row) => row.id), ['alpha', 'charlie', 'bravo', 'delta', 'echo']);
    assert.equal(typeof data.playlists[0].recent_plays_count, 'number');
    assert.equal(data.playlists[0].recent_plays_count, 2);
    assert.equal(data.playlists[0].plays_count, 5);
    assert.equal(data.playlists[2].recent_plays_count, 0);
    assert.equal(data.playlists[2].plays_count, 100);
    assert.equal(data.playlists.some((row) => row.id === 'bravo' && row.recent_plays_count === 0), true);
    assert.equal(data.playlists.every((row) => row.visibility === 'public'), true);
    assert.equal(data.playlists.some((row) => row.id === 'private' || row.id === 'friends'), false);
    assert.equal(data.playlists.some((row) => 'creator_email' in row), false);
    assert.equal(db.calls.length, 1);
  });

  it('limits ranked playlist results to 50', async () => {
    const db = createRankingDb({
      playlists: Array.from({ length: 55 }, (_, index) => playlist({
        id: `playlist-${String(index).padStart(2, '0')}`,
        plays_count: 55 - index,
      })),
      plays: [],
    });
    const response = await worker.fetch(request('/api/discovery/top-playlists'), { ...baseEnv, DB: db });
    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.playlists.length, 50);
    assert.equal(data.playlists[0].id, 'playlist-00');
    assert.equal(data.playlists.at(-1).id, 'playlist-49');
  });

  it('keeps the SQL ranking bounded to the last 7 days with deterministic fallback ordering', () => {
    const source = fs.readFileSync(new URL('../workers/api/src/index.ts', import.meta.url), 'utf8');

    assert.match(source, /COUNT\(pp\.id\)\s+AS recent_plays_count/);
    assert.match(source, /COALESCE\(NULLIF\(TRIM\(pp\.played_at\), ''\), pp\.created_at\)/);
    assert.match(source, /datetime\('now', '-7 days'\)/);
    assert.match(source, /WHERE p\.visibility = 'public'/);
    assert.match(source, /ORDER BY recent_plays_count DESC, p\.plays_count DESC, p\.likes_count DESC,\s+p\.updated_at DESC, p\.id ASC/);
    assert.match(source, /LIMIT 50/);
  });
});

describe('Explore playlist frontend state', () => {
  it('preserves server ordering and exposes a retryable query error state', () => {
    const source = fs.readFileSync(new URL('../src/pages/Explore.jsx', import.meta.url), 'utf8');
    const filteredBlock = source.slice(source.indexOf('const filteredPlaylists = playlists'), source.indexOf('// Build user list'));

    assert.equal(/\.sort\(/.test(filteredBlock), false);
    assert.match(source, /isFetching: playlistsFetching/);
    assert.match(source, /isError: playlistsError/);
    assert.match(source, /error: playlistsQueryError/);
    assert.match(source, /refetch: refetchPlaylists/);
    assert.match(source, /const canRetryPlaylists = playlistsError && Boolean\(playlistsQueryError\) && !playlistsFetching/);
    assert.match(source, /playlistsError \?/);
    assert.match(source, /t\('explorePlaylistsError'\)/);
    assert.match(source, /onClick=\{\(\) => refetchPlaylists\(\)\}/);
    assert.match(source, /disabled=\{!canRetryPlaylists\}/);
    assert.match(source, /t\('retry'\)/);
  });
});
