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

// How often (ms) to sync current position to localStorage while playing
const LOCAL_SAVE_INTERVAL_MS = 5000;
// How often (ms) to push to DB while playing
const DB_SAVE_INTERVAL_MS = 30000;

export function PlayerProvider({ children }) {
  const [currentEpisode, setCurrentEpisode] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queue, setQueue] = useState([]);
  const [autoplay, setAutoplay] = useState(true);
  const queueRef = useRef([]);
  const autoplayRef = useRef(true);
  const finishedUrlsRef = useRef(new Set());
  const [playerMinimized, setPlayerMinimized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [finishedUrls, setFinishedUrls] = useState(new Set());
  const [user, setUser] = useState(null);
  const [episodeSource, setEpisodeSource] = useState(null); // { type: 'playlist'|'podcast', id: string }

  const audioRef = useRef(null);
  const playNextRef = useRef(null);
  const playPrevRef = useRef(null);
  const playInitiatedRef = useRef(false);
  const currentEpisodeRef = useRef(null);
  const localSaveTimerRef = useRef(null);
  const dbSaveTimerRef = useRef(null);
  const podcastPlayRecordedRef = useRef(new Set()); // Track which episodes already recorded as plays

  // ─── Mark episode as finished ────────────────────────────────────────────
  const markFinished = useCallback((audioUrl) => {
    if (!audioUrl) return;
    finishedUrlsRef.current = new Set([...finishedUrlsRef.current, audioUrl]);
    setFinishedUrls(new Set(finishedUrlsRef.current));
    const audio = audioRef.current;
    setCachedProgress(audioUrl, audio?.currentTime || 0, audio?.duration || 0, true);
    if (user) saveProgressToDB(base44, user.id, audioUrl).catch(() => {});
  }, [user]);

  // ─── Record podcast play when >50% reached ──────────────────────────────
  const recordPodcastPlay = useCallback(() => {
    const ep = currentEpisodeRef.current;
    const audio = audioRef.current;
    if (!ep?.audioUrl || !audio) return;

    // Only record once per episode per session
    if (podcastPlayRecordedRef.current.has(ep.audioUrl)) return;

    const dur = isNaN(audio.duration) ? 0 : audio.duration;
    const pos = audio.currentTime;
    const playPercent = dur > 0 ? (pos / dur) : 0;

    if (playPercent >= 0.5) {
      podcastPlayRecordedRef.current.add(ep.audioUrl);
      const feedUrl = ep.feedUrl || ep.id || '';
      base44.functions.invoke('recordPodcastPlay', {
        feed_url: feedUrl,
        podcast_title: ep.feedTitle || '',
        podcast_image: ep.image || '',
        audio_url: ep.audioUrl,
        episode_title: ep.title || '',
      }).then(() => {
        // Invalidate caches so Feed and Playlists reflect the new play
        if (user?.id) {
          invalidateCache(`user-podcast-plays-${user.id}`);
        }
      }).catch(() => {});
    }
  }, [user]);

  // ─── Save current position to cache (and optionally DB) ──────────────────
  const saveCurrentProgress = useCallback((forcDB = false) => {
    const ep = currentEpisodeRef.current;
    const audio = audioRef.current;
    if (!ep?.audioUrl || !audio) return;

    const pos = audio.currentTime;
    const dur = isNaN(audio.duration) ? 0 : audio.duration;
    if (pos < MIN_SAVE_POSITION) return;

    const finished = dur > 0 && pos / dur >= FINISH_THRESHOLD;
    setCachedProgress(ep.audioUrl, pos, dur, finished);

    if (finished) {
      setFinishedUrls(prev => new Set([...prev, ep.audioUrl]));
    }

    // Record podcast play if >50% reached
    recordPodcastPlay();

    if (forcDB && user) {
      saveProgressToDB(base44, user.id, ep.audioUrl).catch(() => {});
    }
  }, [user, recordPodcastPlay]);

  // ─── Periodic save timers ─────────────────────────────────────────────────
  const startSaveTimers = useCallback(() => {
    stopSaveTimers();
    localSaveTimerRef.current = setInterval(() => saveCurrentProgress(false), LOCAL_SAVE_INTERVAL_MS);
    dbSaveTimerRef.current = setInterval(() => saveCurrentProgress(true), DB_SAVE_INTERVAL_MS);
  }, [saveCurrentProgress]);

  const stopSaveTimers = useCallback(() => {
    clearInterval(localSaveTimerRef.current);
    clearInterval(dbSaveTimerRef.current);
  }, []);

  // ─── Audio element setup ──────────────────────────────────────────────────
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'none';
    audioRef.current = audio;

    audio.addEventListener('timeupdate', () => {
      setCurrentTime(audio.currentTime);

      const ep = currentEpisodeRef.current;
      const skipEnd = ep?.skip_end_seconds || 0;
      if (skipEnd > 0 && audio.duration && !isNaN(audio.duration)) {
        const stopAt = audio.duration - skipEnd;
        if (audio.currentTime >= stopAt) {
          audio.pause();
          setIsPlaying(false);
          markFinished(ep?.audioUrl);
          playNextRef.current?.();
        }
      }
    });

    audio.addEventListener('durationchange', () => {
      setDuration(isNaN(audio.duration) ? 0 : audio.duration);
    });

    audio.addEventListener('waiting', () => setIsLoading(true));
    audio.addEventListener('playing', () => { setIsLoading(false); startSaveTimers(); });
    audio.addEventListener('canplay', () => setIsLoading(false));
    audio.addEventListener('pause', () => {
      stopSaveTimers();
      saveCurrentProgress(true);
    });
    audio.addEventListener('ended', () => {
      setIsPlaying(false);
      stopSaveTimers();
      markFinished(currentEpisodeRef.current?.audioUrl);
      // Notify Service Worker about the end
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.controller?.postMessage({
          type: 'EPISODE_ENDED',
          payload: { audioUrl: currentEpisodeRef.current?.audioUrl }
        });
      }
      playNextRef.current?.();
    });

    return () => {
      audio.pause();
      audio.src = '';
      stopSaveTimers();
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ─── MediaSession metadata ────────────────────────────────────────────────
  useEffect(() => {
    if (!currentEpisode || !audioRef.current) return;
    const audio = audioRef.current;

    if (playInitiatedRef.current) {
      playInitiatedRef.current = false;
    } else {
      audio.src = currentEpisode.audioUrl;
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentEpisode.title,
        artist: currentEpisode.feedTitle || 'Voxyl',
        album: 'Voxyl',
        artwork: currentEpisode.image
          ? [
              { src: currentEpisode.image, sizes: '96x96',   type: 'image/jpeg' },
              { src: currentEpisode.image, sizes: '128x128', type: 'image/jpeg' },
              { src: currentEpisode.image, sizes: '256x256', type: 'image/jpeg' },
              { src: currentEpisode.image, sizes: '512x512', type: 'image/jpeg' },
            ]
          : [],
      });
      navigator.mediaSession.setActionHandler('play',          () => { audio.play().then(() => setIsPlaying(true)).catch(() => {}); });
      navigator.mediaSession.setActionHandler('pause',         () => { audio.pause(); setIsPlaying(false); });
      navigator.mediaSession.setActionHandler('previoustrack', () => playPrevRef.current?.());
      navigator.mediaSession.setActionHandler('nexttrack',     () => playNextRef.current?.());
      navigator.mediaSession.setActionHandler('seekbackward',  (d) => { audio.currentTime = Math.max(0, audio.currentTime - (d?.seekOffset ?? 15)); });
      navigator.mediaSession.setActionHandler('seekforward',   (d) => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d?.seekOffset ?? 30)); });
      navigator.mediaSession.setActionHandler('seekto',        (d) => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
    }
  }, [currentEpisode]);

  // ─── Lock screen scrubber position state ─────────────────────────────────
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
     if (u) {
       try {
         await loadProgressFromDB(base44, u.id);
       } catch {}
     }
     // Seed finishedUrls from cache (fast, no DB needed)
     setFinishedUrls(getAllFinishedFromCache());
   }).catch(() => {
     setFinishedUrls(getAllFinishedFromCache());
   });

   // Register Service Worker for background playback
   if ('serviceWorker' in navigator) {
     navigator.serviceWorker.register('/sw.js').catch(() => {});
   }

   // Listen for messages from Service Worker
   if ('serviceWorker' in navigator) {
     navigator.serviceWorker.addEventListener('message', event => {
       if (event.data.type === 'PLAY_NEXT_EPISODE') {
         // Auto-play next episode from background
         playNextRef.current?.();
       } else if (event.data.type === 'PLAY') {
         audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
       } else if (event.data.type === 'PAUSE') {
         audioRef.current?.pause();
         setIsPlaying(false);
       }
     });
   }
  }, []);

  // ─── Keep refs in sync with state ────────────────────────────────────────
  currentEpisodeRef.current = currentEpisode;
  queueRef.current = queue;
  autoplayRef.current = autoplay;
  finishedUrlsRef.current = finishedUrls;

  // ─── play() ──────────────────────────────────────────────────────────────
  const play = (episode, newQueue = [], source = null) => {
    const updatedQueue = newQueue.length > 0 ? newQueue : queueRef.current;
    if (newQueue.length > 0) { queueRef.current = newQueue; setQueue(newQueue); }
    if (source) setEpisodeSource(source);

    if (currentEpisode?.audioUrl === episode.audioUrl) {
      audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
      return;
    }

    // Save progress for the outgoing episode before switching
    saveCurrentProgress(true);

    const audio = audioRef.current;
    if (!audio) return;

    playInitiatedRef.current = true;
    setIsLoading(true);
    audio.src = episode.audioUrl;

    // Resume from saved position (skip_start_seconds takes priority if no saved progress)
    const savedProgress = getCachedProgress(episode.audioUrl);
    const resumeAt = savedProgress && savedProgress.position_seconds > MIN_SAVE_POSITION && !savedProgress.finished
      ? savedProgress.position_seconds
      : (episode.skip_start_seconds || 0);

    if (resumeAt > 0) {
      audio.addEventListener('loadedmetadata', function onMeta() {
        audio.currentTime = resumeAt;
        audio.removeEventListener('loadedmetadata', onMeta);
      });
    }

    audio.play().then(() => setIsPlaying(true)).catch(() => {});
    setCurrentEpisode(episode);

    // Update Service Worker with current episode and queue
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'UPDATE_EPISODE',
        payload: {
          ...episode,
          queue: updatedQueue,
          autoplay: autoplay
        }
      });
    }
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const seek = (time) => {
    if (audioRef.current) audioRef.current.currentTime = time;
  };

  const playNext = () => {
    const ep = currentEpisodeRef.current;
    const q = queueRef.current;
    if (!ep || q.length === 0 || !autoplayRef.current) return;
    const idx = q.findIndex(e => e.audioUrl === ep.audioUrl);

    // Find next unfinished episode using refs (safe when screen is off)
    for (let i = idx + 1; i < q.length; i++) {
      const nextEp = q[i];
      if (!finishedUrlsRef.current.has(nextEp.audioUrl)) {
        play(nextEp, q);
        return;
      }
    }
  };

  const playPrev = () => {
    if (!currentEpisode || queue.length === 0) return;
    const idx = queue.findIndex(e => e.audioUrl === currentEpisode.audioUrl);
    if (idx > 0) setCurrentEpisode(queue[idx - 1]);
  };

  playNextRef.current = playNext;
  playPrevRef.current = playPrev;

  // Sync finished URLs to Service Worker
  useEffect(() => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'UPDATE_FINISHED_URLS',
        payload: Array.from(finishedUrls)
      });
    }
  }, [finishedUrls]);

  // Notify Service Worker about autoplay changes
  useEffect(() => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SET_AUTOPLAY',
        payload: { autoplay }
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