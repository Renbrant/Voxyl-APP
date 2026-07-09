import { voxylApi } from '@/api/voxylApiClient';
import { getFeedFromCache, saveFeedToCache } from '@/lib/feedCache';
import { parseDurationToSeconds } from '@/lib/rssUtils';

const CACHE_PREFIX = 'playlist_episodes_';
const CACHE_HASH_PREFIX = 'playlist_hash_';
const CACHE_TIMESTAMP_PREFIX = 'playlist_timestamp_';
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

// Simple hash function for episodes
function hashEpisodes(episodes) {
  if (!episodes || episodes.length === 0) return '';
  return episodes.map(e => e.audioUrl || e.link).join('|');
}

// Get local cache
export function getLocalCache(playlistId) {
  try {
    const cached = localStorage.getItem(CACHE_PREFIX + playlistId);
    const hash = localStorage.getItem(CACHE_HASH_PREFIX + playlistId);
    const timestamp = localStorage.getItem(CACHE_TIMESTAMP_PREFIX + playlistId);
    
    if (!cached) return null;
    
    return {
      episodes: JSON.parse(cached),
      hash,
      timestamp: parseInt(timestamp || 0)
    };
  } catch {
    return null;
  }
}

// Save local cache
export function saveLocalCache(playlistId, episodes) {
  try {
    const hash = hashEpisodes(episodes);
    const timestamp = Date.now();
    
    localStorage.setItem(CACHE_PREFIX + playlistId, JSON.stringify(episodes));
    localStorage.setItem(CACHE_HASH_PREFIX + playlistId, hash);
    localStorage.setItem(CACHE_TIMESTAMP_PREFIX + playlistId, timestamp.toString());
    
    return { episodes, hash, timestamp };
  } catch {
    return null;
  }
}

// Get cloud cache
export async function getCloudCache(playlistId) {
  try {
    const records = await voxylApi.entities.PlaylistEpisodesCache.filter({ playlist_id: playlistId });
    if (!records[0]) return null;
    
    const record = records[0];
    return {
      episodes: JSON.parse(record.episodes_data || '[]'),
      hash: record.episodes_hash,
      timestamp: new Date(record.last_updated).getTime()
    };
  } catch {
    return null;
  }
}

// Update cloud cache
export async function updateCloudCache(playlistId, episodes) {
  try {
    const hash = hashEpisodes(episodes);
    const data = JSON.stringify(episodes);
    const now = new Date().toISOString();
    
    const existing = await voxylApi.entities.PlaylistEpisodesCache.filter({ playlist_id: playlistId });
    
    if (existing[0]) {
      await voxylApi.entities.PlaylistEpisodesCache.update(existing[0].id, {
        episodes_hash: hash,
        episodes_data: data,
        last_updated: now
      });
    } else {
      await voxylApi.entities.PlaylistEpisodesCache.create({
        playlist_id: playlistId,
        episodes_hash: hash,
        episodes_data: data,
        last_updated: now
      });
    }
    
    return { episodes, hash, timestamp: Date.now() };
  } catch (error) {
    console.error('Error updating cloud cache:', error);
    return null;
  }
}

// Process and filter episodes based on playlist config
function processEpisodes(rawEpisodes, playlist) {
  const feedSkipMap = {};
  (playlist.rss_feeds || []).forEach(f => {
    feedSkipMap[f.url] = {
      skip_start_seconds: f.skip_start_seconds || 0,
      skip_end_seconds: f.skip_end_seconds || 0,
    };
  });

  const timeFilterMs = playlist.time_filter_hours ? playlist.time_filter_hours * 60 * 60 * 1000 : 0;
  const now = Date.now();

  return rawEpisodes
    .filter(ep => {
      // Apply max duration filter
      if (playlist.max_duration && playlist.max_duration > 0) {
        const secs = parseDurationToSeconds(ep.duration);
        if (secs && secs > playlist.max_duration * 60) return false;
      }

      // Apply time filter
      if (timeFilterMs > 0 && ep.pubDate) {
        const age = now - new Date(ep.pubDate).getTime();
        if (age > timeFilterMs) return false;
      }

      return true;
    })
    .map(ep => {
      const skip = feedSkipMap[ep.feedUrl] || { skip_start_seconds: 0, skip_end_seconds: 0 };
      return {
        ...ep,
        audioUrl: ep.audioUrl?.replace(/&amp;/g, '&'),
        image: ep.image?.replace(/&amp;/g, '&'),
        skip_start_seconds: skip.skip_start_seconds,
        skip_end_seconds: skip.skip_end_seconds,
      };
    });
}

