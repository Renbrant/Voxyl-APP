import { getFeedFromCache, saveFeedToCache, getRSSCacheFromCloud } from '@/lib/feedCache';
import { voxylApi } from '@/api/voxylApiClient';

/**
 * Get cover image for playlist
 * If playlist has cover_image, return it
 * Otherwise, get the image from the podcast with most episodes
 */
export async function getPlaylistCoverImage(playlist) {
  if (playlist?.cover_image) {
    return playlist.cover_image;
  }

  // Find podcast with most episodes
  const feeds = playlist?.rss_feeds || [];
  if (feeds.length === 0) return null;

  let maxEpisodeCount = 0;
  let coverImage = null;

  // Try to get feed data from cache or cloud/API
  for (const feed of feeds) {
    let feedData = getFeedFromCache(feed.url);
    
    // If not in local cache, try cloud cache
    if (!feedData) {
      feedData = await getRSSCacheFromCloud(feed.url).catch(() => null);
    }
    
    // If still not found, fetch from API
    if (!feedData) {
      try {
        const res = await voxylApi.functions.invoke('fetchRSSFeed', { url: feed.url, count: 10 });
        feedData = res.data;
        if (feedData) {
          saveFeedToCache(feed.url, feedData);
        }
      } catch (err) {
        // Silent fail, use feed.image fallback
      }
    }

    const episodeCount = feedData?.items?.length || 0;
    
    if (episodeCount > maxEpisodeCount) {
      maxEpisodeCount = episodeCount;
      coverImage = feedData?.image || feed.image;
    }
  }

  // If no feed image found, use first feed's image as fallback
  if (!coverImage && feeds.length > 0) {
    coverImage = feeds[0].image;
  }

  return coverImage;
}