/**
 * NativeAudioPlayer
 *
 * On Android (Capacitor): uses capacitor-music-controls-plugin to create a
 * native Foreground Service that keeps playback alive with screen off.
 *
 * On Web/PWA: all methods are no-ops — PlayerContext handles everything.
 *
 * NOTE: @capacitor/core is NOT imported at module level to avoid build errors
 * when running as a plain web app. It is detected at runtime via window.Capacitor.
 */

// Detect Capacitor at runtime — safe for web builds (no import needed)
export const isNative = !!(
  typeof window !== 'undefined' &&
  window.Capacitor &&
  window.Capacitor.isNativePlatform &&
  window.Capacitor.isNativePlatform()
);

class NativeAudioPlayer {
  constructor() {
    this.queue = [];
    this.currentIndex = 0;
    this._onAdvance = null;
    this._initialized = false;
    this._MusicControls = null;
  }

  /** Call once on app mount. No-op on web. */
  async initialize(onAdvance) {
    if (!isNative) return;
    if (this._initialized) return;
    this._initialized = true;

    this._onAdvance = onAdvance;

    // MusicControls is injected by the Capacitor plugin into window
    this._MusicControls = window.MusicControls ?? null;

    if (!this._MusicControls) {
      console.warn('[NativeAudioPlayer] MusicControls plugin not found on window');
      return;
    }

    console.log('[NativeAudioPlayer] initialized on native platform');

    this._MusicControls.subscribe((action) => {
      console.log('[MusicControls] action:', action);
      switch (action) {
        case 'music-controls-next':
          this._onAdvance?.();
          break;
        case 'music-controls-pause':
          this.updatePlayingState(false);
          break;
        case 'music-controls-play':
          this.updatePlayingState(true);
          break;
        default:
          break;
      }
    });

    this._MusicControls.listen();
  }

  setQueue(queue, startIndex = 0) {
    this.queue = queue;
    this.currentIndex = startIndex;
  }

  updateNotification(episode, playing = true) {
    if (!isNative || !this._MusicControls) return;
    this._MusicControls.create({
      track: episode.title || '',
      artist: episode.feedTitle || 'Voxyl',
      cover: episode.image || '',
      isPlaying: playing,
      dismissable: false,
      hasNext: true,
      hasPrev: true,
      hasClose: false,
      playIcon: 'media_play',
      pauseIcon: 'media_pause',
      notificationIcon: 'notification',
    });
  }

  updatePlayingState(playing) {
    if (!isNative || !this._MusicControls) return;
    this._MusicControls.updateIsPlaying({ isPlaying: playing });
  }
}

export const nativeAudioPlayer = new NativeAudioPlayer();