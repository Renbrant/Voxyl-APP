# Android Authentication Setup - Clerk

Voxyl uses the Clerk Android SDK for authentication in the native Android application.

The previous Base44 token-callback flow is no longer the active Android authentication architecture.

## Runtime architecture

The web application and Android application intentionally use different Clerk integrations:

- Web: Clerk React SDK
- Android: Clerk Android SDK

Android does not mount the Clerk React provider.

The native Android flow is:

```text
Voxyl Android app
       |
       v
Clerk Android SDK
       |
       v
Hosted authentication in system browser
       |
       v
Clerk / Google authentication
       |
       v
clerk://com.renbrant.voxyl.callback
       |
       v
Clerk SSOReceiverActivity
       |
       v
Active Clerk Android session
       |
       v
ClerkNative Capacitor bridge
       |
       v
React AuthContext
```

## Android package

```text
com.renbrant.voxyl
```

The package identity must remain unchanged for the production Android application.

## Clerk native callback

The production Clerk Android callback is:

```text
clerk://com.renbrant.voxyl.callback
```

The Clerk Android SDK registers its callback receiver in the merged Android manifest.

Voxyl does not manually pass this callback through MainActivity.

No Clerk JWT is transported in the callback URL.

## Native initialization

Clerk is initialized when the Android process starts through:

```text
android/app/src/main/java/com/renbrant/voxyl/VoxylApplication.java
```

The application class is registered in AndroidManifest.xml.

## Capacitor bridge

The native Clerk session is exposed to the React application through:

```text
android/app/src/main/java/com/renbrant/voxyl/ClerkNativePlugin.java
src/lib/nativeClerk.js
```

The bridge supports:

- Clerk initialization state
- signed-in state
- hosted sign-in
- session token retrieval
- native logout

JWTs are requested from Clerk when the API client needs one.

Voxyl does not persist the active Clerk JWT in localStorage or Capacitor Preferences as part of the current Android flow.

## Production Clerk configuration

Android release builds must use a Clerk Production publishable key.

The Gradle release configuration blocks the build unless the configured key starts with:

```text
pk_live_
```

The full publishable key should not be copied into documentation or source code.

Debug and release configuration are intentionally separated.

## Worker authorized parties and CORS

Physical-device testing confirmed that the Capacitor Android WebView sends:

```text
Origin: https://localhost
```

The production Worker therefore allows:

```text
https://localhost
capacitor://localhost
```

The first value is the origin observed from the production Android WebView.

The second remains allowed for Capacitor compatibility.

## Session restoration

Session persistence is owned by the Clerk Android SDK.

On application startup, the native provider waits for Clerk initialization and checks whether an active session exists.

If signed in, Voxyl obtains a fresh token through the native bridge and calls `/api/me`.

If signed out, the application remains in guest mode.

## Logout

Logout must go through AuthContext so the correct platform-specific implementation is used.

On Android:

1. Clerk Android signs out the native session.
2. Voxyl clears its authenticated React state.
3. Settings redirects to Home.
4. A cold start must remain signed out.

## Retired token callback

The Base44-era callback and custom-scheme intent filters have been removed.
On startup, Voxyl removes obsolete localStorage and Capacitor Preferences
token copies without touching Clerk Android's native session. The legacy
Capacitor Preferences group is excluded from Android backup and device transfer.

Do not register `com.renbrant.voxyl://auth/callback` or send a JWT in a URL.
The Clerk SDK's `clerk://com.renbrant.voxyl.callback` receiver remains the
supported hosted-login return path; verify it in the merged manifest.
