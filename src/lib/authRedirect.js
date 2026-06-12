import { base44 } from '@/api/base44Client';

const BASE44_APP_URL = 'https://voxyl-app.base44.app';

/**
 * Returns true when running inside a Capacitor native app.
 * In that context window.location.href is https://localhost/...
 * which external Chrome cannot resolve — we must use the real app URL instead.
 */
function isCapacitorNative() {
  return !!(window.Capacitor?.isNativePlatform?.());
}

/**
 * Redirects to login using the Base44 SDK flow.
 * On Capacitor Android, passes the real Base44 app URL as the callback so that
 * Chrome can redirect back to the hosted page (which will have the access_token
 * in its query string) rather than trying to open https://localhost.
 */
export function redirectToLogin(nextUrl) {
  if (isCapacitorNative()) {
    // Use the real hosted URL so external Chrome can resolve it after OAuth.
    // After login, Base44 redirects to BASE44_APP_URL?access_token=...
    // The user will land on the web app in Chrome, but the token will be stored.
    // For a better UX, the Capacitor App URL Scheme / App Links setup is needed
    // on the native side to intercept this redirect back into the APK.
    base44.auth.redirectToLogin(BASE44_APP_URL);
  } else {
    base44.auth.redirectToLogin(nextUrl || window.location.href);
  }
}