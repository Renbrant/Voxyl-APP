import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

// Only two events are supported by @capacitor/browser v8:
//   - browserFinished  (user closed the browser)
//   - browserPageLoaded (initial URL finished loading — NOT subsequent navigations)
// There is NO browserUrlChanged event. Do not add it.

const WEB_CALLBACK_ORIGIN = 'https://voxyl.renbrant.com';
const WEB_CALLBACK_PATH = '/auth/callback';
const HANDLED_URL_KEY = 'voxyl_last_auth_callback';
const POST_AUTH_PATH_KEY = 'voxyl_post_auth_path';

const log = (...args) => console.log('[AUTH]', ...args);
const err = (...args) => console.error('[AUTH]', ...args);

// ── Token extraction ────────────────────────────────────────────────────────
const getTokenFromUrl = (url) => {
  log('Parsing token from URL:', url);
  try {
    const parsedUrl = new URL(url);
    const qp = parsedUrl.searchParams;

    const qpToken = qp.get('access_token') || qp.get('access_tc') || qp.get('token');
    if (qpToken) { log('Token found in query params'); return qpToken; }

    const hashString = parsedUrl.hash.replace(/^#/, '');
    if (hashString) {
      const hp = new URLSearchParams(hashString);
      const hpToken = hp.get('access_token') || hp.get('access_tc') || hp.get('token');
      if (hpToken) { log('Token found in hash params'); return hpToken; }
    }

    log('All query params:', Object.fromEntries(qp.entries()));
    log('Hash string:', hashString || '(empty)');
    log('No token found in URL');
    return null;
  } catch (e) {
    err('Failed to parse URL:', e?.message);
    return null;
  }
};

// ── URL match check ─────────────────────────────────────────────────────────
const isCallbackUrl = (url) => {
  try {
    const p = new URL(url);
    const isWebCallback = p.origin === WEB_CALLBACK_ORIGIN && p.pathname === WEB_CALLBACK_PATH;
    const isCustomScheme = p.protocol === 'com.renbrant.voxyl:'
      && p.hostname === 'auth' && p.pathname === '/callback';
    log('URL check — isWebCallback:', isWebCallback, '| isCustomScheme:', isCustomScheme, '| url:', url);
    return isWebCallback || isCustomScheme;
  } catch (e) {
    err('isCallbackUrl parse error:', e?.message);
    return false;
  }
};

// ── Core handler ────────────────────────────────────────────────────────────
export const handleNativeAuthCallback = async (url) => {
  log('handleNativeAuthCallback called with url:', url);
  if (!url) { log('No URL, skipping'); return false; }
  if (!isCallbackUrl(url)) { log('Not a callback URL, skipping:', url); return false; }

  const token = getTokenFromUrl(url);
  if (!token) {
    err('NO TOKEN in callback URL:', url);
    return false;
  }

  if (sessionStorage.getItem(HANDLED_URL_KEY) === url) {
    log('Already handled this session');
    return true;
  }
  sessionStorage.setItem(HANDLED_URL_KEY, url);

  log('Storing token to localStorage');
  localStorage.setItem('base44_access_token', token);
  localStorage.setItem('token', token);

  log('Calling Browser.close()');
  try {
    await Browser.close();
    log('Browser.close() succeeded');
  } catch (e) {
    log('Browser.close() skipped:', e?.message);
  }

  const postAuthPath = localStorage.getItem(POST_AUTH_PATH_KEY) || '/';
  localStorage.removeItem(POST_AUTH_PATH_KEY);
  log('Redirecting to post-auth path:', postAuthPath);

  await new Promise(r => setTimeout(r, 200));
  window.location.replace(postAuthPath);
  return true;
};

// ── Initialization ──────────────────────────────────────────────────────────
export const initializeNativeAuthCallback = async () => {
  if (!Capacitor.isNativePlatform()) return;

  // appUrlOpen fires when Android intercepts a verified App Link URL.
  // This is the ONLY reliable way to capture the callback with @capacitor/browser.
  log('Registering appUrlOpen listener');
  await CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    log('appUrlOpen fired! url:', url);
    handleNativeAuthCallback(url).catch(e => err('appUrlOpen handler threw:', e?.message));
  });

  // browserFinished fires when user manually closes the browser (no token).
  // Log it so we can tell in logcat whether the browser closed naturally or via redirect.
  try {
    await Browser.addListener('browserFinished', () => {
      log('browserFinished fired — browser closed (by user or redirect)');
    });
  } catch (e) {
    log('browserFinished listener failed:', e?.message);
  }

  // Check cold-start launch URL (app opened directly via App Link while not running)
  log('Checking launch URL');
  const launchUrl = await CapacitorApp.getLaunchUrl();
  log('getLaunchUrl result:', JSON.stringify(launchUrl));
  if (launchUrl?.url) {
    log('Processing launch URL:', launchUrl.url);
    await handleNativeAuthCallback(launchUrl.url);
  }
};