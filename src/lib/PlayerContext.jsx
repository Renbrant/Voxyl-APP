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
  const audioRef = useRef(null);
  const preloadAudioRef = useRef(null);
  const queueRef = useRef([]);
  const currentIndexRef = useRef(-1);
  const currentEpisodeRef = useRef(null);
  const autoplayRef = useRef(true);
  const finishedUrlsRef = useRef(new Set());
  const transitioningRef = useRef(false);
  const rafRef = useRef(null);

  // ─── Save / progress refs ────────────────────────────────────────────────
  const localSaveTimerRef = useRef(null);
  const dbSaveTimerRef = useRef(null);
  const podcastPlayRecordedRef = useRef(new Set());
  const userRef = useRef(null);
  const playInitiatedRef = useRef(false);

  // ─── Mark episode as finished ────────────────────────────────────────────
  const markFinished = useCallback((audioUrl) => {
    if (!audioUrl) return;
    finishedUrlsRef.current = new Set([...finishedUrlsRef.current, audioUrl]);
    setFinishedUrls(new Set(finishedUrlsRef.current));
    const audio = audioRef.current;
    setCachedProgress(audioUrl, audio?.currentTime || 0, audio?.duration || 0, true);
    const u = userRef.current;
    if (u) saveProgressToDB(base44, u.id, audioUrl).catch(() => {});
  }, []);

  // ─── Record podcast play when >50% reached ──────────────────────────────
  const recordPodcastPlay = useCallback(() => {
    const ep = currentEpisodeRef.current;
    const audio = audioRef.current;
    if (!ep?.audioUrl || !audio) return;
    if (podcastPlayRecordedRef.current.has(ep.audioUrl)) return;
    const dur = isNaN(audio.duration) ? 0 : audio.duration;
    const pos = audio.currentTime;
    if (dur > 0 && pos / dur >= 0.5) {
      podcastPlayRecordedRef.current.add(ep.audioUrl);
      const feedUrl = ep.feedUrl || ep.id || '';
      base44.functions.invoke('recordPodcastPlay', {
        feed_url: feedUrl,
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

  // ─── Save current position ────────────────────────────────────────────────
  const saveCurrentProgress = useCallback((forceDB = false) => {
    const ep = currentEpisodeRef.current;
    const audio = audioRef.current;
    if (!ep?.audioUrl || !audio) return;
    const pos = audio.currentTime;
    const dur = isNaN(audio.duration) ? 0 : audio.duration;
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

  // ─── Update MediaSession metadata ────────────────────────────────────────
  const updateMediaSession = useCallback((episode) => {
    if (!('mediaSession' in navigator)) return;
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

  // ─── Preload next episode ────────────────────────────────────────────────
  const preloadNext = useCallback((nextEpisode) => {
    if (!nextEpisode?.audioUrl) return;
    if (preloadAudioRef.current) {
      preloadAudioRef.current.src = '';
    }
    const pre = new Audio();
    pre.preload = 'auto';
    pre.src = nextEpisode.audioUrl;
    preloadAudioRef.current = pre;
    console.log('[PRELOAD] preloading:', nextEpisode.title);
  }, []);

  // ─── rAF monitor: detects end BEFORE 'ended' fires ──────────────────────
  const monitorPlaybackRef = useRef(null);

  const monitorPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.paused || transitioningRef.current) return;

    if (!isNaN(audio.duration) && audio.duration > 0) {
      const remaining = audio.duration - audio.currentTime;
      if (remaining <= 0.25) {
        console.log('[MONITOR] near end, triggering advance. remaining:', remaining);
        transitioningRef.current = true;
        advanceToNextEpisodeImmediateRef.current?.();
        return;
      }
    }

    rafRef.current = requestAnimationFrame(monitorPlaybackRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  monitorPlaybackRef.current = monitorPlayback;

  // ─── Advance to next episode immediately (no React dependencies) ─────────
  const advanceToNextEpisodeImmediateRef = useRef(null);

  const advanceToNextEpisodeImmediate = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) { transitioningRef.current = false; return; }

    if (!autoplayRef.current) {
      console.log('[ADVANCE] autoplay off, skipping');
      transitioningRef.current = false;
      return;
    }

    const currentQueue = queueRef.current;
    const currentIdx = currentIndexRef.current;
    const nextIdx = currentIdx + 1;
    const nextEpisode = currentQueue[nextIdx];

    console.log('[ADVANCE] starting immediate transition. currentIdx:', currentIdx, 'nextIdx:', nextIdx);
    console.log('[ADVANCE] next episode:', nextEpisode?.title);

    if (!nextEpisode) {
      console.log('[ADVANCE] no next episode in queue');
      transitioningRef.current = false;
      return;
    }

    // Save progress of current episode first
    saveCurrentProgress(true);

    // Mark current as finished in refs immediately
    const prevUrl = currentEpisodeRef.current?.audioUrl;
    if (prevUrl) {
      finishedUrlsRef.current = new Set([...finishedUrlsRef.current, prevUrl]);
      setCachedProgress(prevUrl, audio.duration || 0, audio.duration || 0, true);
    }

    try {
      // Update refs FIRST — before touching audio
      currentEpisodeRef.current = nextEpisode;
      currentIndexRef.current = nextIdx;

      // Swap source immediately on the SAME audio element
      audio.src = nextEpisode.audioUrl;
      audio.currentTime = nextEpisode.skip_start_seconds || 0;

      await audio.play();

      console.log('[ADVANCE] play() success:', nextEpisode.title);

      // Update React state AFTER play succeeds
      setCurrentEpisode(nextEpisode);
      setIsPlaying(true);
      setIsLoading(false);
      setFinishedUrls(new Set(finishedUrlsRef.current));

      updateMediaSession(nextEpisode);

      // Notify Service Worker
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'UPDATE_EPISODE',
          payload: { ...nextEpisode, queue: currentQueue, autoplay: autoplayRef.current },
        });
      }

      // Preload the one after next
      preloadNext(currentQueue[nextIdx + 1]);

      transitioningRef.current = false;

      // Restart rAF monitor for the new episode
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(monitorPlaybackRef.current);

    } catch (err) {
      console.log('[ADVANCE] play() failed', err);
      transitioningRef.current = false;
    }
  }, [saveCurrentProgress, updateMediaSession, preloadNext]); // eslint-disable-line react-hooks/exhaustive-deps

  advanceToNextEpisodeImmediateRef.current = advanceToNextEpisodeImmediate;

  // ─── Audio element setup (once) ──────────────────────────────────────────
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'none';
    audioRef.current = audio;

    audio.addEventListener('timeupdate', () => {
      setCurrentTime(audio.currentTime);

      // skip_end_seconds support
      const ep = currentEpisodeRef.current;
      const skipEnd = ep?.skip_end_seconds || 0;
      if (skipEnd > 0 && audio.duration && !isNaN(audio.duration)) {
        const stopAt = audio.duration - skipEnd;
        if (audio.currentTime >= stopAt && !transitioningRef.current) {
          transitioningRef.current = true;
          advanceToNextEpisodeImmediateRef.current?.();
        }
      }
    });

    audio.addEventListener('durationchange', () => {
      setDuration(isNaN(audio.duration) ? 0 : audio.duration);
    });

    audio.addEventListener('waiting', () => setIsLoading(true));

    audio.addEventListener('playing', () => {
      setIsLoading(false);
      startSaveTimers();
      // Start rAF monitor on every play event (covers resume after pause too)
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(monitorPlaybackRef.current);
    });

    audio.addEventListener('canplay', () => setIsLoading(false));

    audio.addEventListener('pause', () => {
      stopSaveTimers();
      saveCurrentProgress(true);
      cancelAnimationFrame(rafRef.current);
    });

    // Keep 'ended' as a safety fallback (though rAF should fire first)
    audio.addEventListener('ended', () => {
      console.log('[ended] fallback fired for:', currentEpisodeRef.current?.title);
      if (!transitioningRef.current) {
        transitioningRef.current = true;
        advanceToNextEpisodeImmediateRef.current?.();
      }
    });

    return () => {
      audio.pause();
      audio.src = '';
      stopSaveTimers();
      cancelAnimationFrame(rafRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── MediaSession action handlers ────────────────────────────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const audio = audioRef.current;
    navigator.mediaSession.setActionHandler('play',          () => { audio?.play().then(() => setIsPlaying(true)).catch(() => {}); });
    navigator.mediaSession.setActionHandler('pause',         () => { audio?.pause(); setIsPlaying(false); });
    navigator.mediaSession.setActionHandler('previoustrack', () => playPrevRef.current?.());
    navigator.mediaSession.setActionHandler('nexttrack',     () => {
      if (!transitioningRef.current) {
        transitioningRef.current = true;
        advanceToNextEpisodeImmediateRef.current?.();
      }
    });
    navigator.mediaSession.setActionHandler('seekbackward',  (d) => { if (audio) audio.currentTime = Math.max(0, audio.currentTime - (d?.seekOffset ?? 15)); });
    navigator.mediaSession.setActionHandler('seekforward',   (d) => { if (audio) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d?.seekOffset ?? 30)); });
    navigator.mediaSession.setActionHandler('seekto',        (d) => { if (audio && d.seekTime != null) audio.currentTime = d.seekTime; });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Lock screen scrubber ─────────────────────────────────────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator) || !duration) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: audioRef.current?.playbackRate ?? 1,
        position: currentTime,
      });
    } catch (_) {}
  }, [currentTime, duration]);

  // ─── Load user + progress on mount ───────────────────────────────────────
  useEffect(() => {
    base44.auth.me().then(async u => {
      setUser(u);
      userRef.current = u;
      if (u) {
        try { await loadProgressFromDB(base44, u.id); } catch {}
      }
      setFinishedUrls(getAllFinishedFromCache());
      finishedUrlsRef.current = getAllFinishedFromCache();
    }).catch(() => {
      const cached = getAllFinishedFromCache();
      setFinishedUrls(cached);
      finishedUrlsRef.current = cached;
    });

    if ('serviceWorker' in navigator) {
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
  }, []);

  // ─── Keep refs in sync with state ────────────────────────────────────────
  queueRef.current = queue;
  autoplayRef.current = autoplay;
  finishedUrlsRef.current = finishedUrls;
  userRef.current = user;

  // ─── Internal: play an episode directly on the audio element ─────────────
  const playEpisodeAudio = useCallback((episode, queue_, skipResume = false) => {
    const audio = audioRef.current;
    if (!audio) return;

    cancelAnimationFrame(rafRef.current);
    transitioningRef.current = false;

    saveCurrentProgress(true);

    playInitiatedRef.current = true;
    setIsLoading(true);
    setCurrentEpisode(episode);
    currentEpisodeRef.current = episode;

    // Find index in queue
    const q = queue_ || queueRef.current;
    const idx = q.findIndex(e => e.audioUrl === episode.audioUrl);
    currentIndexRef.current = idx;

    const savedProgress = getCachedProgress(episode.audioUrl);
    const resumeAt = !skipResume && savedProgress && savedProgress.position_seconds > MIN_SAVE_POSITION && !savedProgress.finished
      ? savedProgress.position_seconds
      : (episode.skip_start_seconds || 0);

    audio.src = episode.audioUrl;

    const doPlay = () => {
      audio.play().then(() => {
        setIsPlaying(true);
        // Preload next
        preloadNext(q[idx + 1]);
      }).catch((e) => {
        console.error('[playEpisodeAudio] play() rejected:', e);
      });
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

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'UPDATE_EPISODE',
        payload: { ...episode, queue: q, autoplay: autoplayRef.current },
      });
    }
  }, [saveCurrentProgress, updateMediaSession, preloadNext]);

  // ─── Public play() ───────────────────────────────────────────────────────
  const play = (episode, newQueue = [], source = null) => {
    const updatedQueue = newQueue.length > 0 ? newQueue : queueRef.current;
    if (newQueue.length > 0) { queueRef.current = newQueue; setQueue(newQueue); }
    if (source) setEpisodeSource(source);

    if (currentEpisodeRef.current?.audioUrl === episode.audioUrl) {
      audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
      return;
    }

    playEpisodeAudio(episode, updatedQueue);
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) { audio.pause(); setIsPlaying(false); }
    else { audio.play().then(() => setIsPlaying(true)).catch(() => {}); }
  };

  const seek = (time) => {
    if (audioRef.current) audioRef.current.currentTime = time;
  };

  // playNext is now just a wrapper for advanceToNextEpisodeImmediate
  const playNext = () => {
    if (!autoplayRef.current) return;
    if (!transitioningRef.current) {
      transitioningRef.current = true;
      advanceToNextEpisodeImmediateRef.current?.();
    }
  };

  const playPrevRef = useRef(null);
  const playPrev = () => {
    const idx = currentIndexRef.current;
    const q = queueRef.current;
    if (idx > 0) playEpisodeAudio(q[idx - 1], q);
  };
  playPrevRef.current = playPrev;

  // ─── Sync finished URLs to Service Worker ────────────────────────────────
  useEffect(() => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'UPDATE_FINISHED_URLS',
        payload: Array.from(finishedUrls),
      });
    }
  }, [finishedUrls]);

  // ─── Persist autoplay + notify SW ────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem('voxyl_autoplay', String(autoplay)); } catch {}
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SET_AUTOPLAY',
        payload: { autoplay },
      });
    }
  }, [autoplay]);

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