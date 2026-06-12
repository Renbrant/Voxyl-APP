# Android OAuth / Login Fix — Capacitor

## Problem

When running in Capacitor Android, the WebView serves content from `https://localhost`.  
When the user taps "Login with Google", the app opens Chrome and starts the OAuth flow.  
After Google account selection, Base44 redirects Chrome to:

```
https://localhost/?access_token=...
```

Chrome cannot resolve `localhost` from outside the device process → `ERR_CONNECTION_REFUSED`.

---

## Solution A — Android App Links (Recommended)

This is the correct, production-quality approach.  
Configure the Android APK to intercept `https://voxyl-app.base44.app` URLs  
so Chrome redirects back into the app after login.

### Step 1 – `AndroidManifest.xml`

Add an intent filter inside the `<activity>` tag
(`android/app/src/main/AndroidManifest.xml`):

```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data
        android:scheme="https"
        android:host="voxyl-app.base44.app" />
</intent-filter>
```

### Step 2 – `assetlinks.json` on Base44

For Android App Links to verify, Base44 must serve a file at:

```
https://voxyl-app.base44.app/.well-known/assetlinks.json
```

Content:
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.renbrant.voxyl",
    "sha256_cert_fingerprints": ["<YOUR_RELEASE_KEYSTORE_SHA256>"]
  }
}]
```

> **Get the SHA256 fingerprint:**
> ```
> keytool -list -v -keystore your-release.keystore -alias your-alias
> ```

This file must be hosted by Base44 (the platform). Since Base44 controls
`voxyl-app.base44.app`, you'll need to contact Base44 support to add this file,
OR use Solution B below as an interim workaround.

### Step 3 – Handle the incoming URL in the app

In `App.jsx` or `main.jsx`, listen for the `appUrlOpen` Capacitor event:

```js
import { App as CapApp } from '@capacitor/app';

CapApp.addListener('appUrlOpen', ({ url }) => {
  // url will be https://voxyl-app.base44.app/?access_token=...
  const params = new URLSearchParams(new URL(url).search);
  const token = params.get('access_token');
  if (token) {
    localStorage.setItem('base44_access_token', token);
    window.location.replace('/'); // reload the app
  }
});
```

Install the plugin first:
```
npm install @capacitor/app
npx cap sync android
```

---

## Solution B — Live Server Mode (Quick but requires internet)

In `capacitor.config.ts`, uncomment the `server.url` line:

```ts
server: {
  url: 'https://voxyl-app.base44.app',
}
```

This makes the WebView load assets from the live Base44 server on every launch.  
`window.location.href` becomes `https://voxyl-app.base44.app/...`, so OAuth callbacks work.

**Downsides:**
- App doesn't work offline
- Every page load hits the remote server (slower)
- Not suitable for App Store / Play Store production release as the primary approach

---

## Current State

The `redirectToLogin()` function now detects Capacitor native mode and uses  
`https://voxyl-app.base44.app` as the OAuth callback URL instead of `https://localhost`.

This means:
- ✅ Chrome no longer shows `ERR_CONNECTION_REFUSED`
- ✅ The login page opens and Google OAuth completes
- ⚠️ After login, Chrome opens `https://voxyl-app.base44.app` (the web app) in Chrome, NOT the APK
- ❌ The user is NOT automatically returned to the APK

To fully close the loop (return to APK after login), implement **Solution A** above.