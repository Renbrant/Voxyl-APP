import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';

const NATIVE_CALLBACK_URL = 'https://voxyl-app.base44.app/';
const POST_AUTH_PATH_KEY = 'voxyl_post_auth_path';

/**
 * Opens Base44 login while keeping native callbacks away from localhost.
 */
export async function redirectToLogin(fromUrl = window.location.href) {
  if (!Capacitor.isNativePlatform()) {
    base44.auth.redirectToLogin(fromUrl);
    return;
  }

  const targetUrl = new URL(fromUrl, window.location.href);
  localStorage.setItem(
    POST_AUTH_PATH_KEY,
    `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`
  );

  const loginUrl = `${appParams.appBaseUrl}/login?from_url=${encodeURIComponent(NATIVE_CALLBACK_URL)}`;
  await Browser.open({ url: loginUrl });
}
