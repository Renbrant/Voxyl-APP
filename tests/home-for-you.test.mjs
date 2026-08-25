import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

import {
  createEpisodeFromPodcastPlay,
  getContinueListeningItems,
  getListeningHistoryEpisodes,
  getPlaybackProgressPercent,
} from '../src/lib/personalFeedMatching.js';

const personalSource = fs.readFileSync(
  new URL(
    '../src/components/feed/MyPlaylistsContent.jsx',
    import.meta.url,
  ),
  'utf8',
);

const feedSource = fs.readFileSync(
  new URL('../src/pages/Feed.jsx', import.meta.url),
  'utf8',
);

const i18nSource = fs.readFileSync(
  new URL('../src/lib/i18n.js', import.meta.url),
  'utf8',
);

describe('Issue #72 For You matching', () => {
  const plays = [
    {
      id: 'play-a-old',
      feed_url: 'https://feeds.example.com/a.xml',
      podcast_title: 'Podcast A',
      podcast_image: 'https://img.example.com/a-old.jpg',
      audio_url: 'https://audio.example.com/a.mp3',
      episode_title: 'Episode A old metadata',
      played_at: '2026-08-20T10:00:00.000Z',
    },
    {
      id: 'play-a-new',
      feed_url: 'https://feeds.example.com/a.xml',
      podcast_title: 'Podcast A',
      podcast_image: 'https://img.example.com/a.jpg',
      audio_url: 'https://audio.example.com/a.mp3',
      episode_title: 'Episode A',
      played_at: '2026-08-24T10:00:00.000Z',
    },
    {
      id: 'play-b',
      feed_url: 'https://feeds.example.com/b.xml',
      podcast_title: 'Podcast B',
      podcast_image: 'https://img.example.com/b.jpg',
      audio_url: 'https://audio.example.com/b.mp3',
      episode_title: 'Episode B',
      played_at: '2026-08-23T10:00:00.000Z',
    },
  ];

  it('creates the PlayerContext-compatible episode shape from PodcastPlay metadata', () => {
    assert.deepEqual(
      createEpisodeFromPodcastPlay(plays[1]),
      {
        title: 'Episode A',
        audioUrl: 'https://audio.example.com/a.mp3',
        image: 'https://img.example.com/a.jpg',
        feedUrl: 'https://feeds.example.com/a.xml',
        feedTitle: 'Podcast A',
      },
    );
  });

  it('matches unfinished progress only by exact audio_url and reuses the latest play metadata', () => {
    const items = getContinueListeningItems(
      [
        {
          audio_url: 'https://audio.example.com/a.mp3',
          position_seconds: 90,
          duration_seconds: 300,
          finished: 0,
          last_played_at: '2026-08-24T10:01:00.000Z',
        },
        {
          audio_url: 'https://audio.example.com/b.mp3',
          position_seconds: 150,
          duration_seconds: 300,
          finished: 1,
          last_played_at: '2026-08-24T11:00:00.000Z',
        },
        {
          audio_url: 'https://audio.example.com/unmatched.mp3',
          position_seconds: 200,
          duration_seconds: 500,
          finished: 0,
          last_played_at: '2026-08-24T12:00:00.000Z',
        },
        {
          audio_url: 'https://audio.example.com/threshold.mp3',
          position_seconds: 10,
          duration_seconds: 100,
          finished: 0,
          last_played_at: '2026-08-24T13:00:00.000Z',
        },
      ],
      plays,
    );

    assert.equal(items.length, 1);
    assert.equal(
      items[0].episode.audioUrl,
      'https://audio.example.com/a.mp3',
    );
    assert.equal(
      items[0].episode.title,
      'Episode A',
    );
    assert.equal(
      items[0].play.id,
      'play-a-new',
    );
  });

  it('treats completed as finished and orders remaining progress by last_played_at', () => {
    const items = getContinueListeningItems(
      [
        {
          audio_url: 'https://audio.example.com/a.mp3',
          position_seconds: 80,
          duration_seconds: 300,
          finished: 0,
          last_played_at: '2026-08-22T10:00:00.000Z',
        },
        {
          audio_url: 'https://audio.example.com/b.mp3',
          position_seconds: 60,
          duration_seconds: 300,
          completed: 0,
          last_played_at: '2026-08-23T10:00:00.000Z',
        },
        {
          audio_url: 'https://audio.example.com/c.mp3',
          position_seconds: 70,
          duration_seconds: 300,
          completed: 1,
          last_played_at: '2026-08-24T10:00:00.000Z',
        },
      ],
      [
        ...plays,
        {
          id: 'play-c',
          feed_url: 'https://feeds.example.com/c.xml',
          podcast_title: 'Podcast C',
          audio_url: 'https://audio.example.com/c.mp3',
          episode_title: 'Episode C',
          played_at: '2026-08-24T10:00:00.000Z',
        },
      ],
    );

    assert.deepEqual(
      items.map(item => item.episode.audioUrl),
      [
        'https://audio.example.com/b.mp3',
        'https://audio.example.com/a.mp3',
      ],
    );
  });

  it('deduplicates broader listening history by audio URL while retaining newest metadata', () => {
    const history =
      getListeningHistoryEpisodes(plays);

    assert.equal(history.length, 2);
    assert.equal(
      history[0].play.id,
      'play-a-new',
    );
    assert.equal(
      history[1].play.id,
      'play-b',
    );
  });

  it('calculates a bounded persisted progress percentage', () => {
    assert.equal(
      getPlaybackProgressPercent({
        position_seconds: 75,
        duration_seconds: 300,
      }),
      25,
    );

    assert.equal(
      getPlaybackProgressPercent({
        position_seconds: 400,
        duration_seconds: 300,
      }),
      100,
    );

    assert.equal(
      getPlaybackProgressPercent({
        position_seconds: 10,
        duration_seconds: 0,
      }),
      0,
    );
  });
});

