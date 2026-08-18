# Android Clerk Authentication - Manual Validation

This document describes the physical-device validation procedure for the current Clerk Android authentication architecture.

The previous Base44 test that injected `access_token` into a custom callback URL is obsolete and must not be used for the current Android implementation.

## Prerequisites

- physical Android device
- USB debugging enabled
- signed Voxyl release APK
- production Clerk configuration
- Android package `com.renbrant.voxyl`
- ADB available from the Android SDK

## Production callback

The active Clerk callback is:

```text
clerk://com.renbrant.voxyl.callback
```

The callback is received by the Clerk Android SDK.

It does not carry the Voxyl session JWT in the URL.

## 1. Install the signed release APK

Install over the existing application when testing upgrade/session behavior:

```powershell
adb install -r .\release\Voxyl-v0.3.1-release.apk
```

Confirm the installed package version:

```powershell
adb shell dumpsys package com.renbrant.voxyl | Select-String "versionCode=|versionName="
```

Expected for v0.3.1:

```text
versionCode=301
versionName=0.3.1
```

## 2. Fresh sign-in

1. Start Voxyl while signed out.
2. Tap Sign in.
3. Confirm Clerk hosted authentication opens in the system browser.
4. Complete Google/Clerk authentication.
5. Confirm the browser returns automatically to Voxyl.
6. Confirm the authenticated profile loads.

Expected results:

- no `*.accounts.dev` production-login regression
- no browser redirect to localhost
- no ERR_CONNECTION_REFUSED
- callback returns to Voxyl
- `/api/me` succeeds
- the existing Voxyl user is resolved

## 3. Verify application data

After sign-in, confirm that existing account data remains intact:

- profile
- playlists
- likes
- saved episode playback/progress

Authentication work must not create a new or disconnected Voxyl profile for an existing user.

## 4. Authenticated cold-start test

Force-stop and reopen the application:

```powershell
adb shell am force-stop com.renbrant.voxyl
Start-Sleep -Seconds 2
adb shell am start -n com.renbrant.voxyl/.MainActivity
```

Expected result:

- the same account is still signed in
- `/api/me` continues to resolve the user
- account data remains available

## 5. Logout test

1. Open Settings.
2. Tap Logout.

Expected result:

- native Clerk session is signed out
- authenticated state disappears
- Settings is replaced by Home
- protected account information is no longer shown

## 6. Signed-out cold-start test

After logout:

```powershell
adb shell am force-stop com.renbrant.voxyl
Start-Sleep -Seconds 2
adb shell am start -n com.renbrant.voxyl/.MainActivity
```

Expected result:

- Voxyl opens signed out
- the previous Clerk session is not restored

## 7. Login-after-logout regression test

Repeat the fresh sign-in flow after logout.

Expected result:

- Clerk hosted authentication opens normally
- Google/Clerk login completes
- callback returns to Voxyl
- the existing user and account data load normally

## 8. Android WebView CORS verification

When troubleshooting `/api/me`, inspect the Worker request or Android runtime traffic.

The production Capacitor Android WebView was physically observed using:

```text
Origin: https://localhost
```

The Worker authorized-party/CORS configuration must accept this origin.

## 9. Security checks

Before release, verify:

- no Clerk secret key is present in source or APK configuration
- release builds use a `pk_live_` Clerk publishable key
- JWTs are not logged
- JWTs are not passed through the callback URL
- locally generated APK files are not committed
- the release APK is signed with the expected production certificate

## v0.3.1 physical validation record

The v0.3.1 release was validated successfully on a physical Android device for:

- fresh Clerk/Google login
- automatic browser-to-app callback
- `/api/me`
- existing profile and playlists
- likes
- playback/progress persistence
- authenticated cold start
- logout
- Home navigation after logout
- signed-out cold start
- login after logout
