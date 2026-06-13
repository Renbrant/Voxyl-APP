import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { setStoredNativeToken } from '@/lib/nativeAuthSession';

// @capacitor/browser v8 only supports two events:
//   - browserFinished  (user closed browser)
//   - browserPageLoaded (initial URL loaded — NOT subsequent navigations, no URL exposed)
// There is NO browserUrlChanged event.

// Custom scheme handled by Android intent filter in AndroidManifest.xml
// Intent filter required:
//   <intent-filter android:autoVerify="false">
//     <action android:name="android.intent.action.VIEW" />
//     <category android:name="android.intent.category.DEFAULT" />
//     <category android:name="android.intent.category.BROWSABLE" />
//     <data android:scheme="com.renbrant.voxyl" android:host="auth" android:path="/callback" />
//   </intent-filter>

const CUSTOM_SCHEME = 'com.renbrant.voxyl:';
const HANDLED_URL_KEY = 'voxyl_last_auth_callback';
const POST_AUTH_PATH_KEY = 'voxyl_post_auth_path';

const log = (...args) => console.log('[AUTH]', ...args);
const err = (...args) => console.error('[AUTH]', ...args);

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
    log('No token found in URL');
    return null;
  } catch (e) {
    err('Failed to parse URL:', e?.message);
    return null;
  }
};

const isCustomSchemeCallback = (url) => {
  try {
    const p = new URL(url);
    return p.protocol === CUSTOM_SCHEME && p.hostname === 'auth' && p.pathname === '/callback';
  } catch {
    return false;
  }
};

export const handleNativeAuthCallback = async (url) => {
  log('handleNativeAuthCallback called with url:', url);
  if (!url) { log('No URL, skipping'); return false; }
  if (!isCustomSchemeCallback(url)) { log('Not a custom scheme callback, skipping:', url); return false; }

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

  setStoredNativeToken(token);

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

export const initializeNativeAuthCallback = async () => {
  if (!Capacitor.isNativePlatform()) return;

  log('Registering appUrlOpen listener');
  await CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    log('appUrlOpen fired! url:', url);
    handleNativeAuthCallback(url).catch(e => err('appUrlOpen handler threw:', e?.message));
  });

  try {
    await Browser.addListener('browserFinished', () => {
      log('browserFinished fired — browser closed');
    });
  } catch (e) {
    log('browserFinished listener failed:', e?.message);
  }

  // Cold-start: app launched directly via custom scheme URL
  log('Checking launch URL');
  const launchUrl = await CapacitorApp.getLaunchUrl();
  log('getLaunchUrl result:', JSON.stringify(launchUrl));
  if (launchUrl?.url) {
    log('Processing launch URL:', launchUrl.url);
    await handleNativeAuthCallback(launchUrl.url);
  }
};