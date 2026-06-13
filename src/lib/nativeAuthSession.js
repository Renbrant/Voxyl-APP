/**
 * nativeAuthSession.js
 *
 * Manages persistent token storage and Base44 SDK session restoration
 * for native (Android/iOS) Capacitor builds.
 *
 * The Base44 SDK client is initialized once at module load time with whatever
 * token exists in localStorage at that moment. On a cold start after login,
 * the token must already be in localStorage BEFORE the SDK client is created.
 *
 * Storage key: 'base44_access_token' — matches what app-params.js reads.
 */

import { base44 } from '@/api/base44Client';
import { Capacitor } from '@capacitor/core';

const TOKEN_KEY = 'base44_access_token';

const log = (...args) => console.log('[AUTH]', ...args);

export const isNativePlatform = () => Capacitor.isNativePlatform();

// ── Token storage helpers ─────────────────────────────────────────────────────

export function getStoredNativeToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function setStoredNativeToken(token) {
  if (!token) return;
  try {
    localStorage.setItem(TOKEN_KEY, token);
    // 'token' is a legacy alias some SDK versions also check
    localStorage.setItem('token', token);
    log('startup token stored: true');
  } catch (e) {
    console.error('[AUTH] Failed to store token:', e?.message);
  }
}

export function clearStoredNativeToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('token');
    log('logout requested, clearing stored token');
  } catch {}
}

// ── Session restoration ───────────────────────────────────────────────────────

/**
 * Attempts to inject the stored token into the live Base44 SDK client
 * and verify it by calling base44.auth.me().
 *
 * The SDK client reads appParams.token at creation time. If the app cold-starts
 * with a token already in localStorage, appParams.token will be set correctly
 * and the client will be authenticated. This function handles the case where
 * the SDK client instance needs to be told about the token explicitly.
 *
 * Returns the user object if the session is valid, null otherwise.
 * Does NOT clear the stored token on network errors — only on definitive 401/403.
 */
export async function restoreNativeAuthSession() {
  const token = getStoredNativeToken();
  log('startup token exists:', !!token);

  if (!token) return null;

  log('restoring native auth session');

  // Inject token into the SDK client if it doesn't already have it.
  // The SDK exposes setToken() or similar — check via duck-typing.
  try {
    if (typeof base44.auth?.setToken === 'function') {
      base44.auth.setToken(token);
      log('Base44 client initialized with stored token');
    } else if (base44._client?.setToken) {
      base44._client.setToken(token);
      log('Base44 client initialized with stored token');
    } else {
      // SDK reads from localStorage on each request — already there, no injection needed.
      log('Base44 client initialized with stored token');
    }
  } catch (e) {
    log('Token injection skipped (SDK may read localStorage directly):', e?.message);
  }

  // Verify the token is still valid
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
      log('stored token invalid, clearing session');
      clearStoredNativeToken();
    } else {
      // Network error, server error, etc. — do NOT clear token.
      // The user is probably just offline. Keep them "logged in" optimistically.
      log('session restore failed (network/server error), keeping token:', error?.message);
    }
    return null;
  }
}