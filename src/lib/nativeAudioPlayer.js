import { Capacitor, registerPlugin } from '@capacitor/core';

// Resolve plugins at runtime to avoid Vite build errors on web.
// These packages are only available inside the native WebView.
const getNativeAudio = () => window?.Capacitor?.Plugins?.NativeAudio ?? null;
const getApp = () => window?.Capacitor?.Plugins?.App ?? null;

/**
 * NativeAudioPlayer — wrapper around @capgo/capacitor-native-audio
 *
 * Architecture:
 *   Web/PWA  → this module is a no-op; PlayerContext uses HTML Audio
 *   Android  → ExoPlayer via @capgo/capacitor-native-audio
 *   iOS      → AVPlayer via @capgo/capacitor-native-audio
 *
 * The plugin provides a web implementation, so importing it directly is safe.
 */

export const isNative = Capacitor.isNativePlatform();

const ASSET_ID = 'voxyl_current'; // single-slot player
const BackgroundAudioService = registerPlugin('BackgroundAudioService');

// Native-side auto-advance bridge. The NATIVE foreground service is expected to
// implement setQueue / clearQueue so it can start the next episode on ExoPlayer
// STATE_ENDED WITHOUT waking the JS WebView (survives Android Doze).
// If the native side does not implement these (older builds / web), the calls
// are wrapped in try/catch and the JS-side fallback in PlayerContext still runs.

