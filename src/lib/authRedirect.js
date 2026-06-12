import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';

// Base44 will redirect here after login — it's on Base44's own domain so it passes
// the "allowed redirect domain" check. The page then bounces to the custom scheme.
// native=1 tells AuthCallback.jsx to redirect to the custom scheme instead of web fallback.
// This is how we detect native context without depending on window.Capacitor inside Chrome Custom Tab.
const NATIVE_CALLBACK_URL = 'https://voxyl-app.base44.app/auth/callback?native=1';
const POST_AUTH_PATH_KEY = 'voxyl_post_auth_path';

const log = (...args) => console.log('[AUTH]', ...args);

export async function redirectToLogin(fromUrl = window.location.href) {
  const isNative = Capacitor.isNativePlatform();
  log('redirectToLogin called — isNative:', isNative, 'fromUrl:', fromUrl);

  if (!isNative) {
    log('Web path: calling base44.auth.redirectToLogin');
    base44.auth.redirectToLogin(fromUrl);
    return;
  }

  // Save where to return after login
  const targetUrl = new URL(fromUrl, window.location.href);
  const postAuthPath = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  localStorage.setItem(POST_AUTH_PATH_KEY, postAuthPath);
  log('Saved post-auth path:', postAuthPath);

  // Flow:
  // 1. Open Base44 login in Capacitor Browser
  // 2. User logs in → Base44 redirects to NATIVE_CALLBACK_URL (Base44 domain, accepted)
  // 3. AuthCallback.jsx page loads in the browser, extracts token, redirects to custom scheme
  // 4. Android intent filter catches com.renbrant.voxyl://auth/callback → appUrlOpen fires
  // 5. nativeAuthCallback.js stores token and navigates to the saved path
  const loginUrl = `${appParams.appBaseUrl}/login?from_url=${encodeURIComponent(NATIVE_CALLBACK_URL)}`;
  log('Opening login URL in Capacitor Browser:', loginUrl);

  await Browser.open({ url: loginUrl });
  log('Browser.open() returned');
}