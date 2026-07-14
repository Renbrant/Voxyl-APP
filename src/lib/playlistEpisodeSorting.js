function episodeDateMs(episode) {
  const value = episode?.pubDate ? new Date(episode.pubDate).getTime() : Number.NaN;
  return Number.isFinite(value) ? value : null;
}

function deterministicEpisodeKey(episode, index) {
  return [
    episode?.feedUrl || '',
    episode?.guid || '',
    episode?.audioUrl || '',
    episode?.link || '',
    episode?.title || '',
    String(index),
  ].join('|');
}

export function sortPlaylistEpisodes(episodes, playlist) {
  const sortOrder = playlist?.episodes_sort_order || 'newest_first';
  return episodes.map((episode, index) => ({
    episode,
    dateMs: episodeDateMs(episode),
    key: deterministicEpisodeKey(episode, index),
  })).sort((a, b) => {
    const aHasDate = a.dateMs !== null;
    const bHasDate = b.dateMs !== null;

    if (aHasDate && bHasDate && a.dateMs !== b.dateMs) {
      return sortOrder === 'oldest_first' ? a.dateMs - b.dateMs : b.dateMs - a.dateMs;
    }

    if (aHasDate !== bHasDate) {
      return aHasDate ? -1 : 1;
    }

    return a.key.localeCompare(b.key);
  }).map(({ episode }) => episode);
}
