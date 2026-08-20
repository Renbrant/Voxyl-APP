import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const read = relativePath =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Issue #81 native playback singleton foundation', async t => {
  const service = read(
    'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackService.java',
  );

  const manifest = read(
    'android/app/src/main/AndroidManifest.xml',
  );

  const gradle = read(
    'android/app/build.gradle',
  );

  const mainActivity = read(
    'android/app/src/main/java/com/renbrant/voxyl/MainActivity.java',
  );

  await t.test('owns the ExoPlayer in a MediaSessionService, not the Activity', () => {
    assert.match(
      service,
      /class VoxylPlaybackService extends MediaSessionService/,
    );

    const playerConstructors =
      service.match(/new ExoPlayer\.Builder\(this\)/g) || [];

    assert.equal(
      playerConstructors.length,
      1,
      'the playback service must construct exactly one ExoPlayer',
    );

    assert.match(
      service,
      /new MediaSession\.Builder\(this,\s*player\)/,
    );

    assert.doesNotMatch(
      mainActivity,
      /\bExoPlayer\b|\bMediaSession\b/,
      'MainActivity must not own playback',
    );
  });

  await t.test('releases native playback resources only with the service lifecycle', () => {
    assert.match(service, /mediaSession\.release\(\)/);
    assert.match(service, /player\.release\(\)/);
    assert.match(service, /public void onDestroy\(\)/);
  });

  await t.test('declares the service as a media playback foreground service', () => {
    assert.match(
      manifest,
      /android:name="\.VoxylPlaybackService"/,
    );

    assert.match(
      manifest,
      /android:foregroundServiceType="mediaPlayback"/,
    );

    assert.match(
      manifest,
      /android:name="androidx\.media3\.session\.MediaSessionService"/,
    );
  });

  await t.test('declares Media3 directly instead of relying on transitive Capgo dependencies', () => {
    assert.match(gradle, /media3-common:1\.10\.1/);
    assert.match(gradle, /media3-exoplayer:1\.10\.0/);
    assert.match(gradle, /media3-exoplayer-hls:1\.10\.0/);
    assert.match(gradle, /media3-session:1\.10\.0/);
  });

  await t.test('controller bridge reconnects to the process-owned service', () => {
    const plugin = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java',
    );

    assert.match(
      plugin,
      /@CapacitorPlugin\(name = "VoxylPlayback"\)/,
    );

    assert.match(
      plugin,
      /new SessionToken\([\s\S]*VoxylPlaybackService\.class/,
    );

    assert.match(
      plugin,
      /new MediaController\.Builder\(/,
    );

    assert.doesNotMatch(
      plugin,
      /new ExoPlayer|new MediaSession/,
      'the Capacitor bridge must never own playback',
    );
  });

  await t.test('registers the controller bridge without moving ownership into MainActivity', () => {
    assert.match(
      mainActivity,
      /registerPlugin\(VoxylPlaybackPlugin\.class\)/,
    );

    assert.doesNotMatch(
      mainActivity,
      /\bExoPlayer\b|\bMediaSession\b|\bMediaController\b/,
      'MainActivity must remain ownership-free',
    );
  });

  await t.test('exposes reconnectable state and playback controls through MediaController', () => {
    const plugin = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java',
    );

    for (const method of [
      'getState',
      'playMedia',
      'pause',
      'resume',
      'seek',
      'stop',
    ]) {
      assert.match(
        plugin,
        new RegExp(`public void ${method}\\(PluginCall call\\)`),
        `missing native bridge method: ${method}`,
      );
    }

    assert.match(
      plugin,
      /\.setMediaId\(audioUrl\)/,
      'audio URL must remain discoverable after Activity recreation',
    );

    assert.match(plugin, /controller\.getCurrentPosition\(\)/);
    assert.match(plugin, /controller\.getDuration\(\)/);
    assert.match(plugin, /controller\.isPlaying\(\)/);
  });

  await t.test('releases only the Activity-scoped MediaController on bridge destruction', () => {
    const plugin = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java',
    );

    assert.match(
      plugin,
      /protected void handleOnDestroy\(\)/,
    );

    assert.match(
      plugin,
      /MediaController\.releaseFuture\(future\)/,
    );

    assert.doesNotMatch(
      plugin,
      /stopService|player\.release|mediaSession\.release/,
      'bridge teardown must not terminate process-owned playback',
    );
  });

  await t.test('stores the Voxyl queue in the process-owned Media3 playlist', () => {
    const plugin = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java',
    );

    for (const method of [
      'setQueue',
      'updateQueue',
      'clearQueue',
      'playQueueIndex',
      'playNext',
      'playPrevious',
    ]) {
      assert.match(
        plugin,
        new RegExp(`public void ${method}\\(PluginCall call\\)`),
        `missing native queue method: ${method}`,
      );
    }

    assert.match(
      plugin,
      /\b(?:controller|resolvedController)\.setMediaItems\(/,
      'the controller bridge must mutate the process-owned Media3 playlist',
    );

    assert.match(
      plugin,
      /\.setMediaId\(audioUrl\)/,
      'audio URL must remain the stable media identity',
    );
  });

  await t.test('uses Media3 native next and previous navigation instead of constructing another player', () => {
    const plugin = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java',
    );

    assert.match(plugin, /controller\.seekToNextMediaItem\(\)/);
    assert.match(plugin, /controller\.seekToPreviousMediaItem\(\)/);

    assert.doesNotMatch(
      plugin,
      /new ExoPlayer|new MediaSession/,
      'queue navigation must remain controller-only',
    );
  });

  await t.test('reports native automatic track transitions and queue completion', () => {
    const plugin = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java',
    );

    assert.match(
      plugin,
      /onMediaItemTransition\(/,
    );

    assert.match(
      plugin,
      /MEDIA_ITEM_TRANSITION_REASON_AUTO/,
    );

    assert.match(
      plugin,
      /notifyListeners\(\s*"nativeTrackChanged"/,
    );

    assert.match(
      plugin,
      /Player\.STATE_ENDED/,
    );

    assert.match(
      plugin,
      /notifyListeners\("queueCompleted"/,
    );
  });

  await t.test('makes queue and current index queryable after Activity recreation', () => {
    const plugin = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java',
    );

    assert.match(
      plugin,
      /controller\.getCurrentMediaItemIndex\(\)/,
    );

    assert.match(
      plugin,
      /controller\.getMediaItemCount\(\)/,
    );

    assert.match(
      plugin,
      /state\.put\(\s*"queueSize"/,
    );

    assert.match(
      plugin,
      /state\.put\(\s*"index"/,
    );
  });

  await t.test('clears upcoming queue state without stopping the currently audible item', () => {
    const plugin = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java',
    );

    const clearQueueStart =
      plugin.indexOf('public void clearQueue(PluginCall call)');

    const playQueueIndexStart =
      plugin.indexOf('public void playQueueIndex(PluginCall call)');

    assert.ok(clearQueueStart >= 0);
    assert.ok(playQueueIndexStart > clearQueueStart);

    const clearQueueBody =
      plugin.slice(clearQueueStart, playQueueIndexStart);

    assert.match(
      clearQueueBody,
      /controller\.setMediaItem\(\s*currentItem,\s*currentPositionMs\s*\)/,
      'clearQueue must collapse the queue around the current item',
    );

    assert.doesNotMatch(
      clearQueueBody,
      /controller\.stop\(\)/,
      'disabling auto-advance must not stop current playback',
    );
  });

  await t.test('keeps autoplay policy inside the process-owned service', () => {
    const service = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackService.java',
    );

    assert.match(
      service,
      /COMMAND_SET_AUTOPLAY/,
    );

    assert.match(
      service,
      /player\.setPauseAtEndOfMediaItems\(\s*!enabled\s*\)/,
      'autoplay=false must pause at media-item boundaries without destroying the playlist',
    );

    assert.match(
      service,
      /session\.setSessionExtras\(/,
      'autoplay state must survive Activity/controller recreation',
    );
  });

  await t.test('changes autoplay through a MediaSession custom command rather than direct player access', () => {
    const plugin = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java',
    );

    assert.match(
      plugin,
      /public void setAutoplay\(PluginCall call\)/,
    );

    assert.match(
      plugin,
      /controller\.sendCustomCommand\(/,
    );

    assert.match(
      plugin,
      /VoxylPlaybackService\.COMMAND_SET_AUTOPLAY/,
    );

    assert.doesNotMatch(
      plugin,
      /setPauseAtEndOfMediaItems/,
      'the Activity-scoped bridge must not control ExoPlayer-specific state directly',
    );
  });

  await t.test('makes setQueue and updateQueue apply their autoplay argument without clearing the queue', () => {
    const plugin = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java',
    );

    const replaceQueueStart =
      plugin.indexOf('private void replaceQueue(');

    const buildQueueStart =
      plugin.indexOf('private List<MediaItem> buildQueue(');

    assert.ok(replaceQueueStart >= 0);
    assert.ok(buildQueueStart > replaceQueueStart);

    const replaceQueueBody =
      plugin.slice(replaceQueueStart, buildQueueStart);

    assert.match(
      replaceQueueBody,
      /call\.getBoolean\(\s*"autoplay",\s*true\s*\)/,
    );

    assert.match(
      replaceQueueBody,
      /applyAutoplay\(/,
    );

    assert.match(
      replaceQueueBody,
      /setMediaItems\(/,
      'changing autoplay must retain the Media3 playlist model',
    );
  });

  await t.test('reports persistent autoplay state through getState after controller recreation', () => {
    const plugin = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java',
    );

    assert.match(
      plugin,
      /controller\.getSessionExtras\(\)/,
    );

    assert.match(
      plugin,
      /VoxylPlaybackService\.EXTRA_AUTOPLAY_ENABLED/,
    );

    assert.match(
      plugin,
      /state\.put\(\s*"autoplay"/,
    );
  });

  await t.test('preserves native queue identity metadata inside Media3 media items', () => {
    const plugin = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java',
    );

    assert.match(plugin, /EXTRA_QUEUE_ITEM_JSON/);
    assert.match(plugin, /item\.toString\(\)/);
    assert.match(plugin, /metadataBuilder\.setExtras\(extras\)/);
  });

  await t.test('restores the complete native queue through getState', () => {
    const plugin = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java',
    );

    assert.match(plugin, /buildQueuePayload\(controller\)/);
    assert.match(plugin, /controller\.getMediaItemAt\(index\)/);
    assert.match(plugin, /state\.put\(\s*"queue"/);
    assert.match(plugin, /state\.put\(\s*"currentTrack"/);
  });

  await t.test('restoration payload carries stable episode and playlist identity', () => {
    const plugin = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java',
    );

    for (const field of [
      'id',
      'episodeId',
      'title',
      'podcastTitle',
      'feedTitle',
      'audioUrl',
      'artworkUrl',
      'playlistId',
      'index',
    ]) {
      assert.match(
        plugin,
        new RegExp(`payload\\.put\\(\\s*"${field}"`),
        `restoration field missing: ${field}`,
      );
    }
  });

  await t.test('activates the process-owned VoxylPlayback bridge for Android', () => {
    const wrapper = read('src/lib/nativeAudioPlayer.js');

    assert.match(wrapper, /registerPlugin\('VoxylPlayback'\)/);
    assert.match(wrapper, /VoxylPlayback\.getState\(\)/);

    assert.match(wrapper, /const isAndroidNative =/);
    assert.match(wrapper, /await this\._initializeVoxylPlayback\(\)/);
    assert.match(wrapper, /this\._plugin = VoxylPlayback/);
  });

  await t.test('retains the legacy native-audio implementation outside Android', () => {
    const wrapper = read('src/lib/nativeAudioPlayer.js');

    assert.match(wrapper, /this\._plugin = getNativeAudio\(\)/);
    assert.match(wrapper, /this\._plugin\.configure\(\{/);
    assert.match(wrapper, /BackgroundAudioService\.start\(\)/);
    assert.match(wrapper, /this\._plugin\.preload\(\{/);
  });

  await t.test('routes Android playback controls through the process-owned bridge', () => {
    const wrapper = read('src/lib/nativeAudioPlayer.js');

    assert.match(wrapper, /this\._plugin\.playMedia\(\{/);
    assert.match(wrapper, /this\._plugin\.pause\(\)/);
    assert.match(wrapper, /this\._plugin\.resume\(\)/);
    assert.match(wrapper, /this\._plugin\.seek\(\{\s*seconds\s*\}\)/);
    assert.match(wrapper, /this\._plugin\.stop\(\)/);
  });

  await t.test('restores and polls the process-owned Android playback state', () => {
    const wrapper = read('src/lib/nativeAudioPlayer.js');

    assert.match(wrapper, /VoxylPlayback\.getState\(\)/);
    assert.match(wrapper, /this\._positionPoll = setInterval\(/);
    assert.match(wrapper, /appStateChange/);
    assert.match(wrapper, /this\._onTimeUpdate\?\.\(/);
  });

  await t.test('does not stop process-owned Android playback when the WebView is destroyed', () => {
    const wrapper = read('src/lib/nativeAudioPlayer.js');
    const destroyStart = wrapper.indexOf('async destroy()');

    assert.ok(destroyStart >= 0);

    const destroyBody = wrapper.slice(destroyStart);
    const androidStart = destroyBody.indexOf('if (isAndroidNative)');
    const androidReturn = destroyBody.indexOf('return;', androidStart);

    assert.ok(androidStart >= 0);
    assert.ok(androidReturn > androidStart);

    const androidBranch = destroyBody.slice(androidStart, androidReturn);

    assert.doesNotMatch(
      androidBranch,
      /this\.stop\(/,
      'WebView destruction must disconnect only the JS controller',
    );
  });

  await t.test('publishes persistent Android state on initial and foreground reconnection', () => {
    const wrapper = read('src/lib/nativeAudioPlayer.js');

    assert.match(wrapper, /onRestoredState/);

    const publishes =
      wrapper.match(/this\._onRestoredState\?\.\(/g)?.length || 0;

    assert.ok(
      publishes >= 2,
      'restoration must publish both initial and foreground state',
    );
  });

  await t.test('reconstructs React playback state from the persistent Android session', () => {
    const context = read('src/lib/PlayerContext.jsx');
    const start = context.indexOf('const reconcileNativePlaybackState');
    const end = context.indexOf('// ── NATIVE PLAYER SETUP', start);

    assert.ok(start >= 0);
    assert.ok(end > start);

    const restoration = context.slice(start, end);

    assert.match(restoration, /state\.queue/);
    assert.match(restoration, /state\.currentTrack/);
    assert.match(restoration, /queueRef\.current = restoredQueue/);
    assert.match(restoration, /currentEpisodeRef\.current = restoredEpisode/);
    assert.match(restoration, /nativeCurrentTimeRef\.current = restoredPosition/);
    assert.match(restoration, /setCurrentEpisode\(restoredEpisode\)/);
    assert.doesNotMatch(
      restoration,
      /nativeAudioPlayer\.play\(/,
      'restoring the UI must never start another audio stream',
    );

    assert.match(
      context,
      /onRestoredState:\s*reconcileNativePlaybackState/,
    );
  });

  await t.test('keeps the native queue when autoplay is disabled', () => {
    const context = read('src/lib/PlayerContext.jsx');
    const start = context.indexOf('// ── Persist autoplay + notify SW');
    const end = context.indexOf('// ── PLAYBACK API', start);

    assert.ok(start >= 0);
    assert.ok(end > start);

    const autoplayEffect = context.slice(start, end);

    assert.match(autoplayEffect, /setNativeQueue\(/);
    assert.match(autoplayEffect, /autoplay/);
    assert.doesNotMatch(
      autoplayEffect,
      /clearNativeQueue\(/,
      'autoplay=false must pause auto-advance without deleting the queue',
    );
  });

  await t.test('preserves playback policy metadata when serializing the Android native queue', () => {
    const player = read('src/lib/nativeAudioPlayer.js');

    const start = player.indexOf('_toNativeQueueItem(episode, index)');
    const end = player.indexOf('async setQueue(', start);

    assert.ok(start >= 0);
    assert.ok(end > start);

    const serializer = player.slice(start, end);

    assert.match(serializer, /feedUrl:\s*episode\?\.feedUrl\s*\|\|\s*episode\?\.feed_url/);
    assert.match(serializer, /skip_start_seconds:\s*Number\.isFinite/);
    assert.match(serializer, /skip_end_seconds:\s*Number\.isFinite/);
    assert.match(serializer, /Math\.max\(0,\s*Number\(episode\.skip_start_seconds\)\)/);
    assert.match(serializer, /Math\.max\(0,\s*Number\(episode\.skip_end_seconds\)\)/);
  });

  await t.test('restores feed and skip policy metadata after Activity recreation', () => {
    const plugin = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java',
    );

    const start = plugin.indexOf('private JSObject buildRestoredQueueItem(');
    const end = plugin.indexOf('private String jsonString(', start);

    assert.ok(start >= 0);
    assert.ok(end > start);

    const restoration = plugin.slice(start, end);

    assert.match(restoration, /"feedUrl"/);
    assert.match(restoration, /jsonString\(source,\s*"feedUrl"\)/);
    assert.match(restoration, /jsonString\(source,\s*"feed_url"\)/);
    assert.match(restoration, /"skip_start_seconds"/);
    assert.match(restoration, /"skip_end_seconds"/);
    assert.match(restoration, /jsonNonNegativeDouble\(/);
    assert.match(plugin, /return Math\.max\(0\.0,\s*value\);/);
  });

  await t.test('polls Android position through a lightweight snapshot without serializing the queue', () => {
    const wrapper = read('src/lib/nativeAudioPlayer.js');

    const pollStart = wrapper.indexOf('async _pollVoxylPlaybackState()');
    const pollEnd = wrapper.indexOf('async _initializeVoxylPlayback()', pollStart);

    assert.ok(pollStart >= 0);
    assert.ok(pollEnd > pollStart);

    const poll = wrapper.slice(pollStart, pollEnd);

    assert.match(
      poll,
      /this\._plugin\.getPlaybackSnapshot\(\)/,
    );

    assert.doesNotMatch(
      poll,
      /_getVoxylPlaybackState\(/,
      '500 ms polling must not request the full restored queue state',
    );

    const plugin = read(
      'android/app/src/main/java/com/renbrant/voxyl/VoxylPlaybackPlugin.java',
    );

    const snapshotStart =
      plugin.indexOf('public void getPlaybackSnapshot(');

    const snapshotEnd =
      plugin.indexOf('public void setQueue(', snapshotStart);

    assert.ok(snapshotStart >= 0);
    assert.ok(snapshotEnd > snapshotStart);

    const snapshot = plugin.slice(snapshotStart, snapshotEnd);

    assert.match(snapshot, /"position"/);
    assert.match(snapshot, /"duration"/);

    assert.doesNotMatch(
      snapshot,
      /buildState\(|buildQueuePayload\(|buildRestoredQueueItem\(|"queue"|"currentTrack"/,
      'polling snapshot must never serialize native queue restoration data',
    );
  });
});
