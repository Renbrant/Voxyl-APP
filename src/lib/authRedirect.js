import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';

// The verified Android App Link that Base44 must redirect to after login.
// Android intercepts this URL in Chrome and fires appUrlOpen in the native app.
const NATIVE_CALLBACK_URL = 'https://voxyl.renbrant.com/auth/callback';
const POST_AUTH_PATH_KEY = 'voxyl_post_auth_path';

const log = (...args) => console.log('[AUTH]', ...args);

export async function redirectToLogin(fromUrl = window.location.href) {
  const isNative = Capacitor.isNativePlatform();
  log('redirectToLogin called — isNative:', isNative, 'fromUrl:', fromUrl);

  if (!isNative) {
    // Web: standard Base44 SDK redirect (returns to same origin)
    log('Web path: calling base44.auth.redirectToLogin');
    base44.auth.redirectToLogin(fromUrl);
    return;
  }

  // Native path:
  // 1. Save where to go after login
  // 2. Open Base44 login in Capacitor Browser with from_url=NATIVE_CALLBACK_URL
  // 3. After successful login, Base44 redirects to NATIVE_CALLBACK_URL?access_token=...
  // 4. Android App Link intercepts it → appUrlOpen fires → handleNativeAuthCallback runs
  //
  // IMPORTANT: This only works if Base44 honours the from_url param for social login
  // (Google/Apple). If Base44 redirects to its own origin instead, appUrlOpen will NOT fire.
  // In that case, the fix must be on the Base44 platform side.

  const targetUrl = new URL(fromUrl, window.location.href);
  const postAuthPath = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  localStorage.setItem(POST_AUTH_PATH_KEY, postAuthPath);
  log('Saved post-auth path:', postAuthPath);

  const loginUrl = `${appParams.appBaseUrl}/login?from_url=${encodeURIComponent(NATIVE_CALLBACK_URL)}`;
  log('Opening login URL in Capacitor Browser:', loginUrl);
  log('Expected callback after login:', NATIVE_CALLBACK_URL);
  log('If appUrlOpen never fires, Base44 is not redirecting to from_url after social login.');

  await Browser.open({ url: loginUrl });
  log('Browser.open() returned');
}