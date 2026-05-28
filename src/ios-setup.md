# iOS Native Setup for Voxyl — Background Audio (App Store Required)

These steps **must** be done manually in Xcode after running `npx cap sync ios`.
They cannot be automated from JavaScript/capacitor.config.ts alone.

---

## 1. Enable Background Modes in Xcode

1. Open `ios/App/App.xcworkspace` in Xcode
2. Select the **App** target → **Signing & Capabilities** tab
3. Click **+ Capability** → add **Background Modes**
4. Check ✅ **Audio, AirPlay, and Picture in Picture**

This writes the `UIBackgroundModes` key to the entitlements file automatically.

---

## 2. Verify Info.plist has `UIBackgroundModes`

Open `ios/App/App/Info.plist` and confirm this block exists (Xcode adds it when you check the capability above, but verify):

```xml
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
</array>
```

If it's missing, add it manually to `Info.plist`.

---

## 3. AVAudioSession — Background Audio Category

`@capgo/capacitor-native-audio` sets `AVAudioSessionCategoryPlayback` automatically when `focus: true` is configured (which Voxyl already does in `capacitor.config.ts` and `nativeAudioPlayer.js`).

**`AVAudioSessionCategoryPlayback`** is the correct category for:
- ✅ Screen locked playback
- ✅ Background playback
- ✅ Silence switch ignored (audio plays even on silent mode)
- ✅ Lock screen + Control Center controls
- ✅ Bluetooth media controls (AirPods, car, etc.)

No additional Swift/ObjC code is needed if using `@capgo/capacitor-native-audio` with `focus: true`.

---

## 4. Sync and Build

```bash
npm run build
npx cap sync ios
npx cap open ios
```

Then archive and submit from Xcode.

---

## 5. App Store Connect — Required Declaration

In **App Store Connect → App Information**:
- Under **App Privacy** → declare microphone/audio usage if prompted
- Under **App Review Information** → mention audio playback in the "Notes" field:
  > "Voxyl is a podcast playlist app. Background audio playback is required for the core functionality. UIBackgroundModes: audio is declared in Info.plist."

---

## What Voxyl Already Handles (JS side — no action needed)

| Feature | How |
|---|---|
| Lock screen metadata (title, artwork) | `preload()` with `title`, `artworkUrl`, `artist` |
| Lock screen play/pause/next/prev | `nextEnabled: true`, `prevEnabled: true` in preload |
| Bluetooth controls | Handled by `AVAudioSessionCategoryPlayback` + plugin |
| Episode auto-advance | `complete` event listener in `nativeAudioPlayer.js` |
| Resume position on episode change | `_pollDuration()` waits for AVPlayer then seeks |
| Seek bar dragging stability | `seek()` calls `setCurrentTime()` directly |
| `backgroundAudio: true` in configure | Set in `nativeAudioPlayer.js` |
| `focus: true` in configure | Set in `nativeAudioPlayer.js` + `capacitor.config.ts` |