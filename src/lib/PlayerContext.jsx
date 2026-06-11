import { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
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
  const rafRef = useRef(null);           // rAF id — web only

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
    const pos = isNative ? nativeCurrentTimeRef.current : (audioRef.current?.currentTime || 0);
    const dur = isNative ? nativeDurationRef.current : (audioRef.current?.duration || 0);
    setCachedProgress(audioUrl, pos, dur, true);
    const u = userRef.current;
    if (u) saveProgressToDB(base44, u.id, audioUrl).catch(() => {});
  }, []);

  const recordPodcastPlay = useCallback(() => {
    const ep = currentEpisodeRef.current;
    if (!ep?.audioUrl) return;
    if (podcastPlayRecordedRef.current.has(ep.audioUrl)) return;
    const pos = isNative ? nativeCurrentTimeRef.current : (audioRef.current?.currentTime || 0);
    const dur = isNative ? nativeDurationRef.current : (isNaN(audioRef.current?.duration) ? 0 : audioRef.current.duration);
    if (dur > 0 && pos / dur >= 0.5) {
      podcastPlayRecordedRef.current.add(ep.audioUrl);
      base44.functions.invoke('recordPodcastPlay', {
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
    const pos = isNative ? nativeCurrentTimeRef.current : (audioRef.current?.currentTime || 0);
    const dur = isNative ? nativeDurationRef.current : (isNaN(audioRef.current?.duration) ? 0 : audioRef.current.duration);
    if (pos < MIN_SAVE_POSITION) return;
    const finished = dur > 0 && pos / dur >= FINISH_THRESHOLD;
    setCachedProgress(ep.audioUrl, pos, dur, finished);
    if (finished) setFinishedUrls(prev => new Set([...prev, ep.audioUrl]));
    recordPodcastPlay();
    const u = userRef.current;
    if (forceDB && u) saveProgressToDB(base44, u.id, ep.audioUrl).catch(() => {});
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

  const advanceToNextEpisode = useCallback(async () => {
    if (!autoplayRef.current) {
      transitioningRef.current = false;
      return;
    }

    const currentQueue = queueRef.current;
    const nextIdx = currentIndexRef.current + 1;
    const nextEpisode = currentQueue[nextIdx];

    if (!nextEpisode) {
      transitioningRef.current = false;
      setIsPlaying(false);
      return;
    }

    // Save + mark current as finished
    saveCurrentProgress(true);
    const prevUrl = currentEpisodeRef.current?.audioUrl;
    if (prevUrl) {
      finishedUrlsRef.current = new Set([...finishedUrlsRef.current, prevUrl]);
      const dur = isNative ? nativeDurationRef.current : (audioRef.current?.duration || 0);
      setCachedProgress(prevUrl, dur, dur, true);
    }

    currentEpisodeRef.current = nextEpisode;
    currentIndexRef.current = nextIdx;

    if (isNative) {
      // ── Native path ──
      setCurrentEpisode(nextEpisode);
      setIsLoading(true);
      setFinishedUrls(new Set(finishedUrlsRef.current));
      await nativeAudioPlayer.play(nextEpisode, nextEpisode.skip_start_seconds || 0);
      setIsPlaying(true);
      setIsLoading(false);
    } else {
      // ── Web path ──
      const audio = audioRef.current;
      cancelAnimationFrame(rafRef.current);
      audio.pause();
      audio.src = nextEpisode.audioUrl;
      audio.load();
      audio.currentTime = nextEpisode.skip_start_seconds || 0;
      audio.volume = volumeRef.current ?? 1;
      try {
        await audio.play();
        setCurrentEpisode(nextEpisode);
        setIsPlaying(true);
        setIsLoading(false);
        setFinishedUrls(new Set(finishedUrlsRef.current));
        updateMediaSession(nextEpisode);
        notifyServiceWorker(nextEpisode, currentQueue);
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(monitorPlaybackRef.current);
      } catch (err) {
        console.error('[ADVANCE] play() failed', err);
      }
    }

    transitioningRef.current = false;
  }, [saveCurrentProgress, updateMediaSession]); // eslint-disable-line react-hooks/exhaustive-deps

  advanceToNextEpisodeRef.current = advanceToNextEpisode;

  const tryAdvance = useCallback((source) => {
    if (!transitioningRef.current) {
      transitioningRef.current = true;
      console.log(`[${source}] triggering advance`);
      advanceToNextEpisodeRef.current?.();
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
        console.log('[NATIVE] onEnded');
        tryAdvance('NATIVE ENDED');
      },
      onStateChange: (playing) => {
        setIsPlaying(playing);
        if (playing) startSaveTimers();
        else { stopSaveTimers(); saveCurrentProgress(true); }
      },
    });

    return () => {
      nativeAudioPlayer.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // =========================================================================
  // ── WEB AUDIO ELEMENT SETUP ───────────────────────────────────────────────
  // =========================================================================

  // ── rAF monitor (web only) ────────────────────────────────────────────────
  const monitorPlaybackRef = useRef(null);
  const monitorPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.paused || transitioningRef.current) return;
    if (!isNaN(audio.duration) && audio.duration > 0) {
      const remaining = audio.duration - audio.currentTime;
      if (remaining <= 0.25) {
        tryAdvance('RAF MONITOR');
        return;
      }
    }
    rafRef.current = requestAnimationFrame(monitorPlaybackRef.current);
  }, [tryAdvance]); // eslint-disable-line react-hooks/exhaustive-deps
  monitorPlaybackRef.current = monitorPlayback;

  useEffect(() => {
    if (isNative) return; // native path handles its own audio

    const audio = new Audio();
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audioRef.current = audio;

    audio.addEventListener('timeupdate', () => {
      setCurrentTime(audio.currentTime);
      if (!isNaN(audio.duration) && audio.duration > 0) {
        if (audio.duration - audio.currentTime <= 0.2) {
          tryAdvance('TIMEUPDATE FALLBACK');
          return;
        }
      }
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

    audio.addEventListener('waiting', () => setIsLoading(true));
    audio.addEventListener('canplay', () => setIsLoading(false));

    audio.addEventListener('playing', () => {
      setIsLoading(false);
      startSaveTimers();
      requestWakeLock();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(monitorPlaybackRef.current);
    });

    audio.addEventListener('pause', () => {
      stopSaveTimers();
      saveCurrentProgress(true);
      cancelAnimationFrame(rafRef.current);
      releaseWakeLock();
    });

    audio.addEventListener('ended', () => {
      console.log('[ENDED FALLBACK]', currentEpisodeRef.current?.title);
      tryAdvance('ENDED FALLBACK');
    });

    return () => {
      audio.pause();
      audio.src = '';
      stopSaveTimers();
      cancelAnimationFrame(rafRef.current);
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

  useEffect(() => {
    base44.auth.me().then(async u => {
      setUser(u);
      userRef.current = u;
      if (u) { try { await loadProgressFromDB(base44, u.id); } catch {} }
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

  // ── Resolve audio URL — follows server-side redirects to get the final CDN URL ──
  // Many podcast feeds redirect to a CDN that allows CORS; resolving server-side fixes it.
  const resolveAudioUrl = useCallback(async (audioUrl) => {
    try {
      const res = await base44.functions.invoke('proxyAudio', { audioUrl });
      const resolved = res?.data?.resolvedUrl;
      if (resolved && resolved !== audioUrl) {
        console.log('[resolveAudioUrl] resolved redirect:', audioUrl, '→', resolved);
      }
      return resolved || audioUrl;
    } catch (_) {
      return audioUrl;
    }
  }, []);

  const playEpisodeInternal = useCallback(async (episode, q, skipResume = false) => {
    transitioningRef.current = false;
    saveCurrentProgress(true);

    setIsLoading(true);
    setCurrentEpisode(episode);
    currentEpisodeRef.current = episode;

    const idx = q.findIndex(e => e.audioUrl === episode.audioUrl);
    currentIndexRef.current = idx;

    const savedProgress = getCachedProgress(episode.audioUrl);
    const resumeAt = !skipResume && savedProgress?.position_seconds > MIN_SAVE_POSITION && !savedProgress?.finished
      ? savedProgress.position_seconds
      : (episode.skip_start_seconds || 0);

    if (isNative) {
      // ── Native path ──
      await nativeAudioPlayer.play(episode, resumeAt);
      const dur = nativeAudioPlayer.getDuration();
      if (dur > 0) { setDuration(dur); nativeDurationRef.current = dur; }
      setCurrentTime(resumeAt);
      nativeCurrentTimeRef.current = resumeAt;
      setIsPlaying(true);
      setIsLoading(false);
    } else {
      // ── Web path ──
      const audio = audioRef.current;
      cancelAnimationFrame(rafRef.current);

      // Resolve redirects server-side to get the final CDN URL (fixes CORS on many podcasts)
      const resolvedUrl = await resolveAudioUrl(episode.audioUrl);
      audio.src = resolvedUrl;

      const doPlay = () => {
        audio.play()
          .then(() => { setIsPlaying(true); })
          .catch(e => console.error('[play] rejected:', e));
      };

      if (resumeAt > 0) {
        audio.addEventListener('loadedmetadata', function onMeta() {
          audio.removeEventListener('loadedmetadata', onMeta);
          audio.currentTime = resumeAt;
          doPlay();
        });
        audio.load();
      } else {
        doPlay();
      }

      updateMediaSession(episode);
      notifyServiceWorker(episode, q);
    }
  }, [saveCurrentProgress, updateMediaSession, resolveAudioUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback((episode, newQueue = [], source = null) => {
    const updatedQueue = newQueue.length > 0 ? newQueue : queueRef.current;
    if (newQueue.length > 0) { queueRef.current = newQueue; setQueue(newQueue); }
    if (source) setEpisodeSource(source);

    if (currentEpisodeRef.current?.audioUrl === episode.audioUrl) {
      // Resume same episode
      if (isNative) nativeAudioPlayer.resume();
      else audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
      return;
    }

    playEpisodeInternal(episode, updatedQueue);
  }, [playEpisodeInternal]);

  const togglePlay = useCallback(() => {
    if (isNative) {
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
      else { audio.play().then(() => setIsPlaying(true)).catch(() => {}); }
    }
  }, [isPlaying]);

  const seek = useCallback((time) => {
    if (isNative) {
      nativeAudioPlayer.seek(time);
      nativeCurrentTimeRef.current = time;
      setCurrentTime(time);
    } else {
      if (audioRef.current) audioRef.current.currentTime = time;
    }
  }, []);

  const playNext = useCallback(() => {
    if (!autoplayRef.current) return;
    tryAdvance('MANUAL NEXT');
  }, [tryAdvance]);

  const playPrevRef = useRef(null);
  const playPrev = useCallback(() => {
    const idx = currentIndexRef.current;
    const q = queueRef.current;
    if (idx > 0) playEpisodeInternal(q[idx - 1], q);
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