/**
 * Episode Progress Cache
 * - localStorage is the primary fast layer (read/write instantly)
 * - DB is synced asynchronously (every 10s while playing, on pause/stop)
 * - Records older than 60 days are ignored on load
 */
import { asArray } from '@/lib/arrayUtils';

const STORAGE_KEY = 'voxyl_ep_progress';
const TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const MIN_SAVE_POSITION = 10; // don't save positions under 10s (considered "not started")
const FINISH_THRESHOLD = 0.93; // >93% = finished

// ─── In-memory cache (faster than repeated JSON parse) ──────────────────────────
let memoryCache = null;

// ─── Local cache helpers ──────────────────────────────────────────────────────

function readCache() {
  if (memoryCache) return memoryCache;
  
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      memoryCache = {};
      return memoryCache;
    }
    const data = JSON.parse(raw);
    const now = Date.now();
    // Prune expired entries
    let pruned = false;
    for (const key of Object.keys(data)) {
      const entry = data[key];
      if (!entry.last_played_at || now - new Date(entry.last_played_at).getTime() > TTL_MS) {
        delete data[key];
        pruned = true;
      }
    }
    if (pruned) writeCache(data);
    memoryCache = data;
    return data;
  } catch {
    memoryCache = {};
    return memoryCache;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    memoryCache = data;
  } catch {}
}

export function getCachedProgress(audioUrl) {
  return readCache()[audioUrl] || null;
}

export function setCachedProgress(audioUrl, position, duration, finished) {
  const cache = readCache();
  cache[audioUrl] = {
    position_seconds: Math.floor(position),
    duration_seconds: Math.floor(duration) || cache[audioUrl]?.duration_seconds || 0,
    finished: finished || (duration > 0 && position / duration >= FINISH_THRESHOLD),
    last_played_at: new Date().toISOString(),
  };
  writeCache(cache);
  return cache[audioUrl];
}

export function isFinishedFromCache(audioUrl) {
  return getCachedProgress(audioUrl)?.finished === true;
}

export function getAllFinishedFromCache() {
  const cache = readCache();
  return new Set(Object.entries(cache).filter(([, v]) => v.finished).map(([k]) => k));
}

// ─── DB sync helpers ──────────────────────────────────────────────────────────

let dbRecordMap = {}; // audioUrl → { id, ...fields }

/** Load all progress records from DB into local map and seed local cache */
export async function loadProgressFromDB(base44, userId) {
  const records = asArray(await base44.entities.EpisodeProgress.filter({ user_id: userId }));
  dbRecordMap = {};
  const cache = readCache();
  const now = Date.now();

  for (const r of records) {
    // Skip expired DB records
    if (r.last_played_at && now - new Date(r.last_played_at).getTime() > TTL_MS) continue;
    dbRecordMap[r.audio_url] = r;

    // Merge DB into cache: DB wins if more recent or cache doesn't have it
    const cached = cache[r.audio_url];
    if (!cached || new Date(r.last_played_at) > new Date(cached.last_played_at || 0)) {
      cache[r.audio_url] = {
        position_seconds: r.position_seconds || 0,
        duration_seconds: r.duration_seconds || 0,
        finished: r.finished || false,
        last_played_at: r.last_played_at,
      };
    }
  }
  writeCache(cache);
  return dbRecordMap;
}

/** Save a single episode's progress to DB (upsert) */
export async function saveProgressToDB(base44, userId, audioUrl) {
  const cached = getCachedProgress(audioUrl);
  if (!cached) return;

  const payload = {
    user_id: userId,
    audio_url: audioUrl,
    position_seconds: cached.position_seconds,
    duration_seconds: cached.duration_seconds,
    finished: cached.finished,
    last_played_at: cached.last_played_at,
  };

  const existing = dbRecordMap[audioUrl];
  if (existing?.id) {
    await base44.entities.EpisodeProgress.update(existing.id, payload);
    dbRecordMap[audioUrl] = { ...existing, ...payload };
  } else {
    const created = await base44.entities.EpisodeProgress.create(payload);
    dbRecordMap[audioUrl] = created;
  }
}

/** Delete old DB records (finished > 60 days) — can be called occasionally */
export async function pruneOldDBRecords(base44) {
  const now = Date.now();
  const toDelete = Object.values(dbRecordMap).filter(r =>
    r.last_played_at && now - new Date(r.last_played_at).getTime() > TTL_MS
  );
  for (const r of toDelete) {
    await base44.entities.EpisodeProgress.delete(r.id);
    delete dbRecordMap[r.audio_url];
  }
}

export { FINISH_THRESHOLD, MIN_SAVE_POSITION };
