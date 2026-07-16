/**
 * Episode Progress Cache
 * - localStorage is the primary fast layer (read/write instantly)
 * - authenticated DB sync is best-effort and ownership is derived by the Worker
 * - records older than 60 days are ignored on load
 */
import { asArray } from './arrayUtils.js';

const LEGACY_STORAGE_KEY = 'voxyl_ep_progress';
const LEGACY_MIGRATION_KEY = 'voxyl_ep_progress_legacy_migrated';
const STORAGE_PREFIX = 'voxyl_ep_progress';
const GUEST_SCOPE = 'guest';
const TTL_MS = 60 * 24 * 60 * 60 * 1000;
const MIN_SAVE_POSITION = 10;
const FINISH_THRESHOLD = 0.93;
const DIAGNOSTIC_THROTTLE_MS = 60000;

let activeScope = GUEST_SCOPE;
let activeStorageKey = buildProgressCacheKey(null);
let memoryCache = null;
let dbRecordMap = {};
let scopeVersion = 0;
let lastDiagnosticAt = 0;
const saveQueues = new Map();

function storageAvailable() {
  return typeof localStorage !== 'undefined';
}

function safeScopePart(value) {
  return encodeURIComponent(String(value || '').trim() || GUEST_SCOPE);
}

export function getProgressCacheScope(userId) {
  return userId ? safeScopePart(userId) : GUEST_SCOPE;
}

export function buildProgressCacheKey(userId) {
  return `${STORAGE_PREFIX}_${getProgressCacheScope(userId)}`;
}

function parseCache(raw) {
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function readStorage(key) {
  if (!storageAvailable()) return {};
  try {
    return parseCache(localStorage.getItem(key));
  } catch {
    return {};
  }
}

function writeStorage(key, data) {
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {}
}

function isFreshProgress(entry, now = Date.now()) {
  const timestamp = Date.parse(entry?.last_played_at || '');
  return Number.isFinite(timestamp) && now - timestamp <= TTL_MS;
}

export function normalizeEpisodeFinished(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return entry.finished === true ||
    entry.finished === 1 ||
    entry.finished === '1' ||
    entry.completed === true ||
    entry.completed === 1 ||
    entry.completed === '1';
}

function normalizeProgressEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const position = Number(entry.position_seconds);
  const duration = Number(entry.duration_seconds);
  const timestamp = typeof entry.last_played_at === 'string' ? entry.last_played_at : null;

  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return null;

  return {
    position_seconds: Number.isFinite(position) && position >= 0 ? Math.trunc(position) : 0,
    duration_seconds: Number.isFinite(duration) && duration >= 0 ? Math.trunc(duration) : 0,
    finished: normalizeEpisodeFinished(entry),
    last_played_at: timestamp,
  };
}

function pruneCache(data) {
  const now = Date.now();
  const next = {};

  for (const [audioUrl, entry] of Object.entries(data || {})) {
    const normalized = normalizeProgressEntry(entry);
    if (normalized && isFreshProgress(normalized, now)) {
      next[audioUrl] = normalized;
    }
  }

  return next;
}

function mergeProgressCache(left, right) {
  const merged = { ...(left || {}) };

  for (const [audioUrl, entry] of Object.entries(right || {})) {
    const normalized = normalizeProgressEntry(entry);
    if (!normalized) continue;
    const current = merged[audioUrl];
    const currentTime = Date.parse(current?.last_played_at || '');
    const nextTime = Date.parse(normalized.last_played_at);

    if (!Number.isFinite(currentTime) || nextTime >= currentTime) {
      merged[audioUrl] = normalized;
    }
  }

  return pruneCache(merged);
}

function maybeMigrateLegacyCache(storageKey, scope) {
  if (!storageAvailable()) return false;

  try {
    const alreadyMigrated = localStorage.getItem(LEGACY_MIGRATION_KEY);
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);

    if (alreadyMigrated || !legacyRaw) return false;

    const legacy = pruneCache(parseCache(legacyRaw));
    if (Object.keys(legacy).length === 0) {
      localStorage.setItem(LEGACY_MIGRATION_KEY, scope);
      return false;
    }

    const current = readStorage(storageKey);
    writeStorage(storageKey, { ...legacy, ...current });
    localStorage.setItem(LEGACY_MIGRATION_KEY, scope);
    return true;
  } catch {}

  return false;
}

