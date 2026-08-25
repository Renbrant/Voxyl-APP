import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import worker from '../workers/api/src/index.ts';

const baseEnv = {
  CLERK_AUTHORIZED_PARTIES: 'https://v.renbrant.com,http://localhost:5173',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();

function daysAgo(days) {
  return new Date(now - days * DAY_MS).toISOString();
}

function playlist(overrides) {
  return {
    id: overrides.id,
    legacy_base44_playlist_id: null,
    creator_id: overrides.id + '-creator',
    creator_clerk_user_id: null,
    creator_legacy_base44_user_id: null,
    title: overrides.title || overrides.id,
    description: null,
    cover_image: null,
    visibility: overrides.visibility || 'public',
    rss_feeds: '[]',
    max_duration: 0,
    time_filter_hours: 0,
    episodes_sort_order: 'newest_first',
    likes_count: overrides.likes_count ?? 0,
    plays_count: overrides.plays_count ?? 0,
    creator_username: null,
    creator_picture: null,
    creator_hidden: 0,
    created_at: overrides.created_at || daysAgo(100),
    updated_at: overrides.updated_at || daysAgo(1),
  };
}

function play(overrides) {
  const playedAt = Object.prototype.hasOwnProperty.call(overrides, 'played_at')
    ? overrides.played_at
    : daysAgo(1);

  const createdAt = Object.prototype.hasOwnProperty.call(overrides, 'created_at')
    ? overrides.created_at
    : playedAt;

  return {
    id: overrides.id,
    playlist_id: overrides.playlist_id ?? null,
    feed_url: overrides.feed_url ?? null,
    podcast_title: overrides.podcast_title ?? null,
    podcast_image: overrides.podcast_image ?? null,
    played_at: playedAt,
    created_at: createdAt,
  };
}

function effectivePlayTimestamp(row) {
  const playedAt = typeof row.played_at === 'string' ? row.played_at.trim() : '';
  const timestamp = playedAt || row.created_at;

  return Date.parse(timestamp);
}

function isWithinWindow(row, days) {
  return effectivePlayTimestamp(row) >= now - days * DAY_MS;
}

function createHomeRankingDb({ playlists, plays }) {
  const calls = [];

  return {
    calls,

    prepare(sql) {
      let kind = null;

      if (sql.includes('COUNT(pp.id) AS window_plays_count')) {
        kind = 'playlists';
      } else if (sql.includes('SELECT pp.feed_url AS feed_url')) {
        kind = 'podcasts';
      }

      assert.ok(kind, 'Unexpected SQL issued by Home rankings route.');

      const call = {
        kind,
        sql,
        binds: [],
      };

      calls.push(call);

      const statement = {
        bind(...args) {
          call.binds = args;
          return statement;
        },

        async all() {
          assert.equal(call.binds.length, 1);

          const windowModifier = String(call.binds[0]);
          const windowMatch = /^-(7|90) days$/.exec(windowModifier);

          assert.ok(windowMatch, 'Home ranking query must bind a 7-day or 90-day window.');

          const days = Number(windowMatch[1]);

          if (kind === 'playlists') {
            const results = playlists
              .filter((row) => row.visibility === 'public')
              .map((row) => ({
                ...row,
                window_plays_count: plays.filter(
                  (candidate) =>
                    candidate.playlist_id === row.id &&
                    isWithinWindow(candidate, days),
                ).length,
              }))
              .filter((row) => row.window_plays_count > 0)
              .sort(
                (left, right) =>
                  right.window_plays_count - left.window_plays_count ||
                  left.id.localeCompare(right.id),
              )
              .slice(0, 50);

            return { results };
          }

          const byFeedUrl = new Map();

          for (const row of plays) {
            if (!isWithinWindow(row, days)) {
              continue;
            }

            const feedUrl = typeof row.feed_url === 'string' ? row.feed_url.trim() : '';

            if (!feedUrl) {
              continue;
            }

            const current = byFeedUrl.get(feedUrl) || {
              feed_url: feedUrl,
              podcast_title: null,
              podcast_image: null,
              play_count: 0,
            };

            current.play_count += 1;

            if (
              row.podcast_title &&
              (current.podcast_title === null || row.podcast_title > current.podcast_title)
            ) {
              current.podcast_title = row.podcast_title;
            }

            if (
              row.podcast_image &&
              (current.podcast_image === null || row.podcast_image > current.podcast_image)
            ) {
              current.podcast_image = row.podcast_image;
            }

            byFeedUrl.set(feedUrl, current);
          }

          const results = [...byFeedUrl.values()]
            .sort(
              (left, right) =>
                right.play_count - left.play_count ||
                left.feed_url.localeCompare(right.feed_url),
            )
            .slice(0, 50);

          return { results };
        },
      };

      return statement;
    },
  };
}

function request(path, method = 'GET') {
  return new Request('https://api.voxyl.test' + path, {
    method,
  });
}

async function body(response) {
  return response.json();
}

function fixtureDb() {
  return createHomeRankingDb({
    playlists: [
      playlist({
        id: 'alpha',
        title: 'Alpha',
        plays_count: 999,
      }),
      playlist({
        id: 'bravo',
        title: 'Bravo',
        plays_count: 1,
      }),
      playlist({
        id: 'charlie',
        title: 'Charlie',
        plays_count: 5000,
      }),
      playlist({
        id: 'private',
        title: 'Private',
        visibility: 'private',
        plays_count: 9000,
      }),
    ],

    plays: [
      play({
        id: 'alpha-1',
        playlist_id: 'alpha',
        feed_url: 'feed-a',
        podcast_title: 'Podcast A',
        podcast_image: 'a.jpg',
        played_at: daysAgo(1),
      }),
      play({
        id: 'alpha-30',
        playlist_id: 'alpha',
        feed_url: 'feed-a',
        podcast_title: 'Podcast A',
        podcast_image: 'a.jpg',
        played_at: daysAgo(30),
      }),
      play({
        id: 'alpha-89',
        playlist_id: 'alpha',
        feed_url: 'feed-a',
        podcast_title: 'Podcast A',
        podcast_image: 'a.jpg',
        played_at: daysAgo(89),
      }),
      play({
        id: 'bravo-8',
        playlist_id: 'bravo',
        feed_url: 'feed-b',
        podcast_title: 'Podcast B',
        podcast_image: 'b.jpg',
        played_at: daysAgo(8),
      }),
      play({
        id: 'bravo-created-at-fallback',
        playlist_id: 'bravo',
        feed_url: 'feed-b',
        podcast_title: 'Podcast B',
        podcast_image: 'b.jpg',
        played_at: '',
        created_at: daysAgo(6),
      }),
      play({
        id: 'charlie-91',
        playlist_id: 'charlie',
        feed_url: 'feed-c',
        podcast_title: 'Podcast C',
        podcast_image: 'c.jpg',
        played_at: daysAgo(91),
      }),
      play({
        id: 'private-recent',
        playlist_id: 'private',
        feed_url: null,
        played_at: daysAgo(1),
      }),
    ],
  });
}

describe('Home popularity ranking Worker route', () => {
  it('defaults to a rolling 90-day window and ignores lifetime playlist popularity', async () => {
    const db = fixtureDb();

    const response = await worker.fetch(
      request('/api/home/rankings'),
      { ...baseEnv, DB: db },
    );

    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.window_days, 90);

    assert.deepEqual(
      data.playlists.map((row) => row.id),
      ['alpha', 'bravo'],
    );

    assert.deepEqual(
      data.playlists.map((row) => row.window_plays_count),
      [3, 2],
    );

    assert.equal(
      data.playlists.some((row) => row.id === 'charlie'),
      false,
      'A playlist with high lifetime plays but no play in the window must not appear.',
    );

    assert.equal(
      data.playlists.some((row) => row.id === 'private'),
      false,
      'Private playlists must not appear in Voxyl-wide playlist rankings.',
    );

    assert.deepEqual(
      data.podcasts.map((row) => row.feedUrl),
      ['feed-a', 'feed-b'],
    );

    assert.deepEqual(
      data.podcasts.map((row) => row.playCount),
      [3, 2],
    );

    assert.equal(db.calls.length, 2);
    assert.deepEqual(
      db.calls.map((call) => call.binds[0]),
      ['-90 days', '-90 days'],
    );
  });

  it('uses a rolling 7-day window and falls back from blank played_at to created_at', async () => {
    const db = fixtureDb();

    const response = await worker.fetch(
      request('/api/home/rankings?days=7'),
      { ...baseEnv, DB: db },
    );

    const data = await body(response);

    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.window_days, 7);

    assert.deepEqual(
      data.playlists.map((row) => row.id),
      ['alpha', 'bravo'],
    );

    assert.deepEqual(
      data.playlists.map((row) => row.window_plays_count),
      [1, 1],
    );

    assert.deepEqual(
      data.podcasts.map((row) => row.feedUrl),
      ['feed-a', 'feed-b'],
    );

    assert.deepEqual(
      data.podcasts.map((row) => row.playCount),
      [1, 1],
    );

    assert.deepEqual(
      db.calls.map((call) => call.binds[0]),
      ['-7 days', '-7 days'],
    );
  });

  it('rejects unsupported ranking windows before querying D1', async () => {
    const db = fixtureDb();

    const response = await worker.fetch(
      request('/api/home/rankings?days=30'),
      { ...baseEnv, DB: db },
    );

    const data = await body(response);

    assert.equal(response.status, 400);
    assert.equal(data.ok, false);
    assert.equal(data.error, 'days must be 7 or 90');
    assert.equal(db.calls.length, 0);
  });

  it('does not accept POST for the Home ranking endpoint', async () => {
    const db = fixtureDb();

    const response = await worker.fetch(
      request('/api/home/rankings?days=7', 'POST'),
      { ...baseEnv, DB: db },
    );

    assert.equal(response.status, 404);
    assert.equal(db.calls.length, 0);
  });

  it('keeps Home ranking SQL tied to real play events and deterministic window ordering', () => {
    const source = fs.readFileSync(
      new URL('../workers/api/src/index.ts', import.meta.url),
      'utf8',
    );

    const start = source.indexOf('async function homeRankingsResponse');
    const end = source.indexOf('async function topPodcastsByPlaybackResponse');

    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    assert.ok(end > start);

    const block = source.slice(start, end);

    assert.match(
      block,
      /COALESCE\(NULLIF\(TRIM\(pp\.played_at\), ''\), pp\.created_at\)/,
    );

    assert.match(
      block,
      /datetime\('now', \?\)/,
    );

    assert.match(
      block,
      /INNER JOIN podcast_plays pp/,
    );

    assert.match(
      block,
      /HAVING COUNT\(pp\.id\) > 0/,
    );

    assert.match(
      block,
      /ORDER BY window_plays_count DESC, p\.id ASC/,
    );

    assert.match(
      block,
      /GROUP BY pp\.feed_url/,
    );

    assert.match(
      block,
      /ORDER BY play_count DESC, pp\.feed_url ASC/,
    );

    assert.doesNotMatch(
      block,
      /ORDER BY window_plays_count DESC,\s*p\.plays_count/,
    );
  });
});

