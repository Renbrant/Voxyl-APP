/**
 * nativeAuthSession.js
 *
 * Manages persistent token storage using BOTH Capacitor Preferences (native)
 * and localStorage (web fallback / SDK read path).
 *
 * Strategy:
 *  - setStoredNativeToken: writes to localStorage + Capacitor Preferences (async)
 *  - getStoredNativeToken: reads localStorage first; if empty, falls back to Preferences
 *  - hydrateLocalStorageFromPreferences: called in main.jsx BEFORE React mounts
 *    so that app-params.js and base44Client.js see the token at init time
 */

import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import { base44 } from '@/api/base44Client';

const TOKEN_KEY = 'base44_access_token';

const log = (...args) => console.log('[AUTH]', ...args);

export const isNativePlatform = () => Capacitor.isNativePlatform();

// ── Token storage helpers ─────────────────────────────────────────────────────

export async function setStoredNativeToken(token) {
  if (!token) return;
  log('saving token to localStorage and Preferences');
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem('token', token);
    log('localStorage verify after save:', !!localStorage.getItem(TOKEN_KEY));
  } catch (e) {
    console.error('[AUTH] localStorage write failed:', e?.message);
  }
  try {
    await Preferences.set({ key: TOKEN_KEY, value: token });
    const verify = await Preferences.get({ key: TOKEN_KEY });
    log('Preferences verify after save:', !!verify?.value);
    log('token saved successfully');
  } catch (e) {
    console.error('[AUTH] Preferences write failed:', e?.message);
  }
}

export async function clearStoredNativeToken() {
  log('clearing stored token from localStorage and Preferences');
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('token');
  } catch {}
  try {
    await Preferences.remove({ key: TOKEN_KEY });
  } catch (e) {
    console.error('[AUTH] Preferences remove failed:', e?.message);
  }
}

/**
 * Reads token from localStorage, falling back to Capacitor Preferences.
 * If Preferences has a token but localStorage doesn't, hydrates localStorage.
 * Returns the token string or null.
 */
export async function getStoredNativeToken() {
  const lsToken = (() => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } })();
  log('localStorage token exists:', !!lsToken);

  if (lsToken) return lsToken;

  try {
    const result = await Preferences.get({ key: TOKEN_KEY });
    const prefToken = result?.value || null;
    log('native Preferences token exists:', !!prefToken);

    if (prefToken) {
      log('hydrated localStorage from native Preferences');
      try {
        localStorage.setItem(TOKEN_KEY, prefToken);
        localStorage.setItem('token', prefToken);
      } catch {}
      return prefToken;
    }
  } catch (e) {
    console.error('[AUTH] Preferences read failed:', e?.message);
  }

  return null;
}

/**
 * Called in main.jsx BEFORE React mounts.
 * Ensures localStorage is populated from Preferences so that app-params.js
 * and the Base44 SDK client pick up the token at module initialization time.
 */
export async function hydrateLocalStorageFromPreferences() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const lsToken = localStorage.getItem(TOKEN_KEY);
    log('localStorage token exists:', !!lsToken);
    if (lsToken) return; // already there, nothing to do

    const result = await Preferences.get({ key: TOKEN_KEY });
    const prefToken = result?.value || null;
    log('native Preferences token exists:', !!prefToken);

    if (prefToken) {
      log('hydrating localStorage from Preferences');
      localStorage.setItem(TOKEN_KEY, prefToken);
      localStorage.setItem('token', prefToken);
    }
  } catch (e) {
    console.error('[AUTH] hydrateLocalStorageFromPreferences failed:', e?.message);
  }
}

// ── Session restoration ───────────────────────────────────────────────────────

/**
 * Verifies the stored token by calling base44.auth.me().
 * Returns the user object if valid, null otherwise.
 * Only clears the token on definitive 401/403 — never on network errors.
 */
export async function restoreNativeAuthSession() {
  const token = await getStoredNativeToken();
  log('startup token restored:', !!token);

  if (!token) return null;

  log('restoring native auth session');

  // Try to inject token into SDK client if it doesn't already have it
  try {
    if (typeof base44.auth?.setToken === 'function') {
      base44.auth.setToken(token);
    } else if (base44._client?.setToken) {
      base44._client.setToken(token);
    }
  } catch {}

  try {
    const user = await base44.auth.me();
    if (user) {
      log('current user restored successfully');
      return user;
    }
    return null;
  } catch (error) {
    const status = error?.status || error?.response?.status;
    if (status === 401 || status === 403) {
      log('stored token invalid (401/403), clearing session');
      await clearStoredNativeToken();
    } else {
      log('session restore failed (network/server error), keeping token:', error?.message);
    }
    return null;
  }
}