/**
 * nativeTokenStorage.js
 *
 * LIGHTWEIGHT storage-only helper for native token persistence.
 * MUST NOT import the API client, App, AuthContext, or other runtime modules.
 *
 * Used by main.jsx before the React app is imported.
 */

import { Preferences } from '@capacitor/preferences';

const TOKEN_KEY = 'voxyl_access_token';
const log = (...args) => console.log('[AUTH]', ...args);

// ── localStorage helpers ──────────────────────────────────────────────────────

function lsGet() {
  try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}

function lsSet(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem('token', token);
  } catch {}
}

function lsClear() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('token');
  } catch {}
}

// ── Capacitor Preferences helpers ────────────────────────────────────────────

async function prefGet() {
  try {
    const result = await Preferences.get({ key: TOKEN_KEY });
    return result?.value || null;
  } catch { return null; }
}

async function prefSet(token) {
  try { await Preferences.set({ key: TOKEN_KEY, value: token }); } catch {}
}

async function prefClear() {
  try { await Preferences.remove({ key: TOKEN_KEY }); } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called in main.jsx before app imports.
 * Reads Capacitor Preferences and writes to localStorage if needed,
 * so native sessions can survive app restarts.
 */
export async function hydrateLocalStorageFromPreferences() {
  const lsToken = lsGet();
  log('localStorage token exists:', !!lsToken);
  if (lsToken) return; // already there

  const prefToken = await prefGet();
  log('native Preferences token exists:', !!prefToken);

  if (prefToken) {
    log('hydrating localStorage from Preferences');
    lsSet(prefToken);
    log('localStorage token after hydration:', !!lsGet());
  }
}

/**
 * Persists token to BOTH localStorage and Capacitor Preferences.
 */
export async function setStoredNativeToken(token) {
  if (!token) return;
  log('saving token to localStorage and Preferences');
  lsSet(token);
  log('localStorage verify after save:', !!lsGet());
  await prefSet(token);
  const verify = await prefGet();
  log('Preferences verify after save:', !!verify);
  log('token saved successfully');
}

/**
 * Reads token from localStorage, falling back to Capacitor Preferences.
 * Hydrates localStorage if Preferences has the token but localStorage doesn't.
 */
export async function getStoredNativeToken() {
  const lsToken = lsGet();
  log('localStorage token exists:', !!lsToken);
  if (lsToken) return lsToken;

  const prefToken = await prefGet();
  log('native Preferences token exists:', !!prefToken);

  if (prefToken) {
    log('hydrated localStorage from native Preferences');
    lsSet(prefToken);
    return prefToken;
  }

  return null;
}

/**
 * Clears token from BOTH localStorage and Capacitor Preferences.
 * Only called on explicit logout or definitive 401/403.
 */
export async function clearStoredNativeToken() {
  log('clearing stored token from localStorage and Preferences');
  lsClear();
  await prefClear();
}