class NativeAudioPlayer {
  constructor() {
    this._plugin = null;         // @capgo/capacitor-native-audio NativeAudio
    this._ready = false;
    this._currentUrl = null;
    this._duration = 0;
    this._isPlaying = false;     // ground-truth playing state
    this._onTimeUpdate = null;   // (posSeconds, durSeconds) => void
    this._onEnded = null;        // () => void
    this._onStateChange = null;  // (playing: boolean) => void
    this._timeListener = null;
    this._stateListener = null;
    this._completeListener = null;
    this._appStateListener = null;
    this._trackChangeListener = null;
    this._onNativeTrackChanged = null;
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  async initialize({ onTimeUpdate, onEnded, onStateChange, onNativeTrackChanged }) {
    if (!isNative) return;
    if (this._ready) return;

    this._onTimeUpdate = onTimeUpdate;
    this._onEnded = onEnded;
    this._onStateChange = onStateChange;
    this._onNativeTrackChanged = onNativeTrackChanged;

    console.log('[NativeAudioPlayer] initialize() — isNative:', isNative);
    try {
      this._plugin = getNativeAudio();
      if (!this._plugin) {
        console.error('[NativeAudioPlayer] NativeAudio plugin not found in Capacitor.Plugins');
        return;
      }

      console.log('[NativeAudioPlayer] calling configure()...');
      await this._plugin.configure({
        focus: true,
        backgroundPlayback: true,
        showNotification: true,
      });
      console.log('[NativeAudioPlayer] configure() succeeded');

      // currentTime events — fired every ~100ms while playing
      this._timeListener = await this._plugin.addListener('currentTime', (data) => {
        const posSec = data.currentTime ?? 0;
        this._onTimeUpdate?.(posSec, this._duration);
      });

      // Track completed
      this._completeListener = await this._plugin.addListener('complete', (data) => {
        if (data.assetId === ASSET_ID) {
          console.log('[PLAYLIST] ended fired', {
            source: 'native',
            url: this._currentUrl,
          });
          this._onEnded?.();
        }
      });

      // Playback state — fired by lock screen, BT controls, notification, interruptions
      this._stateListener = await this._plugin.addListener('playbackState', (data) => {
        this._isPlaying = !!data.isPlaying;
        if (this._isPlaying) {
          console.log('[PLAYLIST] playing event', {
            source: 'native',
            url: this._currentUrl,
          });
        }
        this._onStateChange?.(this._isPlaying);
      });

      // NATIVE auto-advance signal. Emitted by the foreground service when IT
      // moves to the next queue item on ExoPlayer STATE_ENDED while the WebView
      // is frozen. JS uses this to sync currentEpisode/index WITHOUT triggering
      // another play() (which would double-play on resume).
      try {
        this._trackChangeListener = await BackgroundAudioService.addListener('nativeTrackChanged', (data) => {
          console.log('[AUDIO_NEXT] native foreground service advanced track', data);
          this._currentUrl = data?.url ?? this._currentUrl;
          this._duration = 0;
          this._onNativeTrackChanged?.(data);
        });
      } catch (_) {
        // Older native build without queue support — JS fallback handles it.
      }

      // Capacitor App state — sync playing state when returning from background
      const App = getApp();
      if (App) {
        this._appStateListener = await App.addListener('appStateChange', async (state) => {
          if (state.isActive && this._currentUrl) {
            // Re-sync actual playing state from the native engine
            try {
              const { currentTime } = await this._plugin.getCurrentTime({ assetId: ASSET_ID });
              // If we think we're playing but native stopped (e.g. iOS killed session),
              // fire onStateChange so the UI reflects reality.
              // We detect a stall by comparing last known time vs now after 500ms.
              const timeBefore = currentTime ?? 0;
              await new Promise(r => setTimeout(r, 500));
              const { currentTime: currentTime2 } = await this._plugin.getCurrentTime({ assetId: ASSET_ID });
              const timeAfter = currentTime2 ?? 0;
              const actuallyPlaying = Math.abs(timeAfter - timeBefore) > 0.05;
              if (this._isPlaying !== actuallyPlaying) {
                this._isPlaying = actuallyPlaying;
                this._onStateChange?.(actuallyPlaying);
              }
            } catch (_) {}
          }
        }).catch(() => null);
      }

      this._ready = true;
      console.log('[NativeAudioPlayer] initialized successfully ✓');
    } catch (err) {
      console.error('[NativeAudioPlayer] init FAILED:', err?.message, err);
    }
  }

  // ── Load + Play ───────────────────────────────────────────────────────────
  async play(episode, resumeAt = 0) {
    console.log('[NativeAudioPlayer] play() called — isNative:', isNative, '_ready:', this._ready, 'url:', episode?.audioUrl);
    if (!isNative || !this._ready) {
      throw new Error(`Native audio is unavailable (native=${isNative}, ready=${this._ready})`);
    }

    const url = episode.audioUrl;
    if (!url) {
      throw new Error('Episode has no audio URL');
    }
    // Warn if URL looks relative (would resolve to localhost in WebView)
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      console.error('[NativeAudioPlayer] play() — audioUrl is NOT absolute HTTPS!', url);
    }

    console.log('[NativeAudioPlayer] loading URL:', url, '| resumeAt:', resumeAt);

    try {
      await BackgroundAudioService.start().catch((error) => {
        console.warn('[NativeAudioPlayer] foreground service start failed:', error?.message);
      });

      // Unload previous asset if URL changed
      if (this._currentUrl && this._currentUrl !== url) {
        console.log('[NativeAudioPlayer] unloading previous asset:', this._currentUrl);
        await this._plugin.unload({ assetId: ASSET_ID }).catch(() => {});
      }

      this._currentUrl = url;
      this._duration = 0;

      // Preload (registers the asset with the native engine)
      console.log('[NativeAudioPlayer] calling preload()...');
      console.log('[PLAYLIST] audio src changed', {
        source: 'native',
        title: episode.title,
        url,
      });
      await this._plugin.preload({
        assetId: ASSET_ID,
        assetPath: url,
        audioChannelNum: 1,
        isUrl: true,
        notificationMetadata: {
          title: episode.title || '',
          artist: episode.feedTitle || 'Voxyl',
          album: 'Voxyl',
          artworkUrl: episode.image || '',
        },
      });
      console.log('[PLAYLIST] load() called', {
        source: 'native',
        title: episode.title,
        url,
      });

      console.log('[PLAYLIST] play() requested', {
        source: 'native',
        title: episode.title,
        url,
      });
      await this._plugin.play({ assetId: ASSET_ID });
      this._isPlaying = true;
      console.log('[PLAYLIST] play() resolved', {
        source: 'native',
        title: episode.title,
        url,
      });

      // iOS AVPlayer populates duration asynchronously after play() starts.
      // Poll until we get a valid value (up to ~6s).
      this._pollDuration(url, resumeAt);

    } catch (err) {
      console.error('[PLAYLIST] play() rejected', {
        source: 'native',
        title: episode?.title,
        url,
        name: err?.name,
        message: err?.message,
      });
      this._isPlaying = false;
      this._onStateChange?.(false);
      throw err;
    }
  }