function readCache() {
  if (memoryCache) return memoryCache;
  const data = pruneCache(readStorage(activeStorageKey));
  writeStorage(activeStorageKey, data);
  memoryCache = data;
  return data;
}

function writeCache(data) {
  memoryCache = data;
  writeStorage(activeStorageKey, data);
}

export function activateProgressCacheScope(userId, options = {}) {
  const { migrateLegacy = true, mergeCurrentCache = false } = options;
  const previousCache = mergeCurrentCache ? readCache() : null;
  const nextScope = getProgressCacheScope(userId);
  const nextStorageKey = buildProgressCacheKey(userId);

  if (nextScope !== activeScope) {
    memoryCache = null;
    dbRecordMap = {};
    saveQueues.clear();
    scopeVersion += 1;
  }

  activeScope = nextScope;
  activeStorageKey = nextStorageKey;
  if (migrateLegacy && maybeMigrateLegacyCache(activeStorageKey, activeScope)) {
    memoryCache = null;
  }
  if (previousCache) {
    const targetCache = readStorage(activeStorageKey);
    writeStorage(activeStorageKey, mergeProgressCache(targetCache, previousCache));
    memoryCache = null;
  }
  readCache();
  return { scope: activeScope, storageKey: activeStorageKey, version: scopeVersion };
}

export function getActiveProgressScope() {
  return { scope: activeScope, storageKey: activeStorageKey, version: scopeVersion };
}

export function getProgressScopeDecision(authState = null) {
  /** @type {any} */
  const state = authState || {};
  const apiUser = state.apiUser;
  const isAuthenticated = state.isAuthenticated;
  const isLoadingAuth = state.isLoadingAuth;
  const authChecked = state.authChecked;
  const clerkUserId = state.clerkUser?.id || state.clerkUserId || null;

  if (isLoadingAuth || !authChecked) {
    return { status: 'loading', userId: null, migrateLegacy: false };
  }

  if (isAuthenticated && apiUser?.id) {
    return { status: 'confirmed', userId: apiUser.id, migrateLegacy: true };
  }

  if (isAuthenticated && clerkUserId) {
    return { status: 'provisional', userId: `clerk:${clerkUserId}`, migrateLegacy: false };
  }

  if (isAuthenticated) {
    return { status: 'loading', userId: null, migrateLegacy: false };
  }

  return { status: 'confirmed', userId: null, migrateLegacy: true };
}

export function getProgressPlaybackTransition(previousScope, decision) {
  if (decision?.status === 'loading') {
    return {
      nextScope: previousScope || null,
      shouldClearPlayback: Boolean(previousScope),
      mergeCurrentCache: false,
      dbUserId: null,
    };
  }

  const nextScope = decision?.userId || GUEST_SCOPE;
  const isProvisionalToConfirmed = Boolean(previousScope?.startsWith('clerk:') && decision?.status === 'confirmed' && decision?.userId);
  const scopeChanged = Boolean(previousScope && previousScope !== nextScope);

  return {
    nextScope,
    shouldClearPlayback: scopeChanged && !isProvisionalToConfirmed,
    mergeCurrentCache: isProvisionalToConfirmed,
    dbUserId: decision?.status === 'confirmed' ? decision.userId || null : null,
  };
}

export function resetProgressRuntimeState() {
  memoryCache = null;
  dbRecordMap = {};
  saveQueues.clear();
  scopeVersion += 1;
}

export function getCachedProgress(audioUrl) {
  return readCache()[audioUrl] || null;
}

