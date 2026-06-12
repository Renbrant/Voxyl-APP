import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

const WEB_CALLBACK_ORIGIN = 'https://voxyl.renbrant.com';
const WEB_CALLBACK_PATH = '/auth/callback';
const HANDLED_URL_KEY = 'voxyl_last_auth_callback';
const POST_AUTH_PATH_KEY = 'voxyl_post_auth_path';

const log = (...args) => console.log('[AUTH]', ...args);
const err = (...args) => console.error('[AUTH]', ...args);

const getTokenFromUrl = (url) => {
  log('Parsing token from URL:', url);
  try {
    const parsedUrl = new URL(url);

    // Check query params first
    const qpToken = parsedUrl.searchParams.get('access_token')
      || parsedUrl.searchParams.get('access_tc')
      || parsedUrl.searchParams.get('token');
    if (qpToken) {
      log('Token found in query params');
      return qpToken;
    }

    // Check URL hash params
    const hashString = parsedUrl.hash.replace(/^#/, '');
    if (hashString) {
      const hashParams = new URLSearchParams(hashString);
      const hashToken = hashParams.get('access_token')
        || hashParams.get('access_tc')
        || hashParams.get('token');
      if (hashToken) {
        log('Token found in hash params');
        return hashToken;
      }
    }

    // Log all params for debugging
    log('Query params:', Object.fromEntries(parsedUrl.searchParams.entries()));
    log('Hash raw:', parsedUrl.hash);
    log('No token found in URL');
    return null;
  } catch (e) {
    err('Failed to parse URL:', e?.message);
    return null;
  }
};

const isSupportedCallback = (url) => {
  try {
    const parsedUrl = new URL(url);
    const isWebCallback = parsedUrl.origin === WEB_CALLBACK_ORIGIN
      && parsedUrl.pathname === WEB_CALLBACK_PATH;
    const isCustomCallback = parsedUrl.protocol === 'com.renbrant.voxyl:'
      && parsedUrl.hostname === 'auth'
      && parsedUrl.pathname === '/callback';
    log('URL check — origin:', parsedUrl.origin, 'path:', parsedUrl.pathname,
      'isWebCallback:', isWebCallback, 'isCustomCallback:', isCustomCallback);
    return isWebCallback || isCustomCallback;
  } catch (e) {
    err('isSupportedCallback parse error:', e?.message, 'url:', url);
    return false;
  }
};

export const handleNativeAuthCallback = async (url) => {
  log('handleNativeAuthCallback called with url:', url);

  if (!url) {
    log('No URL provided, skipping');
    return false;
  }

  if (!isSupportedCallback(url)) {
    log('URL is not a supported callback, skipping:', url);
    return false;
  }

  const token = getTokenFromUrl(url);
  if (!token) {
    err('Token missing from callback URL — full URL was:', url);
    return false;
  }

  // Deduplicate — same URL should only be processed once per session
  if (sessionStorage.getItem(HANDLED_URL_KEY) === url) {
    log('URL already handled this session, skipping');
    return true;
  }
  sessionStorage.setItem(HANDLED_URL_KEY, url);

  log('Storing token to localStorage (base44_access_token + token)');
  localStorage.setItem('base44_access_token', token);
  localStorage.setItem('token', token);

  log('Calling Browser.close()');
  try {
    await Browser.close();
    log('Browser.close() succeeded');
  } catch (e) {
    log('Browser.close() threw (may already be closed):', e?.message);
  }

  const postAuthPath = localStorage.getItem(POST_AUTH_PATH_KEY) || '/';
  localStorage.removeItem(POST_AUTH_PATH_KEY);
  log('Redirecting to post-auth path:', postAuthPath);

  // Small delay to ensure Browser is fully closed before reload
  await new Promise(resolve => setTimeout(resolve, 150));
  window.location.replace(postAuthPath);
  return true;
};

export const initializeNativeAuthCallback = async () => {
  if (!Capacitor.isNativePlatform()) return;

  log('Registering appUrlOpen listener');
  await CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    log('appUrlOpen fired! url:', url);
    handleNativeAuthCallback(url).catch(e => {
      err('handleNativeAuthCallback threw:', e?.message, e);
    });
  });

  log('Checking launch URL');
  const launchUrl = await CapacitorApp.getLaunchUrl();
  log('getLaunchUrl result:', launchUrl);
  if (launchUrl?.url) {
    log('Processing launch URL:', launchUrl.url);
    await handleNativeAuthCallback(launchUrl.url);
  }
};