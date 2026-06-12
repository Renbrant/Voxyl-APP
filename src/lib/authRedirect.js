import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';

const NATIVE_CALLBACK_URL = 'https://voxyl.renbrant.com/auth/callback';
const POST_AUTH_PATH_KEY = 'voxyl_post_auth_path';

const log = (...args) => console.log('[AUTH]', ...args);

/**
 * Opens Base44 login while keeping native callbacks away from localhost.
 */
export async function redirectToLogin(fromUrl = window.location.href) {
  const isNative = Capacitor.isNativePlatform();
  log('redirectToLogin called — isNative:', isNative, 'fromUrl:', fromUrl);

  if (!isNative) {
    log('Web path: calling base44.auth.redirectToLogin');
    base44.auth.redirectToLogin(fromUrl);
    return;
  }

  // Native path: open Base44 login in Capacitor Browser, with the verified
  // App Link as the callback so Android intercepts it back into the APK.
  const targetUrl = new URL(fromUrl, window.location.href);
  const postAuthPath = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  localStorage.setItem(POST_AUTH_PATH_KEY, postAuthPath);
  log('Saved post-auth path:', postAuthPath);

  const loginUrl = `${appParams.appBaseUrl}/login?from_url=${encodeURIComponent(NATIVE_CALLBACK_URL)}`;
  log('Opening login URL in Capacitor Browser:', loginUrl);

  await Browser.open({ url: loginUrl });
  log('Browser.open() returned');
}