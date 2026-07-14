export function createPlaylistRequestGuard(getCurrentPlaylistId) {
  let generation = 0;

  return {
    start(playlistId) {
      generation += 1;
      return { playlistId, generation };
    },
    reset(playlistId) {
      generation += 1;
      return { playlistId, generation };
    },
    isCurrent(token) {
      return Boolean(
        token &&
        token.generation === generation &&
        token.playlistId === getCurrentPlaylistId()
      );
    },
  };
}

export const INITIAL_PLAYLIST_SYNC_STATE = {
  status: 'idle',
  source: 'none',
  completedFeeds: 0,
  failedFeeds: 0,
  totalFeeds: 0,
};

export function getPlaylistRouteResetState() {
  return {
    episodes: [],
    backgroundSyncSource: 'none',
    selectedEpisode: null,
    cacheLookupStatus: 'loading',
    syncState: INITIAL_PLAYLIST_SYNC_STATE,
  };
}

export function getPlaylistEpisodeDisplayState({ episodeCount, cacheLookupStatus, syncStatus, hasPlaylist }) {
  const isSyncing = syncStatus === 'syncing';
  return {
    isSyncing,
    shouldShowEpisodeLoading: episodeCount === 0 && (cacheLookupStatus === 'loading' || isSyncing),
    shouldShowEmptyState: episodeCount === 0 && hasPlaylist && cacheLookupStatus !== 'loading' && !isSyncing,
  };
}
