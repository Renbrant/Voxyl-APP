# Manual Auth Callback Test for Android

To manually test the custom scheme callback without going through the full Base44 login flow:

## Test Command

```bash
adb shell am start -W -a android.intent.action.VIEW -d "com.renbrant.voxyl://auth/callback?access_token=TEST_TOKEN_12345" com.renbrant.voxyl
```

## Expected Logcat Output

If the callback flow is working correctly, you should see:

```
[AUTH] appUrlOpen fired! url: com.renbrant.voxyl://auth/callback?access_token=TEST_TOKEN_12345
[AUTH] handleNativeAuthCallback called
[AUTH] is custom scheme callback: true
[AUTH] Parsing token from URL: com.renbrant.voxyl://auth/callback?access_token=TEST_TOKEN_12345
[AUTH] Token found in query params
[AUTH] token found in custom scheme URL: true
[AUTH] saving token to localStorage and Preferences
[AUTH] localStorage verify after save: true
[AUTH] Preferences verify after save: true
[AUTH] token saved successfully
[AUTH] Calling Browser.close()
[AUTH] Browser.close() skipped: (browser was not open)
[AUTH] Redirecting to post-auth path: /
```

## Verification Steps

1. **Callback is caught**: Look for `[AUTH] appUrlOpen fired!`
2. **Token is extracted**: Look for `[AUTH] token found in custom scheme URL: true`
3. **Token is stored**: Look for `[AUTH] token saved successfully`
4. **Preferences verification**: Look for `[AUTH] Preferences verify after save: true`
5. **App navigates**: Look for `[AUTH] Redirecting to post-auth path:`

## After Redirect

Close and reopen the app. You should see:

```
[AUTH] bootstrap start
[AUTH] localStorage token exists: true
[AUTH] native Preferences token exists: true
[AUTH] importing App after token hydration
[AUTH] startup token exists: true
[AUTH] restoring native auth session
[AUTH] current user restored successfully
```

This confirms:
- Token persists across app restarts
- Preferences is being used as the source of truth
- Session restoration works

## Full Integration Test

1. Open the app
2. Navigate to login
3. Tap "Continue with Google"
4. Complete Google login in the browser
5. Base44 should redirect to: `https://voxyl-app.base44.app/?native_auth_callback=1&access_token=...`
6. AuthCallback.jsx page should render with debug output showing token found
7. After 500ms delay, page should redirect to custom scheme
8. App should receive the custom scheme URL and store the token
9. Logcat should show all the expected logs
10. App should navigate to home page
11. Close and reopen the app - user should still be logged in