describe('Issue #72 For You source contract', () => {
  it('loads the persisted EpisodeProgress model and broader PodcastPlay history', () => {
    assert.match(
      personalSource,
      /EpisodeProgress\.filter\(\s*\{\},\s*'-last_played_at',\s*500,\s*\)/s,
    );

    assert.match(
      personalSource,
      /PodcastPlay\.filter\(\s*\{ user_id: user\.id \},\s*'-played_at',\s*'all',\s*\)/s,
    );
  });

  it('resumes through PlayerContext play instead of manually seeking', () => {
    assert.match(
      personalSource,
      /const \{\s*play,\s*currentEpisode,\s*isPlaying,\s*togglePlay,\s*\} = usePlayer\(\);/s,
    );

    assert.match(
      personalSource,
      /void play\(\s*item\.episode,\s*\[item\.episode\],\s*\{\s*type: 'podcast',\s*id: item\.play\.feed_url,\s*\},\s*\);/s,
    );

    assert.doesNotMatch(
      personalSource,
      /\bseek\(/,
    );
  });

  it('renders the approved personal Home sections in the intended order', () => {
    const continueListening =
      personalSource.indexOf(
        "t('feedContinueListening')",
      );

    const recentPlaylists =
      personalSource.indexOf(
        "t('feedRecentlyPlayedPlaylists')",
      );

    const recentPodcasts =
      personalSource.indexOf(
        "t('feedLastPlayedPodcasts')",
      );

    const history =
      personalSource.indexOf(
        "t('feedViewListeningHistory')",
      );

    assert.ok(continueListening >= 0);
    assert.ok(recentPlaylists > continueListening);
    assert.ok(recentPodcasts > recentPlaylists);
    assert.ok(history > recentPodcasts);
  });

  it('defines intentional Continue Listening loading, error, retry, and empty states', () => {
    assert.match(
      personalSource,
      /isLoadingProgress/,
    );

    assert.match(
      personalSource,
      /isProgressError/,
    );

    assert.match(
      personalSource,
      /refetchProgress/,
    );

    assert.match(
      personalSource,
      /feedContinueListeningEmpty/,
    );
  });

  it('adds EpisodeProgress to Home pull-to-refresh invalidation', () => {
    assert.match(
      feedSource,
      /invalidateCache\('user-episode-progress-' \+ user\?\.id\)/,
    );

    assert.match(
      feedSource,
      /queryKey: \['user-episode-progress'\]/,
    );
  });

  it('contains the visible For You labels in both supported languages', () => {
    assert.match(
      i18nSource,
      /feedContinueListening: \{ pt: 'Continue ouvindo', en: 'Continue Listening' \}/,
    );

    assert.match(
      i18nSource,
      /feedViewListeningHistory: \{ pt: 'Ver histórico de reprodução', en: 'View listening history' \}/,
    );

    assert.match(
      i18nSource,
      /feedRecentlyPlayedPlaylists: \{ pt: 'Playlists ouvidas recentemente', en: 'Recently Played Playlists' \}/,
    );
  });
});
