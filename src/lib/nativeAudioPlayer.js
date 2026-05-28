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
    this._plugin = null;       // @capgo/capacitor-native-audio NativeAudio
    this._ready = false;
    this._currentUrl = null;
    this._duration = 0;
    this._onTimeUpdate = null; // (posSeconds, durSeconds) => void
    this._onEnded = null;      // () => void
    this._onStateChange = null; // (playing: boolean) => void
    this._timeListener = null;
    this._stateListener = null;
    this._completeListener = null;
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  async initialize({ onTimeUpdate, onEnded, onStateChange }) {
    if (!isNative) return;
    if (this._ready) return;

    this._onTimeUpdate = onTimeUpdate;
    this._onEnded = onEnded;
    this._onStateChange = onStateChange;

    try {
      // Access plugin via Capacitor's global registry — zero static/dynamic imports
      // The plugin registers itself on window.Capacitor.Plugins when loaded natively
      const NativeAudio = window.Capacitor?.Plugins?.NativeAudio ?? null;
      if (!NativeAudio) {
        console.warn('[NativeAudioPlayer] NativeAudio plugin not found in Capacitor.Plugins');
        return;
      }
      this._plugin = NativeAudio;

      await this._plugin.configure({
        fade: false,
        focus: true,          // Request audio focus (Android) / AVAudioSession (iOS)
        backgroundAudio: true, // Keep playback alive when screen locks / app backgrounds
      });

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

      // Playback state (play/pause from lockscreen, BT, notification)
      this._stateListener = await this._plugin.addListener('playbackState', (data) => {
        // data: { assetId, playing }
        this._onStateChange?.(data.playing);
      });

      this._ready = true;
      console.log('[NativeAudioPlayer] initialized');
    } catch (err) {
      console.warn('[NativeAudioPlayer] init failed:', err?.message);
    }
  }

  // ── Load + Play ───────────────────────────────────────────────────────────
  async play(episode, resumeAt = 0) {
    if (!isNative || !this._ready) return;

    const url = episode.audioUrl;

    try {
      // Unload previous asset if URL changed
      if (this._currentUrl && this._currentUrl !== url) {
        await this._plugin.unload({ assetId: ASSET_ID }).catch(() => {});
      }

      this._currentUrl = url;
      this._duration = 0;

      // Preload (registers the asset with the native engine)
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

      await this._plugin.play({ assetId: ASSET_ID });

      // iOS AVPlayer populates duration asynchronously after play() starts.
      // Poll until we get a valid value (up to ~3s).
      this._pollDuration(url, resumeAt);

    } catch (err) {
      console.error('[NativeAudioPlayer] play() failed:', err?.message);
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
  }

  // ── Resume ───────────────────────────────────────────────────────────────
  async resume() {
    if (!isNative || !this._ready) return;
    await this._plugin.resume({ assetId: ASSET_ID }).catch(() => {});
  }

  // ── Seek ─────────────────────────────────────────────────────────────────
  async seek(seconds) {
    if (!isNative || !this._ready) return;
    await this._plugin.setCurrentTime({
      assetId: ASSET_ID,
      time: seconds * 1000,
    }).catch(() => {});
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
    await this._timeListener?.remove?.();
    await this._completeListener?.remove?.();
    await this._stateListener?.remove?.();
    await this.stop();
  }
}

export const nativeAudioPlayer = new NativeAudioPlayer();