import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.termau.bldesk',
  appName: 'BLDesk',
  webDir: 'out/renderer',
  // Capacitor's default 'debug' prints every native plugin call to logcat,
  // request headers included, so a debuggable build writes the account's bearer
  // token to the device log in plaintext once per request. Published APKs are
  // built with assembleRelease and are not debuggable, so they were never
  // affected - this is defence in depth for local dev builds, where `adb logcat`
  // would otherwise hand over a live credential.
  loggingBehavior: 'none',
  server: {
    androidScheme: 'https',
    cleartext: false
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    },
    CapacitorCookies: {
      enabled: true
    }
  }
};

export default config;
