import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const LEGACY_TOKEN_KEY = 'voxyl_access_token';
const LEGACY_LOCAL_KEYS = [LEGACY_TOKEN_KEY, 'token', 'voxyl_post_auth_path'];
const LEGACY_SESSION_KEYS = ['voxyl_last_auth_callback'];
const LEGACY_URL_KEYS = ['access_token', 'access_tc', 'token', 'native_auth_callback'];

// Old browser-to-app callbacks put bearer tokens in URLs. They are no longer
// supported; remove their parameters before initializing routing or auth.
export function stripLegacyAuthUrl(location = window.location, history = window.history) {
  const url = new URL(location.href);
  let changed = false;

  for (const key of LEGACY_URL_KEYS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }

  const hash = new URLSearchParams(url.hash.slice(1));
  let hashChanged = false;
  for (const key of LEGACY_URL_KEYS) {
    if (hash.has(key)) {
      hash.delete(key);
      changed = true;
      hashChanged = true;
    }
  }

  if (changed) {
    if (hashChanged) url.hash = hash.toString();
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  return changed;
}

// Best-effort cleanup of obsolete credentials. Clerk owns the active session;
// failure to remove an old Preferences value must not block normal sign-in.
export async function clearLegacyAuthCredentials({
  local = globalThis.localStorage,
  session = globalThis.sessionStorage,
  native = Capacitor.isNativePlatform(),
  preferences = Preferences,
} = {}) {
  for (const key of LEGACY_LOCAL_KEYS) {
    try { local?.removeItem(key); } catch { /* storage unavailable */ }
  }
  for (const key of LEGACY_SESSION_KEYS) {
    try { session?.removeItem(key); } catch { /* storage unavailable */ }
  }

  if (native) {
    try { await preferences.remove({ key: LEGACY_TOKEN_KEY }); } catch { /* storage unavailable */ }
  }
}