describe('Issue #72 Home UI source contract', () => {
  const feedSource = fs.readFileSync(
    new URL('../src/pages/Feed.jsx', import.meta.url),
    'utf8',
  );

  const i18nSource = fs.readFileSync(
    new URL('../src/lib/i18n.js', import.meta.url),
    'utf8',
  );

  it('uses For You as the stable default Home tab', () => {
    assert.match(
      feedSource,
      /useState\('for-you'\)/,
    );

    assert.doesNotMatch(
      feedSource,
      /setTab\('my-playlists'\)/,
    );

    assert.match(
      feedSource,
      /tab === 'for-you' && authResolved && !user/,
    );

    assert.match(
      feedSource,
      /tab === 'for-you' && user && hiddenUsersReady/,
    );

    assert.match(
      feedSource,
      /onClick=\{redirectToLogin\}/,
    );
  });

  it('exposes For You, Trending, and Last Week in the approved order', () => {
    const forYou = feedSource.indexOf("key: 'for-you'");
    const trending = feedSource.indexOf("key: 'trending'");
    const lastWeek = feedSource.indexOf("key: 'last-week'");

    assert.ok(forYou >= 0);
    assert.ok(trending > forYou);
    assert.ok(lastWeek > trending);

    assert.doesNotMatch(
      feedSource,
      /key: 'recent'/,
    );

    assert.doesNotMatch(
      feedSource,
      /key: 'my-playlists'/,
    );
  });

  it('maps Trending to 90 days and Last Week to 7 days', () => {
    assert.match(
      feedSource,
      /const rankingDays = tab === 'last-week' \? 7 : 90;/,
    );

    assert.match(
      feedSource,
      /queryKey: \['home-rankings', rankingDays\]/,
    );

    assert.match(
      feedSource,
      /queryFn: \(\) => voxylApi\.home\.rankings\(rankingDays\)/,
    );

    assert.match(
      feedSource,
      /enabled: tab === 'trending' \|\| tab === 'last-week'/,
    );
  });

  it('removes legacy lifetime and creation-date ranking sources from Home', () => {
    const forbiddenMarkers = [
      "queryKey: ['feed-playlists']",
      "queryKey: ['top-podcasts']",
      'getTopPodcastsByPlayback',
      'const sortedPlaylists',
      'const recentPlaylists',
      "useState('trending')",
    ];

    for (const marker of forbiddenMarkers) {
      assert.equal(
        feedSource.includes(marker),
        false,
        'Legacy Home marker survived: ' + marker,
      );
    }
  });

  it('renders playlists and podcasts from rolling-window metrics', () => {
    assert.match(
      feedSource,
      /plays_count: playlist\.window_plays_count/,
    );

    assert.match(
      feedSource,
      /podcast\.playCount/,
    );

    const playlistSection = feedSource.indexOf("t('feedTopPlaylists')");
    const podcastSection = feedSource.indexOf("t('feedTopPodcasts')");

    assert.ok(playlistSection >= 0);
    assert.ok(podcastSection > playlistSection);
  });

  it('provides explicit loading, error, retry, and empty states', () => {
    assert.match(
      feedSource,
      /if \(isLoading\)/,
    );

    assert.match(
      feedSource,
      /if \(isError\)/,
    );

    assert.match(
      feedSource,
      /if \(!playlists\.length && !podcasts\.length\)/,
    );

    assert.match(
      feedSource,
      /onClick=\{onRetry\}/,
    );
  });

  it('labels backend windows exactly as 90 days and 7 days', () => {
    assert.match(
      i18nSource,
      /feedTrendingWindow: \{ pt: 'Últimos 90 dias', en: 'Last 90 days' \}/,
    );

    assert.match(
      i18nSource,
      /feedLastWeekWindow: \{ pt: 'Últimos 7 dias', en: 'Last 7 days' \}/,
    );

    assert.match(
      i18nSource,
      /feedForYou: \{ pt: 'Para Você', en: 'For You' \}/,
    );

    assert.match(
      i18nSource,
      /feedLastWeek: \{ pt: 'Última Semana', en: 'Last Week' \}/,
    );
  });
});

describe('Issue #72 Home header source contract', () => {
  const homeHeaderSource = fs.readFileSync(
    new URL('../src/pages/Feed.jsx', import.meta.url),
    'utf8',
  );

  it('does not present Discover as a Home subtitle', () => {
    assert.doesNotMatch(
      homeHeaderSource,
      /subtitle=\{t\('feedSubtitle'\)\}/,
    );

    assert.match(
      homeHeaderSource,
      /subtitle=\{null\}/,
    );
  });
});
