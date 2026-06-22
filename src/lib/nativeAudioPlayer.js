import { Capacitor, registerPlugin } from '@capacitor/core';

const getNativeAudio = () => window?.Capacitor?.Plugins?.NativeAudio ?? null;
const getApp = () => window?.Capacitor?.Plugins?.App ?? null;

export const isNative = Capacitor.isNativePlatform();

const ASSET_ID = 'voxyl_current';
const BackgroundAudioService = registerPlugin('BackgroundAudioService');

class NativeAudioPlayer {
  constructor() {
    this._plugin = null;
    this._ready = false;
    this._currentUrl = null;
    this._duration = 0;
    this._isPlaying = false;
    this._onTimeUpdate = null;
    this._onEnded = null;
    this._onStateChange = null;
    this._onNativeTrackChanged = null;
    this._onPlaybackError = null;
    this._onQueueCompleted = null;
    this._timeListener = null;
    this._stateListener = null;
    this._completeListener = null;
    this._nativeTrackChangedListener = null;
    this._playbackErrorListener = null;
    this._queueCompletedListener = null;
    this._appStateListener = null;
    this._trackChangeListener = null;
  }

  async initialize({ onTimeUpdate, onEnded, onStateChange, onNativeTrackChanged, onPlaybackError, onQueueCompleted }) {
    if (!isNative) return;
    if (this._ready) return;

    this._onTimeUpdate = onTimeUpdate;
    this._onEnded = onEnded;
    this._onStateChange = onStateChange;
    this._onNativeTrackChanged = onNativeTrackChanged;
    this._onPlaybackError = onPlaybackError;
    this._onQueueCompleted = onQueueCompleted;

    console.log('[NativeAudioPlayer] initialize() - isNative:', isNative);
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

      this._timeListener = await this._plugin.addListener('currentTime', (data) => {
        const posSec = data.currentTime ?? 0;
        this._onTimeUpdate?.(posSec, this._duration);
      });

      this._completeListener = await this._plugin.addListener('complete', (data) => {
        if (data.assetId === ASSET_ID) {
          console.log('[PLAYLIST] ended fired', {
            source: 'native',
            url: this._currentUrl,
          });
          this._onEnded?.();
        }
      });

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

      this._nativeTrackChangedListener = await this._plugin.addListener('nativeTrackChanged', (data) => {
        console.log('[AUDIO_NEXT] nativeTrackChanged', data);
        this._currentUrl = data?.url || data?.audioUrl || this._currentUrl;
        this._duration = 0;
        this._isPlaying = true;
        this._onNativeTrackChanged?.(data);
        this._onStateChange?.(true);
      });

      this._playbackErrorListener = await this._plugin.addListener('playbackError', (data) => {
        console.error('[AUDIO_NEXT] playbackError', data);
        this._isPlaying = false;
        this._onPlaybackError?.(data);
        this._onStateChange?.(false);
      });

      this._queueCompletedListener = await this._plugin.addListener('queueCompleted', (data) => {
        console.log('[AUDIO_NEXT] queueCompleted', data);
        this._isPlaying = false;
        this._onQueueCompleted?.(data);
        this._onStateChange?.(false);
      });

      try {
        this._trackChangeListener = await BackgroundAudioService.addListener('nativeTrackChanged', (data) => {
          console.log('[AUDIO_NEXT] native foreground service advanced track', data);
          this._currentUrl = data?.url || data?.audioUrl || this._currentUrl;
          this._duration = 0;
          this._isPlaying = true;
          this._onNativeTrackChanged?.(data);
          this._onStateChange?.(true);
        });
      } catch (_) {
        // Older native builds may not emit this compatibility event.
      }

      const App = getApp();
      if (App) {
        this._appStateListener = await App.addListener('appStateChange', async (state) => {
          if (state.isActive && this._currentUrl) {
            try {
              const { currentTime } = await this._plugin.getCurrentTime({ assetId: ASSET_ID });
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
      console.log('[NativeAudioPlayer] initialized successfully');
    } catch (err) {
      console.error('[NativeAudioPlayer] init FAILED:', err?.message, err);
    }
  }

  async play(episode, resumeAt = 0) {
    console.log('[NativeAudioPlayer] play() called - isNative:', isNative, '_ready:', this._ready, 'url:', episode?.audioUrl);
    if (!isNative || !this._ready) {
      throw new Error(`Native audio is unavailable (native=${isNative}, ready=${this._ready})`);
    }

    const url = episode.audioUrl;
    if (!url) {
      throw new Error('Episode has no audio URL');
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      console.error('[NativeAudioPlayer] play() - audioUrl is NOT absolute HTTPS!', url);
    }

    console.log('[NativeAudioPlayer] loading URL:', url, '| resumeAt:', resumeAt);

    try {
      await BackgroundAudioService.start().catch((error) => {
        console.warn('[NativeAudioPlayer] foreground service start failed:', error?.message);
      });

      if (this._currentUrl && this._currentUrl !== url) {
        console.log('[NativeAudioPlayer] unloading previous asset:', this._currentUrl);
        await this._plugin.unload({ assetId: ASSET_ID }).catch(() => {});
      }

      this._currentUrl = url;
      this._duration = 0;

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

  _toNativeQueueItem(episode, index) {
    return {
      id: episode?.id || episode?.episodeId || episode?.audioUrl || '',
      title: episode?.title || '',
      podcastTitle: episode?.podcastTitle || episode?.feedTitle || episode?.showTitle || '',
      feedTitle: episode?.feedTitle || episode?.podcastTitle || episode?.showTitle || '',
      audioUrl: episode?.audioUrl || episode?.url || '',
      url: episode?.audioUrl || episode?.url || '',
      artworkUrl: episode?.artworkUrl || episode?.image || episode?.podcastImage || '',
      image: episode?.image || episode?.artworkUrl || episode?.podcastImage || '',
      playlistId: episode?.playlistId || episode?.playlist_id || '',
      index,
    };
  }

  async setQueue(queue = [], startIndex = 0, autoplay = true) {
    if (!isNative || !this._ready || !this._plugin?.setQueue) return;
    const nativeQueue = queue.map((episode, index) => this._toNativeQueueItem(episode, index));
    await this._plugin.setQueue({ queue: nativeQueue, startIndex, autoplay }).catch((error) => {
      console.error('[AUDIO_NEXT] setQueue failed', error?.message, error);
    });
  }

  async updateQueue(queue = [], currentIndex = 0, autoplay = true) {
    if (!isNative || !this._ready || !this._plugin?.updateQueue) return;
    const nativeQueue = queue.map((episode, index) => this._toNativeQueueItem(episode, index));
    await this._plugin.updateQueue({ queue: nativeQueue, currentIndex, autoplay }).catch((error) => {
      console.error('[AUDIO_NEXT] updateQueue failed', error?.message, error);
    });
  }

  async clearQueue() {
    if (!isNative || !this._ready || !this._plugin?.clearQueue) return;
    await this._plugin.clearQueue().catch((error) => {
      console.error('[AUDIO_NEXT] clearQueue failed', error?.message, error);
    });
  }

  async playQueueIndex(index) {
    if (!isNative || !this._ready || !this._plugin?.playQueueIndex) return;
    await this._plugin.playQueueIndex({ index });
  }

  async playNext() {
    if (!isNative || !this._ready || !this._plugin?.playNext) return;
    await this._plugin.playNext();
  }

  async playPrevious() {
    if (!isNative || !this._ready || !this._plugin?.playPrevious) return;
    await this._plugin.playPrevious();
  }

  async setNativeQueue(episodes, startIndex, autoplay = true) {
    console.log('[AUDIO_NEXT] pushing native queue', { count: episodes?.length || 0, startIndex });
    await this.updateQueue(episodes || [], startIndex, autoplay);
    console.log('[AUDIO_NEXT] native queue accepted');
  }

  async clearNativeQueue() {
    await this.clearQueue();
    console.log('[AUDIO_NEXT] native queue cleared');
  }

  async _pollDuration(urlAtStart, resumeAt) {
    const MAX_ATTEMPTS = 30;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      if (this._currentUrl !== urlAtStart) return;
      await new Promise(r => setTimeout(r, 200));
      try {
        const { duration } = await this._plugin.getDuration({ assetId: ASSET_ID });
        const durSec = duration ?? 0;
        if (durSec > 0) {
          this._duration = durSec;
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

  async pause() {
    if (!isNative || !this._ready) return;
    await this._plugin.pause({ assetId: ASSET_ID }).catch(() => {});
    this._isPlaying = false;
  }

  async resume() {
    if (!isNative || !this._ready) return;
    await this._plugin.resume({ assetId: ASSET_ID }).catch(() => {});
    this._isPlaying = true;
  }

  seek(seconds) {
    if (!isNative || !this._ready) return;
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

  async stop() {
    if (!isNative || !this._ready) return;
    await this._plugin.stop({ assetId: ASSET_ID }).catch(() => {});
    await this._plugin.unload({ assetId: ASSET_ID }).catch(() => {});
    await BackgroundAudioService.stop().catch(() => {});
    this._currentUrl = null;
    this._duration = 0;
  }

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

  async destroy() {
    clearTimeout(this._seekTimer);
    await this._timeListener?.remove?.();
    await this._completeListener?.remove?.();
    await this._stateListener?.remove?.();
    await this._nativeTrackChangedListener?.remove?.();
    await this._playbackErrorListener?.remove?.();
    await this._queueCompletedListener?.remove?.();
    await this._appStateListener?.remove?.();
    await this._trackChangeListener?.remove?.();
    await this.stop();
  }
}

export const nativeAudioPlayer = new NativeAudioPlayer();
