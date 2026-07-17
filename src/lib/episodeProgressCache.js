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
  const serverTimestamp = typeof entry.server_updated_at === 'string'
    ? entry.server_updated_at
    : (typeof entry.updated_at === 'string' ? entry.updated_at : null);

  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return null;

  return {
    id: typeof entry.id === 'string' ? entry.id : undefined,
    position_seconds: Number.isFinite(position) && position >= 0 ? Math.trunc(position) : 0,
    duration_seconds: Number.isFinite(duration) && duration >= 0 ? Math.trunc(duration) : 0,
    finished: normalizeEpisodeFinished(entry),
    last_played_at: timestamp,
    server_updated_at: serverTimestamp && Number.isFinite(Date.parse(serverTimestamp)) ? serverTimestamp : undefined,
  };
}

function getProgressOrdering(entry) {
  const normalized = normalizeProgressEntry(entry);

  if (!normalized) {
    return { value: 0, authoritative: false };
  }

  const serverTime = Date.parse(normalized.server_updated_at || '');

  if (Number.isFinite(serverTime)) {
    return { value: serverTime, authoritative: true };
  }

  return {
    value: Date.parse(normalized.last_played_at || '') || 0,
    authoritative: false,
  };
}

export function compareProgressRevision(left, right) {
  const leftOrder = getProgressOrdering(left);
  const rightOrder = getProgressOrdering(right);

  if (leftOrder.authoritative !== rightOrder.authoritative) {
    return leftOrder.authoritative ? 1 : -1;
  }

  if (leftOrder.value === rightOrder.value) return 0;
  return leftOrder.value > rightOrder.value ? 1 : -1;
}

export function shouldRefreshRequireResumeTransition({
  before = null,
  after = null,
  currentPosition = 0,
  isPlaying = false,
  minDeltaSeconds = 1,
  isWebPlayback = true,
} = {}) {
  if (!isWebPlayback || !after) return false;

  const afterPosition = Number(after.position_seconds);
  const current = Number(currentPosition);
  const beforePosition = Number(before?.position_seconds);
  if (!Number.isFinite(afterPosition)) return false;
  if (!Number.isFinite(current)) return true;

  if (afterPosition - current >= minDeltaSeconds) return true;
  return Boolean(
    normalizeEpisodeFinished(after) &&
    !normalizeEpisodeFinished(before) &&
    (!Number.isFinite(beforePosition) || afterPosition >= beforePosition)
  );
}

export function createWebResumeRequestGate() {
  let generation = 0;

  return {
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(requestGeneration) {
      return requestGeneration === generation;
    },
    invalidate() {
      generation += 1;
      return generation;
    },
  };
}

/**
 * @param {{ gate?: { isCurrent: (generation: number) => boolean }, requestGeneration?: number, expectedAudioUrl?: string, currentAudioUrl?: string, isPlaying?: boolean }} options
 */
