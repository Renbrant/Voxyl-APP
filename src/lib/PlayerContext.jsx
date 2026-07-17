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
  getProgressHydrationRecoveryDecision,
  loadProgressFromDB,
  saveProgressToDB,
  FINISH_THRESHOLD,
  MIN_SAVE_POSITION,
} from '@/lib/episodeProgressCache';
import {
  beginWebEpisodeSourceSwitch,
  createWebPlaybackTransitionCoordinator,
  isObsoleteWebPlaybackError,
  requestGuardedWebPlayback,
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
  const activeProgressRegressionGuardRef = useRef(null);

  // ─── Native time/duration state (mirrors nativeAudioPlayer callbacks) ────
  const nativeCurrentTimeRef = useRef(0);
  const nativeDurationRef = useRef(0);

  // ─── Keep refs in sync with state ────────────────────────────────────────
  queueRef.current = queue;
  autoplayRef.current = autoplay;
  finishedUrlsRef.current = finishedUrls;

  // =========================================================================
  // ── SHARED HELPERS ────────────────────────────────────────────────────────
  // =========================================================================

  const canSaveAuthenticatedProgress = useCallback((userId) => {
    const hydration = progressHydrationRef.current;
    return Boolean(
      userId &&
      hydration.scope === progressScopeRef.current &&
      hydration.status === 'ready'
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
    if (!activeEpisode?.audioUrl || currentGuard?.audioUrl !== activeEpisode.audioUrl) {
      activeProgressRegressionGuardRef.current = null;
      return;
    }

    const nextGuard = createProgressRegressionGuard(
      activeEpisode.audioUrl,
      getActivePlaybackPosition(),
      getCachedProgress(activeEpisode.audioUrl)
    );
    activeProgressRegressionGuardRef.current = nextGuard;
  }, [getActivePlaybackPosition]);

  const requestProgressHydrationRecovery = useCallback((reason) => {
    if (typeof progressHydrationRecoveryRef.current === 'function') {
      progressHydrationRecoveryRef.current(reason);
    }
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
      void saveProgressToDB(voxylApi, u.id, audioUrl);
    }
  }, [canSaveAuthenticatedProgress]);

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
        void saveProgressToDB(voxylApi, u.id, ep.audioUrl);
      } else {
        requestProgressHydrationRecovery('progress-save');
      }
    }
  }, [canSaveAuthenticatedProgress, recordPodcastPlay, requestProgressHydrationRecovery]);

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
  }, [clearLoadingState, clearPodcastPlayRetry, stopSaveTimers]);

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

  const requestWebPlayback = useCallback((audio, transitionLabel, transition) =>
    requestGuardedWebPlayback({
      audio,
      transitionLabel,
      retryDelays: PLAY_RETRY_DELAYS_MS,
      waitForMediaReady,
      isCurrent: () => !transition || webPlaybackTransitionRef.current.isCurrent(transition),
    }), [waitForMediaReady]);

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
        audio.volume = volumeRef.current ?? 1;
        console.log('[PLAYLIST] next URL assigned', {
          title: nextEpisode.title,
          url: nextEpisode.audioUrl,
        });
        console.log('[PLAYLIST] load() called', {
          title: nextEpisode.title,
          url: nextEpisode.audioUrl,
        });

        if (startAt > 0) {
          await waitForMediaReady(audio, 2000);
          webPlaybackTransitionRef.current.assertCurrent(webTransition);
          audio.currentTime = startAt;
        }

        webPlaybackTransitionRef.current.assertCurrent(webTransition);
        await requestWebPlayback(audio, `advance:${source}`, webTransition);
        webPlaybackTransitionRef.current.assertCurrent(webTransition);
        webPlaybackTransitionRef.current.markEstablished(webTransition);
        setIsPlaying(true);
        clearLoadingState();
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
    requestWebPlayback,
    requestWakeLock,
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
      webPlaybackTransitionRef.current.cancel();
      audio.pause();
      audio.src = '';
      stopSaveTimers();
      pausePodcastPlaySessionTimer();
      clearPodcastPlayRetry(podcastPlaySessionRef.current);
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
    const decision = getProgressScopeDecision({ apiUser, clerkUser, isAuthenticated, isLoadingAuth, authChecked });
    const transition = getProgressPlaybackTransition(progressScopeRef.current, decision);

    if (decision.status === 'loading') {
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
    if (progressScopeRef.current === nextScopeKey) {
      if (decision.status === 'confirmed') {
        const nextUser = decision.userId ? apiUser : null;
        setUser(nextUser);
        userRef.current = nextUser;
        dbProgressUserRef.current = nextUser;
        if (!nextUser?.id) {
          progressHydrationRef.current = { scope: nextScopeKey, promise: null, status: 'guest' };
        }
      } else {
        setUser(null);
        userRef.current = null;
        dbProgressUserRef.current = null;
        progressHydrationRef.current = { scope: nextScopeKey, promise: null, status: 'guest' };
        progressHydrationRecoveryRef.current = null;
      }
      return;
    }

    if (previousScopeKey) {
      saveCurrentProgress(false, { recordPlay: false, allowDB: false });
      stopSaveTimers();
    }

    if (transition.shouldClearPlayback && currentEpisodeRef.current) {
      clearPlaybackForIdentityChange();
    }

    progressScopeRef.current = nextScopeKey;
    const nextUser = decision.status === 'confirmed' && decision.userId ? apiUser : null;
    setUser(nextUser);
    userRef.current = nextUser;
    dbProgressUserRef.current = decision.status === 'confirmed' ? nextUser : null;
    progressHydrationRef.current = nextUser?.id
      ? { scope: nextScopeKey, promise: null, status: 'hydrating' }
      : { scope: nextScopeKey, promise: null, status: 'guest' };
    activateProgressCacheScope(decision.userId, {
      migrateLegacy: decision.migrateLegacy,
      mergeCurrentCache: transition.mergeCurrentCache,
    });
    let cached = getAllFinishedFromCache();
    setFinishedUrls(cached);
    finishedUrlsRef.current = cached;

    if (decision.status !== 'confirmed' || !nextUser?.id) {
      progressHydrationRecoveryRef.current = null;
      return;
    }

    let cancelled = false;
    let retryTimer = null;

    const runHydration = (attempt = 0) => {
      const currentHydration = progressHydrationRef.current;
      if (
        currentHydration.scope === nextScopeKey &&
        currentHydration.status === 'hydrating' &&
        currentHydration.promise
      ) {
        return currentHydration.promise;
      }

      const hydrationPromise = loadProgressFromDB(voxylApi, nextUser.id)
        .then(() => {
          if (cancelled || progressScopeRef.current !== nextScopeKey) return;
          progressHydrationRef.current = { scope: nextScopeKey, promise: null, status: 'ready' };
          refreshActiveProgressRegressionGuard();
        })
        .catch((error) => {
          if (cancelled || progressScopeRef.current !== nextScopeKey) return;
          const retryDelay = PROGRESS_HYDRATION_RETRY_DELAYS_MS[attempt];
          progressHydrationRef.current = { scope: nextScopeKey, promise: null, status: 'failed' };
          console.warn('[VOXYL] Episode progress load failed; authenticated DB progress saves are paused.', {
            name: error?.name,
            message: error?.message,
            status: error?.status,
            willRetry: retryDelay !== undefined,
          });

          if (retryDelay === undefined) return;
          retryTimer = setTimeout(() => {
            if (cancelled || progressScopeRef.current !== nextScopeKey) return;
            retryTimer = null;
            runHydration(attempt + 1);
          }, retryDelay);
        })
        .finally(() => {
          if (cancelled || progressScopeRef.current !== nextScopeKey) return;
          cached = getAllFinishedFromCache();
          setFinishedUrls(cached);
          finishedUrlsRef.current = cached;
        });

      progressHydrationRef.current = { scope: nextScopeKey, promise: hydrationPromise, status: 'hydrating' };
      return hydrationPromise;
    };

    const requestRecovery = (reason) => {
      if (dbProgressUserRef.current?.id !== nextUser.id) return;
      const decision = getProgressHydrationRecoveryDecision({
        hydration: progressHydrationRef.current,
        scope: nextScopeKey,
        userId: nextUser.id,
        hasScheduledRetry: retryTimer !== null,
      });
      if (!decision.shouldStart) return;
      console.info('[VOXYL] Restarting EpisodeProgress hydration after recovery trigger.', { reason });
      runHydration(0);
    };

    progressHydrationRecoveryRef.current = requestRecovery;
    const handleOnline = () => requestRecovery('online');
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestRecovery('visible');
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    runHydration();

    return () => {
      cancelled = true;
      if (progressHydrationRecoveryRef.current === requestRecovery) {
        progressHydrationRecoveryRef.current = null;
      }
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearTimeout(retryTimer);
    };
  }, [
    apiUser,
    clerkUser,
    isAuthenticated,
    isLoadingAuth,
    authChecked,
    clearPlaybackForIdentityChange,
    refreshActiveProgressRegressionGuard,
    requestProgressHydrationRecovery,
    saveCurrentProgress,
    stopSaveTimers,
  ]);

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
    transitioningRef.current = false;
    saveCurrentProgress(true);
    stopSaveTimers();
    pausePodcastPlaySessionTimer();

    const hydrationReady = await waitForAuthenticatedProgressHydration();
    if (!hydrationReady) {
      requestProgressHydrationRecovery('playback-request');
    }
    const { resumeAt, durationSeconds } = getEpisodeResumeState(episode, skipResume);

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
        if (resumeAt > 0) {
          await waitForMediaReady(audio, 2000);
          webPlaybackTransitionRef.current.assertCurrent(transition);
          audio.currentTime = resumeAt;
        }
        webPlaybackTransitionRef.current.assertCurrent(transition);
        await requestWebPlayback(audio, 'manual-play', transition);
        webPlaybackTransitionRef.current.assertCurrent(transition);
        webPlaybackTransitionRef.current.markEstablished(transition);
        setIsPlaying(true);
        clearLoadingState();
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
    requestWebPlayback,
    saveCurrentProgress,
    startPodcastPlaySession,
    stopSaveTimers,
    updateMediaSession,
    requestProgressHydrationRecovery,
    waitForAuthenticatedProgressHydration,
    waitForMediaReady,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback((episode, newQueue = [], source = null) => {
    const updatedQueue = newQueue.length > 0 ? newQueue : queueRef.current;
    if (newQueue.length > 0) { queueRef.current = newQueue; setQueue(newQueue); }
    const nextSource = source ?? null;
    currentPlaybackSourceRef.current = nextSource;
    setEpisodeSource(nextSource);

    if (currentEpisodeRef.current?.audioUrl === episode.audioUrl) {
      // Resume same episode
      if (isNative && nativeAudioPlayer.isReady()) nativeAudioPlayer.resume();
      else {
        const activeTransition = webPlaybackTransitionRef.current.getCurrent();
        if (
          activeTransition?.audioUrl === episode.audioUrl &&
          webPlaybackTransitionRef.current.getPhase(activeTransition) === 'switching'
        ) {
          playEpisodeInternal(episode, updatedQueue);
          return;
        }
        audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
      }
      return;
    }

    playEpisodeInternal(episode, updatedQueue);
  }, [playEpisodeInternal]);

  const togglePlay = useCallback(() => {
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
        const activeEpisode = currentEpisodeRef.current;
        const activeTransition = webPlaybackTransitionRef.current.getCurrent();
        if (
          activeEpisode?.audioUrl &&
          activeTransition?.audioUrl === activeEpisode.audioUrl &&
          webPlaybackTransitionRef.current.getPhase(activeTransition) === 'switching'
        ) {
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
  }, [isPlaying, playEpisodeInternal]);

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
