import {
  MIN_SAVE_POSITION,
  normalizeEpisodeFinished,
} from './episodeProgressCache.js';

function timestampMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getFeedUrlFromPlaylistFeed(feed) {
  if (typeof feed === 'string') return feed;
  return feed?.url || feed?.feed_url || null;
}

export function getPlayedPlaylistId(play, playlists) {
  if (play?.playlist_id) {
    return playlists.some(playlist => playlist.id === play.playlist_id)
      ? play.playlist_id
      : null;
  }

  if (!play?.feed_url) return null;

  return playlists.find(playlist =>
    playlist.rss_feeds?.some(
      feed => getFeedUrlFromPlaylistFeed(feed) === play.feed_url,
    )
  )?.id || null;
}

export function getRecentlyPlayedPlaylists(plays, playlists) {
  if (!playlists.length || !plays.length) return [];

  const playlistLastPlayedMap = new Map();

  plays.forEach(play => {
    const playlistId = getPlayedPlaylistId(play, playlists);
    if (!playlistId) return;

    const playedAt = play.played_at || play.created_at;
    const current = playlistLastPlayedMap.get(playlistId);

    if (!current || timestampMs(playedAt) > timestampMs(current)) {
      playlistLastPlayedMap.set(playlistId, playedAt);
    }
  });

  return playlists
    .filter(playlist => playlistLastPlayedMap.has(playlist.id))
    .sort(
      (left, right) =>
        timestampMs(playlistLastPlayedMap.get(right.id)) -
        timestampMs(playlistLastPlayedMap.get(left.id)),
    );
}

export function createEpisodeFromPodcastPlay(play) {
  if (!play?.audio_url) return null;

  return {
    title: play.episode_title || play.podcast_title || '',
    audioUrl: play.audio_url,
    image: play.podcast_image || '',
    feedUrl: play.feed_url || '',
    feedTitle: play.podcast_title || '',
  };
}

export function getListeningHistoryEpisodes(plays = []) {
  const sorted = [...plays]
    .filter(play => play?.audio_url)
    .sort(
      (left, right) =>
        timestampMs(right.played_at || right.created_at) -
        timestampMs(left.played_at || left.created_at),
    );

  const seenAudioUrls = new Set();
  const history = [];

  for (const play of sorted) {
    if (seenAudioUrls.has(play.audio_url)) continue;

    const episode = createEpisodeFromPodcastPlay(play);
    if (!episode) continue;

    seenAudioUrls.add(play.audio_url);

    history.push({
      play,
      episode,
      playedAt: play.played_at || play.created_at || null,
    });
  }

  return history;
}

export function getContinueListeningItems(
  progressRecords = [],
  plays = [],
) {
  const history = getListeningHistoryEpisodes(plays);

  const latestPlayByAudioUrl = new Map(
    history.map(item => [
      item.episode.audioUrl,
      item.play,
    ]),
  );

  return progressRecords
    .filter(progress => {
      const position = Number(progress?.position_seconds);

      return Boolean(
        progress?.audio_url &&
        Number.isFinite(position) &&
        position > MIN_SAVE_POSITION &&
        !normalizeEpisodeFinished(progress),
      );
    })
    .map(progress => {
      const play = latestPlayByAudioUrl.get(progress.audio_url);

      if (!play) {
        return null;
      }

      const episode = createEpisodeFromPodcastPlay(play);

      if (!episode) {
        return null;
      }

      return {
        progress,
        play,
        episode,
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        timestampMs(right.progress.last_played_at) -
        timestampMs(left.progress.last_played_at),
    );
}

export function getPlaybackProgressPercent(progress) {
  const position = Number(progress?.position_seconds);
  const duration = Number(progress?.duration_seconds);

  if (
    !Number.isFinite(position) ||
    !Number.isFinite(duration) ||
    position <= 0 ||
    duration <= 0
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      100,
      (position / duration) * 100,
    ),
  );
}
