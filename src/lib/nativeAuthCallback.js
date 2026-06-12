import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

const WEB_CALLBACK_ORIGIN = 'https://voxyl.renbrant.com';
const WEB_CALLBACK_PATH = '/auth/callback';
const APP_BASE_URL = 'https://voxyl-app.base44.app';
const HANDLED_URL_KEY = 'voxyl_last_auth_callback';
const POST_AUTH_PATH_KEY = 'voxyl_post_auth_path';

const log = (...args) => console.log('[AUTH]', ...args);
const err = (...args) => console.error('[AUTH]', ...args);

// ── Token extraction ────────────────────────────────────────────────────────
const getTokenFromUrl = (url) => {
  log('Parsing token from URL:', url);
  try {
    const parsedUrl = new URL(url);

    // 1. Query params
    const qp = parsedUrl.searchParams;
    const qpToken = qp.get('access_token') || qp.get('access_tc') || qp.get('token');
    if (qpToken) { log('Token found in query params'); return qpToken; }

    // 2. Hash params
    const hashString = parsedUrl.hash.replace(/^#/, '');
    if (hashString) {
      const hp = new URLSearchParams(hashString);
      const hpToken = hp.get('access_token') || hp.get('access_tc') || hp.get('token');
      if (hpToken) { log('Token found in hash params'); return hpToken; }
    }

    // 3. Log everything for debugging
    log('All query params:', Object.fromEntries(qp.entries()));
    log('Hash string:', hashString || '(empty)');
    log('No token found in URL');
    return null;
  } catch (e) {
    err('Failed to parse URL:', e?.message);
    return null;
  }
};

// ── URL match checks ────────────────────────────────────────────────────────
const isCallbackUrl = (url) => {
  try {
    const p = new URL(url);
    // Our verified App Link callback
    const isWebCallback = p.origin === WEB_CALLBACK_ORIGIN && p.pathname === WEB_CALLBACK_PATH;
    // Custom scheme fallback
    const isCustomScheme = p.protocol === 'com.renbrant.voxyl:'
      && p.hostname === 'auth' && p.pathname === '/callback';
    // Base44 app URL with token (catches redirect before App Link fires)
    const isBase44WithToken = p.origin === APP_BASE_URL
      && (p.searchParams.has('access_token') || p.searchParams.has('access_tc')
          || p.hash.includes('access_token') || p.hash.includes('access_tc'));

    log('URL check — origin:', p.origin, 'path:', p.pathname,
      '| isWebCallback:', isWebCallback,
      '| isCustomScheme:', isCustomScheme,
      '| isBase44WithToken:', isBase44WithToken);
    return isWebCallback || isCustomScheme || isBase44WithToken;
  } catch (e) {
    err('isCallbackUrl parse error:', e?.message, 'url:', url);
    return false;
  }
};

// ── Core handler (shared between appUrlOpen and browserPageLoaded) ──────────
export const handleNativeAuthCallback = async (url) => {
  log('handleNativeAuthCallback called with url:', url);
  if (!url) { log('No URL, skipping'); return false; }
  if (!isCallbackUrl(url)) { log('Not a callback URL, skipping'); return false; }

  const token = getTokenFromUrl(url);
  if (!token) {
    err('NO TOKEN in callback URL:', url);
    return false;
  }

  // Deduplicate within session
  if (sessionStorage.getItem(HANDLED_URL_KEY) === url) {
    log('Already handled this URL this session');
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
    log('Browser.close() skipped (already closed):', e?.message);
  }

  const postAuthPath = localStorage.getItem(POST_AUTH_PATH_KEY) || '/';
  localStorage.removeItem(POST_AUTH_PATH_KEY);
  log('Redirecting to post-auth path:', postAuthPath);

  // Small delay to allow Browser to fully close before navigation
  await new Promise(r => setTimeout(r, 200));
  window.location.replace(postAuthPath);
  return true;
};

// ── Initialization ──────────────────────────────────────────────────────────
export const initializeNativeAuthCallback = async () => {
  if (!Capacitor.isNativePlatform()) return;

  // 1. appUrlOpen — fires when Android App Link opens the native app from Chrome
  log('Registering appUrlOpen listener');
  await CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    log('appUrlOpen fired! url:', url);
    handleNativeAuthCallback(url).catch(e => err('appUrlOpen handler threw:', e?.message));
  });

  // 2. browserPageLoaded — fires on EVERY navigation inside Capacitor Browser.
  //    This catches the token if Base44 redirects to voxyl.renbrant.com/auth/callback
  //    while the in-app browser is still open (before Chrome gets a chance to intercept).
  //    It also catches if Base44 sends the token back on its own domain.
  log('Registering Browser.addListener(browserPageLoaded)');
  try {
    await Browser.addListener('browserPageLoaded', async () => {
      // browserPageLoaded doesn't expose the URL, so we use browserFinished
      // as a signal that the user closed the browser manually (no token received).
      // We can't read the URL from this event — handled by browserUrlChanged instead.
      log('browserPageLoaded fired (browser still open)');
    });

    // browserUrlChanged gives us the URL on each navigation
    await Browser.addListener('browserUrlChanged', async ({ url }) => {
      log('browserUrlChanged fired — url:', url);
      if (isCallbackUrl(url)) {
        log('Callback URL detected in Browser, handling...');
        await handleNativeAuthCallback(url).catch(e =>
          err('browserUrlChanged handler threw:', e?.message)
        );
      }
    });

    await Browser.addListener('browserFinished', () => {
      log('browserFinished fired (user closed browser or redirect completed)');
    });
  } catch (e) {
    log('Browser listener registration failed (may not be supported):', e?.message);
  }

  // 3. Check if app was launched via a callback URL (cold start)
  log('Checking launch URL');
  const launchUrl = await CapacitorApp.getLaunchUrl();
  log('getLaunchUrl result:', JSON.stringify(launchUrl));
  if (launchUrl?.url) {
    log('Processing launch URL:', launchUrl.url);
    await handleNativeAuthCallback(launchUrl.url);
  }
};