// Sort episodes
function sortEpisodes(episodes, playlist) {
  const sortOrder = playlist?.episodes_sort_order || 'newest_first';
  return [...episodes].sort((a, b) => {
    const dateA = new Date(a.pubDate);
    const dateB = new Date(b.pubDate);
    return sortOrder === 'newest_first' ? dateB - dateA : dateA - dateB;
  });
}

// Get initial playlist episodes (fast load from local cache)
export async function getInitialPlaylistEpisodes(playlistId) {
  const localCache = getLocalCache(playlistId);
  if (localCache?.episodes?.length) {
    return {
      episodes: localCache.episodes,
      source: 'local',
      hash: localCache.hash
    };
  }

  // Fallback to cloud if no local cache
  const cloudCache = await getCloudCache(playlistId);
  if (cloudCache?.episodes?.length) {
    saveLocalCache(playlistId, cloudCache.episodes);
    return {
      episodes: cloudCache.episodes,
      source: 'cloud',
      hash: cloudCache.hash
    };
  }

  return {
    episodes: [],
    source: 'none',
    hash: null
  };
}

// Refresh and sync episodes (background sync with cloud and RSS feeds)
export async function refreshAndSyncPlaylistEpisodes(playlistId, playlist) {
  try {
    // Fetch cloud cache and RSS feeds in parallel
    const [cloudCache, feedResults] = await Promise.all([
      getCloudCache(playlistId),
      Promise.allSettled(
        (playlist.rss_feeds || []).map(async (f) => {
          const res = await voxylApi.functions.invoke('fetchRSSFeed', { url: f.url, count: 100 });
          const fresh = res.data;
          if (fresh?.items?.length) {
            saveFeedToCache(f.url, fresh);
          }
          return fresh;
        })
      )
    ]);

    // Process feed results (fresh or cached)
    const processedFeeds = (playlist.rss_feeds || []).map((f, i) => {
      const result = feedResults[i];
      if (result.status === 'fulfilled' && result.value?.items?.length) {
        return result.value;
      }
      const cached = getFeedFromCache(f.url);
      return cached?.items?.length ? cached : null;
    }).filter(Boolean);

    // Get current local cache
    const localCache = getLocalCache(playlistId);

    // Determine which data to use (fresh RSS, cloud, or local)
    let episodesToUse = [];
    let sourceUsed = 'local';

    if (processedFeeds.length > 0) {
      // We have fresh RSS data, use it
      const rawEpisodes = processedFeeds
        .filter(r => r?.items)
        .flatMap(r => r.items);
      
      // DEDUPLICATE: Remove duplicate episodes by audioUrl
      const seenUrls = new Set();
      const deduplicatedEpisodes = rawEpisodes.filter(ep => {
        if (!ep.audioUrl) return true; // Keep episodes without audioUrl
        if (seenUrls.has(ep.audioUrl)) return false; // Skip duplicates
        seenUrls.add(ep.audioUrl);
        return true;
      });
      
      episodesToUse = processEpisodes(deduplicatedEpisodes, playlist);
      sourceUsed = 'rss';
    } else if (cloudCache?.episodes?.length) {
      // No fresh RSS, use cloud cache if available and newer than local
      if (!localCache || cloudCache.timestamp > localCache.timestamp) {
        episodesToUse = cloudCache.episodes;
        sourceUsed = 'cloud';
      } else if (localCache?.episodes?.length) {
        episodesToUse = localCache.episodes;
        sourceUsed = 'local';
      }
    } else if (localCache?.episodes?.length) {
      episodesToUse = localCache.episodes;
      sourceUsed = 'local';
    }

    // Sort episodes
    const sortedEpisodes = sortEpisodes(episodesToUse, playlist);

    // Update both caches if we have new data
    if (sortedEpisodes.length > 0) {
      saveLocalCache(playlistId, sortedEpisodes);
      await updateCloudCache(playlistId, sortedEpisodes);
    }

    return {
      episodes: sortedEpisodes,
      source: sourceUsed,
      hash: hashEpisodes(sortedEpisodes)
    };
  } catch (error) {
    console.error('Error refreshing playlist episodes:', error);
    // Return local cache as fallback
    const localCache = getLocalCache(playlistId);
    return {
      episodes: localCache?.episodes || [],
      source: 'local',
      hash: localCache?.hash || null
    };
  }
}

// Clear cache
export function clearCache(playlistId) {
  localStorage.removeItem(CACHE_PREFIX + playlistId);
  localStorage.removeItem(CACHE_HASH_PREFIX + playlistId);
  localStorage.removeItem(CACHE_TIMESTAMP_PREFIX + playlistId);
}