export function setCachedProgress(audioUrl, position, duration, finished) {
  const cache = readCache();
  const current = cache[audioUrl];
  const safePosition = Number.isFinite(position) && position >= 0 ? Math.floor(position) : 0;
  const safeDuration = Number.isFinite(duration) && duration >= 0 ? Math.floor(duration) : current?.duration_seconds || 0;
  cache[audioUrl] = {
    position_seconds: safePosition,
    duration_seconds: safeDuration,
    finished: Boolean(finished) || (safeDuration > 0 && safePosition / safeDuration >= FINISH_THRESHOLD),
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

export function mergeProgressRecords(records, expectedVersion = scopeVersion) {
  if (expectedVersion !== scopeVersion) return {};

  dbRecordMap = {};
  const cache = readCache();
  const now = Date.now();

  for (const record of records) {
    if (!record?.audio_url) continue;
    const normalized = normalizeProgressEntry(record);
    if (!normalized || !isFreshProgress(normalized, now)) continue;

    dbRecordMap[record.audio_url] = record;
    const cached = cache[record.audio_url];
    const cachedTime = Date.parse(cached?.last_played_at || '');
    const remoteTime = Date.parse(normalized.last_played_at);

    if (!Number.isFinite(cachedTime) || remoteTime > cachedTime) {
      cache[record.audio_url] = normalized;
    }
  }

  if (expectedVersion !== scopeVersion) return {};

  writeCache(cache);
  return dbRecordMap;
}

function reportProgressSyncError(error) {
  const now = Date.now();
  if (now - lastDiagnosticAt < DIAGNOSTIC_THROTTLE_MS) return;
  lastDiagnosticAt = now;

  if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location?.hostname)) {
    console.warn('[VOXYL] Episode progress sync failed; local progress was kept.', {
      name: error?.name,
      message: error?.message,
      status: error?.status,
    });
  }
}

export async function loadProgressFromDB(voxylApi, userId) {
  const expectedScope = getProgressCacheScope(userId);
  if (!userId || expectedScope !== activeScope) return {};
  const { version } = getActiveProgressScope();
  const records = asArray(await voxylApi.entities.EpisodeProgress.filter({}, '-last_played_at', 500));
  if (expectedScope !== activeScope) return {};
  return mergeProgressRecords(records, version);
}

async function saveProgressSnapshot(voxylApi, userId, audioUrl, expectedScope, version) {
  if (!userId || expectedScope !== activeScope || version !== scopeVersion) return;
  const cached = getCachedProgress(audioUrl);
  if (expectedScope !== activeScope || version !== scopeVersion) return;
  if (!cached) return;

  const payload = {
    audio_url: audioUrl,
    position_seconds: cached.position_seconds,
    duration_seconds: cached.duration_seconds,
    finished: cached.finished,
    last_played_at: cached.last_played_at,
  };

  const saved = await voxylApi.entities.EpisodeProgress.create(payload);
  if (expectedScope !== activeScope || version !== scopeVersion) return;
  dbRecordMap[audioUrl] = saved;
}

export function saveProgressToDB(voxylApi, userId, audioUrl) {
  if (!userId || !audioUrl) return Promise.resolve();

  const expectedScope = getProgressCacheScope(userId);
  if (expectedScope !== activeScope) return Promise.resolve();
  const version = scopeVersion;
  const queueKey = `${expectedScope}:${audioUrl}`;
  const previous = saveQueues.get(queueKey) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => saveProgressSnapshot(voxylApi, userId, audioUrl, expectedScope, version))
    .catch((error) => {
      reportProgressSyncError(error);
    })
    .finally(() => {
      if (saveQueues.get(queueKey) === next) {
        saveQueues.delete(queueKey);
      }
    });

  saveQueues.set(queueKey, next);
  return next;
}

export async function pruneOldDBRecords(voxylApi) {
  const now = Date.now();
  const toDelete = Object.values(dbRecordMap).filter((record) =>
    record?.id && record.last_played_at && now - Date.parse(record.last_played_at) > TTL_MS
  );

  for (const record of toDelete) {
    try {
      await voxylApi.entities.EpisodeProgress.delete(record.id);
      delete dbRecordMap[record.audio_url];
    } catch (error) {
      reportProgressSyncError(error);
    }
  }
}

export { FINISH_THRESHOLD, MIN_SAVE_POSITION, TTL_MS };
