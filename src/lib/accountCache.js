import { clearAllContentCache } from './savedContentCache';

// Account switch removes private browser data; account deletion also removes progress.
export function clearAccountClientData(userId, { deleted = false } = {}) {
  try {
    const prefixes = ['playlist_episodes_', 'playlist_hash_', 'playlist_timestamp_', 'voxyl_feed_'];
    const scoped = userId ? encodeURIComponent(`user:${userId}`) : null;
    for (const key of Object.keys(localStorage)) {
      if (key === 'voxyl_downloads' || key === 'voxyl_feed_index' ||
          prefixes.some(prefix => key.startsWith(prefix) && (prefix === 'voxyl_feed_' || !key.startsWith(`${prefix}v2_`) || (scoped && key.startsWith(`${prefix}v2_${scoped}_`)))) ||
          (userId && (key.startsWith('voxyl_cache_') && key.includes(userId))) ||
          (userId && key === `voxyl_downloads_v2_${encodeURIComponent(userId)}`) ||
          (deleted && userId && key === `voxyl_ep_progress_${encodeURIComponent(userId)}`)) {
        localStorage.removeItem(key);
      }
    }
    if (userId) clearAllContentCache(userId);
  } catch {
    // localStorage can be disabled by the browser.
  }
}
