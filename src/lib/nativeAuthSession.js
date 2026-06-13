/**
 * nativeAuthSession.js
 *
 * Base44 session restoration logic for native platforms.
 * Safe to import base44 here because this file is only imported AFTER
 * hydrateLocalStorageFromPreferences() has already run in main.jsx.
 *
 * Storage helpers live in nativeTokenStorage.js (no Base44 imports).
 */

import { base44 } from '@/api/base44Client';
import { Capacitor } from '@capacitor/core';
import {
  getStoredNativeToken,
  clearStoredNativeToken,
} from '@/lib/nativeTokenStorage';

// Re-export storage helpers so AuthContext only needs one import
export { getStoredNativeToken, clearStoredNativeToken, setStoredNativeToken } from '@/lib/nativeTokenStorage';

const log = (...args) => console.log('[AUTH]', ...args);

export const isNativePlatform = () => Capacitor.isNativePlatform();

/**
 * Verifies the stored token by calling base44.auth.me().
 * Returns the user object if valid, null otherwise.
 * Only clears the token on definitive 401/403 — never on network errors.
 */
export async function restoreNativeAuthSession() {
  const token = await getStoredNativeToken();
  log('startup token exists:', !!token);

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