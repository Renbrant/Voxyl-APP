import { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { voxylApi } from '@/api/voxylApiClient';
import { useAuth } from '@/lib/AuthContext';
import { invalidateCache } from '@/lib/appCache';
import {
  getCachedProgress,
  setCachedProgress,
  getAllFinishedFromCache,
  activateProgressCacheScope,
  getEpisodeResumeState,
  getProgressScopeDecision,
  getProgressPlaybackTransition,
  createProgressRegressionGuard,
  shouldBlockProgressSaveForGuard,
  getProgressHydrationLifecycleDecision,
  isAuthenticatedProgressSaveReady,
  shouldRefreshRequireResumeTransition,
  createWebResumeRequestGate,
  isCurrentWebResumeRequest as isCurrentWebResumeRequestDecision,
  createProgressHydrationController,
  loadProgressFromDB,
  saveProgressToDB,
  FINISH_THRESHOLD,
  MIN_SAVE_POSITION,
} from '@/lib/episodeProgressCache';
import {
  beginWebEpisodeSourceSwitch,
  createWebPlaybackTransitionCoordinator,
  createWebResumeTransitionProtection,
  establishWebPlaybackTransition,
  isObsoleteWebPlaybackError,
} from '@/lib/webPlaybackTransition';
import { nativeAudioPlayer, isNative } from '@/lib/nativeAudioPlayer';
import {
  clearPodcastPlayRetryTimer,
  createPodcastPlayRecorder,
  createPodcastPlaySession,
  markPodcastSessionPlaying,
  pausePodcastSession,
} from '@/lib/podcastPlaybackSession';

const PlayerContext = createContext(null);

const LOCAL_SAVE_INTERVAL_MS = 5000;
const DB_SAVE_INTERVAL_MS = 30000;
const LOADING_TIMEOUT_MS = 8000;
const PLAY_RETRY_DELAYS_MS = [0, 750, 2000];
const PROGRESS_HYDRATION_RETRY_DELAYS_MS = [3000, 10000, 30000];

export function PlayerProvider({ children }) {
  const queryClient = useQueryClient();
  const { apiUser, clerkUser, isAuthenticated, isLoadingAuth, authChecked } = useAuth();
  const apiUserId = apiUser?.id || null;
  const clerkUserId = clerkUser?.id || null;
  const [currentEpisode, setCurrentEpisode] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queue, setQueue] = useState([]);
  const [autoplay, setAutoplay] = useState(() => {
    try { const v = localStorage.getItem('voxyl_autoplay'); return v === null ? true : v === 'true'; }
    catch { return true; }
  });
  const [playerMinimized, setPlayerMinimized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [finishedUrls, setFinishedUrls] = useState(new Set());
  const [user, setUser] = useState(null);
  const [episodeSource, setEpisodeSource] = useState(null);

  // ─── Core refs ───────────────────────────────────────────────────────────
  const audioRef = useRef(null);         // HTMLAudioElement — web only
  const volumeRef = useRef(1);
  const queueRef = useRef([]);
  const currentIndexRef = useRef(-1);
  const currentEpisodeRef = useRef(null);
  const autoplayRef = useRef(true);
  const finishedUrlsRef = useRef(new Set());
  const transitioningRef = useRef(false);
  const loadingWatchdogRef = useRef(null);
  const webPlaybackTransitionRef = useRef(createWebPlaybackTransitionCoordinator());

  // ─── Save / progress refs ────────────────────────────────────────────────
  const localSaveTimerRef = useRef(null);
  const dbSaveTimerRef = useRef(null);
  const podcastPlaySessionRef = useRef(null);
  const currentPlaybackSourceRef = useRef(null);
  const userRef = useRef(null);
  const dbProgressUserRef = useRef(null);
  const wakeLockRef = useRef(null);
  const progressScopeRef = useRef(null);
  const progressHydrationRef = useRef({ scope: null, promise: null, status: 'guest' });
  const progressHydrationRecoveryRef = useRef(null);
  const progressHydrationControllerRef = useRef(null);
  const activeProgressRegressionGuardRef = useRef(null);
  const pendingWebSeekRef = useRef(null);
  const isPlayingRef = useRef(false);
  const webResumeRequestGateRef = useRef(createWebResumeRequestGate());

  // ─── Native time/duration state (mirrors nativeAudioPlayer callbacks) ────
  const nativeCurrentTimeRef = useRef(0);
  const nativeDurationRef = useRef(0);

  // ─── Keep refs in sync with state ────────────────────────────────────────
  queueRef.current = queue;
  autoplayRef.current = autoplay;
  finishedUrlsRef.current = finishedUrls;
  isPlayingRef.current = isPlaying;

  // =========================================================================
  // ── SHARED HELPERS ────────────────────────────────────────────────────────
  // =========================================================================

  const canSaveAuthenticatedProgress = useCallback((userId) => {
    return isAuthenticatedProgressSaveReady(
      userId,
      progressHydrationRef.current,
      progressScopeRef.current,
      progressHydrationControllerRef.current
    );
  }, []);

  const waitForAuthenticatedProgressHydration = useCallback(async () => {
    const hydration = progressHydrationRef.current;

    if (!dbProgressUserRef.current || hydration.scope !== progressScopeRef.current) {
      return true;
    }

    if (hydration.status === 'ready') {
      return true;
    }

    if (hydration.status === 'failed') {
      return false;
    }

    if (hydration.promise) {
      await hydration.promise.catch(() => {});
      return progressHydrationRef.current.scope === progressScopeRef.current &&
        progressHydrationRef.current.status === 'ready';
    }

    return false;
  }, []);

  const getActivePlaybackPosition = useCallback(() => {
    const useNative = isNative && nativeAudioPlayer.isReady();
    return useNative ? nativeCurrentTimeRef.current : (audioRef.current?.currentTime || 0);
  }, []);

  const refreshActiveProgressRegressionGuard = useCallback(() => {
    const activeEpisode = currentEpisodeRef.current;
    const currentGuard = activeProgressRegressionGuardRef.current;
    if (!activeEpisode?.audioUrl) {
      activeProgressRegressionGuardRef.current = null;
      return;
    }
    if (currentGuard && currentGuard.audioUrl !== activeEpisode.audioUrl) {
      activeProgressRegressionGuardRef.current = null;
    }

    const nextGuard = createProgressRegressionGuard(
      activeEpisode.audioUrl,
      getActivePlaybackPosition(),
      getCachedProgress(activeEpisode.audioUrl)
    );
    activeProgressRegressionGuardRef.current = nextGuard;
  }, [getActivePlaybackPosition]);

  const captureActiveProgressRefreshContext = useCallback(() => {
    if (isNative) return null;
    const activeEpisode = currentEpisodeRef.current;
    if (!activeEpisode?.audioUrl) return null;

    return {
      audioUrl: activeEpisode.audioUrl,
      before: getCachedProgress(activeEpisode.audioUrl),
      currentPosition: getActivePlaybackPosition(),
      isPlaying: isPlayingRef.current,
    };
  }, [getActivePlaybackPosition]);

  const reconcileActiveProgressRefresh = useCallback((_, context) => {
    if (isNative || !context?.audioUrl) return;
    const activeEpisode = currentEpisodeRef.current;
    if (activeEpisode?.audioUrl !== context.audioUrl) {
      if (pendingWebSeekRef.current?.audioUrl === context.audioUrl) {
        pendingWebSeekRef.current = null;
      }
      return;
    }

    const refreshed = getCachedProgress(context.audioUrl);
    if (shouldRefreshRequireResumeTransition({
      before: context.before,
      after: refreshed,
      currentPosition: getActivePlaybackPosition(),
      isPlaying: context.isPlaying || isPlayingRef.current,
      isWebPlayback: true,
    })) {
      pendingWebSeekRef.current = {
        audioUrl: context.audioUrl,
        position_seconds: refreshed.position_seconds,
        server_updated_at: refreshed.server_updated_at,
        refresh: true,
      };
      refreshActiveProgressRegressionGuard();
    }
  }, [getActivePlaybackPosition, refreshActiveProgressRegressionGuard]);

  const requestProgressHydrationRecovery = useCallback((reason) => {
    if (typeof progressHydrationRecoveryRef.current === 'function') {
      progressHydrationRecoveryRef.current(reason);
    }
  }, []);

  const requestAuthenticatedProgressRefresh = useCallback(async (reason) => {
    if (isNative) return;
    const controller = progressHydrationControllerRef.current;
    if (
      controller?.scope !== progressScopeRef.current ||
      controller?.userId !== dbProgressUserRef.current?.id ||
      typeof controller.requestRefresh !== 'function'
    ) return;

    await controller.requestRefresh(reason, { immediate: true })?.catch?.(() => {});
  }, []);

  const beginWebResumeRequest = useCallback(() => {
    return webResumeRequestGateRef.current.begin();
  }, []);

  const isCurrentWebResumeRequest = useCallback((requestGeneration, audioUrl) => {
    return isCurrentWebResumeRequestDecision({
      gate: webResumeRequestGateRef.current,
      requestGeneration,
      expectedAudioUrl: audioUrl,
      currentAudioUrl: currentEpisodeRef.current?.audioUrl,
      isPlaying: isPlayingRef.current,
    });
  }, []);

  const invalidateWebResumeRequest = useCallback(() => {
    webResumeRequestGateRef.current.invalidate();
  }, []);

  const createProgressDiagnostics = useCallback((audioUrl = null) => {
    const hydration = progressHydrationRef.current;
    return {
      scopeStatus: hydration?.status,
      hydrationReady: hydration?.scope === progressScopeRef.current && hydration?.status === 'ready',
      audioUrl,
    };
  }, []);

  const markFinished = useCallback((audioUrl) => {
    if (!audioUrl) return;
    finishedUrlsRef.current = new Set([...finishedUrlsRef.current, audioUrl]);
    setFinishedUrls(new Set(finishedUrlsRef.current));
    const useNative = isNative && nativeAudioPlayer.isReady();
    const pos = useNative ? nativeCurrentTimeRef.current : (audioRef.current?.currentTime || 0);
    const dur = useNative ? nativeDurationRef.current : (audioRef.current?.duration || 0);
    setCachedProgress(audioUrl, pos, dur, true);
    const u = dbProgressUserRef.current;
    if (u && canSaveAuthenticatedProgress(u.id)) {
      void saveProgressToDB(voxylApi, u.id, audioUrl, createProgressDiagnostics(audioUrl));
    }
  }, [canSaveAuthenticatedProgress, createProgressDiagnostics]);

  const clearPodcastPlayRetry = useCallback((session = podcastPlaySessionRef.current) => {
    clearPodcastPlayRetryTimer(session);
  }, []);

  const pausePodcastPlaySessionTimer = useCallback(() => {
    pausePodcastSession(podcastPlaySessionRef.current);
  }, []);

  const markPodcastPlaySessionPlaying = useCallback(() => {
    markPodcastSessionPlaying(podcastPlaySessionRef.current);
  }, []);

  const startPodcastPlaySession = useCallback((episode, source = currentPlaybackSourceRef.current) => {
    const previousSession = podcastPlaySessionRef.current;
    pausePodcastSession(previousSession);
    clearPodcastPlayRetry(previousSession);
    podcastPlaySessionRef.current = createPodcastPlaySession(episode, source);
  }, [clearPodcastPlayRetry]);

  const podcastPlayRecorderRef = useRef(null);

  const recordPodcastPlay = useCallback((expectedEventId = null) => {
    void podcastPlayRecorderRef.current?.attempt(expectedEventId);
  }, []);

  podcastPlayRecorderRef.current = createPodcastPlayRecorder({
    invoke: (payload) => voxylApi.functions.invoke('recordPodcastPlay', payload),
    getCurrentSession: () => podcastPlaySessionRef.current,
    getCurrentEpisode: () => currentEpisodeRef.current,
    onSuccess: (result) => {
      const u = userRef.current;
      if (u?.id && (result?.data?.recorded || result?.data?.duplicate || result?.recorded)) {
        invalidateCache(`user-podcast-plays-${u.id}`);
        queryClient.invalidateQueries({ queryKey: ['user-podcast-plays', u.id] });
      }
    },
  });

  const saveCurrentProgress = useCallback((forceDB = false, options = {}) => {
    const { recordPlay = true, allowDB = true } = options;
    const ep = currentEpisodeRef.current;
    if (!ep?.audioUrl) return;
    const useNative = isNative && nativeAudioPlayer.isReady();
    const pos = useNative ? nativeCurrentTimeRef.current : (audioRef.current?.currentTime || 0);
    const dur = useNative ? nativeDurationRef.current : (isNaN(audioRef.current?.duration) ? 0 : audioRef.current.duration);
    if (pos < MIN_SAVE_POSITION) return;
    const finished = dur > 0 && pos / dur >= FINISH_THRESHOLD;
    if (shouldBlockProgressSaveForGuard(activeProgressRegressionGuardRef.current, ep.audioUrl, pos)) {
      if (recordPlay) recordPodcastPlay();
      return;
    }
    if (activeProgressRegressionGuardRef.current?.audioUrl === ep.audioUrl) {
      activeProgressRegressionGuardRef.current = null;
    }
    setCachedProgress(ep.audioUrl, pos, dur, finished);
    if (finished) setFinishedUrls(prev => new Set([...prev, ep.audioUrl]));
    if (recordPlay) recordPodcastPlay();
    const u = dbProgressUserRef.current;
    if (forceDB && allowDB && u) {
      if (canSaveAuthenticatedProgress(u.id)) {
        void saveProgressToDB(voxylApi, u.id, ep.audioUrl, createProgressDiagnostics(ep.audioUrl));
      } else {
        requestProgressHydrationRecovery('progress-save');
      }
    }
  }, [canSaveAuthenticatedProgress, createProgressDiagnostics, recordPodcastPlay, requestProgressHydrationRecovery]);

  const stopSaveTimers = useCallback(() => {
    clearInterval(localSaveTimerRef.current);
    clearInterval(dbSaveTimerRef.current);
  }, []);

  const startSaveTimers = useCallback(() => {
    stopSaveTimers();
    localSaveTimerRef.current = setInterval(() => saveCurrentProgress(false), LOCAL_SAVE_INTERVAL_MS);
    dbSaveTimerRef.current = setInterval(() => saveCurrentProgress(true), DB_SAVE_INTERVAL_MS);
  }, [saveCurrentProgress, stopSaveTimers]);

  const clearLoadingState = useCallback(() => {
    clearTimeout(loadingWatchdogRef.current);
    loadingWatchdogRef.current = null;
    setIsLoading(false);
  }, []);

  const clearPlaybackForIdentityChange = useCallback(() => {
    const currentSession = podcastPlaySessionRef.current;
    if (!isNative) invalidateWebResumeRequest();
    webPlaybackTransitionRef.current.cancel();
    if (isNative && nativeAudioPlayer.isReady()) {
      nativeAudioPlayer.clearNativeQueue().catch(() => {});
      nativeAudioPlayer.stop().catch(() => {});
    } else {
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.src = '';
    }

    stopSaveTimers();
    pausePodcastSession(currentSession);
    clearPodcastPlayRetry(currentSession);
    podcastPlaySessionRef.current = null;
    currentEpisodeRef.current = null;
    activeProgressRegressionGuardRef.current = null;
    pendingWebSeekRef.current = null;
    currentIndexRef.current = -1;
    queueRef.current = [];
    nativeCurrentTimeRef.current = 0;
    nativeDurationRef.current = 0;
    transitioningRef.current = false;
    currentPlaybackSourceRef.current = null;
    clearLoadingState();
    setCurrentEpisode(null);
    setQueue([]);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setEpisodeSource(null);
  }, [clearLoadingState, clearPodcastPlayRetry, invalidateWebResumeRequest, stopSaveTimers]);

  const armLoadingWatchdog = useCallback((reason) => {
    clearTimeout(loadingWatchdogRef.current);
    setIsLoading(true);
    loadingWatchdogRef.current = setTimeout(() => {
      const audio = audioRef.current;
      console.error('[PLAYLIST] audio loading timed out', {
        reason,
        episode: currentEpisodeRef.current?.title,
        src: audio?.currentSrc || audio?.src,
        networkState: audio?.networkState,
        readyState: audio?.readyState,
      });
      setIsLoading(false);
      setIsPlaying(false);
      transitioningRef.current = false;
    }, LOADING_TIMEOUT_MS);
  }, []);

  const waitForMediaReady = useCallback((audio, timeoutMs) => new Promise((resolve) => {
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      audio.removeEventListener('canplay', finish);
      audio.removeEventListener('canplaythrough', finish);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    audio.addEventListener('canplay', finish, { once: true });
    audio.addEventListener('canplaythrough', finish, { once: true });
  }), []);

  // ── Web-only: MediaSession metadata ───────────────────────────────────────
  const updateMediaSession = useCallback((episode) => {
    if (isNative || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: episode.title,
      artist: episode.feedTitle || 'Voxyl',
      album: 'Voxyl',
      artwork: episode.image
        ? [
            { src: episode.image, sizes: '96x96',   type: 'image/jpeg' },
            { src: episode.image, sizes: '128x128', type: 'image/jpeg' },
            { src: episode.image, sizes: '256x256', type: 'image/jpeg' },
            { src: episode.image, sizes: '512x512', type: 'image/jpeg' },
          ]
        : [],
    });
  }, []);

  // ── Web Wake Lock ─────────────────────────────────────────────────────────
  const requestWakeLock = useCallback(async () => {
    if (isNative || !('wakeLock' in navigator)) return;
    try {
      if (wakeLockRef.current) return;
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      wakeLockRef.current.addEventListener('release', () => { wakeLockRef.current = null; });
    } catch (_) {}
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      await wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  }, []);

  const cleanupFailedWebTransition = useCallback((transition) => {
    if (isNative || !transition || !webPlaybackTransitionRef.current.isCurrent(transition)) return false;
    webPlaybackTransitionRef.current.cancel(transition);
    stopSaveTimers();
    pausePodcastPlaySessionTimer();
    clearPodcastPlayRetry(podcastPlaySessionRef.current);
    clearLoadingState();
    setIsPlaying(false);
    void releaseWakeLock();
    return true;
  }, [
    clearLoadingState,
    clearPodcastPlayRetry,
    pausePodcastPlaySessionTimer,
    releaseWakeLock,
    stopSaveTimers,
  ]);

  // ── Advance to next episode ───────────────────────────────────────────────
  const advanceToNextEpisodeRef = useRef(null);

  const advanceToNextEpisode = useCallback(async (source = 'UNKNOWN') => {
    const isManualAdvance = source === 'MANUAL NEXT' || source === 'MEDIA SESSION NEXT';
    if (!autoplayRef.current && !isManualAdvance) {
      console.log('[AUDIO_NEXT] autoplay disabled — stopping after current episode');
      if (isNative && nativeAudioPlayer.isReady()) {
        nativeAudioPlayer.clearNativeQueue().catch(() => {});
        nativeAudioPlayer.stop().catch(() => {});
      }
      transitioningRef.current = false;
      return;
    }

    const currentQueue = queueRef.current;
    const nextIdx = currentIndexRef.current + 1;
    const nextEpisode = currentQueue[nextIdx];

    console.log('[AUDIO_NEXT] current episode ended', {
      source,
      title: currentEpisodeRef.current?.title,
      index: currentIndexRef.current,
    });

    if (!nextEpisode) {
      console.log('[AUDIO_NEXT] no next episode available — end of queue');
      webPlaybackTransitionRef.current.cancel();
      if (isNative && nativeAudioPlayer.isReady()) nativeAudioPlayer.stop().catch(() => {});
      transitioningRef.current = false;
      setIsPlaying(false);
      clearLoadingState();
      return;
    }

    console.log('[AUDIO_NEXT] next episode selected', {
      title: nextEpisode.title,
      index: nextIdx,
    });
    console.log('[AUDIO_NEXT] next episode URL', { url: nextEpisode.audioUrl });

    // Save + mark current as finished
    saveCurrentProgress(true);
    stopSaveTimers();
    const prevUrl = currentEpisodeRef.current?.audioUrl;
    if (prevUrl) {
      finishedUrlsRef.current = new Set([...finishedUrlsRef.current, prevUrl]);
      const dur = (isNative && nativeAudioPlayer.isReady()) ? nativeDurationRef.current : (audioRef.current?.duration || 0);
      setCachedProgress(prevUrl, dur, dur, true);
    }

    let webTransition = null;
    try {
      if (isNative && nativeAudioPlayer.isReady()) {
        currentEpisodeRef.current = nextEpisode;
        currentIndexRef.current = nextIdx;
        startPodcastPlaySession(nextEpisode);
        setCurrentEpisode(nextEpisode);
        setCurrentTime(0);
        setDuration(0);
        setFinishedUrls(new Set(finishedUrlsRef.current));
        armLoadingWatchdog(`advance:${source}`);
        await nativeAudioPlayer.updateQueue(currentQueue, nextIdx, autoplayRef.current);
        console.log('[AUDIO_NEXT] next episode load/preload started (native)', { url: nextEpisode.audioUrl });
        await nativeAudioPlayer.play(nextEpisode, nextEpisode.skip_start_seconds || 0);
        // Refresh the native queue so the foreground service can keep advancing
        // past THIS episode while backgrounded.
        nativeAudioPlayer.setNativeQueue(currentQueue, nextIdx, autoplayRef.current).catch(() => {});
        console.log('[AUDIO_NEXT] next episode playback started (native)', { title: nextEpisode.title });
        setIsPlaying(true);
        clearLoadingState();
      } else {
        const audio = audioRef.current;
        if (!audio) throw new Error('Shared audio element is unavailable');

        invalidateWebResumeRequest();
        const startAt = nextEpisode.skip_start_seconds || 0;
        webTransition = beginWebEpisodeSourceSwitch({
          coordinator: webPlaybackTransitionRef.current,
          audio,
          audioUrl: nextEpisode.audioUrl,
          resumeAt: startAt,
          durationSeconds: 0,
          onBeforeSource: () => {
            audio.pause();
            currentEpisodeRef.current = nextEpisode;
            currentIndexRef.current = nextIdx;
            startPodcastPlaySession(nextEpisode);
            setCurrentEpisode(nextEpisode);
            setCurrentTime(startAt);
            setDuration(0);
            setFinishedUrls(new Set(finishedUrlsRef.current));
            armLoadingWatchdog(`advance:${source}`);
          },
        });
        const webSeekProtection = createWebResumeTransitionProtection({
          isWebPlayback: true,
          shouldProtectCanonicalResume: false,
          audioUrl: nextEpisode.audioUrl,
          resumeAt: startAt,
          transitionGeneration: webTransition.generation,
        });
        pendingWebSeekRef.current = webSeekProtection.pendingWebSeek;
        audio.volume = volumeRef.current ?? 1;
        console.log('[PLAYLIST] next URL assigned', {
          title: nextEpisode.title,
          url: nextEpisode.audioUrl,
        });
        console.log('[PLAYLIST] load() called', {
          title: nextEpisode.title,
          url: nextEpisode.audioUrl,
        });

        const establishedPosition = await establishWebPlaybackTransition({
          audio,
          coordinator: webPlaybackTransitionRef.current,
          transition: webTransition,
          transitionLabel: `advance:${source}`,
          resumeAt: startAt,
          retryDelays: PLAY_RETRY_DELAYS_MS,
          waitForMediaReady,
        });
        if (startAt > 0) setCurrentTime(establishedPosition || startAt);
        setIsPlaying(true);
        clearLoadingState();
        if (pendingWebSeekRef.current?.transitionGeneration === webTransition.generation) {
          pendingWebSeekRef.current = null;
        }
        markPodcastPlaySessionPlaying();
        startSaveTimers();
        requestWakeLock();
        updateMediaSession(nextEpisode);
        notifyServiceWorker(nextEpisode, currentQueue);
      }
    } catch (error) {
      if (isObsoleteWebPlaybackError(error)) return;
      console.error('[AUDIO_NEXT] error during auto-next', {
        source,
        title: nextEpisode.title,
        name: error?.name,
        message: error?.message,
      });
      if (!cleanupFailedWebTransition(webTransition)) {
        clearLoadingState();
        setIsPlaying(false);
      }
    } finally {
      transitioningRef.current = false;
    }
  }, [
    armLoadingWatchdog,
    clearLoadingState,
    cleanupFailedWebTransition,
    markPodcastPlaySessionPlaying,
    requestWakeLock,
    invalidateWebResumeRequest,
    saveCurrentProgress,
    startPodcastPlaySession,
    startSaveTimers,
    stopSaveTimers,
    updateMediaSession,
    waitForMediaReady,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  advanceToNextEpisodeRef.current = advanceToNextEpisode;

  const tryAdvance = useCallback((source) => {
    if (!transitioningRef.current) {
      transitioningRef.current = true;
      advanceToNextEpisodeRef.current?.(source);
    }
  }, []);

  // =========================================================================
  // ── NATIVE PLAYER SETUP ───────────────────────────────────────────────────
  // =========================================================================

  useEffect(() => {
    if (!isNative) return;

    nativeAudioPlayer.initialize({
      onTimeUpdate: (posSec, durSec) => {
        nativeCurrentTimeRef.current = posSec;
        if (durSec > 0) nativeDurationRef.current = durSec;
        setCurrentTime(posSec);
        if (durSec > 0) setDuration(durSec);

        // skip_end_seconds support
        const ep = currentEpisodeRef.current;
        const skipEnd = ep?.skip_end_seconds || 0;
        if (skipEnd > 0 && durSec > 0) {
          const stopAt = durSec - skipEnd;
          if (posSec >= stopAt) tryAdvance('NATIVE SKIP_END');
        }
      },
      onEnded: () => {
        console.log('[AUDIO_NEXT] native complete event received (JS path)');
        tryAdvance('NATIVE ENDED');
      },
      // Fired when the NATIVE foreground service auto-advanced on its own while
      // backgrounded. Sync UI/index to reality — do NOT call play() again.
      onStateChange: (playing) => {
        setIsPlaying(playing);
        if (playing) { markPodcastPlaySessionPlaying(); startSaveTimers(); }
        else { pausePodcastPlaySessionTimer(); stopSaveTimers(); saveCurrentProgress(true); }
      },
      onNativeTrackChanged: (track = {}) => {
        const url = track?.url || track?.audioUrl;
        const index = Number.isInteger(track?.index) ? track.index : queueRef.current.findIndex(e => e.audioUrl === url);
        const nextEpisode = index >= 0 ? queueRef.current[index] : queueRef.current.find(e => e.audioUrl === url);
        if (!nextEpisode) return;

        console.log('[AUDIO_NEXT] syncing JS state to natively-advanced track', { url, index });
        const prevUrl = currentEpisodeRef.current?.audioUrl;
        if (prevUrl && prevUrl !== url) {
          finishedUrlsRef.current = new Set([...finishedUrlsRef.current, prevUrl]);
          setFinishedUrls(new Set(finishedUrlsRef.current));
        }

        currentEpisodeRef.current = nextEpisode;
        currentIndexRef.current = index;
        startPodcastPlaySession(nextEpisode);
        setCurrentEpisode(nextEpisode);
        setCurrentTime(0);
        setDuration(0);
        nativeCurrentTimeRef.current = 0;
        nativeDurationRef.current = 0;
        setIsPlaying(true);
        clearLoadingState();
      },
      onPlaybackError: (error) => {
        console.error('[AUDIO_NEXT] native playback error', error);
        pausePodcastPlaySessionTimer();
        clearLoadingState();
        setIsPlaying(false);
        transitioningRef.current = false;
      },
      onQueueCompleted: () => {
        pausePodcastPlaySessionTimer();
        clearLoadingState();
        setIsPlaying(false);
        transitioningRef.current = false;
      },
    });

    return () => {
      nativeAudioPlayer.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // =========================================================================
  // ── WEB AUDIO ELEMENT SETUP ───────────────────────────────────────────────
  // =========================================================================

  // ── Global unhandled promise rejection logger ─────────────────────────────
  useEffect(() => {
    const handler = (event) => {
      console.error('[VOXYL] Unhandled Promise rejection:',
        'name:', event.reason?.name,
        'message:', event.reason?.message,
        event.reason
      );
    };
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, []);

  useEffect(() => {
    if (isNative) return;

    const audio = new Audio();
    audio.preload = 'auto';
    // Do NOT set crossOrigin = 'anonymous' — many podcast CDNs reject CORS preflight
    // and the audio element works fine without it for playback.
    audioRef.current = audio;

    // ── Audio error diagnostics ───────────────────────────────────────────
    audio.addEventListener('error', () => {
      if (webPlaybackTransitionRef.current.shouldIgnoreEvent('error', audio)) return;
      console.error('[PLAYLIST] audio error', {
        code: audio.error?.code,
        message: audio.error?.message,
        src: audio.currentSrc || audio.src,
        networkState: audio.networkState,
        readyState: audio.readyState,
      });
      pausePodcastPlaySessionTimer();
      clearLoadingState();
      setIsPlaying(false);
      transitioningRef.current = false;
    });

    audio.addEventListener('timeupdate', () => {
      if (webPlaybackTransitionRef.current.shouldIgnoreEvent('timeupdate', audio)) return;
      setCurrentTime(audio.currentTime);
      const ep = currentEpisodeRef.current;
      const skipEnd = ep?.skip_end_seconds || 0;
      if (skipEnd > 0 && audio.duration && !isNaN(audio.duration)) {
        if (audio.currentTime >= audio.duration - skipEnd) {
          tryAdvance('SKIP_END');
        }
      }
    });

    audio.addEventListener('durationchange', () => {
      if (webPlaybackTransitionRef.current.shouldIgnoreEvent('durationchange', audio)) return;
      setDuration(isNaN(audio.duration) ? 0 : audio.duration);
    });

    audio.addEventListener('stalled', () => {
      if (webPlaybackTransitionRef.current.shouldIgnoreEvent('stalled', audio)) return;
      console.warn('[PLAYLIST] audio stalled', {
        title: currentEpisodeRef.current?.title,
        src: audio.currentSrc || audio.src,
      });
      pausePodcastPlaySessionTimer();
      armLoadingWatchdog('stalled');
    });

    audio.addEventListener('waiting', () => {
      if (webPlaybackTransitionRef.current.shouldIgnoreEvent('waiting', audio)) return;
      console.warn('[PLAYLIST] audio waiting', {
        title: currentEpisodeRef.current?.title,
        src: audio.currentSrc || audio.src,
      });
      pausePodcastPlaySessionTimer();
      armLoadingWatchdog('waiting');
    });

    audio.addEventListener('canplay', () => {
      if (webPlaybackTransitionRef.current.shouldIgnoreEvent('canplay', audio)) return;
      clearLoadingState();
    });
    audio.addEventListener('canplaythrough', () => {
      if (webPlaybackTransitionRef.current.shouldIgnoreEvent('canplaythrough', audio)) return;
      clearLoadingState();
    });

    audio.addEventListener('playing', () => {
      if (webPlaybackTransitionRef.current.shouldIgnoreEvent('playing', audio)) return;
      invalidateWebResumeRequest();
      console.log('[PLAYLIST] audio playing', {
        title: currentEpisodeRef.current?.title,
        src: audio.currentSrc || audio.src,
      });
      clearLoadingState();
      setIsPlaying(true);
      markPodcastPlaySessionPlaying();
      startSaveTimers();
      requestWakeLock();
    });

    audio.addEventListener('pause', () => {
      if (webPlaybackTransitionRef.current.shouldIgnoreEvent('pause', audio)) return;
      console.log('[PLAYLIST] audio paused', {
        title: currentEpisodeRef.current?.title,
        ended: audio.ended,
      });
      pausePodcastPlaySessionTimer();
      stopSaveTimers();
      saveCurrentProgress(true);
      releaseWakeLock();
    });

    audio.addEventListener('ended', () => {
      if (webPlaybackTransitionRef.current.shouldIgnoreEvent('ended', audio)) return;
      console.log('[PLAYLIST] ended fired', {
        source: 'web',
        title: currentEpisodeRef.current?.title,
        src: audio.currentSrc || audio.src,
      });
      tryAdvance('AUDIO ENDED');
    });

    return () => {
      invalidateWebResumeRequest();
      webPlaybackTransitionRef.current.cancel();
      audio.pause();
      audio.src = '';
      stopSaveTimers();
      pausePodcastPlaySessionTimer();
      clearPodcastPlayRetry(podcastPlaySessionRef.current);
      pendingWebSeekRef.current = null;
      clearTimeout(loadingWatchdogRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Web MediaSession action handlers ─────────────────────────────────────
  useEffect(() => {
    if (isNative || !('mediaSession' in navigator)) return;
    const audio = audioRef.current;
    navigator.mediaSession.setActionHandler('play',          () => { audio?.play().then(() => setIsPlaying(true)).catch(() => {}); });
    navigator.mediaSession.setActionHandler('pause',         () => { audio?.pause(); setIsPlaying(false); });
    navigator.mediaSession.setActionHandler('previoustrack', () => playPrevRef.current?.());
    navigator.mediaSession.setActionHandler('nexttrack',     () => tryAdvance('MEDIA SESSION NEXT'));
    navigator.mediaSession.setActionHandler('seekbackward',  (d) => { if (audio) audio.currentTime = Math.max(0, audio.currentTime - (d?.seekOffset ?? 15)); });
    navigator.mediaSession.setActionHandler('seekforward',   (d) => { if (audio) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d?.seekOffset ?? 30)); });
    navigator.mediaSession.setActionHandler('seekto',        (d) => { if (audio && d.seekTime != null) audio.currentTime = d.seekTime; });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lock screen scrubber (web) ────────────────────────────────────────────
  useEffect(() => {
    if (isNative || !('mediaSession' in navigator) || !duration) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: audioRef.current?.playbackRate ?? 1,
        position: currentTime,
      });
    } catch (_) {}
  }, [currentTime, duration]);

  // ── Service Worker helpers (web) ──────────────────────────────────────────
  const notifyServiceWorker = (episode, q) => {
    if (isNative || !('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage({
      type: 'UPDATE_EPISODE',
      payload: { ...episode, queue: q, autoplay: autoplayRef.current },
    });
  };

  const startProgressHydrationController = useCallback((scopeKey, progressUser) => {
    return createProgressHydrationController({
      scopeKey,
      progressUser,
      controllerRef: progressHydrationControllerRef,
      hydrationRef: progressHydrationRef,
      recoveryRef: progressHydrationRecoveryRef,
      scopeRef: progressScopeRef,
      dbUserRef: dbProgressUserRef,
      retryDelays: PROGRESS_HYDRATION_RETRY_DELAYS_MS,
      loadProgress: () => loadProgressFromDB(voxylApi, progressUser.id, createProgressDiagnostics()),
      onBeforeRefresh: captureActiveProgressRefreshContext,
      onRefreshed: reconcileActiveProgressRefresh,
      onHydrated: refreshActiveProgressRegressionGuard,
      onSettled: () => {
        const cached = getAllFinishedFromCache();
        setFinishedUrls(cached);
        finishedUrlsRef.current = cached;
      },
    });
  }, [
    captureActiveProgressRefreshContext,
    createProgressDiagnostics,
    reconcileActiveProgressRefresh,
    refreshActiveProgressRegressionGuard,
  ]);

  // =========================================================================
  // ── MOUNT: user, SW, progress ────────────────────────────────────────────
  // =========================================================================

  // ── Android WebView audio unlock on first user gesture ───────────────────
  // WebView requires a user gesture before any audio plays. This silently
  // unlocks the audio context on the first tap anywhere in the app.
  useEffect(() => {
    if (isNative) return;
    let unlocked = false;
    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      const silent = new Audio();
      silent.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
      silent.volume = 0;
      silent.play().then(() => {
        console.log('[AUDIO UNLOCK] Web audio unlocked on first gesture');
      }).catch(() => {});
      document.removeEventListener('touchstart', unlock, true);
      document.removeEventListener('click', unlock, true);
    };
    document.addEventListener('touchstart', unlock, true);
    document.addEventListener('click', unlock, true);
    return () => {
      document.removeEventListener('touchstart', unlock, true);
      document.removeEventListener('click', unlock, true);
    };
  }, []);

  useEffect(() => {
    const decision = getProgressScopeDecision({ apiUser: apiUserId ? { id: apiUserId } : null, clerkUserId, isAuthenticated, isLoadingAuth, authChecked });
    const transition = getProgressPlaybackTransition(progressScopeRef.current, decision);

    if (decision.status === 'loading') {
      progressHydrationControllerRef.current?.cleanup?.();
      progressHydrationRef.current = { scope: progressScopeRef.current, promise: null, status: 'loading' };
      if (progressScopeRef.current && currentEpisodeRef.current) {
        saveCurrentProgress(false, { recordPlay: false, allowDB: false });
        clearPlaybackForIdentityChange();
      } else {
        stopSaveTimers();
      }
      setUser(null);
      userRef.current = null;
      dbProgressUserRef.current = null;
      progressHydrationRecoveryRef.current = null;
      return;
    }

    const previousScopeKey = progressScopeRef.current;
    const nextScopeKey = transition.nextScope;
    const nextProgressUser = decision.status === 'confirmed' && decision.userId ? { id: decision.userId } : null;

    if (progressScopeRef.current === nextScopeKey) {
      dbProgressUserRef.current = nextProgressUser;
      if (!nextProgressUser?.id) {
        setUser(null);
        userRef.current = null;
        progressHydrationRef.current = { scope: nextScopeKey, promise: null, status: 'guest' };
        progressHydrationControllerRef.current?.cleanup?.();
        progressHydrationRecoveryRef.current = null;
        return;
      }

      const lifecycle = getProgressHydrationLifecycleDecision({
        currentScope: progressScopeRef.current,
        nextScope: nextScopeKey,
        userId: nextProgressUser.id,
        hydration: progressHydrationRef.current,
        controller: progressHydrationControllerRef.current,
      });
      if (lifecycle.action === 'start') {
        startProgressHydrationController(nextScopeKey, nextProgressUser);
      }
      return;
    }

    progressHydrationControllerRef.current?.cleanup?.();

    if (previousScopeKey) {
      saveCurrentProgress(false, { recordPlay: false, allowDB: false });
      stopSaveTimers();
    }

    if (transition.shouldClearPlayback && currentEpisodeRef.current) {
      clearPlaybackForIdentityChange();
    }

    progressScopeRef.current = nextScopeKey;
    dbProgressUserRef.current = nextProgressUser;
    progressHydrationRef.current = nextProgressUser?.id
      ? { scope: nextScopeKey, promise: null, status: 'hydrating' }
      : { scope: nextScopeKey, promise: null, status: 'guest' };
    activateProgressCacheScope(decision.userId, {
      migrateLegacy: decision.migrateLegacy,
      mergeCurrentCache: transition.mergeCurrentCache,
    });
    let cached = getAllFinishedFromCache();
    setFinishedUrls(cached);
    finishedUrlsRef.current = cached;

    if (decision.status !== 'confirmed' || !nextProgressUser?.id) {
      progressHydrationRecoveryRef.current = null;
      return;
    }

    startProgressHydrationController(nextScopeKey, nextProgressUser);
  }, [
    apiUserId,
    clerkUserId,
    isAuthenticated,
    isLoadingAuth,
    authChecked,
    clearPlaybackForIdentityChange,
    saveCurrentProgress,
    startProgressHydrationController,
    stopSaveTimers,
  ]);

  useEffect(() => {
    return () => {
      progressHydrationControllerRef.current?.cleanup?.();
    };
  }, []);

  useEffect(() => {
    const decision = getProgressScopeDecision({ apiUser, clerkUser, isAuthenticated, isLoadingAuth, authChecked });
    const nextUser = decision.status === 'confirmed' && decision.userId ? apiUser : null;
    setUser(nextUser);
    userRef.current = nextUser;
  }, [apiUser, clerkUser, isAuthenticated, isLoadingAuth, authChecked]);

  useEffect(() => {

    if (!isNative && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data.type === 'PLAY') {
          audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
        } else if (event.data.type === 'PAUSE') {
          audioRef.current?.pause();
          setIsPlaying(false);
        }
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync finished URLs to SW ──────────────────────────────────────────────
  useEffect(() => {
    if (isNative || !('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage({
      type: 'UPDATE_FINISHED_URLS',
      payload: Array.from(finishedUrls),
    });
  }, [finishedUrls]);

  // ── Persist autoplay + notify SW ─────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem('voxyl_autoplay', String(autoplay)); } catch {}
    // Keep native foreground-service queue in sync with autoplay preference so it
    // only auto-advances natively when autoplay is on.
    if (isNative && nativeAudioPlayer.isReady()) {
      if (autoplay) {
        nativeAudioPlayer.setNativeQueue(queueRef.current, Math.max(0, currentIndexRef.current), true).catch(() => {});
      } else {
        nativeAudioPlayer.clearNativeQueue().catch(() => {});
      }
    }
    if (!isNative && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SET_AUTOPLAY',
        payload: { autoplay },
      });
    }
  }, [autoplay]);

  // =========================================================================
  // ── PLAYBACK API ──────────────────────────────────────────────────────────
  // =========================================================================

  const playEpisodeInternal = useCallback(async (episode, q, skipResume = false) => {
    if (!isNative) invalidateWebResumeRequest();
    transitioningRef.current = false;
    saveCurrentProgress(true);
    stopSaveTimers();
    pausePodcastPlaySessionTimer();

    const hydrationReady = await waitForAuthenticatedProgressHydration();
    if (!hydrationReady) {
      requestProgressHydrationRecovery('playback-request');
    }
    const { savedProgress, resumeAt, durationSeconds } = getEpisodeResumeState(episode, skipResume);
    const canonicalResumePosition = Number(savedProgress?.position_seconds);
    const shouldProtectResumeSeek = Boolean(
      !skipResume &&
      savedProgress &&
      Number.isFinite(canonicalResumePosition) &&
      canonicalResumePosition > MIN_SAVE_POSITION &&
      canonicalResumePosition === resumeAt
    );

    armLoadingWatchdog('manual-play');
    setCurrentTime(resumeAt);
    setDuration(durationSeconds);
    setCurrentEpisode(episode);
    currentEpisodeRef.current = episode;
    activeProgressRegressionGuardRef.current = dbProgressUserRef.current && !hydrationReady
      ? { audioUrl: episode.audioUrl, pendingHydration: true }
      : null;
    startPodcastPlaySession(episode);

    const idx = q.findIndex(e => e.audioUrl === episode.audioUrl);
    currentIndexRef.current = idx;

    if (isNative && !nativeAudioPlayer.isReady()) {
      await nativeAudioPlayer.waitUntilReady();
    }
    const pluginReady = isNative && nativeAudioPlayer.isReady();
    console.log('[PlayerContext] playEpisodeInternal — isNative:', isNative, 'pluginReady:', pluginReady, 'url:', episode.audioUrl);

    if (pluginReady) {
      try {
        await nativeAudioPlayer.updateQueue(q, idx, autoplayRef.current);
        await nativeAudioPlayer.play(episode, resumeAt);
        // Hand the full upcoming queue to the native foreground service so it can
        // auto-advance natively (survives Doze / locked screen).
        nativeAudioPlayer.setNativeQueue(q, idx >= 0 ? idx : 0, autoplayRef.current).catch(() => {});
        const dur = nativeAudioPlayer.getDuration();
        if (dur > 0) { setDuration(dur); nativeDurationRef.current = dur; }
        setCurrentTime(resumeAt);
        nativeCurrentTimeRef.current = resumeAt;
        setIsPlaying(true);
        clearLoadingState();
      } catch (error) {
        console.error('[PLAYLIST] native play failed', {
          title: episode.title,
          name: error?.name,
          message: error?.message,
        });
        clearLoadingState();
        setIsPlaying(false);
      }
    } else {
      if (isNative) {
        console.error('[PLAYLIST] native audio plugin did not initialize');
        clearLoadingState();
        setIsPlaying(false);
        return;
      }

      const audio = audioRef.current;
      if (!audio) {
        clearLoadingState();
        setIsPlaying(false);
        console.error('[PLAYLIST] shared audio element unavailable');
        return;
      }
      const transition = beginWebEpisodeSourceSwitch({
        coordinator: webPlaybackTransitionRef.current,
        audio,
        audioUrl: episode.audioUrl,
        resumeAt,
        durationSeconds,
      });
      const webSeekProtection = createWebResumeTransitionProtection({
        isWebPlayback: true,
        shouldProtectCanonicalResume: shouldProtectResumeSeek,
        audioUrl: episode.audioUrl,
        resumeAt,
        transitionGeneration: transition.generation,
      });
      pendingWebSeekRef.current = webSeekProtection.pendingWebSeek;
      if (webSeekProtection.progressRegressionGuard) {
        activeProgressRegressionGuardRef.current = webSeekProtection.progressRegressionGuard;
      } else if (activeProgressRegressionGuardRef.current?.audioUrl === episode.audioUrl) {
        activeProgressRegressionGuardRef.current = {
          ...activeProgressRegressionGuardRef.current,
          transitionGeneration: transition.generation,
        };
      }
      audio.volume = volumeRef.current ?? 1;
      console.log('[PLAYLIST] next URL assigned', {
        title: episode.title,
        url: episode.audioUrl,
      });
      console.log('[PLAYLIST] load() called', {
        title: episode.title,
        url: episode.audioUrl,
      });

      try {
        const establishedPosition = await establishWebPlaybackTransition({
          audio,
          coordinator: webPlaybackTransitionRef.current,
          transition,
          transitionLabel: 'manual-play',
          resumeAt,
          retryDelays: PLAY_RETRY_DELAYS_MS,
          waitForMediaReady,
        });
        if (resumeAt > 0) setCurrentTime(establishedPosition || resumeAt);
        setIsPlaying(true);
        clearLoadingState();
        if (activeProgressRegressionGuardRef.current?.transitionGeneration === transition.generation) {
          activeProgressRegressionGuardRef.current = null;
        }
        if (pendingWebSeekRef.current?.transitionGeneration === transition.generation) {
          pendingWebSeekRef.current = null;
        }
        markPodcastPlaySessionPlaying();
        startSaveTimers();
        requestWakeLock();
      } catch (error) {
        if (isObsoleteWebPlaybackError(error)) return;
        console.error('[PLAYLIST] manual play failed', {
          title: episode.title,
          name: error?.name,
          message: error?.message,
        });
        if (!cleanupFailedWebTransition(transition)) {
          clearLoadingState();
          setIsPlaying(false);
        }
      }

      if (!webPlaybackTransitionRef.current.isCurrent(transition)) return;
      updateMediaSession(episode);
      notifyServiceWorker(episode, q);
    }
  }, [
    armLoadingWatchdog,
    clearLoadingState,
    cleanupFailedWebTransition,
    markPodcastPlaySessionPlaying,
    pausePodcastPlaySessionTimer,
    requestWakeLock,
    saveCurrentProgress,
    startPodcastPlaySession,
    stopSaveTimers,
    updateMediaSession,
    invalidateWebResumeRequest,
    requestProgressHydrationRecovery,
    waitForAuthenticatedProgressHydration,
    waitForMediaReady,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback(async (episode, newQueue = [], source = null) => {
    const updatedQueue = newQueue.length > 0 ? newQueue : queueRef.current;
    if (newQueue.length > 0) { queueRef.current = newQueue; setQueue(newQueue); }
    const nextSource = source ?? null;
    currentPlaybackSourceRef.current = nextSource;
    setEpisodeSource(nextSource);

    if (currentEpisodeRef.current?.audioUrl === episode.audioUrl) {
      // Resume same episode
      if (isNative && nativeAudioPlayer.isReady()) nativeAudioPlayer.resume();
      else {
        const requestGeneration = beginWebResumeRequest();
        await requestAuthenticatedProgressRefresh('playback-resume');
        if (!isCurrentWebResumeRequest(requestGeneration, episode.audioUrl)) return;
        const activeTransition = webPlaybackTransitionRef.current.getCurrent();
        const pendingSeekGuard = activeProgressRegressionGuardRef.current;
        const pendingWebSeek = pendingWebSeekRef.current;
        if (
          (
            activeTransition?.audioUrl === episode.audioUrl &&
            webPlaybackTransitionRef.current.getPhase(activeTransition) === 'switching'
          ) ||
          (
            pendingSeekGuard?.audioUrl === episode.audioUrl &&
            pendingSeekGuard?.pendingSeek
          ) ||
          (
            pendingWebSeek?.audioUrl === episode.audioUrl
          )
        ) {
          playEpisodeInternal(episode, updatedQueue);
          return;
        }
        audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
      }
      return;
    }

    playEpisodeInternal(episode, updatedQueue);
  }, [
    beginWebResumeRequest,
    isCurrentWebResumeRequest,
    playEpisodeInternal,
    requestAuthenticatedProgressRefresh,
  ]);

  const togglePlay = useCallback(async () => {
    if (isNative && nativeAudioPlayer.isReady()) {
      // Let onStateChange (fired by native) be the source of truth for isPlaying.
      // We optimistically update UI immediately, but native corrects it if needed.
      if (isPlaying) {
        setIsPlaying(false);
        nativeAudioPlayer.pause();
      } else {
        setIsPlaying(true);
        nativeAudioPlayer.resume();
      }
    } else {
      const audio = audioRef.current;
      if (!audio) return;
      if (isPlaying) { audio.pause(); setIsPlaying(false); }
      else {
        const requestGeneration = beginWebResumeRequest();
        const activeEpisode = currentEpisodeRef.current;
        const activeTransition = webPlaybackTransitionRef.current.getCurrent();
        const pendingSeekGuard = activeProgressRegressionGuardRef.current;
        const pendingWebSeek = pendingWebSeekRef.current;
        if (
          activeEpisode?.audioUrl &&
          (
            (
              activeTransition?.audioUrl === activeEpisode.audioUrl &&
              webPlaybackTransitionRef.current.getPhase(activeTransition) === 'switching'
            ) ||
            (
              pendingSeekGuard?.audioUrl === activeEpisode.audioUrl &&
              pendingSeekGuard?.pendingSeek
            ) ||
            (
              pendingWebSeek?.audioUrl === activeEpisode.audioUrl
            )
          )
        ) {
          playEpisodeInternal(activeEpisode, queueRef.current);
          return;
        }
        await requestAuthenticatedProgressRefresh('toggle-resume');
        if (!activeEpisode?.audioUrl || !isCurrentWebResumeRequest(requestGeneration, activeEpisode.audioUrl)) return;
        const refreshedPendingWebSeek = pendingWebSeekRef.current;
        if (activeEpisode?.audioUrl && refreshedPendingWebSeek?.audioUrl === activeEpisode.audioUrl) {
          playEpisodeInternal(activeEpisode, queueRef.current);
          return;
        }
        console.log('[WEB AUDIO] togglePlay — play() call',
          'src:', audio.src, 'readyState:', audio.readyState);
        audio.play().then(() => setIsPlaying(true)).catch(e =>
          console.error('[WEB AUDIO] togglePlay play() rejected —', 'name:', e?.name, 'message:', e?.message)
        );
      }
    }
  }, [
    beginWebResumeRequest,
    isCurrentWebResumeRequest,
    isPlaying,
    playEpisodeInternal,
    requestAuthenticatedProgressRefresh,
  ]);

  const seek = useCallback((time) => {
    if (isNative && nativeAudioPlayer.isReady()) {
      nativeAudioPlayer.seek(time);
      nativeCurrentTimeRef.current = time;
      setCurrentTime(time);
    } else {
      if (audioRef.current) audioRef.current.currentTime = time;
    }
  }, []);

  const playNext = useCallback(() => {
    if (isNative && nativeAudioPlayer.isReady()) {
      nativeAudioPlayer.playNext().catch(() => tryAdvance('MANUAL NEXT'));
      return;
    }
    tryAdvance('MANUAL NEXT');
  }, [tryAdvance]);

  const playPrevRef = useRef(null);
  const playPrev = useCallback(() => {
    const idx = currentIndexRef.current;
    const q = queueRef.current;
    if (idx <= 0) return;
    if (isNative && nativeAudioPlayer.isReady()) {
      nativeAudioPlayer.playPrevious().catch(() => playEpisodeInternal(q[idx - 1], q));
      return;
    }
    playEpisodeInternal(q[idx - 1], q);
  }, [playEpisodeInternal]);
  playPrevRef.current = playPrev;

  // =========================================================================

  return (
    <PlayerContext.Provider value={{
      currentEpisode, isPlaying, isLoading, currentTime, duration,
      queue, play, togglePlay, seek, playNext, playPrev,
      autoplay, setAutoplay,
      playerMinimized, setPlayerMinimized,
      finishedUrls, setFinishedUrls, markFinished,
      getCachedProgress,
      episodeSource, setEpisodeSource,
    }}>
      {children}
    </PlayerContext.Provider>
  );
}

export const usePlayer = () => useContext(PlayerContext);
