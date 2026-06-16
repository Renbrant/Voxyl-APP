# Android Background Auto-Next — Native Spec ([AUDIO_NEXT])

## Why the bug happens

The episode playback itself runs natively (ExoPlayer + a foreground service), so **audio**
keeps playing while the screen is off. BUT the **decision of what to play next** lives in
JavaScript (`advanceToNextEpisode` in `lib/PlayerContext.jsx`).

When the screen is off / app is backgrounded, Android **freezes the WebView's JS engine**
(Doze / background execution limits). So:

1. ExoPlayer finishes the episode and emits `complete` → JS.
2. JS is frozen, so the `complete` callback that loads the next episode does **not** run.
3. When you unlock/open the app, JS thaws, the callback finally runs, and the next episode
   starts — which is exactly the late behavior you observed.

**Fix: the queue + "play next on end" must live in the NATIVE foreground service**, so it
never depends on the WebView being awake.

---

## What the JS side now does (already implemented in this app)

`lib/nativeAudioPlayer.js` now calls two new methods on your custom
`BackgroundAudioService` Capacitor plugin, and listens for one event:

### JS → Native (calls you must implement)

```js
// Push the full upcoming queue. Called on play and whenever the queue/autoplay changes.
BackgroundAudioService.setQueue({
  items: [
    {
      url: "https://.../episode2.mp3",
      title: "Episode 2",
      artist: "Show name",
      album: "Voxyl",
      artworkUrl: "https://.../art.jpg",
      skipStartSeconds: 0,
      skipEndSeconds: 0
    },
    // ... rest of the queue, in order, starting at the CURRENTLY playing item
  ]
});

// Stop auto-advancing (autoplay off / playback stopped).
BackgroundAudioService.clearQueue();
```

### Native → JS (event you must emit)

```js
// Emit this the moment the NATIVE service starts the next item on its own.
notifyListeners("nativeTrackChanged", { url: "<new url>", index: <queue index> });
```

JS uses `nativeTrackChanged` only to **sync the UI** (title, artwork, index). It does **not**
start another play, so there is no double-play.

> If `setQueue` / `clearQueue` are not implemented yet, the JS calls fail silently and the
> old JS-on-resume fallback still runs — so nothing breaks, the background fix just won't
> activate until the native side ships.

---

## Native implementation (Kotlin, in your Android Studio project)

> These files are in your native Android project, NOT in Base44. Edit them in Android Studio.

### 1. Hold the queue in the service

```kotlin
data class QueueItem(
    val url: String,
    val title: String,
    val artist: String,
    val album: String,
    val artworkUrl: String,
    val skipStartSeconds: Double,
    val skipEndSeconds: Double
)

private val queue = mutableListOf<QueueItem>()
private var currentIndex = 0
private var autoNextEnabled = true
```

### 2. Plugin methods

```kotlin
@PluginMethod
fun setQueue(call: PluginCall) {
    val items = call.getArray("items") ?: JSArray()
    queue.clear()
    for (i in 0 until items.length()) {
        val o = items.getJSONObject(i)
        queue.add(QueueItem(
            url = o.getString("url"),
            title = o.optString("title"),
            artist = o.optString("artist"),
            album = o.optString("album"),
            artworkUrl = o.optString("artworkUrl"),
            skipStartSeconds = o.optDouble("skipStartSeconds", 0.0),
            skipEndSeconds = o.optDouble("skipEndSeconds", 0.0)
        ))
    }
    currentIndex = 0
    autoNextEnabled = true
    Log.d("AUDIO_NEXT", "setQueue: ${queue.size} items")
    call.resolve()
}

@PluginMethod
fun clearQueue(call: PluginCall) {
    autoNextEnabled = false
    queue.clear()
    Log.d("AUDIO_NEXT", "clearQueue")
    call.resolve()
}
```

### 3. Advance natively on ExoPlayer end (THE actual fix)

This runs on the **main/native thread inside the foreground service**, so it is NOT subject
to WebView/JS freezing. This is what makes the next episode start while locked.

```kotlin
player.addListener(object : Player.Listener {
    override fun onPlaybackStateChanged(state: Int) {
        if (state == Player.STATE_ENDED) {
            Log.d("AUDIO_NEXT", "STATE_ENDED at index $currentIndex")
            playNextNative()
        }
    }
})

private fun playNextNative() {
    if (!autoNextEnabled) { Log.d("AUDIO_NEXT", "auto-next disabled"); return }
    val nextIndex = currentIndex + 1
    if (nextIndex >= queue.size) {
        Log.d("AUDIO_NEXT", "no next episode available")
        stopForeground(false)
        return
    }
    currentIndex = nextIndex
    val next = queue[nextIndex]
    Log.d("AUDIO_NEXT", "next selected: ${next.title} -> ${next.url}")

    val item = MediaItem.fromUri(next.url)
    player.setMediaItem(item)
    player.prepare()
    if (next.skipStartSeconds > 0) player.seekTo((next.skipStartSeconds * 1000).toLong())
    player.play()
    updateMediaSessionMetadata(next)        // keep lock screen controls correct
    Log.d("AUDIO_NEXT", "playback started: ${next.title}")

    // Tell JS so the UI updates next time it wakes.
    notifyListeners("nativeTrackChanged", JSObject().apply {
        put("url", next.url)
        put("index", nextIndex)
    })
}
```

### 4. (Optional but recommended) preload the next URL

To avoid a buffering gap at the boundary, build an ExoPlayer `ConcatenatingMediaSource` /
`setMediaItems(queue)` and let ExoPlayer handle transitions via
`onMediaItemTransition`, emitting `nativeTrackChanged` there instead. That is the most
robust approach and removes the manual `STATE_ENDED` handling.

### 5. Keep the foreground service + wake handling

- Foreground service type must include `mediaPlayback` in `AndroidManifest.xml`.
- Acquire a partial `WakeLock` (or rely on ExoPlayer's `setWakeMode(C.WAKE_MODE_NETWORK)`)
  so streaming continues through Doze:
  ```kotlin
  player.setWakeMode(C.WAKE_MODE_NETWORK)
  player.setHandleAudioBecomingNoisy(true)
  ```
- Do not stop the foreground service between episodes — only when the queue ends.

---

## How to test on Android with logcat

1. Build & install the APK.
2. Connect device, run:
   ```
   adb logcat -s AUDIO_NEXT
   ```
3. In the app: start a playlist, then **lock the phone**.
4. Let the current episode finish. You should see (WITHOUT unlocking):
   ```
   AUDIO_NEXT  STATE_ENDED at index 0
   AUDIO_NEXT  next selected: Episode 2 -> https://...
   AUDIO_NEXT  playback started: Episode 2
   ```
   and audio should continue to the next episode.
5. Unlock the app — it should already be on Episode 2 (JS logs `syncing JS state to
   natively-advanced track`), with no restart and no double-play.

### What "wrong/old" behavior looks like in logs
If you only see the `next selected/started` logs **after** you unlock the phone, the native
`setQueue` / `STATE_ENDED` handling is not active yet — verify steps 1–3 above shipped in
the native build.