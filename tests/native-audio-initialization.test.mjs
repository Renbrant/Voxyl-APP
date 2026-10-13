import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const wrapperSource = await readFile(new URL('../src/lib/nativeAudioPlayer.js', import.meta.url), 'utf8');
// Exercise the shipped player wrapper with Capacitor bridge objects, without a device.
const makePlayer = new Function(
  'Capacitor', 'registerPlugin', 'window', 'setInterval', 'clearInterval', 'console',
  wrapperSource
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export const isNative', 'const isNative')
    .replace('export const nativeAudioPlayer', 'const nativeAudioPlayer')
    + '\nreturn nativeAudioPlayer;',
);

function createNativePlayer(app) {
  const calls = [];
  const removed = [];
  const playback = {
    async addListener(name) { return { async remove() { removed.push(name); } }; },
    async getState() { return { hasMedia: false, isPlaying: false, duration: 0, position: 0 }; },
    async playMedia(media) {
      calls.push(media);
      return { hasMedia: true, audioUrl: media.audioUrl, isPlaying: true, duration: 60 };
    },
  };
  const player = makePlayer(
    { isNativePlatform: () => true, getPlatform: () => 'android' },
    name => name === 'VoxylPlayback' ? playback : {},
    { Capacitor: { Plugins: { App: app } } },
    () => 1,
    () => {},
    { log() {}, warn() {}, error() {} },
  );
  return { player, calls, removed };
}

for (const mode of ['legacy handle', 'promise handle', 'rejected promise', 'synchronous error', 'no App plugin']) {
  test(`Android player initializes and plays with an app-state ${mode}`, async () => {
    let appHandler;
    let appRemoved = false;
    const handle = { async remove() { appRemoved = true; } };
    const app = mode === 'no App plugin' ? null : {
      addListener(name, handler) {
        assert.equal(name, 'appStateChange');
        appHandler = handler;
        if (mode === 'synchronous error') throw new Error('Unavailable optional app listener');
        if (mode === 'rejected promise') return Promise.reject(new Error('Unavailable optional app listener'));
        return mode === 'promise handle' ? Promise.resolve(handle) : handle;
      },
    };
    const { player, calls, removed } = createNativePlayer(app);
    let restoredStates = 0;
    await player.initialize({ onRestoredState() { restoredStates++; } });
    assert.equal(player.isReady(), true, 'optional app lifecycle listeners must not block playback readiness');
    assert.equal(restoredStates, 1);
    await player.play({ audioUrl: 'https://example.com/episode.mp3', title: 'Episode' }, 7);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].audioUrl, 'https://example.com/episode.mp3');
    assert.equal(calls[0].resumeAt, 7);
    if (mode === 'legacy handle' || mode === 'promise handle') {
      await appHandler({ isActive: true });
      assert.equal(restoredStates, 2, 'foreground restoration stays connected');
    }
    await player.destroy();
    assert.equal(player.isReady(), false);
    assert.equal(removed.length, 4);
    assert.equal(appRemoved, mode === 'legacy handle' || mode === 'promise handle');
  });
}
