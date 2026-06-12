import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.renbrant.voxyl',
  appName: 'Voxyl',
  webDir: 'dist',
  plugins: {
    NativeAudio: {
      focus: true,
      backgroundPlayback: true,
      showNotification: true,
    },
  },
};

export default config;
