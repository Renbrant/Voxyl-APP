import { voxylApi } from '../api/voxylApiClient.js';
import { getCache, setCache, invalidateCache, TTL_5MIN } from './appCache.js';
import { getCachedContent, setCachedContent, clearContentCache } from './savedContentCache.js';
import { asArray } from './arrayUtils.js';
import {
  applyPlaylistLikeOptimistic,
  playlistLikeIds,
  reconcilePlaylistLikeRecords,
  updatePlaylistLikesCountInValue,
} from './savedContentState.js';

const playlistToggleInflight = new Map();

export const savedContentQueryKeys = {
  playlistLikes: (userId) => ['saved-content', 'playlist-likes', userId],
  likedPlaylists: (userId, playlistIds = []) => ['saved-content', 'liked-playlists', userId, playlistIds.join(',')],
  podcastLikes: (userId) => ['saved-content', 'podcast-likes', userId],
};

export { normalizePodcastFeedUrl, playlistLikeIds, podcastFeedUrlSet } from './savedContentState.js';

export async function loadPlaylistLikeRecords(userId) {
  const cacheKey = `liked-playlists-${userId}`;
  const cached = getCache(cacheKey) || getCachedContent(userId, 'LIKED_PLAYLISTS');
  if (Array.isArray(cached)) return cached;

  const records = asArray(await voxylApi.entities.PlaylistLike.filter({ user_id: userId }));
  setCache(cacheKey, records, TTL_5MIN);
  setCachedContent(userId, 'LIKED_PLAYLISTS', records);
  return records;
}

export async function loadLikedPlaylistsForRecords(records, ownedPlaylists = []) {
  const likedIds = playlistLikeIds(records);
  const ownedIds = new Set(asArray(ownedPlaylists).map((playlist) => playlist.id));
  const idsToLoad = likedIds.filter((id) => !ownedIds.has(id));
  const results = await Promise.allSettled(idsToLoad.map((id) => voxylApi.entities.Playlist.get(id)));
  const playlists = [];

  results.forEach((result, index) => {
    const playlistId = idsToLoad[index];
    if (result.status === 'fulfilled') {
      if (result.value) playlists.push(result.value);
      return;
    }

    if (result.reason?.status === 404) {
      console.warn('[saved-content] Skipping inaccessible liked playlist', {
        playlistId,
        status: result.reason.status,
        message: result.reason.message,
      });
      return;
    }

    throw result.reason;
  });

  return playlists;
}

export async function loadPodcastLikeRecords(userId) {
  const cacheKey = `liked-podcasts-${userId}`;
  const cached = getCache(cacheKey) || getCachedContent(userId, 'LIKED_PODCASTS');
  if (Array.isArray(cached)) return cached;

  const records = asArray(await voxylApi.entities.PodcastLike.filter({ user_id: userId }, '-created_date', 100));
  setCache(cacheKey, records, TTL_5MIN);
  setCachedContent(userId, 'LIKED_PODCASTS', records);
  return records;
}

export function clearPlaylistLikeCaches(userId) {
  invalidateCache(`liked-playlists-${userId}`);
  clearContentCache(userId, 'LIKED_PLAYLISTS');
}

export function clearPodcastLikeCaches(userId) {
  invalidateCache(`liked-podcasts-${userId}`);
  clearContentCache(userId, 'LIKED_PODCASTS');
}

export function invalidatePlaylistLikeQueries(queryClient, userId) {
  if (!queryClient || !userId) return;
  queryClient.invalidateQueries({ queryKey: savedContentQueryKeys.playlistLikes(userId) });
  queryClient.invalidateQueries({ queryKey: ['saved-content', 'liked-playlists', userId] });
}

export function invalidatePodcastLikeQueries(queryClient, userId) {
  if (!queryClient || !userId) return;
  queryClient.invalidateQueries({ queryKey: savedContentQueryKeys.podcastLikes(userId) });
  queryClient.invalidateQueries({ queryKey: ['liked-podcasts', userId] });
}

export function handlePodcastLikeMutationSuccess(queryClient, userId) {
  clearPodcastLikeCaches(userId);
  invalidatePodcastLikeQueries(queryClient, userId);
}

export function refreshPlaylistLikeQuery(queryClient, userId) {
  clearPlaylistLikeCaches(userId);
  return queryClient?.refetchQueries?.({ queryKey: savedContentQueryKeys.playlistLikes(userId), type: 'active' });
}

export function refreshPodcastLikeQuery(queryClient, userId) {
  clearPodcastLikeCaches(userId);
  return queryClient?.refetchQueries?.({ queryKey: savedContentQueryKeys.podcastLikes(userId), type: 'active' });
}

export function updateCachedPlaylistLikesCount(queryClient, playlistId, likesCount) {
  if (!queryClient || !playlistId || likesCount === undefined || likesCount === null) return;
  const updater = (value) => updatePlaylistLikesCountInValue(value, playlistId, likesCount);

  queryClient.setQueryData(['feed-playlists'], updater);
  queryClient.setQueryData(['explore-playlists'], updater);
  queryClient.setQueryData(['playlist', playlistId], updater);
  queryClient.setQueriesData(
    { predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'saved-content' && query.queryKey[1] === 'liked-playlists' },
    updater,
  );
}

export function togglePlaylistLikeOptimistically({ queryClient, userId, playlistId, toggle }) {
  const inflightKey = `${userId}:${playlistId}`;
  const existing = playlistToggleInflight.get(inflightKey);
  if (existing) return existing;

  const promise = (async () => {
    const queryKey = savedContentQueryKeys.playlistLikes(userId);
    const cachedRecords = queryClient.getQueryData(queryKey);
    const previousRecords = Array.isArray(cachedRecords) ? cachedRecords : [];

    queryClient.setQueryData(queryKey, applyPlaylistLikeOptimistic(previousRecords, playlistId));
    clearPlaylistLikeCaches(userId);

    try {
      const response = await toggle();
      const data = response?.data || response || {};
      const liked = Boolean(data.liked);
      queryClient.setQueryData(queryKey, reconcilePlaylistLikeRecords(previousRecords, playlistId, liked));
      updateCachedPlaylistLikesCount(queryClient, playlistId, data.likes_count);
      invalidatePlaylistLikeQueries(queryClient, userId);
      return data;
    } catch (error) {
      queryClient.setQueryData(queryKey, previousRecords);
      throw error;
    } finally {
      playlistToggleInflight.delete(inflightKey);
    }
  })();

  playlistToggleInflight.set(inflightKey, promise);
  return promise;
}
