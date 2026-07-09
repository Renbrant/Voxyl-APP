import { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { voxylApi } from '@/api/voxylApiClient';
import { invalidateCache } from '@/lib/appCache';
import {
  getCachedProgress,
  setCachedProgress,
  getAllFinishedFromCache,
  loadProgressFromDB,
  saveProgressToDB,
  FINISH_THRESHOLD,
  MIN_SAVE_POSITION,
} from '@/lib/episodeProgressCache';
import { nativeAudioPlayer, isNative } from '@/lib/nativeAudioPlayer';

const PlayerContext = createContext(null);

const LOCAL_SAVE_INTERVAL_MS = 5000;
const DB_SAVE_INTERVAL_MS = 30000;
const LOADING_TIMEOUT_MS = 8000;
const PLAY_RETRY_DELAYS_MS = [0, 750, 2000];

export function PlayerProvider({ children }) {
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

  // ─── Save / progress refs ────────────────────────────────────────────────
  const localSaveTimerRef = useRef(null);
  const dbSaveTimerRef = useRef(null);
  const podcastPlayRecordedRef = useRef(new Set());
  const userRef = useRef(null);
  const wakeLockRef = useRef(null);

  // ─── Native time/duration state (mirrors nativeAudioPlayer callbacks) ────
  const nativeCurrentTimeRef = useRef(0);
  const nativeDurationRef = useRef(0);

  // ─── Keep refs in sync with state ────────────────────────────────────────
  queueRef.current = queue;
  autoplayRef.current = autoplay;
  finishedUrlsRef.current = finishedUrls;
  userRef.current = user;

  // =========================================================================
  // ── SHARED HELPERS ────────────────────────────────────────────────────────
  // =========================================================================

  const markFinished = useCallback((audioUrl) => {
    if (!audioUrl) return;
    finishedUrlsRef.current = new Set([...finishedUrlsRef.current, audioUrl]);
    setFinishedUrls(new Set(finishedUrlsRef.current));
    const useNative = isNative && nativeAudioPlayer.isReady();
    const pos = useNative ? nativeCurrentTimeRef.current : (audioRef.current?.currentTime || 0);
    const dur = useNative ? nativeDurationRef.current : (audioRef.current?.duration || 0);
    setCachedProgress(audioUrl, pos, dur, true);
    const u = userRef.current;
    if (u) saveProgressToDB(voxylApi, u.id, audioUrl).catch(() => {});
  }, []);

  const recordPodcastPlay = useCallback(() => {
    const ep = currentEpisodeRef.current;
    if (!ep?.audioUrl) return;
    if (podcastPlayRecordedRef.current.has(ep.audioUrl)) return;
    const useNative = isNative && nativeAudioPlayer.isReady();
    const pos = useNative ? nativeCurrentTimeRef.current : (audioRef.current?.currentTime || 0);
    const dur = useNative ? nativeDurationRef.current : (isNaN(audioRef.current?.duration) ? 0 : audioRef.current.duration);
    if (dur > 0 && pos / dur >= 0.5) {
      podcastPlayRecordedRef.current.add(ep.audioUrl);
      voxylApi.functions.invoke('recordPodcastPlay', {
        feed_url: ep.feedUrl || ep.id || '',
        podcast_title: ep.feedTitle || '',
        podcast_image: ep.image || '',
        audio_url: ep.audioUrl,
        episode_title: ep.title || '',
      }).then(() => {
        const u = userRef.current;
        if (u?.id) invalidateCache(`user-podcast-plays-${u.id}`);
      }).catch(() => {});
    }
  }, []);

  const saveCurrentProgress = useCallback((forceDB = false) => {
    const ep = currentEpisodeRef.current;
    if (!ep?.audioUrl) return;
    const useNative = isNative && nativeAudioPlayer.isReady();
    const pos = useNative ? nativeCurrentTimeRef.current : (audioRef.current?.currentTime || 0);
    const dur = useNative ? nativeDurationRef.current : (isNaN(audioRef.current?.duration) ? 0 : audioRef.current.duration);
    if (pos < MIN_SAVE_POSITION) return;
    const finished = dur > 0 && pos / dur >= FINISH_THRESHOLD;
    setCachedProgress(ep.audioUrl, pos, dur, finished);
    if (finished) setFinishedUrls(prev => new Set([...prev, ep.audioUrl]));
    recordPodcastPlay();
    const u = userRef.current;
    if (forceDB && u) saveProgressToDB(voxylApi, u.id, ep.audioUrl).catch(() => {});
  }, [recordPodcastPlay]);

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

  const requestWebPlayback = useCallback(async (audio, transitionLabel) => {
    let lastError = null;

    for (let attempt = 0; attempt < PLAY_RETRY_DELAYS_MS.length; attempt += 1) {
      const delay = PLAY_RETRY_DELAYS_MS[attempt];
      if (delay > 0) await waitForMediaReady(audio, delay);

      try {
        console.log('[PLAYLIST] play() requested', {
          transition: transitionLabel,
          attempt: attempt + 1,
          src: audio.currentSrc || audio.src,
        });
        await audio.play();
        console.log('[PLAYLIST] play() resolved', {
          transition: transitionLabel,
          attempt: attempt + 1,
        });
        return;
      } catch (error) {
        lastError = error;
        console.error('[PLAYLIST] play() rejected', {
          transition: transitionLabel,
          attempt: attempt + 1,
          name: error?.name,
          message: error?.message,
        });

        const recoverable = error?.name === 'AbortError' ||
          error?.name === 'NotAllowedError' ||
          audio.networkState === HTMLMediaElement.NETWORK_LOADING;
        if (!recoverable) break;
      }
    }

    throw lastError || new Error('Audio playback did not start');
  }, [waitForMediaReady]);

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
    const prevUrl = currentEpisodeRef.current?.audioUrl;
    if (prevUrl) {
      finishedUrlsRef.current = new Set([...finishedUrlsRef.current, prevUrl]);
      const dur = (isNative && nativeAudioPlayer.isReady()) ? nativeDurationRef.current : (audioRef.current?.duration || 0);
      setCachedProgress(prevUrl, dur, dur, true);
    }

    currentEpisodeRef.current = nextEpisode;
    currentIndexRef.current = nextIdx;
    setCurrentEpisode(nextEpisode);
    setCurrentTime(0);
    setDuration(0);
    setFinishedUrls(new Set(finishedUrlsRef.current));
    armLoadingWatchdog(`advance:${source}`);

    try {
      if (isNative && nativeAudioPlayer.isReady()) {
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

        audio.pause();
        audio.src = nextEpisode.audioUrl;
        audio.volume = volumeRef.current ?? 1;
        console.log('[PLAYLIST] next URL assigned', {
          title: nextEpisode.title,
          url: nextEpisode.audioUrl,
        });
        audio.load();
        console.log('[PLAYLIST] load() called', {
          title: nextEpisode.title,
          url: nextEpisode.audioUrl,
        });

        const startAt = nextEpisode.skip_start_seconds || 0;
        if (startAt > 0) {
          await waitForMediaReady(audio, 2000);
          audio.currentTime = startAt;
        }

        await requestWebPlayback(audio, `advance:${source}`);
        setIsPlaying(true);
        clearLoadingState();
        updateMediaSession(nextEpisode);
        notifyServiceWorker(nextEpisode, currentQueue);
      }
    } catch (error) {
      console.error('[AUDIO_NEXT] error during auto-next', {
        source,
        title: nextEpisode.title,
        name: error?.name,
        message: error?.message,
      });
      clearLoadingState();
      setIsPlaying(false);
    } finally {
      transitioningRef.current = false;
    }
  }, [
    armLoadingWatchdog,
    clearLoadingState,
    requestWebPlayback,
    saveCurrentProgress,
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
        if (playing) startSaveTimers();
        else { stopSaveTimers(); saveCurrentProgress(true); }
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
        clearLoadingState();
        setIsPlaying(false);
        transitioningRef.current = false;
      },
      onQueueCompleted: () => {
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
      console.error('[PLAYLIST] audio error', {
        code: audio.error?.code,
        message: audio.error?.message,
        src: audio.currentSrc || audio.src,
        networkState: audio.networkState,
        readyState: audio.readyState,
      });
      clearLoadingState();
      setIsPlaying(false);
      transitioningRef.current = false;
    });

    audio.addEventListener('timeupdate', () => {
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
      setDuration(isNaN(audio.duration) ? 0 : audio.duration);
    });

    audio.addEventListener('stalled', () => {
      console.warn('[PLAYLIST] audio stalled', {
        title: currentEpisodeRef.current?.title,
        src: audio.currentSrc || audio.src,
      });
      armLoadingWatchdog('stalled');
    });

    audio.addEventListener('waiting', () => {
      console.warn('[PLAYLIST] audio waiting', {
        title: currentEpisodeRef.current?.title,
        src: audio.currentSrc || audio.src,
      });
      armLoadingWatchdog('waiting');
    });

    audio.addEventListener('canplay', clearLoadingState);
    audio.addEventListener('canplaythrough', clearLoadingState);

    audio.addEventListener('playing', () => {
      console.log('[PLAYLIST] audio playing', {
        title: currentEpisodeRef.current?.title,
        src: audio.currentSrc || audio.src,
      });
      clearLoadingState();
      setIsPlaying(true);
      startSaveTimers();
      requestWakeLock();
    });

    audio.addEventListener('pause', () => {
      console.log('[PLAYLIST] audio paused', {
        title: currentEpisodeRef.current?.title,
        ended: audio.ended,
      });
      stopSaveTimers();
      saveCurrentProgress(true);
      releaseWakeLock();
    });

    audio.addEventListener('ended', () => {
      console.log('[PLAYLIST] ended fired', {
        source: 'web',
        title: currentEpisodeRef.current?.title,
        src: audio.currentSrc || audio.src,
      });
      tryAdvance('AUDIO ENDED');
    });

    return () => {
      audio.pause();
      audio.src = '';
      stopSaveTimers();
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
    voxylApi.auth.me().then(async u => {
      setUser(u);
      userRef.current = u;
      if (u) { try { await loadProgressFromDB(voxylApi, u.id); } catch {} }
      setFinishedUrls(getAllFinishedFromCache());
      finishedUrlsRef.current = getAllFinishedFromCache();
    }).catch(() => {
      const cached = getAllFinishedFromCache();
      setFinishedUrls(cached);
      finishedUrlsRef.current = cached;
    });

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

    armLoadingWatchdog('manual-play');
    setCurrentEpisode(episode);
    currentEpisodeRef.current = episode;

    const idx = q.findIndex(e => e.audioUrl === episode.audioUrl);
    currentIndexRef.current = idx;

    const savedProgress = getCachedProgress(episode.audioUrl);
    const resumeAt = !skipResume && savedProgress?.position_seconds > MIN_SAVE_POSITION && !savedProgress?.finished
      ? savedProgress.position_seconds
      : (episode.skip_start_seconds || 0);

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
      audio.src = episode.audioUrl;
      audio.volume = volumeRef.current ?? 1;
      console.log('[PLAYLIST] next URL assigned', {
        title: episode.title,
        url: episode.audioUrl,
      });
      audio.load();
      console.log('[PLAYLIST] load() called', {
        title: episode.title,
        url: episode.audioUrl,
      });

      try {
        if (resumeAt > 0) {
          await waitForMediaReady(audio, 2000);
          audio.currentTime = resumeAt;
        }
        await requestWebPlayback(audio, 'manual-play');
        setIsPlaying(true);
        clearLoadingState();
      } catch (error) {
        console.error('[PLAYLIST] manual play failed', {
          title: episode.title,
          name: error?.name,
          message: error?.message,
        });
        clearLoadingState();
        setIsPlaying(false);
      }

      updateMediaSession(episode);
      notifyServiceWorker(episode, q);
    }
  }, [
    armLoadingWatchdog,
    clearLoadingState,
    requestWebPlayback,
    saveCurrentProgress,
    updateMediaSession,
    waitForMediaReady,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback((episode, newQueue = [], source = null) => {
    const updatedQueue = newQueue.length > 0 ? newQueue : queueRef.current;
    if (newQueue.length > 0) { queueRef.current = newQueue; setQueue(newQueue); }
    if (source) setEpisodeSource(source);

    if (currentEpisodeRef.current?.audioUrl === episode.audioUrl) {
      // Resume same episode
      if (isNative && nativeAudioPlayer.isReady()) nativeAudioPlayer.resume();
      else audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
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
        console.log('[WEB AUDIO] togglePlay — play() call',
          'src:', audio.src, 'readyState:', audio.readyState);
        audio.play().then(() => setIsPlaying(true)).catch(e =>
          console.error('[WEB AUDIO] togglePlay play() rejected —', 'name:', e?.name, 'message:', e?.message)
        );
      }
    }
  }, [isPlaying]);

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
