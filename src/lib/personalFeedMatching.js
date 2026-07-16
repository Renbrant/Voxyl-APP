export function getFeedUrlFromPlaylistFeed(feed) {
  if (typeof feed === 'string') return feed;
  return feed?.url || feed?.feed_url || null;
}

export function getPlayedPlaylistId(play, playlists) {
  if (play?.playlist_id && playlists.some(playlist => playlist.id === play.playlist_id)) {
    return play.playlist_id;
  }

  if (!play?.feed_url) return null;

  return playlists.find(playlist =>
    playlist.rss_feeds?.some(feed => getFeedUrlFromPlaylistFeed(feed) === play.feed_url)
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
    if (!current || new Date(playedAt) > new Date(current)) {
      playlistLastPlayedMap.set(playlistId, playedAt);
    }
  });

  return playlists
    .filter(playlist => playlistLastPlayedMap.has(playlist.id))
    .sort((a, b) => new Date(playlistLastPlayedMap.get(b.id)).getTime() - new Date(playlistLastPlayedMap.get(a.id)).getTime());
}
