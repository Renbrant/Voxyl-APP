import { asArray } from './arrayUtils.js';

export function normalizePodcastFeedUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return trimmed;
    url.hash = '';
    return url.toString();
  } catch {
    return trimmed;
  }
}

export function podcastFeedUrlSet(records) {
  return new Set(asArray(records).map((record) => normalizePodcastFeedUrl(record.feed_url)).filter(Boolean));
}

export function playlistLikeIds(records) {
  return asArray(records).map((record) => record.playlist_id).filter(Boolean);
}

export function hasPlaylistLike(records, playlistId) {
  return playlistLikeIds(records).includes(playlistId);
}

export function optimisticPlaylistLikeRecord(playlistId) {
  return {
    id: `optimistic-${playlistId}`,
    playlist_id: playlistId,
    created_at: new Date().toISOString(),
    created_date: new Date().toISOString(),
  };
}

export function applyPlaylistLikeOptimistic(records, playlistId) {
  const current = asArray(records);
  if (hasPlaylistLike(current, playlistId)) {
    return current.filter((record) => record.playlist_id !== playlistId);
  }
  return [optimisticPlaylistLikeRecord(playlistId), ...current];
}

export function reconcilePlaylistLikeRecords(records, playlistId, liked) {
  const current = asArray(records).filter((record) => record.playlist_id !== playlistId);
  return liked ? [optimisticPlaylistLikeRecord(playlistId), ...current] : current;
}

export function updatePlaylistLikesCountInValue(value, playlistId, likesCount) {
  if (!playlistId || !Number.isFinite(Number(likesCount))) return value;

  const updatePlaylist = (playlist) => (
    playlist?.id === playlistId ? { ...playlist, likes_count: Number(likesCount) } : playlist
  );

  if (Array.isArray(value)) {
    return value.map(updatePlaylist);
  }

  if (value?.playlist) {
    return { ...value, playlist: updatePlaylist(value.playlist) };
  }

  return updatePlaylist(value);
}
