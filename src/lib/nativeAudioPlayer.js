/**
 * NativeAudioPlayer — wrapper around @capgo/capacitor-native-audio
 *
 * Architecture:
 *   Web/PWA  → this module is a no-op; PlayerContext uses HTML Audio
 *   Android  → ExoPlayer via @capgo/capacitor-native-audio
 *   iOS      → AVPlayer via @capgo/capacitor-native-audio
 *
 * The plugin is imported DYNAMICALLY so the web bundle never fails to resolve it.
 * window.Capacitor is injected by the native WebView at runtime.
 */

// ─── Platform detection (no static import needed) ───────────────────────────
export const isNative = !!(
  typeof window !== 'undefined' &&
  window.Capacitor &&
  window.Capacitor.isNativePlatform?.()
);

const ASSET_ID = 'voxyl_current'; // single-slot player

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
    this._interruptionListener = null;
    this._appStateListener = null;
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  async initialize({ onTimeUpdate, onEnded, onStateChange }) {
    if (!isNative) return;
    if (this._ready) return;

    this._onTimeUpdate = onTimeUpdate;
    this._onEnded = onEnded;
    this._onStateChange = onStateChange;

    console.log('[NativeAudioPlayer] initialize() — isNative:', isNative);
    console.log('[NativeAudioPlayer] Capacitor.Plugins keys:', Object.keys(window.Capacitor?.Plugins ?? {}));

    try {
      // Access plugin via Capacitor's global registry — zero static/dynamic imports
      // The plugin registers itself on window.Capacitor.Plugins when loaded natively
      const NativeAudio = window.Capacitor?.Plugins?.NativeAudio ?? null;
      if (!NativeAudio) {
        console.error('[NativeAudioPlayer] FATAL: NativeAudio plugin not found in Capacitor.Plugins. ' +
          'Run "npx cap sync android" and rebuild the APK. ' +
          'Available plugins:', Object.keys(window.Capacitor?.Plugins ?? {}));
        return;
      }
      console.log('[NativeAudioPlayer] NativeAudio plugin found:', !!NativeAudio);
      this._plugin = NativeAudio;

      console.log('[NativeAudioPlayer] calling configure()...');
      await this._plugin.configure({
        fade: false,
        focus: true,          // Request audio focus (Android) / AVAudioSession (iOS)
        backgroundAudio: true, // Keep playback alive when screen locks / app backgrounds
      });
      console.log('[NativeAudioPlayer] configure() succeeded');

      // currentTime events — fired every ~100ms while playing
      this._timeListener = await this._plugin.addListener('currentTime', (data) => {
        // data: { assetId, currentTime (ms) }
        const posSec = (data.currentTime ?? 0) / 1000;
        this._onTimeUpdate?.(posSec, this._duration);
      });

      // Track completed
      this._completeListener = await this._plugin.addListener('complete', (data) => {
        if (data.assetId === ASSET_ID) {
          this._onEnded?.();
        }
      });

      // Playback state — fired by lock screen, BT controls, notification, interruptions
      this._stateListener = await this._plugin.addListener('playbackState', (data) => {
        // data: { assetId, playing }
        this._isPlaying = !!data.playing;
        this._onStateChange?.(this._isPlaying);
      });

      // iOS audio session interruption (phone call, Siri, alarm, etc.)
      // When interruption ends with shouldResume=true, resume playback automatically.
      this._interruptionListener = await this._plugin.addListener('interruption', (data) => {
        // data: { type: 'began' | 'ended', shouldResume?: boolean }
        if (data.type === 'ended' && data.shouldResume && this._currentUrl) {
          console.log('[NativeAudioPlayer] interruption ended — resuming');
          this._plugin.resume({ assetId: ASSET_ID }).catch(() => {});
        } else if (data.type === 'began') {
          // iOS pauses AVPlayer automatically; sync our state
          this._isPlaying = false;
          this._onStateChange?.(false);
        }
      }).catch(() => null); // older plugin versions may not have this event

      // Capacitor App state — sync playing state when returning from background
      const AppPlugin = window.Capacitor?.Plugins?.App ?? null;
      if (AppPlugin) {
        this._appStateListener = await AppPlugin.addListener('appStateChange', async (state) => {
          if (state.isActive && this._currentUrl) {
            // Re-sync actual playing state from the native engine
            try {
              const { currentTime } = await this._plugin.getCurrentTime({ assetId: ASSET_ID });
              // If we think we're playing but native stopped (e.g. iOS killed session),
              // fire onStateChange so the UI reflects reality.
              // We detect a stall by comparing last known time vs now after 500ms.
              const timeBefore = (currentTime ?? 0) / 1000;
              await new Promise(r => setTimeout(r, 500));
              const { currentTime: currentTime2 } = await this._plugin.getCurrentTime({ assetId: ASSET_ID });
              const timeAfter = (currentTime2 ?? 0) / 1000;
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
      console.warn('[NativeAudioPlayer] play() skipped — isNative:', isNative, '_ready:', this._ready);
      return;
    }

    const url = episode.audioUrl;
    if (!url) {
      console.error('[NativeAudioPlayer] play() — episode has no audioUrl!', episode);
      return;
    }
    // Warn if URL looks relative (would resolve to localhost in WebView)
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      console.error('[NativeAudioPlayer] play() — audioUrl is NOT absolute HTTPS!', url);
    }

    console.log('[NativeAudioPlayer] loading URL:', url, '| resumeAt:', resumeAt);

    try {
      // Unload previous asset if URL changed
      if (this._currentUrl && this._currentUrl !== url) {
        console.log('[NativeAudioPlayer] unloading previous asset:', this._currentUrl);
        await this._plugin.unload({ assetId: ASSET_ID }).catch(() => {});
      }

      this._currentUrl = url;
      this._duration = 0;

      // Preload (registers the asset with the native engine)
      console.log('[NativeAudioPlayer] calling preload()...');
      await this._plugin.preload({
        assetId: ASSET_ID,
        assetPath: url,
        audioChannelNum: 1,
        isUrl: true,
        // Notification / lockscreen metadata
        title: episode.title || '',
        artist: episode.feedTitle || 'Voxyl',
        albumTitle: 'Voxyl',
        artworkUrl: episode.image || '',
        nextEnabled: true,
        prevEnabled: true,
      });

      console.log('[NativeAudioPlayer] preload() succeeded, calling play()...');
      await this._plugin.play({ assetId: ASSET_ID });
      this._isPlaying = true;
      console.log('[NativeAudioPlayer] play() succeeded ✓');

      // iOS AVPlayer populates duration asynchronously after play() starts.
      // Poll until we get a valid value (up to ~6s).
      this._pollDuration(url, resumeAt);

    } catch (err) {
      console.error('[NativeAudioPlayer] play() FAILED:', err?.message, err);
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
        const durSec = (duration ?? 0) / 1000;
        if (durSec > 0) {
          this._duration = durSec;
          // Now that duration is known, seek to resume position
          if (resumeAt > 0 && this._currentUrl === urlAtStart) {
            await this._plugin.setCurrentTime({
              assetId: ASSET_ID,
              time: resumeAt * 1000,
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
        time: seconds * 1000,
      }).catch(() => {});
    }, 80);
  }

  isCurrentlyPlaying() {
    return this._isPlaying;
  }

  // ── Stop / cleanup ───────────────────────────────────────────────────────
  async stop() {
    if (!isNative || !this._ready) return;
    await this._plugin.stop({ assetId: ASSET_ID }).catch(() => {});
    await this._plugin.unload({ assetId: ASSET_ID }).catch(() => {});
    this._currentUrl = null;
    this._duration = 0;
  }

  // ── Current position (polling fallback) ──────────────────────────────────
  async getCurrentTime() {
    if (!isNative || !this._ready) return 0;
    try {
      const { currentTime } = await this._plugin.getCurrentTime({ assetId: ASSET_ID });
      return (currentTime ?? 0) / 1000;
    } catch (_) {
      return 0;
    }
  }

  getDuration() {
    return this._duration;
  }

  // ── Cleanup listeners ────────────────────────────────────────────────────
  async destroy() {
    clearTimeout(this._seekTimer);
    await this._timeListener?.remove?.();
    await this._completeListener?.remove?.();
    await this._stateListener?.remove?.();
    await this._interruptionListener?.remove?.();
    await this._appStateListener?.remove?.();
    await this.stop();
  }
}

export const nativeAudioPlayer = new NativeAudioPlayer();