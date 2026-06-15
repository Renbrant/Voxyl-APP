const CACHE_KEY_PREFIX = 'voxyl_feed_';
const INDEX_KEY = 'voxyl_feed_index';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_CACHE_ENTRIES = 100;

// Deterministic 32-bit hash (djb2) — guarantees a unique key per distinct URL.
// Truncating a base64 string (old approach) caused collisions where two
// different feeds shared the same cache key, showing the wrong podcast's metadata.
function hashUrl(url) {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) + hash + url.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function getCacheKey(url) {
  return CACHE_KEY_PREFIX + hashUrl(url) + '_' + url.length.toString(36);
}

function getIndex() {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY)) || {};
  } catch {
    return {};
  }
}

function saveIndex(index) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {}
}

export function getFeedFromCache(url) {
  try {
    const key = getCacheKey(url);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function saveFeedToCache(url, data) {
  try {
    const key = getCacheKey(url);
    const index = getIndex();
    index[key] = Date.now();
    
    if (Object.keys(index).length >= MAX_CACHE_ENTRIES) {
      pruneOldEntries(index);
    }
    
    localStorage.setItem(key, JSON.stringify({ cachedAt: Date.now(), data }));
    saveIndex(index);
  } catch {
    // Storage full — ignore
  }
  // Always return a resolved promise so callers can safely .catch()
  return Promise.resolve();
}

export function invalidateFeedCache(url) {
  try {
    localStorage.removeItem(getCacheKey(url));
  } catch {}
}

function pruneOldEntries(index) {
  try {
    const entries = Object.entries(index).sort((a, b) => a[1] - b[1]);
    const toRemove = entries.slice(0, Math.floor(MAX_CACHE_ENTRIES / 2));
    toRemove.forEach(([key]) => {
      localStorage.removeItem(key);
      delete index[key];
    });
  } catch {}
}

// Cloud cache is handled server-side by fetchRSSFeed function.
// Frontend only uses localStorage cache.
export async function getRSSCacheFromCloud(feedUrl) {
  return null; // no-op: cloud cache is managed by the backend function
}