  // ── Duration polling (iOS AVPlayer needs time after play()) ──────────────
  async _pollDuration(urlAtStart, resumeAt) {
    const MAX_ATTEMPTS = 30; // 30 × 200ms = 6s max
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      // Stop if the track changed while we were polling
      if (this._currentUrl !== urlAtStart) return;
      await new Promise(r => setTimeout(r, 200));
      try {
        const { duration } = await this._plugin.getDuration({ assetId: ASSET_ID });
        const durSec = duration ?? 0;
        if (durSec > 0) {
          this._duration = durSec;
          // Now that duration is known, seek to resume position
          if (resumeAt > 0 && this._currentUrl === urlAtStart) {
            await this._plugin.setCurrentTime({
              assetId: ASSET_ID,
              time: resumeAt,
            }).catch(() => {});
          }
          return;
        }
      } catch (_) {}
    }
  }

  // ── Pause ────────────────────────────────────────────────────────────────
  async pause() {
    if (!isNative || !this._ready) return;
    await this._plugin.pause({ assetId: ASSET_ID }).catch(() => {});
    this._isPlaying = false;
  }

  // ── Resume ───────────────────────────────────────────────────────────────
  async resume() {
    if (!isNative || !this._ready) return;
    await this._plugin.resume({ assetId: ASSET_ID }).catch(() => {});
    this._isPlaying = true;
  }

  // ── Seek — debounced to prevent rapid-fire during scrubber drag ───────────
  seek(seconds) {
    if (!isNative || !this._ready) return;
    // Cancel any pending seek and schedule a new one 80ms later.
    // This prevents flooding the native bridge during seek bar dragging.
    clearTimeout(this._seekTimer);
    this._seekTimer = setTimeout(() => {
      this._plugin.setCurrentTime({
        assetId: ASSET_ID,
        time: seconds,
      }).catch(() => {});
    }, 80);
  }

  isCurrentlyPlaying() {
    return this._isPlaying;
  }

  // ── Native-side queue handoff ─────────────────────────────────────────────
  // Pushes the WHOLE upcoming queue to the native foreground service so it can
  // auto-advance on ExoPlayer STATE_ENDED while the WebView/JS is frozen (Doze).
  // The native BackgroundAudioService must implement `setQueue`. If it doesn't,
  // this no-ops gracefully and the JS fallback handles advancing on resume.
  async setNativeQueue(episodes, startIndex) {
    if (!isNative) return;
    try {
      const items = (episodes || []).slice(startIndex).map(ep => ({
        url: ep.audioUrl,
        title: ep.title || '',
        artist: ep.feedTitle || 'Voxyl',
        album: 'Voxyl',
        artworkUrl: ep.image || '',
        skipStartSeconds: ep.skip_start_seconds || 0,
        skipEndSeconds: ep.skip_end_seconds || 0,
      }));
      console.log('[AUDIO_NEXT] pushing native queue', { count: items.length, startIndex });
      await BackgroundAudioService.setQueue({ items });
      console.log('[AUDIO_NEXT] native queue accepted by foreground service');
    } catch (err) {
      console.warn('[AUDIO_NEXT] native setQueue unavailable — JS fallback will handle next', err?.message);
    }
  }

  async clearNativeQueue() {
    if (!isNative) return;
    try {
      await BackgroundAudioService.clearQueue();
      console.log('[AUDIO_NEXT] native queue cleared');
    } catch (_) {}
  }

  // ── Stop / cleanup ───────────────────────────────────────────────────────
  async stop() {
    if (!isNative || !this._ready) return;
    await this._plugin.stop({ assetId: ASSET_ID }).catch(() => {});
    await this._plugin.unload({ assetId: ASSET_ID }).catch(() => {});
    await BackgroundAudioService.stop().catch(() => {});
    this._currentUrl = null;
    this._duration = 0;
  }

  // ── Current position (polling fallback) ──────────────────────────────────
  async getCurrentTime() {
    if (!isNative || !this._ready) return 0;
    try {
      const { currentTime } = await this._plugin.getCurrentTime({ assetId: ASSET_ID });
      return currentTime ?? 0;
    } catch (_) {
      return 0;
    }
  }

  getDuration() {
    return this._duration;
  }

  // ── Public readiness check (use this instead of reading _ready directly) ──
  isReady() {
    return this._ready === true;
  }

  async waitUntilReady(timeoutMs = 1500) {
    const deadline = Date.now() + timeoutMs;
    while (!this._ready && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return this._ready;
  }

  // ── Cleanup listeners ────────────────────────────────────────────────────
  async destroy() {
    clearTimeout(this._seekTimer);
    await this._timeListener?.remove?.();
    await this._completeListener?.remove?.();
    await this._stateListener?.remove?.();
    await this._appStateListener?.remove?.();
    await this._trackChangeListener?.remove?.();
    await this.stop();
  }
}

export const nativeAudioPlayer = new NativeAudioPlayer();