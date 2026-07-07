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
    // Keep the bundled web assets by default. Uncomment only if you need the APK
    // to load every page from the hosted Base44 app instead of local assets.
    // url: 'https://voxyl-app.base44.app',
  },
  ios: {
    backgroundColor: '#0f0d0b',
    contentInset: 'always',
  },
  plugins: {
    NativeAudio: {
      focus: true,
      backgroundPlayback: true,
      showNotification: true,
    },
  },
};

export default config;
