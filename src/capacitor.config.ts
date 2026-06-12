import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.voxyl.app',
  appName: 'Voxyl',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: true,
    backgroundColor: '#0f0d0b',
  },
  ios: {
    // Required for App Store: allow background audio session to stay active
    backgroundColor: '#0f0d0b',
    // Tells the WKWebView to not suspend when backgrounded
    // (actual UIBackgroundModes must also be set in Info.plist — see ios-setup.md)
    contentInset: 'always',
  },
  plugins: {
    // @capgo/capacitor-native-audio plugin configuration
    NativeAudio: {
      // Keep audio session active when app goes to background / screen locks
      focus: true,
    },
  },
};

export default config;