export function isCurrentWebResumeRequest({
  gate,
  requestGeneration,
  expectedAudioUrl,
  currentAudioUrl,
  isPlaying = false,
} = {}) {
  return Boolean(
    gate?.isCurrent(requestGeneration) &&
    expectedAudioUrl &&
    expectedAudioUrl === currentAudioUrl &&
    !isPlaying
  );
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

    if (!current) {
      merged[audioUrl] = normalized;
      continue;
    }

    const currentPosition = Number(current.position_seconds);
    const incomingPosition = Number(normalized.position_seconds);
    const furthestPosition = Math.max(currentPosition, incomingPosition);
    const revisionSource = compareProgressRevision(normalized, current) > 0
      ? normalized
      : current;
    const positionSource = incomingPosition > currentPosition ? normalized : current;

    merged[audioUrl] = {
      ...positionSource,
      ...revisionSource,
      position_seconds: furthestPosition,
      finished: normalizeEpisodeFinished(current) || normalizeEpisodeFinished(normalized),
    };
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

export function getEpisodeResumeState(episode, skipResume = false) {
  const savedProgress = getCachedProgress(episode?.audioUrl);
  const cachedPosition = Number(savedProgress?.position_seconds);
  const cachedDuration = Number(savedProgress?.duration_seconds);
  const resumeAt = !skipResume && cachedPosition > MIN_SAVE_POSITION && !savedProgress?.finished
    ? cachedPosition
    : (episode?.skip_start_seconds || 0);

  return {
    savedProgress,
    resumeAt,
    durationSeconds: Number.isFinite(cachedDuration) && cachedDuration > 0 ? cachedDuration : 0,
  };
}

export function createProgressRegressionGuard(audioUrl, currentPosition, canonicalProgress) {
  const canonicalPosition = Number(canonicalProgress?.position_seconds);
  const safeCurrentPosition = Number.isFinite(currentPosition) && currentPosition >= 0 ? currentPosition : 0;

  if (!audioUrl || !Number.isFinite(canonicalPosition) || canonicalPosition <= safeCurrentPosition) {
    return null;
  }

  return {
    audioUrl,
    position_seconds: Math.trunc(canonicalPosition),
    server_updated_at: canonicalProgress?.server_updated_at,
  };
}

export function shouldBlockProgressSaveForGuard(guard, audioUrl, position) {
  if (!guard || guard.audioUrl !== audioUrl) return false;
  const safePosition = Number.isFinite(position) && position >= 0 ? position : 0;
  return safePosition < Number(guard.position_seconds);
}

export function getProgressHydrationRecoveryDecision(options = {}) {
  const { hydration, scope, userId, hasScheduledRetry = false } = options;
  if (!userId) {
    return { shouldStart: false, reason: 'guest' };
  }

  if (!scope || hydration?.scope !== scope) {
    return { shouldStart: false, reason: 'scope-mismatch' };
  }

  if (hydration?.status === 'hydrating' && hydration?.promise) {
    return { shouldStart: false, reason: 'active-request' };
  }

  if (hasScheduledRetry) {
    return { shouldStart: false, reason: 'scheduled-retry' };
  }

  if (hydration?.status !== 'failed') {
    return { shouldStart: false, reason: 'not-failed' };
  }

  return { shouldStart: true, reason: 'failed' };
}

export function isAuthenticatedProgressSaveReady(userId, hydration, scope, controller = null) {
  return Boolean(
    userId &&
    hydration?.scope === scope &&
    hydration?.status === 'ready' &&
    controller &&
    !controller.cancelled &&
    controller.scope === scope &&
    controller.userId === userId
  );
}

export function getProgressHydrationLifecycleDecision(options = {}) {
  const { currentScope, nextScope, userId, hydration, controller } = options;
  if (!userId) {
    return { action: 'guest' };
  }

  const sameScope = currentScope === nextScope;
  const activeController = Boolean(
    controller &&
    !controller.cancelled &&
    controller.scope === nextScope &&
    controller.userId === userId
  );

  if (!sameScope) {
    return { action: 'start', reason: 'scope-changed' };
  }

  if (activeController) {
    return { action: 'preserve', reason: 'active-controller' };
  }

  return { action: 'start', reason: 'same-scope-without-controller' };
}

export function createProgressHydrationController(options = {}) {
  const {
    scopeKey,
    progressUser,
    controllerRef,
    hydrationRef,
    recoveryRef,
    scopeRef,
    dbUserRef,
    loadProgress,
    retryDelays = [],
    setTimeoutFn = globalThis.setTimeout,
    clearTimeoutFn = globalThis.clearTimeout,
    windowTarget = typeof window !== 'undefined' ? window : null,
    documentTarget = typeof document !== 'undefined' ? document : null,
    getVisibilityState = () => documentTarget?.visibilityState,
    refreshThrottleMs = 100,
    getRecoveryDecision = getProgressHydrationRecoveryDecision,
    onHydrated = () => {},
    onBeforeRefresh = () => null,
    onRefreshed = () => {},
    onSettled = () => {},
    onLoadFailed = () => {},
    onRecoveryStarted = () => {},
    onRefreshStarted = () => {},
  } = options;

  if (!scopeKey || !progressUser?.id || !controllerRef || !hydrationRef || !scopeRef || !loadProgress) {
    return null;
  }

  const currentController = controllerRef.current;
  if (
    currentController &&
    !currentController.cancelled &&
    currentController.scope === scopeKey &&
    currentController.userId === progressUser.id
  ) {
    return currentController;
  }

  currentController?.cleanup?.();

  const controller = {
    scope: scopeKey,
    userId: progressUser.id,
    cancelled: false,
    retryTimer: null,
    refreshTimer: null,
    refreshPromise: null,
    cleanup: null,
    requestRecovery: null,
    requestRefresh: null,
    runHydration: null,
  };
  controllerRef.current = controller;

  const ownsCurrentScope = () =>
    !controller.cancelled &&
    controllerRef.current === controller &&
    scopeRef.current === scopeKey;

  const runHydration = (attempt = 0) => {
    const currentHydration = hydrationRef.current;
    if (
      currentHydration.scope === scopeKey &&
      currentHydration.status === 'hydrating' &&
      currentHydration.promise &&
      controllerRef.current === controller
    ) {
      return currentHydration.promise;
    }

    const hydrationPromise = Promise.resolve()
      .then(() => loadProgress())
      .then(() => {
        if (!ownsCurrentScope()) return;
        hydrationRef.current = { scope: scopeKey, promise: null, status: 'ready' };
        onHydrated(controller);
      })
      .catch((error) => {
        if (!ownsCurrentScope()) return;
        const retryDelay = retryDelays[attempt];
        hydrationRef.current = { scope: scopeKey, promise: null, status: 'failed' };
        onLoadFailed(error, retryDelay !== undefined);

        if (retryDelay === undefined) return;
        controller.retryTimer = setTimeoutFn(() => {
          if (!ownsCurrentScope()) return;
          controller.retryTimer = null;
          runHydration(attempt + 1);
        }, retryDelay);
      })
      .finally(() => {
        if (!ownsCurrentScope()) return;
        onSettled(controller);
      });

    hydrationRef.current = { scope: scopeKey, promise: hydrationPromise, status: 'hydrating' };
    return hydrationPromise;
  };

  const requestRecovery = (reason) => {
    if (
      !ownsCurrentScope() ||
      dbUserRef?.current?.id !== progressUser.id
    ) return;
    const decision = getRecoveryDecision({
      hydration: hydrationRef.current,
      scope: scopeKey,
      userId: progressUser.id,
      hasScheduledRetry: controller.retryTimer !== null,
    });
    if (!decision.shouldStart) return;
    onRecoveryStarted(reason);
    runHydration(0);
  };

  const runRefresh = (reason) => {
    if (
      !ownsCurrentScope() ||
      dbUserRef?.current?.id !== progressUser.id
    ) return null;

    const hydration = hydrationRef.current;
    if (hydration.scope !== scopeKey || hydration.status !== 'ready') return null;
    if (controller.refreshPromise) return controller.refreshPromise;

    const refreshContext = onBeforeRefresh(reason, controller);
    onRefreshStarted(reason, controller);
    controller.refreshPromise = Promise.resolve()
      .then(() => loadProgress())
      .then((records) => {
        if (!ownsCurrentScope() || dbUserRef?.current?.id !== progressUser.id) return;
        onRefreshed(records, refreshContext, reason, controller);
      })
      .catch((error) => {
        if (!ownsCurrentScope()) return;
        onLoadFailed(error, false);
      })
      .finally(() => {
        if (!ownsCurrentScope()) return;
        controller.refreshPromise = null;
        onSettled(controller);
      });

    return controller.refreshPromise;
  };

  const requestRefresh = (reason, options = {}) => {
    if (
      !ownsCurrentScope() ||
      dbUserRef?.current?.id !== progressUser.id
    ) return null;

    if (controller.refreshPromise) return controller.refreshPromise;
    if (options.immediate) {
      clearTimeoutFn(controller.refreshTimer);
      controller.refreshTimer = null;
      return runRefresh(reason);
    }
    if (controller.refreshTimer) return null;

    controller.refreshTimer = setTimeoutFn(() => {
      if (!ownsCurrentScope()) return;
      controller.refreshTimer = null;
      runRefresh(reason);
    }, refreshThrottleMs);
    return null;
  };

  const handleOnline = () => requestRecovery('online');
  const handleVisibilityChange = () => {
    if (getVisibilityState() === 'visible') {
      requestRecovery('visible');
      requestRefresh('visible');
    }
  };
  const handleFocus = () => requestRefresh('focus');

  controller.runHydration = runHydration;
  controller.requestRecovery = requestRecovery;
  controller.requestRefresh = requestRefresh;
  if (recoveryRef) recoveryRef.current = requestRecovery;
  windowTarget?.addEventListener?.('online', handleOnline);
  windowTarget?.addEventListener?.('focus', handleFocus);
  documentTarget?.addEventListener?.('visibilitychange', handleVisibilityChange);

  controller.cleanup = () => {
    const isCurrentOwner = controllerRef.current === controller;
    controller.cancelled = true;
    clearTimeoutFn(controller.retryTimer);
    clearTimeoutFn(controller.refreshTimer);
    windowTarget?.removeEventListener?.('online', handleOnline);
    windowTarget?.removeEventListener?.('focus', handleFocus);
    documentTarget?.removeEventListener?.('visibilitychange', handleVisibilityChange);
    if (isCurrentOwner) {
      controllerRef.current = null;
    }
    if (recoveryRef?.current === requestRecovery) {
      recoveryRef.current = null;
    }
    const hydration = hydrationRef.current;
    if (
      isCurrentOwner &&
      hydration.scope === scopeKey &&
      hydration.status === 'hydrating' &&
      hydration.promise
    ) {
      hydrationRef.current = { scope: scopeKey, promise: null, status: 'failed' };
    }
  };

  runHydration();
  return controller;
}

export function setCachedProgress(audioUrl, position, duration, finished) {
  const cache = readCache();
  const current = cache[audioUrl];
  const safePosition = Number.isFinite(position) && position >= 0 ? Math.floor(position) : 0;
  const safeDuration = Number.isFinite(duration) && duration >= 0 ? Math.floor(duration) : current?.duration_seconds || 0;
  cache[audioUrl] = {
    id: current?.id,
    position_seconds: safePosition,
    duration_seconds: safeDuration,
    finished: Boolean(finished) || (safeDuration > 0 && safePosition / safeDuration >= FINISH_THRESHOLD),
    last_played_at: new Date().toISOString(),
    server_updated_at: current?.server_updated_at,
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
  const validRecords = [];

  for (const record of records) {
    if (!record?.audio_url) continue;
    const normalized = normalizeProgressEntry(record);
    if (!normalized || !isFreshProgress(normalized, now)) continue;

    dbRecordMap[record.audio_url] = record;
    validRecords.push(record);
  }

  if (expectedVersion !== scopeVersion) return {};

  const incomingCache = Object.fromEntries(validRecords.map((record) => [record.audio_url, record]));
  writeCache(mergeProgressCache(cache, incomingCache));
  return dbRecordMap;
}

function safeAudioIdentity(audioUrl) {
  if (!audioUrl || typeof audioUrl !== 'string') return undefined;
  let hash = 0;
  for (let index = 0; index < audioUrl.length; index += 1) {
    hash = ((hash << 5) - hash + audioUrl.charCodeAt(index)) | 0;
  }
  return `audio:${Math.abs(hash).toString(36).slice(0, 8)}`;
}

function reportProgressSyncError(error, context = {}) {
  const now = Date.now();
  if (now - lastDiagnosticAt < DIAGNOSTIC_THROTTLE_MS) return;
  lastDiagnosticAt = now;

  console.warn('[VOXYL] Episode progress sync failed; local progress was kept.', {
    operation: context.operation || 'unknown',
    status: error?.status,
    code: error?.code,
    name: error?.name,
    scopeStatus: context.scopeStatus,
    hydrationReady: context.hydrationReady,
    audio: safeAudioIdentity(context.audioUrl),
  });
}

export async function loadProgressFromDB(voxylApi, userId, diagnostics = {}) {
  const expectedScope = getProgressCacheScope(userId);
  if (!userId || expectedScope !== activeScope) return {};
  const { version } = getActiveProgressScope();
  try {
    const records = asArray(await voxylApi.entities.EpisodeProgress.filter({}, '-last_played_at', 500));
    if (expectedScope !== activeScope) return {};
    return mergeProgressRecords(records, version);
  } catch (error) {
    reportProgressSyncError(error, { ...diagnostics, operation: 'load' });
    throw error;
  }
}

async function saveProgressSnapshot(voxylApi, userId, audioUrl, expectedScope, version, diagnostics = {}) {
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
    base_server_updated_at: cached.server_updated_at,
  };

  const saved = await voxylApi.entities.EpisodeProgress.create(payload);
  if (expectedScope !== activeScope || version !== scopeVersion) return;
  dbRecordMap[audioUrl] = saved;
  mergeProgressRecords([saved], version);
}

export function saveProgressToDB(voxylApi, userId, audioUrl, diagnostics = {}) {
  if (!userId || !audioUrl) return Promise.resolve();

  const expectedScope = getProgressCacheScope(userId);
  if (expectedScope !== activeScope) return Promise.resolve();
  const version = scopeVersion;
  const queueKey = `${expectedScope}:${audioUrl}`;
  const previous = saveQueues.get(queueKey) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => saveProgressSnapshot(voxylApi, userId, audioUrl, expectedScope, version, diagnostics))
    .catch((error) => {
      reportProgressSyncError(error, { ...diagnostics, operation: 'save', audioUrl });
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
