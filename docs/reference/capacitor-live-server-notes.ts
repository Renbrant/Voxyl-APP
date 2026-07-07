import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.renbrant.voxyl',
  appName: 'Voxyl',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: true,
    backgroundColor: '#0f0d0b',
  },
  server: {
    // IMPORTANT: This makes Capacitor Android serve the WebView under the real
    // app domain instead of https://localhost. This means:
    // 1. localStorage is shared with the hosted web app on the same origin.
    // 2. OAuth callbacks to https://voxyl-app.base44.app will work in Chrome
    //    because the app is "at" that origin, BUT it requires internet access
    //    for every page load since assets are proxied through the live server.
    //
    // PREFERRED ALTERNATIVE: Keep hostname as localhost and use Android App Links
    // to intercept https://voxyl.renbrant.com/auth/callback in Chrome and
    // re-open the APK with the token. See ../android-auth-setup.md.
    //
    // Uncomment the line below ONLY if you want to always load from the live server:
    // url: 'https://voxyl-app.base44.app',
  },
  ios: {
    // Required for App Store: allow background audio session to stay active
    backgroundColor: '#0f0d0b',
    // Tells the WKWebView to not suspend when backgrounded
    // (actual UIBackgroundModes must also be set in Info.plist - see ../ios-setup.md)
    contentInset: 'always',
  },
  plugins: {
    // @capgo/capacitor-native-audio plugin configuration
    NativeAudio: {
      focus: true,
      backgroundPlayback: true,
      showNotification: true,
    },
  },
};

export default config;
