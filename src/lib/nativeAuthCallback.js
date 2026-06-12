import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

const WEB_CALLBACK_ORIGIN = 'https://voxyl-app.base44.app';
const HANDLED_URL_KEY = 'voxyl_last_auth_callback';
const POST_AUTH_PATH_KEY = 'voxyl_post_auth_path';

const getTokenFromUrl = (url) => {
  const parsedUrl = new URL(url);
  const hashParams = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));
  return parsedUrl.searchParams.get('access_token')
    || parsedUrl.searchParams.get('access_tc')
    || hashParams.get('access_token')
    || hashParams.get('access_tc');
};

const isSupportedCallback = (url) => {
  try {
    const parsedUrl = new URL(url);
    const isWebCallback = parsedUrl.origin === WEB_CALLBACK_ORIGIN;
    const isCustomCallback = parsedUrl.protocol === 'com.renbrant.voxyl:'
      && parsedUrl.hostname === 'auth'
      && parsedUrl.pathname === '/callback';
    return isWebCallback || isCustomCallback;
  } catch {
    return false;
  }
};

export const handleNativeAuthCallback = async (url) => {
  if (!url || !isSupportedCallback(url)) return false;

  const token = getTokenFromUrl(url);
  if (!token) return false;

  if (sessionStorage.getItem(HANDLED_URL_KEY) === url) return true;
  sessionStorage.setItem(HANDLED_URL_KEY, url);

  localStorage.setItem('base44_access_token', token);
  localStorage.setItem('token', token);

  try {
    await Browser.close();
  } catch {
    // Chrome may already be closed when Android opens the verified App Link.
  }

  const postAuthPath = localStorage.getItem(POST_AUTH_PATH_KEY) || '/';
  localStorage.removeItem(POST_AUTH_PATH_KEY);
  window.location.replace(postAuthPath);
  return true;
};

export const initializeNativeAuthCallback = async () => {
  if (!Capacitor.isNativePlatform()) return;

  await CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    handleNativeAuthCallback(url).catch(error => {
      console.error('Failed to handle native auth callback:', error);
    });
  });

  const launchUrl = await CapacitorApp.getLaunchUrl();
  if (launchUrl?.url) {
    await handleNativeAuthCallback(launchUrl.url);
  }
};
