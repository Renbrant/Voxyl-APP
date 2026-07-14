import { voxylApi } from '@/api/voxylApiClient';
import { getFeedFromCache, saveFeedToCache } from '@/lib/feedCache';
import { sortPlaylistEpisodes } from './playlistEpisodeSorting';
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
      timestamp: parseInt(timestamp || '0')
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
export function processPlaylistEpisodes(rawEpisodes, playlist) {
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
export async function refreshAndSyncPlaylistEpisodes(playlistId, playlist, options = {}) {
  const { onProgress } = options;
  const rssFeeds = playlist.rss_feeds || [];
  const settledFeeds = new Array(rssFeeds.length).fill(null);
  let completedFeeds = 0;
  let failedFeeds = 0;

  const emitProgress = (extra = {}) => {
    if (!onProgress) return;
    const successfulFeeds = settledFeeds.filter(Boolean);
    onProgress({
      playlistId,
      episodes: mergeAndSortPlaylistEpisodes(successfulFeeds, playlist),
      source: successfulFeeds.length > 0 ? 'rss' : 'none',
      completedFeeds,
      failedFeeds,
      totalFeeds: rssFeeds.length,
      done: completedFeeds >= rssFeeds.length,
      ...extra,
    });
  };

  try {
    const cloudCachePromise = getCloudCache(playlistId);
    const feedPromises = rssFeeds.map(async (f, index) => {
      try {
          const res = await voxylApi.functions.invoke('fetchRSSFeed', { url: f.url, count: 100 });
          const fresh = res.data;
          if (fresh?.items?.length) {
            saveFeedToCache(f.url, fresh);
          }
          if (fresh?.items?.length) {
            settledFeeds[index] = fresh;
          } else {
            const cached = getFeedFromCache(f.url);
            settledFeeds[index] = cached?.items?.length ? cached : null;
            if (!settledFeeds[index]) failedFeeds += 1;
          }
          completedFeeds += 1;
          emitProgress({ feedUrl: f.url });
          return fresh;
      } catch (error) {
        const cached = getFeedFromCache(f.url);
        settledFeeds[index] = cached?.items?.length ? cached : null;
        if (!settledFeeds[index]) failedFeeds += 1;
        completedFeeds += 1;
        emitProgress({ feedUrl: f.url, error });
        return settledFeeds[index];
      }
    });

    // Fetch cloud cache and RSS feeds in parallel, while feeds emit progress individually.
    const [cloudCache] = await Promise.all([
      cloudCachePromise,
      Promise.allSettled(feedPromises)
    ]);

    // Process feed results (fresh or cached)
    const processedFeeds = settledFeeds.filter(Boolean);

    // Get current local cache
    const localCache = getLocalCache(playlistId);

    // Determine which data to use (fresh RSS, cloud, or local)
    let episodesToUse = [];
    let sourceUsed = 'local';

    if (processedFeeds.length > 0) {
      // We have fresh RSS data, use it
      episodesToUse = mergeAndSortPlaylistEpisodes(processedFeeds, playlist);
      if (failedFeeds > 0 && localCache?.episodes?.length) {
        episodesToUse = mergePlaylistEpisodeLists([episodesToUse, localCache.episodes], playlist);
      }
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
    const sortedEpisodes = sortPlaylistEpisodes(episodesToUse, playlist);

    // Update both caches if we have new data
    if (sortedEpisodes.length > 0) {
      saveLocalCache(playlistId, sortedEpisodes);
      await updateCloudCache(playlistId, sortedEpisodes);
    }

    return {
      playlistId,
      episodes: sortedEpisodes,
      source: sourceUsed,
      hash: hashEpisodes(sortedEpisodes),
      completedFeeds,
      failedFeeds,
      totalFeeds: rssFeeds.length
    };
  } catch (error) {
    console.error('Error refreshing playlist episodes:', error);
    // Return local cache as fallback
    const localCache = getLocalCache(playlistId);
    return {
      playlistId,
      episodes: localCache?.episodes || [],
      source: 'local',
      hash: localCache?.hash || null,
      completedFeeds,
      failedFeeds: Math.max(failedFeeds, rssFeeds.length - completedFeeds),
      totalFeeds: rssFeeds.length
    };
  }
}

// Clear cache
export function clearCache(playlistId) {
  localStorage.removeItem(CACHE_PREFIX + playlistId);
  localStorage.removeItem(CACHE_HASH_PREFIX + playlistId);
  localStorage.removeItem(CACHE_TIMESTAMP_PREFIX + playlistId);
}

export function mergeAndSortPlaylistEpisodes(feeds, playlist) {
  const rawEpisodes = feeds
    .filter(r => r?.items)
    .flatMap(r => r.items);

  const seenUrls = new Set();
  const deduplicatedEpisodes = rawEpisodes.filter(ep => {
    if (!ep.audioUrl) return true;
    if (seenUrls.has(ep.audioUrl)) return false;
    seenUrls.add(ep.audioUrl);
    return true;
  });

  return sortPlaylistEpisodes(processPlaylistEpisodes(deduplicatedEpisodes, playlist), playlist);
}

export function mergePlaylistEpisodeLists(episodeLists, playlist) {
  const seenUrls = new Set();
  const merged = [];

  episodeLists.flat().forEach(ep => {
    const key = ep.audioUrl || ep.link || `${ep.feedUrl || ''}:${ep.title || ''}:${ep.pubDate || ''}`;
    if (key && seenUrls.has(key)) return;
    if (key) seenUrls.add(key);
    merged.push(ep);
  });

  return sortPlaylistEpisodes(merged, playlist);
}
