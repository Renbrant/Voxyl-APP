/**
 * nativeAuthSession.js
 *
 * Session restoration logic for native platforms.
 * Safe to import the API client here because this file is only imported after
 * hydrateLocalStorageFromPreferences() has already run in main.jsx.
 *
 * Storage helpers live in nativeTokenStorage.js (no voxylApi imports).
 */

import { voxylApi } from '@/api/voxylApiClient';
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
 * Verifies the stored token by calling the Worker-backed auth endpoint.
 * Returns the user object if valid, null otherwise.
 * Only clears the token on definitive 401/403 — never on network errors.
 */
export async function restoreNativeAuthSession() {
  const token = await getStoredNativeToken();
  log('startup token exists:', !!token);

  if (!token) return null;

  log('restoring native auth session');

  // Older native sessions may have a stored token before Clerk is ready
  try {
    if (typeof voxylApi.auth?.setToken === 'function') {
      voxylApi.auth.setToken(token);
    } else if (voxylApi._client?.setToken) {
      voxylApi._client.setToken(token);
    }
  } catch {}

  try {
    const user = await voxylApi.auth.me();
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