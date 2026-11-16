import { getFeedFromCache, getRSSCacheFromCloud } from '@/lib/feedCache';

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
    
    // No network fetch here: cover images are drawn for every playlist card, and
    // fetching each feed would spend the RSS rate limit the playlist screens need.
    // Without cached data the card falls back to the feed's own image below.

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